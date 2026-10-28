import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { realSeason } from '../src/engine/realAdvancedLookup';
import { autoAssignRotation } from '../src/engine/rotation';
import { offenseScore } from '../src/engine/scoring';
import { computeOffensiveTalent } from '../src/engine/talent';
import { rimPressureForFit } from '../src/engine/rimPressure';
import { teamSpacingValue } from '../src/engine/midrangeGravity';
import { mechanicsPer100 } from '../src/engine/liveGame';
import benchTeams from '../src/data/benchTeams.json';
import { spanById } from '../src/engine/bestFive';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-28, step 6.3, team-season version (the user: Giannis at Spacing 51 barely pays): does a star who scores at the
 * rim and cannot shoot lose more beside poor shooters than other stars do? Same units and loader as
 * `measureBallDominance.ts`. The star = the five's top O-TAL; "rim star" = his rim pressure high and
 * his own spacing low; the four beside him = their mean spacing value (`teamSpacingValue`).
 *
 * (Loader copied from measureBallDominance.ts — step 6.2:)
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

type Row = { offense: number; rimStar: number; mates: number; starO: number; y: number; mech: number; w: number; who: string };
const rows: Row[] = [];
const yard = (benchTeams as { teams: { ids: string[] }[] }[]).slice(0, 4).map((lg, L) => {
  const ts = lg.teams.map((t, i) => teamOf(t.ids.map(spanById).filter(Boolean) as PlayerSpan[], `y${L}-${i}`));
  return ts.sort((a, b) => scoreTeam(a).overallExact - scoreTeam(b).overallExact)[Math.floor(ts.length / 2)];
});
const cache = new Map<string, { offense: number; mech: number }>();
// rim star: rim pressure 0-100 scaled from 50 -> 0 to 80 -> 1, times his own spacing deficit (spacing 60 -> 0, 30 -> 1).
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
// Team-seasons (BBRef, 1973-74 on): the five with the most minutes on that team.
const rosterRows = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(rosterRows, (r) => `${r.end}|${r.team}`);
let missingTeams = 0;
for (const ts of teamSeasons as { season: string; team: string; ortg: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  const top = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes).slice(0, 5);
  const five = top.map((r) => spanFor(r.name, end)) as PlayerSpan[];
  if (top.length < 5 || five.some((x) => !x) || !leagueOrtg.has(ts.season)) {
    missingTeams++;
    continue;
  }
  const key = five.map((x) => x.id).sort().join('|');
  let c = cache.get(key);
  if (!c) {
    const t = teamOf(five, key);
    c = { offense: offenseScore(t), mech: yard.reduce((sum, y) => sum + mechanicsPer100(t, y)[0], 0) / yard.length };
    cache.set(key, c);
  }
  const star = [...five].sort((p, q) => computeOffensiveTalent(q) - computeOffensiveTalent(p))[0];
  const rimStar = clamp01((rimPressureForFit(star) - 50) / 30) * clamp01((60 - teamSpacingValue(star)) / 30) * clamp01((computeOffensiveTalent(star) - 75) / 15);
  const mates = mean(five.filter((x) => x !== star).map(teamSpacingValue));
  rows.push({ offense: c.offense, rimStar, mates, starO: computeOffensiveTalent(star), y: ts.ortg - leagueOrtg.get(ts.season)!, mech: c.mech, w: 1, who: `${ts.season} ${ts.team} ${star.playerName} mates spacing ${mates.toFixed(0)}` });
}
console.log(`team-seasons used ${rows.length}, skipped ${missingTeams}`);
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
function report(label: string, names: string[], xf: (r: Row) => number[], yf: (r: Row) => number) {
  const b = wols(rows.map(xf), rows.map(yf), rows.map((r) => r.w));
  const boots = Array.from({ length: 300 }, () => {
    const s = rows.map(() => rows[Math.floor(rnd() * rows.length)]);
    return wols(s.map(xf), s.map(yf), s.map((r) => r.w));
  });
  console.log(`\n${label}`);
  names.forEach((n, j) => {
    const v = boots.map((c) => c[j + 1]).sort((p, q) => p - q);
    console.log(`  ${n.padEnd(44)} ${b[j + 1].toFixed(3).padStart(7)}   90% ${v[15].toFixed(3)} … ${v[285].toFixed(3)}`);
  });
}
const rs = rows.filter((r) => r.rimStar > 0.3);
console.log(`${rows.length} units; with a rim star (> 0.3): ${rs.length} — ${[...new Set(rs.map((r) => r.who.split(' ').slice(2, -3).join(' ')))].join(', ')}`);
const X = (r: Row) => [r.offense, r.rimStar, (r.mates - 50) / 10, r.rimStar * ((50 - r.mates) / 10)];
const names = ['Offense', 'rim star', 'mates spacing (per 10)', 'rim star × mates spacing deficit (per 10)'];
report('REAL ORtg over league', names, X, (r) => r.y);
report('GAME mechanics offense a 100 trips', names, X, (r) => r.mech);
