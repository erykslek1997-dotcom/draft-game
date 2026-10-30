import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam, spacingScore } from '../src/engine/scoring';
import { computeTalent } from '../src/engine/talent';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-30 (the user: "waga spacingu powinna być na podstawie lat 15-26" — LeBron 2012-14 with
 * weak shooters and a post centre won a league): the auditTeams build, then, by era, whether the
 * team Spacing score explains what Overall misses of real SRS, and the extra weight that would
 * close it (Overall points per Spacing point). Based on auditTeams.ts:: the engine's
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

type Row = { spc: number; label: string; end: number; srs: number; ovr: number; off: number; def: number; tal: number; spans: PlayerSpan[]; minShare: number[] };
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
  rows.push({ spc: spacingScore(teamOf(spans as PlayerSpan[], `${end}-${ts.team}`)), label: `${ts.season} ${ts.team}`, end, srs: ts.srs, ovr: b.overallExact, off: b.offenseScore, def: b.defenseScore, tal: b.talentScore, spans: spans as PlayerSpan[], minShare: top.map((r) => r.minutes / total) });
}

const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};
// Two-variable least squares: SRS = a + b·Overall + c·Spacing.
function fit(rs: Row[]) {
  const y = rs.map((x) => x.srs), x1 = rs.map((x) => x.ovr), x2 = rs.map((x) => x.spc);
  const m1 = mean(x1), m2 = mean(x2), my = mean(y);
  let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0;
  rs.forEach((_, i) => { const a = x1[i] - m1, b = x2[i] - m2, c = y[i] - my; s11 += a * a; s22 += b * b; s12 += a * b; s1y += a * c; s2y += b * c; });
  const det = s11 * s22 - s12 * s12;
  const b1 = (s22 * s1y - s12 * s2y) / det, b2 = (s11 * s2y - s12 * s1y) / det;
  const pred = rs.map((_, i) => my + b1 * (x1[i] - m1) + b2 * (x2[i] - m2));
  return { n: rs.length, r: corr(x1, y), r2both: corr(pred, y), b1, b2, perSpacing: b2 / b1, resSpc: corr(x2, rs.map((x, i) => y[i] - (my + (corr(x1, y) * Math.sqrt(mean(y.map((v) => (v - my) ** 2)))) / Math.sqrt(mean(x1.map((v) => (v - m1) ** 2))) * (x1[i] - m1)))) };
}
for (const [label, from, to] of [['all 1974-2026', 1974, 2026], ['1974-2004', 1974, 2004], ['2005-2014', 2005, 2014], ['2015-2026', 2015, 2026]] as const) {
  const f = fit(rows.filter((x) => x.end >= from && x.end <= to));
  console.log(`${label.padEnd(14)} n ${String(f.n).padStart(3)} · Overall↔SRS r ${f.r.toFixed(3)} → with Spacing ${f.r2both.toFixed(3)} · Spacing vs what Overall misses r ${f.resSpc.toFixed(2)} · extra weight ${f.perSpacing.toFixed(3)} Overall points per Spacing point`);
}
