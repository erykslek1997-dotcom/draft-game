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
type Row = { rel: number; off: number; rims: number[]; team: number; label: string; drv: number; mx: number; end: number; five: PlayerSpan[] };
const rows: Row[] = [];
for (const t of ts) {
  const end = parseInt(t.season.slice(0, 4), 10) + 1;
  const top = [...(byTeam[`${end}|${t.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const five = spans.slice(0, 5) as PlayerSpan[];
  const b = scoreTeam({ id: t.team, name: t.team, draftSlot: 1, isHuman: false, roster: spans as PlayerSpan[], rotation: autoAssignRotation(spans as PlayerSpan[]) });
  rows.push({ rel: t.ortg - lgOrtg.get(t.season)!, off: b.offenseScore, rims: five.map(rimPressureForFit).sort((a, c) => c - a), team: rimPressureTeam(five), label: `${t.season} ${t.team}`, drv: mean(five.map(driveScore)), mx: mean(five.map(blend)), end, five });
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

// 1997-98 on only (every player has zone data), and blends: today's rim pressure plus k × the drive
// score for a player today reads 0-40 on (a guard who gets to the rim and the line)
const late = rows.filter((r) => r.end >= 1998);
const offL = late.map((r) => r.off), relL = late.map((r) => r.rel), relLR = resid(relL, offL);
console.log(`\n1997-98 on: ${late.length} team-seasons`);
for (const k of [0, 0.15, 0.3, 0.5, 0.75, 1]) {
  const v = late.map((r) => mean(r.five.map((s) => { const t = rimPressureForFit(s); return Math.max(t, t + k * driveScore(s) * (1 - t / 100)); })));
  console.log(`  today + ${k} × drive  r ${corr(v, relL).toFixed(3)}, beyond Offense ${corr(resid(v, offL), relLR).toFixed(3)}`);
}
const vd = late.map((r) => r.drv);
console.log(`  drive alone         r ${corr(vd, relL).toFixed(3)}, beyond Offense ${corr(resid(vd, offL), relLR).toFixed(3)}`);

// 2026-10-29 (the user: "Shaq case w rimP… jak Curry w spacingu, powinien znacznie zawyżać. Podobnie
// Giannis"): does a team with one dominant rim force score more than the five's mean says? Fit ORtg
// on the engine's team rim (and on Offense), then the miss for teams by their best rim player.
{
  const team = rows.map((r) => r.team);
  const rR = resid(rel, team), rO = resid(rel, off);
  const band = (r: Row) => (r.rims[0] >= 95 ? 'best 95+' : r.rims[0] >= 80 ? 'best 80-94' : r.rims[0] >= 60 ? 'best 60-79' : 'best <60');
  console.log('\nORtg miss by the best rim player (+ = the team scored more than predicted):');
  console.log('  band          n    vs team rim   vs Offense   example');
  for (const k of ['best 95+', 'best 80-94', 'best 60-79', 'best <60']) {
    const idx = rows.map((r, i) => (band(r) === k ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const ex = idx.slice(0, 2).map((i) => rows[i].label).join('; ');
    console.log(`  ${k.padEnd(12)} ${String(idx.length).padStart(4)}   ${mean(idx.map((i) => rR[i])).toFixed(2).padStart(6)}       ${mean(idx.map((i) => rO[i])).toFixed(2).padStart(6)}     ${ex}`);
  }
}
