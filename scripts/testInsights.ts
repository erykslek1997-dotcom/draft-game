import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { autoFinishDraft, createDraft } from '../src/engine/draft';
import { buildTeamFeatureSnapshot } from '../src/engine/insightMapper';
import { generateRosterInsights } from '../src/engine/insights';
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

const threeLayerWithTargets = team('three-layer-with-targets', [
  pick('Jalen Brunson', '2024-26'),
  pick('Dana Barros', '1993-95'),
  pick('Michael Jordan', '1990-92'),
  pick('Paul Pierce', '2009-11'),
  pick('Andre Roberson', '2016-18'),
  pick('Evan Mobley', '2023-25'),
  pick('Rudy Gobert', '2020-22'),
  pick('DeAndre Jordan', '2015-17'),
]);
const threeLayerInsights = generateRosterInsights(buildTeamFeatureSnapshot(threeLayerWithTargets));
const weakLinkInsight = threeLayerInsights.concerns.find((insight) => insight.id === 'MULTIPLE_DEFENSIVE_WEAK_LINKS');
check(Boolean(weakLinkInsight), 'reported Jordan/Mobley/Gobert roster exposes its multiple weak links in prose');
check(
  ['Jalen Brunson', 'Dana Barros', 'Paul Pierce'].every((name) => weakLinkInsight?.message.includes(name)),
  'weak-link description names Brunson, Barros and Pierce rather than using a generic warning',
);
// 2026-08-19: 96->86 after talent.ts's spacing-conditional TAL correction shifted this same
// fixture's rotation minutes (Paul Pierce, a real plus-shooter, gained TAL and rotation minutes
// at Andre Roberson's expense — see testDefensiveHuntability.ts's matching fixture for the full
// root cause). Re-measured directly, not guessed.
check(weakLinkInsight?.message.includes('86 targetable minutes'), 'weak-link description reports the real 86-minute cost');

const guardWingStopper = team('guard-wing-stopper-poa', [
  pick('Ron Harper', '1988-90'),
  pick('Jrue Holiday', '2017-19'),
  pick('Grant Hill', '1995-97'),
  pick('Victor Wembanyama', '2024-26'),
  pick('David Robinson', '1997-99'),
  pick('Anthony Mason', '1995-97'),
  pick('Charlie Ward', '1999-01'),
  pick('Jon Barry', '2001-03'),
]);
const guardWingInsights = generateRosterInsights(buildTeamFeatureSnapshot(guardWingStopper));
check(
  !guardWingInsights.concerns.some((insight) => insight.id === 'NO_POA_DEFENDER'),
  'credible guard Wing Stoppers no longer trigger a contradictory no-POA concern',
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
