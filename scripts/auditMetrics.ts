import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { ballHandlerAdjustment, ballLoadAdjustment, scoreTeam } from '../src/engine/scoring';
import { liftAdjustment } from '../src/engine/teammateLift';
import { mechanicsPer100 } from '../src/engine/liveGame';
import { spanById } from '../src/engine/bestFive';
import benchTeams from '../src/data/benchTeams.json';
import { computeTalent } from '../src/engine/talent';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-28 (the user: "sprawdź wszystkie metryki do oceny"): every part of Overall against two
 * judges — real team-seasons (SRS, loader below from auditTeams.ts) and the bench leagues in the
 * game's mechanics (each team's mean margin a 100 trips against its own league). For each part:
 * its weight inside Overall (a least-squares read of Overall on the parts), the weight each judge
 * gives it on the same parts, and the ratio — above 1, the judge wants more of it; below, less.
 *
 * (Loader from auditTeams.ts:)
 * 2026-10-28 (the user: "zrób audyt porównania z nowymi danymi, gdzie mamy błędy"): the engine's
 * team score against how real teams did. Every BBRef team-season 1973-74 on whose eight biggest-
 * minute players are in the pool (each as the pool window closest to that season); the engine
 * scores the eight with its own rotation; the judge is the team's SRS (margin adjusted for
 * schedule). Where the engine misses: by era, by the team's make-up, and per player (ridge: how
 * much a player's teams beat or missed the engine, one shared shrink).
 *
 *   npx tsx scripts/auditTeams.ts [--top=8] [--lambda=6]
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const TOP = Number(args.top ?? 8);
const LAMBDA = Number(args.lambda ?? 6);

const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
const spanFor = (name: string, endYear: number) =>
  (byName.get(normalizePlayerName(name)) ?? [])
    .filter((s) => spanEndYears(s.spanLabel).includes(endYear))
    .sort((a, b) => {
      const mid = (s: PlayerSpan) => {
        const ys = spanEndYears(s.spanLabel);
        return Math.abs(ys[Math.floor(ys.length / 2)] - endYear);
      };
      return mid(a) - mid(b);
    })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const teamOf = (r: PlayerSpan[], id: string): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) });
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

const PARTS = ['Talent', 'Bench depth', 'Rotation', 'Fit', 'Offense', 'Defense', 'Ball load', 'Teammate lift', 'Ball handlers'] as const;
function partsOf(team: Team, b: ReturnType<typeof scoreTeam>): number[] {
  return [b.talentScore, b.benchDepthScore, b.rotationScore, b.fitScore, b.offenseScore, b.defenseScore, ballLoadAdjustment(team), liftAdjustment(team), ballHandlerAdjustment(team)];
}
type Row = { label: string; end: number; srs: number; ovr: number; off: number; def: number; tal: number; spans: PlayerSpan[]; minShare: number[]; parts: number[] };
const rows: Row[] = [];
let skipped = 0;
for (const ts of teamSeasons as { season: string; team: string; srs: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  const all = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes);
  const top = all.slice(0, TOP);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < TOP || spans.some((s) => !s)) {
    skipped++;
    continue;
  }
  const total = all.reduce((s, r) => s + r.minutes, 0);
  const team = teamOf(spans as PlayerSpan[], `${end}-${ts.team}`);
  const b = scoreTeam(team);
  rows.push({ label: `${ts.season} ${ts.team}`, end, srs: ts.srs, ovr: b.overallExact, off: b.offenseScore, def: b.defenseScore, tal: b.talentScore, spans: spans as PlayerSpan[], minShare: top.map((r) => r.minutes / total), parts: partsOf(team, b) });
}

// Bench leagues: the game's mechanics, each team's mean margin a 100 trips against its own league.
const game: { ovr: number; parts: number[]; y: number }[] = [];
for (const lg of benchTeams as { teams: { ids: string[] }[] }[]) {
  const ts = lg.teams.map((t, i) => teamOf(t.ids.map(spanById).filter(Boolean) as PlayerSpan[], `b${i}`));
  for (const t of ts) {
    const y = ts.filter((o) => o !== t).reduce((s, o) => { const [a, c] = mechanicsPer100(t, o); return s + a - c; }, 0) / (ts.length - 1);
    const b = scoreTeam(t);
    game.push({ ovr: b.overallExact, parts: partsOf(t, b), y });
  }
}

function ols(X: number[][], y: number[]) {
  const rows = X.map((r) => [1, ...r]);
  const k = rows[0].length;
  const A = Array.from({ length: k }, (_, i) => [...Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)), rows.reduce((s, r, n) => s + r[i] * y[n], 0)]);
  for (let i = 0; i < k; i++) {
    const p = A[i][i];
    if (Math.abs(p) < 1e-12) continue;
    for (let j = i; j <= k; j++) A[i][j] /= p;
    for (let r = 0; r < k; r++) if (r !== i) for (let j = k; j >= i; j--) A[r][j] -= A[r][i] * A[i][j];
  }
  return A.map((r) => r[k]);
}
const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};
let seed = 3;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function audit(label: string, data: { ovr: number; parts: number[]; y: number }[]) {
  const X = data.map((d) => d.parts);
  const inOverall = ols(X, data.map((d) => d.ovr)).slice(1);
  const judge = ols(X, data.map((d) => d.y)).slice(1);
  // Judge weight in Overall points: scale by how many judge units one Overall point is worth.
  const perOverall = (corr(data.map((d) => d.ovr), data.map((d) => d.y)) * sd(data.map((d) => d.y))) / sd(data.map((d) => d.ovr));
  const boots = Array.from({ length: 200 }, () => {
    const idx = data.map(() => Math.floor(rnd() * data.length));
    return ols(idx.map((i) => X[i]), idx.map((i) => data[i].y)).slice(1);
  });
  console.log(`\n${label}: n ${data.length}, Overall vs judge r ${corr(data.map((d) => d.ovr), data.map((d) => d.y)).toFixed(3)}, ${perOverall.toFixed(2)} judge units per Overall point`);
  console.log('  part            r alone   weight in Overall   judge weight (Overall pts)   90%              judge / Overall');
  PARTS.forEach((p, j) => {
    const v = boots.map((b) => b[j] / perOverall).sort((a, b) => a - b);
    const jw = judge[j] / perOverall;
    const spread = sd(data.map((d) => d.parts[j]));
    if (spread < 1e-9) return console.log(`  ${p.padEnd(15)} (no spread)`);
    console.log(`  ${p.padEnd(15)} ${corr(data.map((d) => d.parts[j]), data.map((d) => d.y)).toFixed(2).padStart(7)}   ${inOverall[j].toFixed(3).padStart(10)}          ${jw.toFixed(3).padStart(10)}              ${v[10].toFixed(3)} … ${v[190].toFixed(3)}   ${(jw / inOverall[j]).toFixed(2).padStart(6)}`);
  });
}
audit(`REAL team-seasons (SRS)${process.env.FROM ? ` from ${process.env.FROM}` : ''}`, rows.filter((r) => r.end >= Number(process.env.FROM ?? 0)).map((r) => ({ ovr: r.ovr, parts: r.parts, y: r.srs })));
audit('GAME bench leagues (margin a 100 trips)', game);
