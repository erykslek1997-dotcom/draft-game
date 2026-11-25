// 2026-11-22 (recreated 2026-11-25): the engine against plain window BPM on the same real teams.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { computeTalent } from '../src/engine/talent';
import { realSeason } from '../src/engine/realAdvancedLookup';
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
/** `--quick` (2026-11-04, fast calibration): every third team-season — ~3x faster, for iterating;
 * the full run stays the number of record before a merge. */
const QUICK = 'quick' in args || process.env.JUDGE_QUICK === '1';

const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
// PRIOR=1: a forecast — the window ending the season before (nothing from the team's own season).
const PRIOR = process.env.PRIOR === '1';
const spanFor = (name: string, endYear: number) =>
  (byName.get(normalizePlayerName(name)) ?? [])
    .filter((s) => PRIOR ? Math.max(...spanEndYears(s.spanLabel)) < endYear && Math.max(...spanEndYears(s.spanLabel)) >= endYear - 3 : spanEndYears(s.spanLabel).includes(endYear))
    .sort((a, b) => {
      const mid = (s: PlayerSpan) => {
        const ys = spanEndYears(s.spanLabel);
        return Math.abs(ys[Math.floor(ys.length / 2)] - endYear);
      };
      return PRIOR ? Math.max(...spanEndYears(b.spanLabel)) - Math.max(...spanEndYears(a.spanLabel)) : mid(a) - mid(b);
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
for (const [tsIndex, ts] of (teamSeasons as { season: string; team: string; srs: number }[]).entries()) {
  if (QUICK && tsIndex % 3 !== 0) continue;
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
// YEAR_FROM: only team-seasons ending in or after that year (the era test).
if (process.env.YEAR_FROM) rows.splice(0, rows.length, ...rows.filter((x) => x.end >= Number(process.env.YEAR_FROM)));
const r = (xs: number[]) => corr(xs, rows.map((x) => x.srs)).toFixed(3);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const winBpm = (s: PlayerSpan, skip?: number) => {
  let a = 0, w = 0;
  for (const y of spanEndYears(s.spanLabel)) { if (y === skip) continue; const q = realSeason(s.playerName, y); const b = num(q?.bpm), m = num(q?.mp); if (b !== undefined && m) { a += b * m; w += m; } }
  return w ? a / w : undefined;
};
const teamVal = (row: Row, f: (s: PlayerSpan) => number | undefined, real: boolean) => {
  let a = 0, w = 0; row.spans.forEach((s, i) => { const v = f(s); if (v === undefined) return; const wt = real ? row.minShare[i] : 1; a += v * wt; w += wt; }); return w ? a / w : 0;
};
const ownBpm = (row: Row) => (s: PlayerSpan) => num(realSeason(s.playerName, row.end)?.bpm);
console.log(`teams ${rows.length}`);
console.log(`engine Overall             ${r(rows.map((x) => x.ovr))}`);
console.log(`engine Talent only         ${r(rows.map((x) => x.tal))}`);
console.log(`window BPM, equal weights  ${r(rows.map((x) => teamVal(x, (s) => winBpm(s), false)))}`);
console.log(`window BPM, real minutes   ${r(rows.map((x) => teamVal(x, (s) => winBpm(s), true)))}`);
console.log(`window BPM w/o that season, equal  ${r(rows.map((x) => teamVal(x, (s) => winBpm(s, x.end), false)))}`);
console.log(`window BPM w/o that season, minutes ${r(rows.map((x) => teamVal(x, (s) => winBpm(s, x.end), true)))}`);
console.log(`same-season BPM, real minutes (cheat) ${r(rows.map((x) => teamVal(x, ownBpm(x), true)))}`);
// How far a blend of the engine and window BPM gets (z-scores, equal top-8 weights).
const z = (v: number[]) => { const m = mean(v), s = Math.sqrt(mean(v.map((x) => (x - m) ** 2))); return v.map((x) => (x - m) / s); };
const zo = z(rows.map((x) => x.ovr)), zb = z(rows.map((x) => teamVal(x, (s) => winBpm(s), false))), zt = z(rows.map((x) => x.tal));
for (const w of [0.25, 0.5, 1, 2]) console.log(`Overall + ${w} x BPM  ${r(zo.map((v, i) => v + w * zb[i]))}   Talent + ${w} x BPM ${r(zt.map((v, i) => v + w * zb[i]))}`);
// Which players' TAL disagrees most with their window BPM (by position-free regression)?
const all = rows.flatMap((x) => x.spans);
const uniq = [...new Map(all.map((s) => [s.id, s])).values()].filter((s) => winBpm(s) !== undefined);
const tl = uniq.map((s) => computeTalent(s)), bp = uniq.map((s) => winBpm(s)!);
console.log(`players ${uniq.length}: r(TAL, window BPM) ${corr(tl, bp).toFixed(3)}`);
for (const w of [0.5, 1, 2]) console.log(`Overall + ${w} x Talent  ${r(zo.map((v, i) => v + w * zt[i]))}`);
