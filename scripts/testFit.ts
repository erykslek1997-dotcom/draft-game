import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import {
  FIT_WEIGHTS,
  fitScore,
  SPACING_BOTTLENECK_FLOOR,
  SPACING_BOTTLENECK_MAX_PENALTY,
  SPACING_BOTTLENECK_SCALE,
} from '../src/engine/fit';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function pick(playerName: string, spanLabel: string): PlayerSpan {
  const player = players.find((candidate) => candidate.playerName === playerName && candidate.spanLabel === spanLabel);
  if (!player) throw new Error(`Missing FIT v2 fixture: ${playerName}, ${spanLabel}`);
  return player;
}

function team(id: string, roster: PlayerSpan[]): Team {
  return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
}

const cramped = team('fit-v2-cramped', [
  pick('Ben Simmons', '2017-19'),
  pick('David Thompson', '1976-78'),
  pick('Alex English', '1981-83'),
  pick('Elton Brand', '2005-07'),
  pick("Amar'e Stoudemire", '2007-09'),
]);
const balanced = team('fit-v2-balanced', [
  pick('Kyle Lowry', '2015-17'),
  pick('Jrue Holiday', '2021-23'),
  pick('LeBron James', '2008-10'),
  pick('Paul Millsap', '2013-15'),
  pick('Brook Lopez', '2022-24'),
]);

const crampedResult = fitScore(cramped);
const balancedResult = fitScore(balanced);
check(balancedResult.score >= crampedResult.score + 15, 'balanced lineup clearly outranks the cramped control');
check(balancedResult.components.championshipStructure >= 45, 'balanced lineup receives a meaningful championship-structure score');
check(balancedResult.inputs.championshipArchetypes.length >= 1, 'FIT exposes at least one evidence-backed roster archetype');

for (const [label, result] of [['cramped', crampedResult], ['balanced', balancedResult]] as const) {
  check(result.version === 'fit-v2', `${label} result carries the expected schema version`);
  check(
    Object.values(result.components).every((value) => value >= 0 && value <= 100),
    `${label} component scores stay on the 0-100 scale`,
  );
  const weightedBlend =
    result.components.creationStructure * FIT_WEIGHTS.creationStructure +
    result.components.spacingCompatibility * FIT_WEIGHTS.spacingCompatibility +
    result.components.defensiveRoleCoverage * FIT_WEIGHTS.defensiveRoleCoverage +
    result.components.reboundingBalance * FIT_WEIGHTS.reboundingBalance +
    result.components.sizeCoverage * FIT_WEIGHTS.sizeCoverage +
    result.components.championshipStructure * FIT_WEIGHTS.championshipStructure;
  // Fit is not fully compensatory: a bounded spacing bottleneck (see fit.ts) subtracts from the
  // weighted blend before the final score, so "the documented component blend" now means that
  // penalty too, not just the five weighted components.
  const spacingBottleneckPenalty = Math.min(
    SPACING_BOTTLENECK_MAX_PENALTY,
    Math.max(0, (SPACING_BOTTLENECK_FLOOR - result.components.spacingCompatibility) * SPACING_BOTTLENECK_SCALE),
  );
  const recomputed = Math.round(Math.max(0, Math.min(100, weightedBlend - spacingBottleneckPenalty)));
  check(result.score === recomputed, `${label} total is exactly the documented component blend`);
}

const productionBefore = scoreTeam(balanced);
fitScore(balanced);
const productionAfter = scoreTeam(balanced);
check(
  JSON.stringify(productionBefore) === JSON.stringify(productionAfter),
  'calling fitScore standalone does not mutate or alter production scoring',
);

const barkleyEmbiid = team('fit-v2-barkley-embiid', [
  pick('Chris Paul', '2012-14'),
  pick('Ron Harper', '1988-90'),
  pick('Eddie Jones', '1997-99'),
  pick('Charles Barkley', '1985-87'),
  pick('Joel Embiid', '2020-22'),
]);
const barkleyEmbiidResult = fitScore(barkleyEmbiid);
check(barkleyEmbiidResult.components.reboundingBalance >= 75, 'Barkley + Embiid lineup retains elite measured rebounding');
check((barkleyEmbiidResult.inputs.positionAdjustedHeightPercentile ?? 100) < 50, 'Barkley + Embiid lineup still reports its separate height limitation');
check(
  barkleyEmbiidResult.components.sizeCoverage > (barkleyEmbiidResult.inputs.positionAdjustedHeightPercentile ?? 100),
  'Barkley strength, athleticism and rebounding raise functional size above height alone',
);

const reportedFunctionalSize = team('fit-v2-reported-functional-size', [
  pick('Kyle Lowry', '2016-18'),
  pick('Nate McMillan', '1988-90'),
  pick('Dwyane Wade', '2005-07'),
  pick('Gerald Wallace', '2008-10'),
  pick('Shane Battier', '2005-07'),
  pick('Rasheed Wallace', '2000-02'),
  pick('Hakeem Olajuwon', '1991-93'),
  pick('Jakob Poeltl', '2020-22'),
]);
const reportedFunctionalSizeResult = fitScore(reportedFunctionalSize);
console.log('Reported functional-size inputs:', {
  functionalSize: reportedFunctionalSizeResult.components.sizeCoverage,
  height: Math.round(reportedFunctionalSizeResult.inputs.positionAdjustedHeightPercentile ?? 0),
  strength: Math.round(reportedFunctionalSizeResult.inputs.positionAdjustedWeightPercentile ?? 0),
  athleticism: Math.round(reportedFunctionalSizeResult.inputs.positionAdjustedAthleticismPercentile ?? 0),
  rebounding: Math.round(reportedFunctionalSizeResult.inputs.positionAdjustedReboundingPercentile),
});
check(
  reportedFunctionalSizeResult.components.sizeCoverage > (reportedFunctionalSizeResult.inputs.positionAdjustedHeightPercentile ?? 100),
  'reported Lowry/Wade/Wallace frontcourt roster receives functional-size credit beyond raw height',
);

const reportedSwitchability = team('fit-v2-reported-switchability', [
  pick('Jason Kidd', '2001-03'),
  pick('José Calderón', '2011-13'),
  pick('Klay Thompson', '2014-16'),
  pick('LeBron James', '2011-13'),
  pick('Joe Ingles', '2016-18'),
  pick('Charles Barkley', '1985-87'),
  pick('Kristaps Porziņģis', '2022-24'),
  pick('Ben Wallace', '2001-03'),
]);
const reportedSwitchabilityResult = fitScore(reportedSwitchability);
check(
  reportedSwitchabilityResult.inputs.switchability === 71,
  'Kidd/Klay/LeBron/Barkley/Porzingis starting five grades as good, not elite, switchability',
);

const jrue = pick('Jrue Holiday', '2017-19');
check(jrue.secondaryPositions.includes('PG'), 'Jrue Holiday 2017-19 is a real secondary PG and avoids an artificial PG penalty');

const wembyWebber = team('fit-v2-wemby-webber', [
  pick('Magic Johnson', '1988-90'),
  pick('Sidney Moncrief', '1981-83'),
  pick('Gerald Wallace', '2008-10'),
  pick('Victor Wembanyama', '2024-26'),
  pick('Chris Webber', '1996-98'),
]);
const wembyWebberStarters = primaryStarters(wembyWebber);
check(
  wembyWebberStarters.find((entry) => entry.slot === 'PF')?.player.playerName === 'Chris Webber' &&
    wembyWebberStarters.find((entry) => entry.slot === 'C')?.player.playerName === 'Victor Wembanyama',
  'equal-value dual-position starters prefer Webber at primary PF and Wembanyama at primary C',
);

const duncanPorzingis = team('fit-v2-duncan-porzingis', [
  pick('Shai Gilgeous-Alexander', '2024-26'),
  pick('Anfernee Hardaway', '1995-97'),
  pick('Shane Battier', '2005-07'),
  pick('Tim Duncan', '2005-07'),
  pick('Kristaps Porziņģis', '2022-24'),
]);
const wembyWebberResult = fitScore(wembyWebber);
const duncanPorzingisResult = fitScore(duncanPorzingis);
check(
  duncanPorzingisResult.components.sizeCoverage > wembyWebberResult.components.sizeCoverage,
  'Duncan + Porzingis lineup grades larger than Wembanyama + Webber after natural-slot assignment',
);
check(
  duncanPorzingisResult.components.defensiveRoleCoverage > wembyWebberResult.components.defensiveRoleCoverage,
  'five credible defensive roles outrank three elite layers hiding a Low Activity weak link',
);

const noTrueWingStopper = team('fit-v2-no-true-wing-stopper', [
  pick('Terry Porter', '1989-91'),
  pick('Tracy McGrady', '2001-03'),
  pick('Reggie Miller', '1989-91'),
  pick('Kevin Garnett', '2004-06'),
  pick('Alonzo Mourning', '1998-00'),
]);
const noTrueWingStopperResult = fitScore(noTrueWingStopper);
check(pick('Tracy McGrady', '2001-03').defensiveRole === 'Chaser', 'peak T-Mac is not mislabeled as a primary Wing Stopper from box activity');
check(
  noTrueWingStopperResult.inputs.wingCoverage <= 80,
  'box-only secondary wing coverage cannot masquerade as an elite 90+ Wing Stopper',
);
check(
  noTrueWingStopperResult.components.defensiveRoleCoverage < 90,
  'Porter/T-Mac/Reggie lineup no longer earns elite defensive-role coverage without a true wing stopper',
);

console.log('Fit tests complete.');
