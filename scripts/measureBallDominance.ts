import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { realSeason } from '../src/engine/realAdvancedLookup';
import { autoAssignRotation } from '../src/engine/rotation';
import { offenseScore } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-28, step 6.2 (the user: "Harden i Kobe nie powinni ze sobą fitować"): does a second
 * ball-dominant player cost a real five offense beyond what its players are worth? Ball dominance
 * measured directly: NBA.com tracking time of possession over minutes played (2013-14 on; Harden
 * and Westbrook 2017-18 ~0.25 of their floor time with the ball, a spot-up wing ~0.03). Every
 * NBA.com five-man unit with `--min` minutes; expectation = the engine's Offense score of that five
 * (each player's pool span covering the season); judge = the unit's ORtg over the league's that
 * season, minutes-weighted.
 *
 *   npx tsx scripts/measureBallDominance.ts [--min=100]
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const MIN_UNIT_MINUTES = Number(args.min ?? 100);
const RAW = resolve(import.meta.dirname, '../src/data/raw/nbaStats');
function csv(file: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(resolve(RAW, file), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

// Ball share by season|player id.
const ball = new Map<string, { name: string; share: number }>();
for (const r of csv('player_possessions.csv')) {
  const min = Number(r.MIN);
  if (min < 200) continue;
  const key = `${r.SEASON}|${r.PLAYER_ID}`;
  const share = Number(r.TIME_OF_POSS) / min;
  const prev = ball.get(key);
  if (!prev || share > prev.share) ball.set(key, { name: r.PLAYER_NAME, share }); // traded players: either row
}

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
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const leagueOrtg = new Map<string, number>();
for (const [season, rows] of Object.entries(Object.groupBy(teamSeasons as { season: string; ortg: number }[], (r) => r.season)))
  leagueOrtg.set(season, mean(rows!.map((r) => r.ortg)));
const teamOf = (roster: PlayerSpan[], id: string): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) });

type Row = { offense: number; b1: number; b2: number; b3: number; u2: number; iso2: boolean; y: number; w: number; who: string };
const rows: Row[] = [];
let skipped = 0;
const offenseCache = new Map<string, number>();
for (const u of csv('lineups_advanced.csv')) {
  const min = Number(u.MIN);
  if (min < MIN_UNIT_MINUTES || !leagueOrtg.has(u.SEASON)) continue;
  const ids = u.GROUP_ID.split('-').filter(Boolean);
  const balls = ids.map((id) => ball.get(`${u.SEASON}|${id}`));
  if (ids.length !== 5 || balls.some((b) => !b)) {
    skipped++;
    continue;
  }
  const end = parseInt(u.SEASON.slice(0, 4), 10) + 1;
  const five = balls.map((b) => spanFor(b!.name, end));
  if (five.some((s) => !s)) {
    skipped++;
    continue;
  }
  const key = five.map((s) => s!.id).sort().join('|');
  let offense = offenseCache.get(key);
  if (offense === undefined) offenseCache.set(key, (offense = offenseScore(teamOf(five as PlayerSpan[], key))));
  const order = balls.map((b, i) => ({ ...b!, i })).sort((a, b) => b.share - a.share);
  // Real USG% of each (BBRef, that season), to separate a second scorer from a second handler.
  const usg = balls.map((b) => Number(realSeason(normalizePlayerName(b!.name), end)?.usg ?? 18) / 100).sort((a, b) => b - a);
  rows.push({
    offense,
    b1: order[0].share,
    b2: order[1].share,
    b3: order[2].share,
    u2: usg[1],
    iso2: false,
    y: Number(u.OFF_RATING) - leagueOrtg.get(u.SEASON)!,
    w: Number(u.POSS) || min,
    who: `${u.SEASON} ${u.TEAM_ABBREVIATION} ${order[0].name.split(' ').at(-1)}(${order[0].share.toFixed(2)})+${order[1].name.split(' ').at(-1)}(${order[1].share.toFixed(2)}) ${Math.round(min)}min`,
  });
}

function wols(X: number[][], y: number[], w: number[]) {
  const rowsX = X.map((r) => [1, ...r]);
  const k = rowsX[0].length;
  const A = Array.from({ length: k }, (_, i) => [...Array.from({ length: k }, (_, j) => rowsX.reduce((s, r, n) => s + w[n] * r[i] * r[j], 0)), rowsX.reduce((s, r, n) => s + w[n] * r[i] * y[n], 0)]);
  for (let i = 0; i < k; i++) {
    const p = A[i][i];
    for (let j = i; j <= k; j++) A[i][j] /= p;
    for (let r = 0; r < k; r++) if (r !== i) for (let j = k; j >= i; j--) A[r][j] -= A[r][i] * A[i][j];
  }
  return A.map((r) => r[k]);
}
let seed = 5;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
function report(label: string, names: string[], xf: (r: Row) => number[], sample = rows) {
  const b = wols(sample.map(xf), sample.map((r) => r.y), sample.map((r) => r.w));
  const boots = Array.from({ length: 300 }, () => {
    const s = sample.map(() => sample[Math.floor(rnd() * sample.length)]);
    return wols(s.map(xf), s.map((r) => r.y), s.map((r) => r.w));
  });
  console.log(`\n${label}`);
  names.forEach((n, j) => {
    const v = boots.map((c) => c[j + 1]).sort((p, q) => p - q);
    console.log(`  ${n.padEnd(40)} ${b[j + 1].toFixed(2).padStart(7)}   90% ${v[15].toFixed(2)} … ${v[285].toFixed(2)}`);
  });
}

console.log(`${rows.length} units (${MIN_UNIT_MINUTES}+ min, 2013-14 on; ${skipped} skipped: no tracking row or a player outside the pool), weighted by possessions`);
const two = (t: number) => rows.filter((r) => r.b2 >= t).length;
console.log(`second ball handler with the ball 15%+ of his time: ${two(0.15)} units, 18%+: ${two(0.18)}, 20%+: ${two(0.2)}`);
report('ORtg over league ~ Offense + ball share of the top three handlers (per 0.10 of floor time)', ['Offense', 'top handler', 'second handler', 'third handler'], (r) => [r.offense, r.b1 * 10, r.b2 * 10, r.b3 * 10]);
report('… a second handler at 18%+ (0/1), and how far past 18%', ['Offense', 'top handler', '2nd at 18%+', '2nd past 18% (per 0.10)'], (r) => [r.offense, r.b1 * 10, r.b2 >= 0.18 ? 1 : 0, Math.max(0, r.b2 - 0.18) * 10]);
report('… only units whose top handler is ball-dominant (20%+): does a second one cost?', ['Offense', 'second handler (per 0.10)'], (r) => [r.offense, r.b2 * 10], rows.filter((r) => r.b1 >= 0.2));

report('… a second high-usage SCORER (2nd-highest USG%, per 0.05) beside the handlers', ['Offense', 'top handler', 'second handler', '2nd-highest usage'], (r) => [r.offense, r.b1 * 10, r.b2 * 10, r.u2 * 20]);
report('… a second scorer at 27%+ usage (0/1)', ['Offense', 'top handler', 'second handler', '2nd usage 27%+'], (r) => [r.offense, r.b1 * 10, r.b2 * 10, r.u2 >= 0.27 ? 1 : 0]);
console.log(`  (units with a second scorer at 27%+: ${rows.filter((r) => r.u2 >= 0.27).length})`);

// The two-handler units, by how far they beat or miss the fit on Offense and the top handler alone.
const b = wols(rows.map((r) => [r.offense, r.b1 * 10]), rows.map((r) => r.y), rows.map((r) => r.w));
const pred = (r: Row) => b[0] + b[1] * r.offense + b[2] * r.b1 * 10;
const pairs = rows.filter((r) => r.b2 >= 0.18 && r.w >= 600);
const wm = (s: Row[]) => s.reduce((a, r) => a + r.w * (r.y - pred(r)), 0) / s.reduce((a, r) => a + r.w, 0);
console.log(`\nTwo handlers at 18%+ (${pairs.length} units with 600+ poss): ORtg vs expectation, weighted mean ${wm(pairs).toFixed(2)} (all units ${wm(rows).toFixed(2)})`);
[...pairs].sort((p, q) => q.w - p.w).slice(0, 25).forEach((r) => console.log(`  ${(r.y - pred(r)).toFixed(1).padStart(6)}  ${r.who}`));
