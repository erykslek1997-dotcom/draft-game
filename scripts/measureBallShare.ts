import lineups from '../src/data/awards/lineups5.json';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { fitScore } from '../src/engine/fit';
import { offenseScore, realUsageShare, scoreTeam } from '../src/engine/scoring';
import { teamLiftPoints, teammateLift } from '../src/engine/teammateLift';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-28, step 6.2 (the user's export: Harden 2016-18 + Kobe 2007-09, both shot-first first
 * options, take +2.5 Overall of teammate lift and pay ~0.7 for the clash): on real NBA.com five-man
 * units (2007-08 on, 300+ min, ORtg over the league's), what do the lift and a second high-usage
 * scorer add over the five's Offense score? Lift is the engine's own reading (points a game, real
 * teammate TS gains); usage is each player's real share of his team's possessions.
 *
 *   npx tsx scripts/measureBallShare.ts [--min=300] [--high=0.28]
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const MIN_UNIT_MINUTES = Number(args.min ?? 300);
const HIGH_USAGE = Number(args.high ?? 0.28);

const teamOf = (roster: PlayerSpan[], id: string): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) });
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
function ols(X: number[][], y: number[]) {
  const rows = X.map((r) => [1, ...r]);
  const k = rows[0].length;
  const A = Array.from({ length: k }, (_, i) => [...Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)), rows.reduce((s, r, n) => s + r[i] * y[n], 0)]);
  for (let i = 0; i < k; i++) {
    const p = A[i][i];
    for (let j = i; j <= k; j++) A[i][j] /= p;
    for (let r = 0; r < k; r++) if (r !== i) for (let j = k; j >= i; j--) A[r][j] -= A[r][i] * A[i][j];
  }
  return A.map((r) => r[k]);
}
let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
function fitWithCi(label: string, names: string[], X: number[][], y: number[]) {
  const b = ols(X, y);
  const boots = Array.from({ length: 400 }, () => {
    const idx = X.map(() => Math.floor(rnd() * X.length));
    return ols(idx.map((i) => X[i]), idx.map((i) => y[i]));
  });
  console.log(`\n${label}`);
  names.forEach((n, j) => {
    const v = boots.map((c) => c[j + 1]).sort((p, q) => p - q);
    console.log(`  ${n.padEnd(34)} ${b[j + 1].toFixed(3).padStart(7)}   90% ${v[20].toFixed(3)} … ${v[380].toFixed(3)}`);
  });
}

const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
const spanFor = (name: string, endYear: number) =>
  (byName.get(name) ?? [])
    .filter((s) => spanEndYears(s.spanLabel).includes(endYear))
    .sort((a, b) => {
      const mid = (s: PlayerSpan) => {
        const ys = spanEndYears(s.spanLabel);
        return Math.abs(ys[Math.floor(ys.length / 2)] - endYear);
      };
      return mid(a) - mid(b);
    })[0];
const leagueOrtg = new Map<string, number>();
for (const [season, rows] of Object.entries(Object.groupBy(teamSeasons as { season: string; ortg: number }[], (r) => r.season)))
  leagueOrtg.set(season, mean(rows!.map((r) => r.ortg)));

const rows: { offense: number; fit: number; lift: number; topLift: number; restLift: number; load: number; high: number; second: number; y: number; who: string }[] = [];
for (const u of lineups as { season: string; team: string; players: string[]; min: number; ortg: number }[]) {
  if (u.min < MIN_UNIT_MINUTES || !leagueOrtg.has(u.season)) continue;
  const five = u.players.map((n) => spanFor(n, parseInt(u.season.slice(0, 4), 10) + 1));
  if (five.some((s) => !s)) continue;
  const team = teamOf(five as PlayerSpan[], `${u.season}-${u.team}`);
  const usage = (five as PlayerSpan[]).map(realUsageShare).sort((a, b) => b - a);
  const lifts = (five as PlayerSpan[]).map((s) => teammateLift(s).lift).sort((a, b) => b - a);
  rows.push({
    offense: offenseScore(team),
    fit: fitScore(team).score,
    lift: teamLiftPoints(team),
    topLift: lifts[0] * 196,
    restLift: lifts.slice(1).reduce((a, b) => a + b, 0) * 196,
    load: usage.reduce((a, b) => a + b, 0),
    high: usage.filter((x) => x >= HIGH_USAGE).length,
    second: usage[1],
    y: u.ortg - leagueOrtg.get(u.season)!,
    who: `${u.season} ${u.team}`,
  });
}
console.log(`${rows.length} real fives, ${MIN_UNIT_MINUTES}+ min; high usage = ${HIGH_USAGE}+ (fives with 2+: ${rows.filter((r) => r.high >= 2).length})`);
const y = rows.map((r) => r.y);
fitWithCi('ORtg over league ~ Offense + lift (engine points a game)', ['Offense', 'lift'], rows.map((r) => [r.offense, r.lift]), y);
fitWithCi('… lift split: the top lifter vs the other four (diminishing?)', ['Offense', 'top lifter', 'other four'], rows.map((r) => [r.offense, r.topLift, r.restLift]), y);
fitWithCi('… usage: the five\'s summed real usage', ['Offense', 'usage load (1.0 = one ball)'], rows.map((r) => [r.offense, r.load]), y);
fitWithCi('… a second high-usage scorer', ['Offense', 'second-highest usage', '2+ high-usage (0/1)'], rows.map((r) => [r.offense, r.second, r.high >= 2 ? 1 : 0]), y);
fitWithCi('… Fit (holds the shot-first clash) over Offense', ['Offense', 'Fit'], rows.map((r) => [r.offense, r.fit]), y);
void scoreTeam;
