import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import {
  FIT_WEIGHTS,
  fitScore,
  shadowRoleProfileForDiagnostics,
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
check(!pick('Ben Wallace', '2001-03').secondaryPositions.includes('PF'), 'Ben Wallace remains center-only');

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

const nashLeBron = team('fit-v2-nash-lebron', [
  pick('Steve Nash', '2005-07'),
  pick('Klay Thompson', '2015-17'),
  pick('Paul George', '2018-20'),
  pick('LeBron James', '2012-14'),
  pick('Rudy Gobert', '2019-21'),
  pick('Derrick White', '2023-25'),
  pick('Joe Ingles', '2016-18'),
  pick('Nerlens Noel', '2018-20'),
]);
const nashLeBronResult = fitScore(nashLeBron);
// 2026-09-17: onBallDemand's flat archetype weights became real-FGA-scaled (starterOnBallDemand,
// fit.ts) — Paul George's 2018-20 span (19.2 real FGA) now reads slightly above his Shot Creator
// archetype's old flat 1.0 weight, nudging this roster's sum from exactly 2.0 to 2.058. The bound
// here was always a proxy for the real thing this fixture checks (`creationStructure` below,
// still exactly 90) — loosened to what the more accurate calculation actually produces rather
// than the round number the old flat weights happened to land on.
check(nashLeBronResult.inputs.onBallDemand <= 2.2, 'inferred creator versatility does not fabricate on-ball demand');
check(nashLeBronResult.components.creationStructure >= 90, 'Nash and LeBron with off-ball threats grade as elite creation');
check(nashLeBronResult.inputs.defensiveWeakLinkCover >= 20, 'strong POA/wing/rim layers can partially hide one weak defender');
check(nashLeBronResult.components.defensiveRoleCoverage >= 70, 'one weak defender does not erase an otherwise complete defensive shell');

// 2026-09-17: this fixture's three starters (Paul, McGrady, Korver) used to all fall short of
// `WALKING_GRAVITY_FLOOR` (then 19), so the roster read as "three good-but-not-elite spacers"
// via `THREE_SHOOTER_LINEUP_SPACING_FLOOR`. The user-directed threshold lower (19->16, see
// spacing.ts's own note — Korver's real 17.0 is named there as one of the intended catches) now
// puts Korver over the line on his own, genuine number: this is a one-genuine-threat lineup
// (Paul 15.5, McGrady 15.2 stay short; Korver 17.0 clears), not a three-near-miss one. That's a
// different, and correctly stronger, read — `SINGLE_WALKING_GRAVITY_TEAM_SPACING_FLOOR` (70)
// blended over Korver's own ~89% starter-minutes share, landing at 68.
const threeSpacersTwoBigs = team('fit-v2-three-spacers-two-bigs', [
  pick('Chris Paul', '2013-15'),
  pick('José Calderón', '2012-14'),
  pick('Tracy McGrady', '2000-02'),
  pick('Kyle Korver', '2011-13'),
  pick('Danny Green', '2016-18'),
  pick('Kevin Garnett', '2004-06'),
  pick('Alonzo Mourning', '1997-99'),
  pick('Tyson Chandler', '2011-13'),
]);
check(
  scoreTeam(threeSpacersTwoBigs).spacingScore >= 63 && scoreTeam(threeSpacersTwoBigs).spacingScore <= 75,
  'one genuine walking-gravity spacer carries a two-non-shooting-big lineup to a strong, not maxed, read',
);

for (const [label, result] of [['cramped', crampedResult], ['balanced', balancedResult]] as const) {
  check(result.version === 'fit-v2', `${label} result carries the expected schema version`);
  check(
    Object.values(result.components).every((value) => value >= 0 && value <= 100),
    `${label} component scores stay on the 0-100 scale`,
  );
  const weightedBlend = (Object.keys(FIT_WEIGHTS) as (keyof typeof FIT_WEIGHTS)[]).reduce(
    (sum, key) => sum + result.components[key] * FIT_WEIGHTS[key],
    0,
  );
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
// 2026-09-26: switchability rescaled so an all-time switching five (Payton/Jordan/Pippen/Garnett/
// Green) reads ~100 (fit.ts `rescaleSwitchability`); this roster moved 69 -> 82. "Good, not
// elite" is now 70-89 — still well short of the elite five.
check(
  reportedSwitchabilityResult.inputs.switchability >= 70 && reportedSwitchabilityResult.inputs.switchability <= 89,
  'Kidd/Klay/LeBron/Barkley/Porzingis starting five grades as good, not elite, switchability',
);

const jrue = pick('Jrue Holiday', '2017-19');
check(jrue.secondaryPositions.includes('PG'), 'Jrue Holiday 2017-19 is a real secondary PG and avoids an artificial PG penalty');

const hakeemRoleProfile = shadowRoleProfileForDiagnostics(pick('Hakeem Olajuwon', '1991-93'));
check(
  hakeemRoleProfile.incumbentDefensiveRole === 'Anchor Big' &&
    hakeemRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Mobile Big') &&
    hakeemRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Post Defender') &&
    hakeemRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Helper'),
  'Hakeem is recognized simultaneously as an Anchor Big, Mobile Big, Post Defender and Helper',
);
const mutomboRoleProfile = shadowRoleProfileForDiagnostics(pick('Dikembe Mutombo', '1998-00'));
check(
  mutomboRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Post Defender') &&
    !mutomboRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Mobile Big'),
  'Mutombo grades as Anchor + Post without receiving an artificial Mobile role',
);
const draymondRoleProfile = shadowRoleProfileForDiagnostics(pick('Draymond Green', '2015-17'));
check(
  draymondRoleProfile.incumbentDefensiveRole === 'Anchor Big' &&
    draymondRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Mobile Big') &&
    draymondRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Helper') &&
    draymondRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Wing Stopper'),
  'Draymond carries Anchor, Mobile, Helper and Wing Stopper roles simultaneously',
);
const marionRoleProfile = shadowRoleProfileForDiagnostics(pick('Shawn Marion', '2005-07'));
check(
  marionRoleProfile.incumbentDefensiveRole === 'Mobile Big' &&
    !marionRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Post Defender'),
  'Marion remains Mobile without receiving Post Defender from activity stats',
);
const shaqRoleProfile = shadowRoleProfileForDiagnostics(pick("Shaquille O'Neal", '1999-01'));
check(
  shaqRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Post Defender') &&
    shaqRoleProfile.proposedDefensiveRoles.some((fit) => fit.role === 'Mobile Big'),
  'peak Shaq qualifies as Anchor + Post + Mobile from extraordinary size and athleticism',
);

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
  // 2026-09-23: was `=== 'LeBron James'`. LeBron's 2015-17 span is tagged `Helper` (uncorroborated —
  // no All-Defense, no real DARKO/BPM2 coverage for these seasons), so lowering
  // `UNCORROBORATED_CEILING` (defensiveTalent.ts, 78 -> 58, user ask re: Magic/Barkley) capped his
  // D-TAL 75 -> 60. Mobley's Switch Big secondary (D-TAL 81, real corroboration) now out-scores
  // LeBron's diminished Wing Stopper secondary for the wing slot — still the exact mechanism this
  // check exists to verify (a curated SECONDARY role earning real credit over a naive primary-tag
  // read), just demonstrated by a different player now that the ceiling change moved the ranking.
  multiProfileCohesion.wingProvider === 'Evan Mobley',
  'Mobley receives credible wing coverage from his curated secondary defensive profile',
);
check(
  // 2026-09-07: was `=== 'Evan Mobley'`. That only held because Wilt 1966-68 read D-TAL 71 (the
  // pre-1974 no-stocks under-rating). Wilt now carries a whole-career era override
  // (defensiveTalent.ts `NAMED_DTAL_FLOOR_ALL_SPANS`, floor 84), so the greatest rim deterrent of
  // his era correctly out-anchors a young Mobley for the rim slot. Mobley stays the lineup's #2
  // rim option via his curated Anchor Big secondary (still exercised by the POA/wing checks above
  // and his own incumbent Mobile Big tag).
  multiProfileCohesion.rimProvider === 'Wilt Chamberlain',
  'Wilt out-anchors a young Mobley at the rim once his era-override D-TAL is applied',
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
// 2026-09-25: was `components.sizeCoverage` (the functional-size composite). Graded position
// competence (positionCompetence.ts) now starts Porzingis at PF — a real natural position of his —
// and Duncan at C instead of the reverse, and the composite's slot-relative athleticism and
// rebounding legs flip with that swap (76 -> 74 vs Wemby/Webber's 75) while the two lineups'
// real size does not change. "Larger" is asserted on the size legs themselves: height 84 vs 72,
// weight 67 vs 54 percentile. Re-measured directly, not guessed.
check(
  (duncanPorzingisResult.inputs.positionAdjustedHeightPercentile ?? 0) >
    (wembyWebberResult.inputs.positionAdjustedHeightPercentile ?? 0) &&
    (duncanPorzingisResult.inputs.positionAdjustedWeightPercentile ?? 0) >
      (wembyWebberResult.inputs.positionAdjustedWeightPercentile ?? 0),
  'Duncan + Porzingis lineup grades larger (height and weight) than Wembanyama + Webber',
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
