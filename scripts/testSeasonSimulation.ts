import { players } from '../src/data/players';
import { autoAssignRotation } from '../src/engine/rotation';
import { simulateSeason, REGULAR_SEASON_GAMES } from '../src/engine/seasonSimulation';
import { projectMatchup } from '../src/engine/matchup';
import { TEAM_COUNT } from '../src/engine/positions';
import type { PlayerSpan } from '../src/data/schema';
import type { Team } from '../src/engine/types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function pick(playerName: string, spanLabel: string): PlayerSpan {
  const player = players.find((candidate) => candidate.playerName === playerName && candidate.spanLabel === spanLabel);
  if (!player) throw new Error(`Missing season-sim fixture: ${playerName}, ${spanLabel}`);
  return player;
}

function team(id: string, roster: PlayerSpan[]): Team {
  return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
}

// Same fixtures testScoringLogic.ts/testFit.ts already validate exist — reused rather than
// invented so this doesn't add a third copy of "which spans are safe to build a synthetic team
// from" to keep in sync with the pool.
const strongRoster = [
  pick('Kareem Abdul-Jabbar', '1975-77'),
  pick('Tracy McGrady', '2001-03'),
  pick('Charles Barkley', '1991-93'),
  pick('Kyle Lowry', '2016-18'),
  pick('Nic Claxton', '2021-23'),
  pick('Robert Horry', '1997-99'),
  pick('George Hill', '2018-20'),
  pick('Bruce Bowen', '2007-09'),
];
const weakRoster = [
  pick('Ben Simmons', '2017-19'),
  pick('David Thompson', '1976-78'),
  pick('Alex English', '1981-83'),
  pick('Elton Brand', '2005-07'),
  pick("Amar'e Stoudemire", '2007-09'),
];
const fillerRoster = [
  pick('Kyle Lowry', '2015-17'),
  pick('Jrue Holiday', '2021-23'),
  pick('LeBron James', '2008-10'),
  pick('Paul Millsap', '2013-15'),
  pick('Brook Lopez', '2022-24'),
];

const strongTeam = team('season-sim-strong', strongRoster);
const weakTeam = team('season-sim-weak', weakRoster);
const teams: Team[] = [
  strongTeam,
  weakTeam,
  ...Array.from({ length: TEAM_COUNT - 2 }, (_, i) => team(`season-sim-filler-${i}`, fillerRoster)),
];
assert(teams.length === TEAM_COUNT, `builds the real game's exact team count (${TEAM_COUNT})`);

const standings = simulateSeason(teams);

assert(standings.length === TEAM_COUNT, 'returns one standings row per team');
assert(
  standings.every((row) => row.gamesPlayed === REGULAR_SEASON_GAMES),
  `every team plays exactly ${REGULAR_SEASON_GAMES} games (the balanced-schedule construction)`,
);
const totalWins = standings.reduce((sum, row) => sum + row.wins, 0);
const totalLosses = standings.reduce((sum, row) => sum + row.losses, 0);
const expectedTotalGames = (TEAM_COUNT * REGULAR_SEASON_GAMES) / 2;
assert(totalWins === expectedTotalGames, `total league wins equal total scheduled games (${expectedTotalGames})`);
assert(totalWins === totalLosses, 'every win is paired with exactly one loss (zero-sum schedule)');

assert(standings[0].rank === 1, 'best record ranks #1');
for (let i = 1; i < standings.length; i++) {
  assert(standings[i - 1].winPct >= standings[i].winPct, `standings row ${i} is sorted by descending win%`);
}

// Deterministic sanity check on the underlying matchup model itself (not the noisy simulation) —
// the strong roster should be a clear favorite over the weak one before any coin flips happen.
const { gameWinProbA } = projectMatchup(strongTeam, weakTeam);
assert(gameWinProbA > 0.75, `strong roster is a clear per-game favorite over the weak roster (${gameWinProbA.toFixed(2)})`);

// Statistical check across several simulated seasons (cheap: ~656 games/season) — guards that the
// per-game coin flips actually favor the stronger roster in aggregate, not just in one lucky roll.
const SEASONS_TO_SAMPLE = 20;
let strongWinsTotal = 0;
let weakWinsTotal = 0;
for (let s = 0; s < SEASONS_TO_SAMPLE; s++) {
  const rows = simulateSeason(teams);
  strongWinsTotal += rows.find((r) => r.teamId === strongTeam.id)!.wins;
  weakWinsTotal += rows.find((r) => r.teamId === weakTeam.id)!.wins;
}
const strongAvgWins = strongWinsTotal / SEASONS_TO_SAMPLE;
const weakAvgWins = weakWinsTotal / SEASONS_TO_SAMPLE;
assert(
  strongAvgWins - weakAvgWins > 20,
  `strong roster clearly outwins the weak roster across ${SEASONS_TO_SAMPLE} simulated seasons (avg ${strongAvgWins.toFixed(1)} vs ${weakAvgWins.toFixed(1)})`,
);

console.log('Season-simulation tests complete.');
