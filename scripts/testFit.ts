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
import { defensiveCohesion } from '../src/engine/defensiveCohesion';
import type { Team } from '../src/engine/types';
import { calibrateSeasonProfileScore } from '../src/engine/seasonProfile';
import { effectiveTalent } from '../src/engine/grades';
import { playoffBpmDraftBonus } from '../src/engine/aiDrafter';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function pick(playerName: string, spanLabel: string): PlayerSpan {
  const player = players.find((candidate) => candidate.playerName === playerName && candidate.spanLabel === spanLabel);
  if (!player) throw new Error(`Missing FIT v2 fixture: ${playerName}, ${spanLabel}`);
  return player;
}

check(calibrateSeasonProfileScore(66, { p10: 66, median: 76, p90: 82, elite: 86 }) === 50, 'season profile maps P10 to 50');
check(calibrateSeasonProfileScore(76, { p10: 66, median: 76, p90: 82, elite: 86 }) === 75, 'season profile maps median to 75');
check(calibrateSeasonProfileScore(82, { p10: 66, median: 76, p90: 82, elite: 86 }) === 90, 'season profile maps P90 to 90');
check(calibrateSeasonProfileScore(86, { p10: 66, median: 76, p90: 82, elite: 86 }) === 100, 'season profile maps elite edge to 100');
check(effectiveTalent(pick('Pau Gasol', '2008-10')) === 82, 'playoff-validated Pau Gasol earns the All-NBA talent floor');
check(playoffBpmDraftBonus(pick('Marc Gasol', '2011-13')) > 1, 'Marc Gasol receives a reliable playoff-value draft bonus');
check(playoffBpmDraftBonus(pick('Gilbert Arenas', '2005-07')) === 0, 'weak-defense perimeter scorers do not receive a playoff BPM draft bonus');
check(
  pick('Pau Gasol', '2008-10').primaryPosition === 'PF' && pick('Pau Gasol', '2008-10').secondaryPositions.includes('C'),
  'title-window Pau Gasol is represented as a real PF/C rather than a center-only player',
);
check(pick('Ben Wallace', '2001-03').secondaryPositions.includes('PF'), 'Ben Wallace can cover credible PF minutes without a center-at-PF penalty');

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

const multiProfileDefense = team('fit-v2-multi-profile-defense', [
  pick('Jrue Holiday', '2022-24'),
  pick('Ray Allen', '2000-02'),
  pick('LeBron James', '2015-17'),
  pick('Evan Mobley', '2023-25'),
  pick('Wilt Chamberlain', '1966-68'),
]);
const multiProfileCohesion = defensiveCohesion(multiProfileDefense);
check(
  multiProfileCohesion.poaProvider === 'Jrue Holiday',
  'Jrue receives POA credit from his curated secondary defensive profile instead of Ray Allen',
);
check(
  multiProfileCohesion.wingProvider === 'LeBron James',
  'LeBron receives credible wing coverage from his curated secondary defensive profile',
);
check(
  multiProfileCohesion.rimProvider === 'Evan Mobley',
  'Mobley receives anchor-rim credit from his curated secondary defensive profile',
);

const billupsWadeSpacing = team('fit-v2-billups-wade-spacing', [
  pick('Chauncey Billups', '2004-06'),
  pick('Dwyane Wade', '2005-07'),
  pick('Andre Iguodala', '2011-13'),
  pick('Chris Webber', '1996-98'),
  pick('Joel Embiid', '2019-21'),
  pick('Alex Caruso', '2022-24'),
  pick('Brad Miller', '2003-05'),
  pick('Brent Barry', '2005-07'),
  pick('Adrian Griffin', '2004-06'),
]);
check(
  scoreTeam(billupsWadeSpacing).spacingScore >= 65 && scoreTeam(billupsWadeSpacing).spacingScore <= 75,
  'one Billups gravity span makes Wade/Iguodala/Webber/Embiid solid, not elite, spacing',
);

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
