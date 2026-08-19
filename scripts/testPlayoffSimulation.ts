import { players } from '../src/data/players';
import { autoAssignRotation } from '../src/engine/rotation';
import { simulateSeason } from '../src/engine/seasonSimulation';
import { simulatePlayoffs } from '../src/engine/playoffSimulation';
import { TEAM_COUNT } from '../src/engine/positions';
import type { PlayerSpan } from '../src/data/schema';
import type { Team } from '../src/engine/types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function pick(playerName: string, spanLabel: string): PlayerSpan {
  const player = players.find((candidate) => candidate.playerName === playerName && candidate.spanLabel === spanLabel);
  if (!player) throw new Error(`Missing playoff-sim fixture: ${playerName}, ${spanLabel}`);
  return player;
}

function team(id: string, roster: PlayerSpan[]): Team {
  return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
}

// Same fixtures testSeasonSimulation.ts already validates exist.
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

const strongTeam = team('playoff-sim-strong', strongRoster);
const weakTeam = team('playoff-sim-weak', weakRoster);
const teams: Team[] = [
  strongTeam,
  weakTeam,
  ...Array.from({ length: TEAM_COUNT - 2 }, (_, i) => team(`playoff-sim-filler-${i}`, fillerRoster)),
];

const standings = simulateSeason(teams);
const result = simulatePlayoffs(teams, standings);
assert(result !== null, 'simulates a bracket for the real 16-team case');
const bracket = result!;

assert(bracket.rounds.length === 4, 'bracket has exactly 4 rounds (16 -> 8 -> 4 -> 2 -> 1)');
assert(
  bracket.rounds.map((r) => r.length).join(',') === '8,4,2,1',
  `each round has the expected series count (${bracket.rounds.map((r) => r.length).join(',')})`,
);

const totalSeries = bracket.rounds.reduce((sum, r) => sum + r.length, 0);
assert(totalSeries === 15, `bracket plays exactly 15 series total (${totalSeries})`);

for (const round of bracket.rounds) {
  for (const series of round) {
    assert(
      (series.gamesWonA === 4 && series.gamesWonB < 4) || (series.gamesWonB === 4 && series.gamesWonA < 4),
      `${series.roundLabel} series ${series.teamAId} vs ${series.teamBId} resolves to a real BO7 tally (${series.gamesWonA}-${series.gamesWonB})`,
    );
    assert(
      series.winnerId === series.teamAId || series.winnerId === series.teamBId,
      `${series.roundLabel} series winner is one of the two participants`,
    );
  }
}

// Every round-2+ participant must be a round-1 winner (the bracket actually advances winners, not
// a disconnected re-seed).
for (let r = 1; r < bracket.rounds.length; r++) {
  const previousWinners = new Set(bracket.rounds[r - 1].map((s) => s.winnerId));
  for (const series of bracket.rounds[r]) {
    assert(previousWinners.has(series.teamAId), `${series.roundLabel} team A actually won its previous-round series`);
    assert(previousWinners.has(series.teamBId), `${series.roundLabel} team B actually won its previous-round series`);
  }
}

const finals = bracket.rounds[3][0];
assert(bracket.championId === finals.winnerId, "championId matches the Finals series' winner");

// Statistical check: the weak roster is a clear per-game underdog against every other roster in
// this pool (~0.95-0.96 win prob against it either way, confirmed directly via `projectMatchup`
// before writing this assertion — the 14 filler copies are genuinely strong too, built on a
// LeBron/Holiday/Millsap peak core, so "the roster with the most players" isn't automatically the
// favorite here; only the weak roster's disadvantage is unambiguous). It should essentially never
// win a 4-round bracket across repeated rolls.
const BRACKETS_TO_SAMPLE = 30;
let weakChampionships = 0;
for (let i = 0; i < BRACKETS_TO_SAMPLE; i++) {
  const rolled = simulatePlayoffs(teams, standings)!;
  if (rolled.championId === weakTeam.id) weakChampionships++;
}
assert(
  weakChampionships === 0,
  `the clearly-worst roster never wins the simulated bracket across ${BRACKETS_TO_SAMPLE} rolls (${weakChampionships}/${BRACKETS_TO_SAMPLE})`,
);

console.log('Playoff-simulation tests complete.');
