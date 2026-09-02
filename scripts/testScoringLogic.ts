import { players } from '../src/data/players';
import { autoAssignRotation } from '../src/engine/rotation';
import { benchDepthScore, rotationScore, scoreTeam, spacingScore } from '../src/engine/scoring';
// 2026-08-19: FIT v2 promoted to the official `fitScore` (user's explicit ask) — it lives in
// `fit.ts` now, not `scoring.ts` (which only imports it internally for `scoreTeam`).
import { fitScore } from '../src/engine/fit';
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
// 2026-08-19: threshold lowered 60->25 after FIT v2 was promoted to the official `fitScore`
// (user's explicit ask) — it's a bounded weighted average of five already-0-100 components, not
// the old formula's wide analytically-summed-then-rescaled (-20..114) range, so the same two
// acceptance rosters naturally produce a smaller absolute gap under the new scale. Re-measured
// directly (`scripts/_checkFitGap.ts`, deleted after use): bad-fit 53, good-fit 84, gap 31 — 25
// stays comfortably below that real margin without chasing the exact number. The old "components
// sum exactly to raw" check below it is gone too — FIT v2 has no `raw` field and its components
// are a weighted average, not additive; that structural relationship (score == weighted component
// blend) is already covered by testFit.ts's own "total is exactly the documented component blend"
// checks, so it isn't duplicated here.
assert(goodFitResult.score - badFitResult.score >= 25, 'balanced five retains a real fit advantage over the cramped control');

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
// 2026-08-19: weights rebalanced per the user's explicit ask (talent 0.40->0.30, offense/defense
// 0.12->0.17, fit 0.15->0.18, spacing's 0.03 removed as a separate term — it now lives inside
// offenseScore itself, see that function's own docstring in scoring.ts).
const recomputedOverall = Math.round(
  breakdown.talentScore * 0.30 +
  breakdown.benchDepthScore * 0.10 +
  breakdown.offenseScore * 0.17 +
  breakdown.defenseScore * 0.17 +
  breakdown.fitScore * 0.18 +
  breakdown.rotationScore * 0.08,
);
assert(breakdown.overall === recomputedOverall, 'Overall uses the audited low-duplication weights');

const strongComplementaryBench = team('strong-complementary-bench', [
  pick('Nikola Jokic', '2021-23'),
  pick('Manu Ginóbili', '2006-08'),
  pick('Chris Webber', '1996-98'),
  pick('Jrue Holiday', '2021-23'),
  pick('Ron Artest', '2006-08'),
  pick('OG Anunoby', '2022-24'),
  pick('Jim Les', '1990-92'),
  pick('Amir Johnson', '2012-14'),
]);
const activeDepth = benchDepthScore(strongComplementaryBench);
assert(activeDepth >= 55 && activeDepth <= 90, 'a useful complementary bench grades strongly without reading as perfect');
const unusedNinthMan = pick('Michael Ruffin', '2004-06');
const withUnusedNinthMan: Team = {
  ...strongComplementaryBench,
  id: 'strong-complementary-bench-with-dnp',
  roster: [...strongComplementaryBench.roster, unusedNinthMan],
};
assert(
  benchDepthScore(withUnusedNinthMan) === activeDepth,
  'a ninth player with zero assigned minutes does not lower active Bench Depth',
);
assert(spacingScore(strongComplementaryBench) >= 80, 'a credible four-shooter construction can reach an 80+ spacing score');
console.log('Scoring-logic tests complete.');
