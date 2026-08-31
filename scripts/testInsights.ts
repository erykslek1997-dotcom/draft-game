import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { autoFinishDraft, createDraft } from '../src/engine/draft';
import { buildTeamFeatureSnapshot } from '../src/engine/insightMapper';
import { DETECTORS, generateRosterInsights, type DetectorId, type TeamFeatureSnapshot } from '../src/engine/insights';
import { CAP_LIMIT } from '../src/engine/positions';
import { autoAssignRotation } from '../src/engine/rotation';
import type { Team } from '../src/engine/types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(name: string, spanLabel: string): PlayerSpan {
  const span = draftPool.find(
    (candidate) => normalizePlayerName(candidate.playerName) === normalizePlayerName(name) && candidate.spanLabel === spanLabel,
  );
  if (!span) throw new Error(`Missing insight fixture: ${name}, ${spanLabel}`);
  return span;
}

function team(id: string, roster: PlayerSpan[]): Team {
  return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
}

function detector(id: DetectorId, snapshot: TeamFeatureSnapshot) {
  const match = DETECTORS.find((candidate) => candidate.id === id);
  if (!match) throw new Error(`Missing detector: ${id}`);
  return match.evaluate(snapshot);
}

const threeLayerWithTargets = team('three-layer-with-targets', [
  pick('Jalen Brunson', '2024-26'),
  pick('Dana Barros', '1993-95'),
  pick('Michael Jordan', '1990-92'),
  pick('Paul Pierce', '2009-11'),
  pick('Andre Roberson', '2016-18'),
  pick('Evan Mobley', '2023-25'),
  pick('Rudy Gobert', '2020-22'),
  pick('DeAndre Jordan', '2015-17'),
  pick('Larry Smith', '1991-93'),
]);
const threeLayerInsights = generateRosterInsights(buildTeamFeatureSnapshot(threeLayerWithTargets));
const weakLinkInsight = threeLayerInsights.concerns.find((insight) => insight.id === 'HUNTABLE_STARTER_EXPOSED');
check(Boolean(weakLinkInsight), 'reported Jordan/Mobley/Gobert roster exposes its multiple weak links in prose');
check(
  ['Jalen Brunson', 'Dana Barros', 'Paul Pierce'].every((name) => weakLinkInsight?.message.includes(name)),
  'contextual exposure description retains Brunson, Barros and Pierce rather than hiding bench targets',
);
// 2026-08-31: the shared role-minute model now gives Pierce and Barros their real material roles
// instead of flattening them behind a generic 12/36 split. In this nine-player fixture Larry
// Smith adds two targetable minutes to the matching eight-man defensive fixture's 98.
check(weakLinkInsight?.message.includes('100 targetable minutes'), 'weak-link description reports the real 100-minute cost');

const guardWingStopper = team('guard-wing-stopper-poa', [
  pick('Ron Harper', '1988-90'),
  pick('Jrue Holiday', '2017-19'),
  pick('Grant Hill', '1995-97'),
  pick('Victor Wembanyama', '2024-26'),
  pick('David Robinson', '1997-99'),
  pick('Anthony Mason', '1995-97'),
  pick('Charlie Ward', '1999-01'),
  pick('Jon Barry', '2001-03'),
  pick('Larry Smith', '1991-93'),
]);
const guardWingInsights = generateRosterInsights(buildTeamFeatureSnapshot(guardWingStopper));
check(
  !guardWingInsights.concerns.some((insight) => insight.id === 'NO_POA_DEFENDER'),
  'credible guard Wing Stoppers no longer trigger a contradictory no-POA concern',
);

// Team Model v1 fixtures use nine real player spans and their real box/FGA/role data. No player
// attributes are synthesized; only the normal auto-rotation decides assigned minutes.
const movementCoverageTeam = team('team-model-movement-coverage', [
  pick('Chris Paul', '2012-14'),
  pick('Klay Thompson', '2014-16'),
  pick('Shane Battier', '2005-07'),
  pick('Al Horford', '2017-19'),
  pick('Hakeem Olajuwon', '1991-93'),
  pick('Kyle Korver', '2013-15'),
  pick('Tyson Chandler', '2011-13'),
  pick('Andre Iguodala', '2011-13'),
  pick('Larry Smith', '1991-93'),
]);
const movementCoverage = buildTeamFeatureSnapshot(movementCoverageTeam);
check(movementCoverage.players.length === 9, 'Team Model fixture uses the active nine-player roster');
check(movementCoverage.totalFga <= CAP_LIMIT, 'movement/coverage fixture respects the real FGA cap');
check(detector('MOVEMENT_SHOOTING_GRAVITY', movementCoverage).active, 'validated Klay/Korver movement gravity fires');
check(
  movementCoverage.movementShooterNames?.includes('Klay Thompson') &&
    movementCoverage.movementShooterNames?.includes('Kyle Korver'),
  'movement evidence names only supported real movement shooters',
);
check(
  detector('DEFENSIVE_COVERAGE_CAPACITY_ELITE', movementCoverage).active,
  'confirmed POA-wing-rim coverage reaches the elite available-layer detector',
);
// 2026-08-31: this fixture's own Kyle Korver moved from a real ~12-minute specialist role to
// ~26 real minutes — root cause, checked directly, not guessed: Tyson Chandler's real D-TAL (87)
// now clears `talent.ts`'s new elite-one-way-defense bonus threshold (85, same batch-feedback
// pass that fixed the Brad Miller/Arvydas Sabonis/Mutombo cases), correctly re-rating him as a
// stronger center option and shifting this exact roster's auto-rotation minute split — Korver's
// own D-TAL, and the real "still an attackable weak link" fact, are both completely unchanged.
// `HUNTABLE_SPECIALIST_MITIGATED`'s own 8-24-minute definition of "specialist" no longer fits
// him at 26 (a real rotation regular now, not a bench specialist) — that's the detector correctly
// no longer applying to a role that no longer exists in THIS fixture, not a regression. Checks
// the underlying fact that survives instead: Korver is still a real, named huntability offender.
check(
  movementCoverage.targetableRotationNames?.includes('Kyle Korver'),
  'Korver remains a real, named defensive weak link regardless of how his minutes were split',
);
check(
  !movementCoverage.mitigatedSpecialistNames?.includes('Larry Smith'),
  'a zero-minute low-impact ninth man is not mislabeled as a mitigated specialist',
);
check(detector('LOW_FGA_ROTATION_VALUE', movementCoverage).active, 'real low-FGA impact in material minutes is recognized');
check(
  movementCoverage.lowFgaImpactPlayers?.includes('Shane Battier'),
  'low-FGA rotation evidence names the qualifying real player',
);
check(detector('DEAD_NINTH_SLOT_ACCEPTABLE', movementCoverage).active, 'cheap dead ninth slot is acceptable behind eight meaningful players');
check(!detector('DEAD_SLOT_HURTS_ROTATION', movementCoverage).active, 'acceptable dead ninth slot does not also fire the harmful detector');

const viableTwoBigTeam = team('team-model-two-big', [
  pick('Stephen Curry', '2014-16'),
  pick('Klay Thompson', '2014-16'),
  pick('Shane Battier', '2005-07'),
  pick('Dirk Nowitzki', '2006-08'),
  pick('Brook Lopez', '2022-24'),
  pick('Tyson Chandler', '2011-13'),
  pick('Thabo Sefolosha', '2011-13'),
  pick('Steve Blake', '2008-10'),
  pick('Larry Smith', '1991-93'),
]);
const viableTwoBig = buildTeamFeatureSnapshot(viableTwoBigTeam);
check(viableTwoBig.totalFga <= CAP_LIMIT, 'two-big fixture respects the real FGA cap');
check(detector('SPACING_WITH_TWO_BIGS_VIABLE', viableTwoBig).active, 'Dirk/Lopez two-big spacing is treated as viable');
check(!detector('NON_SPACER_OVERLOAD', viableTwoBig).active, 'viable two-big spacing is not contradicted by non-spacer overload');

const expensiveStarWithDepth = team('team-model-star-justified', [
  pick('Chris Paul', '2012-14'),
  pick('Michael Jordan', '1990-92'),
  pick('Shane Battier', '2005-07'),
  pick('Al Horford', '2017-19'),
  pick('Hakeem Olajuwon', '1991-93'),
  pick('Tyson Chandler', '2011-13'),
  pick('Andre Iguodala', '2011-13'),
  pick('Thabo Sefolosha', '2011-13'),
  pick('Larry Smith', '1991-93'),
]);
const starJustified = buildTeamFeatureSnapshot(expensiveStarWithDepth);
check(starJustified.totalFga <= CAP_LIMIT, 'justified-star fixture respects the real FGA cap');
check(detector('STAR_FGA_COST_JUSTIFIED', starJustified).active, 'Jordan-level FGA cost is justified behind a robust eight-man group');
check(!detector('STAR_FGA_COST_HURTS_DEPTH', starJustified).active, 'justified star cost does not also fire the depth concern');

const exposedStarTeam = team('team-model-exposed-star', [
  pick('Jalen Brunson', '2024-26'),
  pick('Michael Jordan', '1990-92'),
  pick('Paul Pierce', '2009-11'),
  pick('Evan Mobley', '2023-25'),
  pick('Rudy Gobert', '2020-22'),
  pick('Charlie Ward', '1999-01'),
  pick('Andre Roberson', '2016-18'),
  pick('DeAndre Jordan', '2015-17'),
  pick('Greg Anderson', '1989-91'),
]);
const exposedStar = buildTeamFeatureSnapshot(exposedStarTeam);
check(exposedStar.totalFga <= CAP_LIMIT, 'exposed-star fixture respects the real FGA cap');
check(detector('NON_SPACER_OVERLOAD', exposedStar).active, 'nonlinear non-spacer overload fires on real cramped personnel');
check(detector('HUNTABLE_STARTER_EXPOSED', exposedStar).active, 'starter weak links remain exposed despite strong back-line talent');
check(
  exposedStar.targetableStarterNames?.includes('Jalen Brunson'),
  'huntability evidence names the real targetable starter',
);
check(detector('STAR_FGA_COST_HURTS_DEPTH', exposedStar).active, 'high star FGA plus sharp support dropoff fires the depth-cost concern');
check(!detector('STAR_FGA_COST_JUSTIFIED', exposedStar).active, 'depth-cost concern does not also justify the same star allocation');
check(exposedStar.deadRosterSlotCount === 0, 'role-aware nine-man rotation no longer creates an artificial dead slot');
check(!detector('DEAD_SLOT_HURTS_ROTATION', exposedStar).active, 'a fully used nine-man rotation does not trigger a false dead-slot concern');
check(!detector('DEAD_NINTH_SLOT_ACCEPTABLE', exposedStar).active, 'a fully used ninth player is not mislabeled as a dead-slot strength');

const exposedOutput = generateRosterInsights(exposedStar);
check(
  exposedOutput.allActiveInsights.some((insight) => insight.id === 'HUNTABLE_STARTER_EXPOSED') &&
    !exposedOutput.allActiveInsights.some((insight) => insight.id === 'MULTIPLE_DEFENSIVE_WEAK_LINKS'),
  'contextual exposed-starter detector suppresses the older generic weak-link message',
);
check(
  exposedOutput.allActiveInsights.some((insight) => insight.id === 'NON_SPACER_OVERLOAD') &&
    !exposedOutput.allActiveInsights.some((insight) => insight.id === 'MULTIPLE_NON_SPACERS'),
  'contextual nonlinear spacing detector suppresses the older generic non-spacer message',
);

const outputs = [];
const originalRandom = Math.random;
try {
  for (const seed of [73_001, 73_002]) {
    Math.random = seededRandom(seed);
    const state = autoFinishDraft(createDraft(false));
    check(state.complete, `seed ${seed} completes for insight coverage`);
    for (const draftedTeam of state.teams) {
      const rotated = { ...draftedTeam, rotation: autoAssignRotation(draftedTeam.roster) };
      outputs.push(generateRosterInsights(buildTeamFeatureSnapshot(rotated)));
    }
  }
} finally {
  Math.random = originalRandom;
}

const contradictoryPairs = [
  ['ELITE_STARTING_SPACING', 'MULTIPLE_NON_SPACERS'],
  ['GOOD_STARTING_SPACING', 'MULTIPLE_NON_SPACERS'],
  ['POA_DEFENDER_PRESENT', 'NO_POA_DEFENDER'],
  ['WING_STOPPER_PRESENT', 'NO_WING_STOPPER'],
  ['ELITE_RIM_PROTECTION', 'NO_RIM_PROTECTOR'],
  ['NO_MAJOR_STRUCTURAL_HOLE', 'MULTIPLE_STRUCTURAL_HOLES'],
  ['NO_MAJOR_STRUCTURAL_HOLE', 'MULTIPLE_NON_SPACERS'],
  ['STAR_POWER_WITHOUT_USAGE_COLLISION', 'STAR_POWER_WITH_USAGE_COLLISION'],
] as const;
let respectsCap = true;
let strengthsUnique = true;
let concernsUnique = true;
const contradictions: string[] = [];
for (const output of outputs) {
  const ids = new Set([...output.strengths, ...output.concerns].map((insight) => insight.id));
  respectsCap &&= output.strengths.length <= 7 && output.concerns.length <= 7;
  strengthsUnique &&= new Set(output.strengths.map((insight) => insight.message)).size === output.strengths.length;
  concernsUnique &&= new Set(output.concerns.map((insight) => insight.message)).size === output.concerns.length;
  for (const [positive, negative] of contradictoryPairs) {
    if (ids.has(positive) && ids.has(negative)) contradictions.push(`${positive}/${negative}`);
  }
}
check(respectsCap, 'insight panel respects the seven-per-side readability cap');
check(strengthsUnique, 'strength messages do not duplicate within a roster');
check(concernsUnique, 'concern messages do not duplicate within a roster');
check(contradictions.length === 0, 'positive and negative descriptions do not contradict each other');

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const avgStrengths = average(outputs.map((output) => output.strengths.length));
const avgConcerns = average(outputs.map((output) => output.concerns.length));
const uniqueIds = new Set(outputs.flatMap((output) => output.allActiveInsights.map((insight) => insight.id)));
console.log({ rosters: outputs.length, avgStrengths, avgConcerns, uniqueActiveDetectors: uniqueIds.size });
check(avgStrengths >= 3, 'real drafted rosters average at least three meaningful strengths');
check(avgConcerns >= 3, 'real drafted rosters average at least three meaningful concerns');
check(uniqueIds.size >= 25, 'real drafted rosters activate a broad variety of description types');

console.log('Roster insight tests complete.');
