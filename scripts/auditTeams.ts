import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { computeTalent } from '../src/engine/talent';
import type { Team } from '../src/engine/types';

/**
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

type Row = { label: string; end: number; srs: number; ovr: number; off: number; def: number; tal: number; spans: PlayerSpan[]; minShare: number[] };
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
  const b = scoreTeam(teamOf(spans as PlayerSpan[], `${end}-${ts.team}`));
  rows.push({ label: `${ts.season} ${ts.team}`, end, srs: ts.srs, ovr: b.overallExact, off: b.offenseScore, def: b.defenseScore, tal: b.talentScore, spans: spans as PlayerSpan[], minShare: top.map((r) => r.minutes / total) });
}
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};
const r = corr(rows.map((x) => x.ovr), rows.map((x) => x.srs));
const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
const slope = (r * sd(rows.map((x) => x.srs))) / sd(rows.map((x) => x.ovr));
const pred = (x: Row) => mean(rows.map((q) => q.srs)) + slope * (x.ovr - mean(rows.map((q) => q.ovr)));
console.log(`${rows.length} team-seasons (${skipped} skipped: a top-${TOP} player outside the pool)`);
console.log(`Overall vs SRS r ${r.toFixed(3)} (Talent ${corr(rows.map((x) => x.tal), rows.map((x) => x.srs)).toFixed(3)}, Offense ${corr(rows.map((x) => x.off), rows.map((x) => x.srs)).toFixed(3)}, Defense ${corr(rows.map((x) => x.def), rows.map((x) => x.srs)).toFixed(3)}); ${slope.toFixed(2)} SRS per Overall point`);

const res = (x: Row) => x.srs - pred(x);
const group = (label: string, key: (x: Row) => string) => {
  console.log(`\nMiss by ${label} (SRS over what Overall says; + = engine underrates):`);
  for (const [k, g] of Object.entries(Object.groupBy(rows, key)).sort()) if (g!.length >= 15) console.log(`  ${k.padEnd(22)} n ${String(g!.length).padStart(4)}  ${mean(g!.map(res)).toFixed(2).padStart(6)}  (Overall↔SRS r ${corr(g!.map((x) => x.ovr), g!.map((x) => x.srs)).toFixed(2)})`);
};
group('decade', (x) => `${Math.floor((x.end - 1) / 10) * 10}s`);
group('Offense vs Defense lean', (x) => (x.off - x.def > 8 ? 'offense-heavy' : x.def - x.off > 8 ? 'defense-heavy' : 'balanced'));
group('top player TAL', (x) => {
  const t = Math.max(...x.spans.map(computeTalent));
  return t >= 95 ? 'superstar 95+' : t >= 88 ? 'star 88-94' : t >= 80 ? 'good 80-87' : 'no star <80';
});
group('depth (8th man TAL)', (x) => {
  const t = [...x.spans.map(computeTalent)].sort((a, b) => b - a)[7];
  return t >= 70 ? 'deep 70+' : t >= 60 ? 'mid 60-69' : 'thin <60';
});
group('top-player minutes share', (x) => (Math.max(...x.minShare) >= 0.16 ? 'star heavy minutes' : 'spread minutes'));

console.log('\nBiggest misses, engine OVERRATES (real SRS far below):');
[...rows].sort((a, b) => res(a) - res(b)).slice(0, 15).forEach((x) => console.log(`  ${res(x).toFixed(1).padStart(6)}  SRS ${x.srs.toFixed(1)}  Ovr ${x.ovr.toFixed(1)} O${x.off} D${x.def}  ${x.label}: ${x.spans.slice(0, 5).map((s) => s.playerName.split(' ').at(-1)).join(', ')}`));
console.log('\nBiggest misses, engine UNDERRATES:');
[...rows].sort((a, b) => res(b) - res(a)).slice(0, 15).forEach((x) => console.log(`  ${res(x).toFixed(1).padStart(6)}  SRS ${x.srs.toFixed(1)}  Ovr ${x.ovr.toFixed(1)} O${x.off} D${x.def}  ${x.label}: ${x.spans.slice(0, 5).map((s) => s.playerName.split(' ').at(-1)).join(', ')}`));

// Per player: ridge on the residual, each team-season's players weighted by their minutes share x5.
const ids = new Map<string, number>();
const names: string[] = [];
for (const x of rows) for (const s of x.spans) {
  const k = s.playerName;
  if (!ids.has(k)) { ids.set(k, names.length); names.push(k); }
}
const n = names.length;
const XtX = new Map<string, number>();
const Xty = new Float64Array(n);
const seasons = new Float64Array(n);
for (const x of rows) {
  const y = res(x);
  const ent = x.spans.map((s, i) => [ids.get(s.playerName)!, x.minShare[i] * 5] as const);
  for (const [i, wi] of ent) {
    Xty[i] += wi * y;
    seasons[i] += wi;
    for (const [j, wj] of ent) XtX.set(`${i},${j}`, (XtX.get(`${i},${j}`) ?? 0) + wi * wj);
  }
}
// Gauss-Seidel on (XtX + λI) b = Xty.
const b = new Float64Array(n);
const neighbours: [number, number][][] = Array.from({ length: n }, () => []);
for (const [k, v] of XtX) {
  const [i, j] = k.split(',').map(Number);
  if (i !== j) neighbours[i].push([j, v]);
}
for (let it = 0; it < 200; it++)
  for (let i = 0; i < n; i++) {
    let s = Xty[i];
    for (const [j, v] of neighbours[i]) s -= v * b[j];
    b[i] = s / ((XtX.get(`${i},${i}`) ?? 0) + LAMBDA);
  }
const order = names.map((nm, i) => ({ nm, v: b[i], w: seasons[i] })).filter((p) => p.w >= 4);
order.sort((p, q) => p.v - q.v);
console.log(`\nPlayers whose teams most MISSED the engine (SRS points per full-minutes season; ridge λ ${LAMBDA}, 4+ weighted seasons):`);
order.slice(0, 25).forEach((p) => console.log(`  ${p.v.toFixed(2).padStart(6)}  ${p.nm} (${p.w.toFixed(1)})`));
console.log('\nPlayers whose teams most BEAT the engine:');
order.slice(-25).reverse().forEach((p) => console.log(`  ${p.v.toFixed(2).padStart(6)}  ${p.nm} (${p.w.toFixed(1)})`));
