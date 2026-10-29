import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { spanEndYears } from '../src/engine/era';
import { computeFinishing } from '../src/engine/finishing';
import { defenderProfile } from '../src/engine/liveDefense';
import { playmakingScoreForPlayer } from '../src/engine/playmakingLookup';
import { rimPressureForFit } from '../src/engine/rimPressure';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { selfCreationEstimate } from '../src/engine/selfCreationSimilarity';
import { computeSpacing } from '../src/engine/spacing';
import { computeOffensiveTalent } from '../src/engine/talent';

/**
 * 2026-10-29 (the user, after the dominant-rim check: "Sprawdź inne statystyki pod tym kątem"): for
 * each player number, do real teams with one dominant player at it (the pool's top 3%, top 3-10%)
 * do better on that side of the ball than the engine's Offense / Defense score says? Judge: ORtg
 * over the league for the offensive numbers, the league's DRtg minus the team's for the defensive
 * ones; the miss is the residual on the engine's side score, by the band of the team's best player.
 * A clearly positive top band is a dominance the engine averages away (as rim pressure was).
 *
 *   npx tsx scripts/measureDominance.ts
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

const metrics: [string, 'O' | 'D', (s: PlayerSpan) => number][] = [
  ['O-TAL', 'O', computeOffensiveTalent],
  ['spacing', 'O', computeSpacing],
  ['rim pressure', 'O', rimPressureForFit],
  ['finishing', 'O', computeFinishing],
  ['playmaking', 'O', (s) => playmakingScoreForPlayer(s) ?? 0],
  ['self-creation', 'O', selfCreationEstimate],
  ['offensive glass /36', 'O', (s) => defenderProfile(s).oreb36],
  ['D-TAL', 'D', computeDefensiveTalent],
  ['rim protection', 'D', (s) => defenderProfile(s).rim],
  ['ball pressure', 'D', (s) => defenderProfile(s).perimeter],
  ['defensive glass /36', 'D', (s) => defenderProfile(s).dreb36],
];
const cut = metrics.map(([, , f]) => { const v = draftPool.map(f).sort((a, b) => a - b); return { p97: v[Math.floor(0.97 * v.length)], p90: v[Math.floor(0.9 * v.length)] }; });

const ts = teamSeasons as { season: string; team: string; ortg: number; drtg: number }[];
const lg = new Map(Object.entries(Object.groupBy(ts, (t) => t.season)).map(([k, g]) => [k, { o: mean(g!.map((t) => t.ortg)), d: mean(g!.map((t) => t.drtg)) }]));
type Row = { o: number; d: number; off: number; def: number; best: number[] };
const rows: Row[] = [];
for (const t of ts) {
  const end = parseInt(t.season.slice(0, 4), 10) + 1;
  const top = [...(byTeam[`${end}|${t.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const r8 = spans as PlayerSpan[];
  const b = scoreTeam({ id: t.team, name: t.team, draftSlot: 1, isHuman: false, roster: r8, rotation: autoAssignRotation(r8) });
  const five = r8.slice(0, 5);
  rows.push({ o: t.ortg - lg.get(t.season)!.o, d: lg.get(t.season)!.d - t.drtg, off: b.offenseScore, def: b.defenseScore, best: metrics.map(([, , f]) => Math.max(...five.map(f))) });
}
const resid = (ys: number[], xs: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; }); const s = a / b; return ys.map((y, i) => y - my - s * (xs[i] - mx)); };
const oR = resid(rows.map((r) => r.o), rows.map((r) => r.off));
const dR = resid(rows.map((r) => r.d), rows.map((r) => r.def));
console.log(`${rows.length} real team-seasons. Miss on the engine's side score (pts per 100; + = the team did better than the engine says), by the team's best player at the number:`);
console.log('  number                 side   top 3% (n)        top 3-10% (n)     rest');
metrics.forEach(([name, side], m) => {
  const res = side === 'O' ? oR : dR;
  const g = (pred: (v: number) => boolean) => { const idx = rows.map((r, i) => (pred(r.best[m]) ? i : -1)).filter((i) => i >= 0); return idx.length ? `${mean(idx.map((i) => res[i])).toFixed(2).padStart(6)} (${String(idx.length).padStart(3)})` : '     — (  0)'; };
  console.log(`  ${name.padEnd(22)} ${side}    ${g((v) => v >= cut[m].p97)}     ${g((v) => v >= cut[m].p90 && v < cut[m].p97)}     ${g((v) => v < cut[m].p90)}`);
});
