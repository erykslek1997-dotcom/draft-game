import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { rimPressureForFit, rimPressureTeam } from '../src/engine/rimPressure';
import { boxRatesForSpan } from '../src/engine/boxRatesLookup';
import { computeOffensiveProfile } from '../src/engine/offensiveProfile';
import { eraBaseline } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';

/**
 * 2026-10-29 (the user, playtest 7: "rimP z Shaqiem ma 59"; approved a top-weighted team rim
 * pressure): the team's rim pressure as the plain mean of its five against weightings that lean on
 * the best finisher, judged on real teams 1973-74 on — the five biggest-minute players, each as the
 * pool window closest to that season — by the team's offensive rating over the league that season,
 * alone and beyond the engine's Offense score.
 *
 *   npx tsx scripts/measureRimTeam.ts
 */
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) byName.set(normalizePlayerName(s.playerName), [...(byName.get(normalizePlayerName(s.playerName)) ?? []), s]);
const spanFor = (name: string, end: number) =>
  (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => {
    const mid = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return Math.abs(ys[Math.floor(ys.length / 2)] - end); };
    return mid(a) - mid(b);
  })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const ts = teamSeasons as { season: string; team: string; ortg: number }[];
const lgOrtg = new Map(Object.entries(Object.groupBy(ts, (t) => t.season)).map(([k, g]) => [k, mean(g!.map((t) => t.ortg))]));

// 2026-10-29 (the user: "Billups ma 0 mimo tego że wymuszał sporo osobistych? Parker z 0 też nie
// ma sensu"): a variant for every player, guards included — rim attempts a game (zone share × FGA)
// plus free throws drawn, pace-adjusted, as a pool percentile above the 35th.
const drive = (s: PlayerSpan) => {
  const pr = computeOffensiveProfile(s);
  const rimFga = pr.hasZoneData ? pr.rimShare * s.fga : 0;
  const fta = (boxRatesForSpan(s)?.ftRate ?? 0) * s.fga;
  return (rimFga + 0.44 * fta) * (100 / eraBaseline(s.spanLabel).pace);
};
const zoned = draftPool.filter((s) => computeOffensiveProfile(s).hasZoneData).map(drive).sort((a, b) => a - b);
const pctile = (v: number) => { let lo = 0, hi = zoned.length; while (lo < hi) { const m = (lo + hi) >> 1; if (zoned[m] < v) lo = m + 1; else hi = m; } return (100 * lo) / zoned.length; };
const driveScore = (s: PlayerSpan) => (computeOffensiveProfile(s).hasZoneData ? Math.max(0, (pctile(drive(s)) - 35) / 65) * 100 : rimPressureForFit(s));
const blend = (s: PlayerSpan) => Math.max(rimPressureForFit(s), driveScore(s));
type Row = { rel: number; off: number; rims: number[]; team: number; label: string; drv: number; mx: number };
const rows: Row[] = [];
for (const t of ts) {
  const end = parseInt(t.season.slice(0, 4), 10) + 1;
  const top = [...(byTeam[`${end}|${t.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const five = spans.slice(0, 5) as PlayerSpan[];
  const b = scoreTeam({ id: t.team, name: t.team, draftSlot: 1, isHuman: false, roster: spans as PlayerSpan[], rotation: autoAssignRotation(spans as PlayerSpan[]) });
  rows.push({ rel: t.ortg - lgOrtg.get(t.season)!, off: b.offenseScore, rims: five.map(rimPressureForFit).sort((a, c) => c - a), team: rimPressureTeam(five), label: `${t.season} ${t.team}`, drv: mean(five.map(driveScore)), mx: mean(five.map(blend)) });
}
const corr = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
// what a measure adds to the Offense score: the correlation of its residual on Offense with the ORtg residual on Offense
const resid = (ys: number[], xs: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; }); const s = a / b; return ys.map((y, i) => y - my - s * (xs[i] - mx)); };
const off = rows.map((r) => r.off), rel = rows.map((r) => r.rel), relR = resid(rel, off);
const weights: [string, number[]][] = [
  ['mean (today)', [0.2, 0.2, 0.2, 0.2, 0.2]],
  ['35/25/15/15/10', [0.35, 0.25, 0.15, 0.15, 0.1]],
  ['45/25/10/10/10', [0.45, 0.25, 0.1, 0.1, 0.1]],
  ['60/20/10/5/5', [0.6, 0.2, 0.1, 0.05, 0.05]],
  ['best only', [1, 0, 0, 0, 0]],
];
console.log(`${rows.length} real team-seasons; judge: ORtg over the league that season`);
console.log(`  engine team rim (mean + FT/OREB bonuses): r ${corr(rows.map((r) => r.team), rel).toFixed(3)}, beyond Offense ${corr(resid(rows.map((r) => r.team), off), relR).toFixed(3)}`);
for (const [k, key] of [['drive, everyone', 'drv'], ['max(today, drive)', 'mx']] as const) {
  const v = rows.map((r) => r[key]);
  console.log(`  ${k.padEnd(16)} r ${corr(v, rel).toFixed(3)}, beyond Offense ${corr(resid(v, off), relR).toFixed(3)}`);
}
for (const n of ['Chauncey Billups', 'Tony Parker', 'Dwyane Wade', "Shaquille O'Neal", 'Stephen Curry']) {
  const s = draftPool.filter((p) => p.playerName === n).sort((a, b) => b.fga - a.fga)[0];
  if (s) console.log(`  ${n} ${s.spanLabel}: today ${rimPressureForFit(s).toFixed(0)}, drive ${driveScore(s).toFixed(0)}`);
}
for (const [k, w] of weights) {
  const v = rows.map((r) => r.rims.reduce((s, x, i) => s + x * w[i], 0));
  console.log(`  ${k.padEnd(16)} r ${corr(v, rel).toFixed(3)}, beyond Offense ${corr(resid(v, off), relR).toFixed(3)}`);
}
