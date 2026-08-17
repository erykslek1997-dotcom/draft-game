import { players } from '../src/data/players';
import { autoAssignRotation } from '../src/engine/rotation';
import { benchDepthScore, fitScore, rotationScore, scoreTeam, spacingScore } from '../src/engine/scoring';
import { computeTalent } from '../src/engine/talent';
import type { PlayerSpan } from '../src/data/schema';
import type { Team } from '../src/engine/types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function pick(playerName: string, spanLabel: string): PlayerSpan {
  const player = players.find((candidate) => candidate.playerName === playerName && candidate.spanLabel === spanLabel);
  if (!player) throw new Error(`Missing scoring fixture: ${playerName}, ${spanLabel}`);
  return player;
}

function team(id: string, roster: PlayerSpan[]): Team {
  return {
    id,
    name: id,
    draftSlot: 1,
    isHuman: false,
    roster,
    rotation: autoAssignRotation(roster),
  };
}

const badFit = team('bad-fit', [
  pick('Ben Simmons', '2017-19'),
  pick('David Thompson', '1976-78'),
  pick('Alex English', '1981-83'),
  pick('Elton Brand', '2005-07'),
  pick("Amar'e Stoudemire", '2007-09'),
]);
const goodFit = team('good-fit', [
  pick('Kyle Lowry', '2015-17'),
  pick('Jrue Holiday', '2021-23'),
  pick('LeBron James', '2008-10'),
  pick('Paul Millsap', '2013-15'),
  pick('Brook Lopez', '2022-24'),
]);

const badFitResult = fitScore(badFit);
const goodFitResult = fitScore(goodFit);
assert(goodFitResult.score - badFitResult.score >= 60, 'balanced five retains a large fit advantage over the cramped control');

for (const [label, result] of [['bad', badFitResult], ['good', goodFitResult]] as const) {
  const componentTotal = Object.values(result.components).reduce((sum, value) => sum + value, 0);
  assert(componentTotal === result.raw, `${label} fit components add exactly to raw fit`);
}

const fullRoster = team('full-roster', [
  pick('Kareem Abdul-Jabbar', '1975-77'),
  pick('Tracy McGrady', '2001-03'),
  pick('Charles Barkley', '1991-93'),
  pick('Kyle Lowry', '2016-18'),
  pick('Nic Claxton', '2021-23'),
  pick('Robert Horry', '1997-99'),
  pick('George Hill', '2018-20'),
  pick('Bruce Bowen', '2007-09'),
]);
const rotation = rotationScore(fullRoster);
const rotationRaw = Object.values(rotation.components).reduce((sum, value) => sum + value, 0);
assert(rotation.score === Math.max(0, Math.min(100, Math.round(rotationRaw))), 'rotation components reproduce the clamped rotation score');

const breakdown = scoreTeam(fullRoster);
const recomputedOverall = Math.round(
  breakdown.talentScore * 0.40 +
  breakdown.benchDepthScore * 0.10 +
  breakdown.offenseScore * 0.12 +
  breakdown.defenseScore * 0.12 +
  breakdown.spacingScore * 0.03 +
  breakdown.fitScore * 0.15 +
  breakdown.rotationScore * 0.08,
);
assert(breakdown.overall === recomputedOverall, 'Overall uses the audited low-duplication weights');

const strongComplementaryBench = team('strong-complementary-bench', [
  pick('Nikola Jokic', '2021-23'),
  pick('Manu Ginóbili', '2006-08'),
  pick('Chris Webber', '1996-98'),
  pick('Jrue Holiday', '2021-23'),
  pick('Metta World Peace', '2006-08'),
  pick('OG Anunoby', '2022-24'),
  pick('Jim Les', '1990-92'),
  pick('Amir Johnson', '2012-14'),
]);
const depthTals = strongComplementaryBench.roster.map(computeTalent).sort((a, b) => b - a).slice(5);
const rawDepthAverage = depthTals.reduce((sum, value) => sum + value, 0) / depthTals.length;
const expectedDepth = Math.round(Math.max(0, Math.min(100, ((rawDepthAverage - 35) / 33) * 100)));
assert(benchDepthScore(strongComplementaryBench) === expectedDepth, 'Bench Depth maps the raw reserve average onto its achievable 0-100 range');
assert(benchDepthScore(strongComplementaryBench) >= 80, 'a genuinely strong complementary bench can reach an 80+ score');
assert(spacingScore(strongComplementaryBench) >= 80, 'a credible four-shooter construction can reach an 80+ spacing score');
console.log('Scoring-logic tests complete.');
