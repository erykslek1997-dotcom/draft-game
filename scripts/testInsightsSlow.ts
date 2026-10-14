import { autoFinishDraft, createDraft } from '../src/engine/draft';
import { buildTeamFeatureSnapshot } from '../src/engine/insightMapper';
import { generateRosterInsights, insightContextFor } from '../src/engine/insights';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';

/**
 * 2026-09-05: split out of testInsights.ts — this is the one part of that file slow enough to
 * matter (full 16-team/9-round synchronous drafts over the real ~1223-player pool, then
 * insight generation for all 32 resulting rosters). Kept in `npm test` for full correctness, but
 * excluded from `npm run test:fast` so iterating on an unrelated fixture-level detector change
 * doesn't have to wait ~15-20 minutes every time. The named-fixture checks (targetable-minute
 * counts, specific detector firing on hand-built rosters, etc.) stayed in testInsights.ts — they
 * run in seconds and don't need real drafted samples. This file is purely the "does the detector
 * suite behave sanely across a broad, real, statistically varied sample of drafted teams" check.
 */

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

const outputs = [];
const samples: { standing: number; breakdown: ReturnType<typeof scoreTeam>; output: ReturnType<typeof generateRosterInsights> }[] = [];
const originalRandom = Math.random;
try {
  // 2026-09-25: two seeds -> six. With 16 teams a draft, two drafts gave the bottom/top-quarter
  // checks 8 rosters each, and main sat within one roster of failing them; six drafts (24 each)
  // measure the rule instead of the sample.
  // 2026-10-14: six -> twelve, for the same reason. With franchise GMs keeping one style
  // (draft.ts `aiProfileForTeam`) the old six drafts read bottom-quarter strengths 1.50 vs concerns
  // 1.42, flipped by about one roster; over these twelve, 1.50 vs 1.60 (1.50 vs 1.75 before the
  // change, so weak teams do read a little milder).
  for (const seed of [91_001, 91_002, 91_003, 91_004, 91_005, 91_006, 91_007, 91_008, 91_009, 91_010, 91_011, 91_012]) {
    Math.random = seededRandom(seed);
    const state = autoFinishDraft(createDraft(false));
    check(state.complete, `seed ${seed} completes for insight coverage`);
    const scored = state.teams.map((draftedTeam) => {
      const rotated = { ...draftedTeam, rotation: autoAssignRotation(draftedTeam.roster) };
      return { rotated, breakdown: scoreTeam(rotated) };
    });
    const order = [...scored].sort((a, b) => b.breakdown.overall - a.breakdown.overall);
    for (const entry of scored) {
      const rank = order.indexOf(entry) + 1;
      const context = insightContextFor(entry.breakdown, rank, scored.length);
      const output = generateRosterInsights(buildTeamFeatureSnapshot(entry.rotated), undefined, context);
      outputs.push(output);
      samples.push({ standing: context.standing ?? 0.5, breakdown: entry.breakdown, output });
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
  ['NO_MAJOR_STRUCTURAL_HOLE', 'MULTIPLE_NON_SPACERS'],
  // 2026-09-17, real playtester feedback ("generally writes contradictory things") triggered a
  // full audit of every strength/concern pair — these 9 were confirmed live (synthetic snapshots
  // that satisfied both sides simultaneously, run through the real `generateRosterInsights`)
  // before being fixed in insights.ts/insightMapper.ts. Added here so a future change can't
  // silently reopen any of them without this test catching it.
  ['NO_MAJOR_STRUCTURAL_HOLE', 'WEAK_STARTING_REBOUNDING'],
  ['SPACING_DISTRIBUTED', 'MULTIPLE_NON_SPACERS'],
  ['DEAD_NINTH_SLOT_ACCEPTABLE', 'STRONG_CORE_FRAGILE_ROTATION'],
  ['ELITE_PERIMETER_DEFENSE', 'NO_WING_STOPPER'],
  ['ELITE_RIM_PROTECTION', 'SINGLE_RIM_PROTECTOR_DEPENDENCY'],
  // 2026-09-25, found in a 192-team sweep of the displayed lists (see insights.ts selectForDisplay).
  ['DEFENSIVE_COVERAGE_CAPACITY_ELITE', 'MULTIPLE_DEFENSIVE_WEAK_LINKS'],
  ['ELITE_DEFENSE_LOW_FGA_COST', 'MULTIPLE_DEFENSIVE_WEAK_LINKS'],
  ['ELITE_PRIMARY_CREATOR', 'ELITE_SPACING_WEAK_CREATION'],
  ['CLOSING_FIVE_STABLE', 'NON_SPACER_OVERLOAD'],
] as const;
// 2026-10-09: pairs with detectors removed after scripts/validateDescriptions.ts dropped.
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
if (contradictions.length) console.log(contradictions);
check(contradictions.length === 0, 'positive and negative descriptions do not contradict each other');

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const avgStrengths = average(outputs.map((output) => output.strengths.length));
const avgConcerns = average(outputs.map((output) => output.concerns.length));
const uniqueIds = new Set(outputs.flatMap((output) => output.allActiveInsights.map((insight) => insight.id)));
console.log({ rosters: outputs.length, avgStrengths, avgConcerns, uniqueActiveDetectors: uniqueIds.size });
check(avgStrengths >= 2.5, 'real drafted rosters average at least two and a half strengths');
// 2026-09-25: floor 1.5 -> 1.4 (main read exactly 1.5 on the old two seeds). The user-reported huntability fix
// (real shot blockers and near-bar defenders like Marc Gasol / Mitchell Robinson are no longer
// "targetable") removes false MULTIPLE_DEFENSIVE_WEAK_LINKS / HUNTABLE_STARTER_EXPOSED concerns —
// over these six seeds 21->15 and 11->8, average 1.69 -> 1.49.
// 2026-10-10: 1.4 -> 1.1. The TAL defense credit (talent.ts `defenseCreditLift`) lifts defensive
// role players into the playable band, so far fewer benches read as dead or strained: over these
// six seeds DEAD_SLOT_HURTS_ROTATION 33 -> 9, STAR_FGA_COST_HURTS_DEPTH 13 -> 3,
// SINGLE_RIM_PROTECTOR_DEPENDENCY 8 -> 0, DEFENSE_DEPENDS_ON_STARTERS 12 -> 6 (spacing and
// playmaking concerns rose: SPACING_CONCENTRATED 10 -> 18, NO_TRUE_PLAYMAKER 0 -> 4); average
// 1.51 -> 1.15. The floor still catches a detector suite that goes silent.
// 2026-10-14: 1.1 -> 1.0. Over the twelve seeds the average was 1.10 before franchise GMs kept one
// style and 1.11 after — right at the old floor either way, so it sat on sample noise.
check(avgConcerns >= 1.0, 'real drafted rosters average at least 1.0 concerns');
// 2026-09-25: the lists follow the finish — a bottom team reads mostly what held it back, a top
// team mostly what worked (before, both averaged 7 strengths).
const top = samples.filter((sample) => sample.standing >= 0.75);
const bottom = samples.filter((sample) => sample.standing <= 0.25);
check(
  average(top.map((s) => s.output.strengths.length)) > average(top.map((s) => s.output.concerns.length)),
  'top-quarter teams get more strengths than concerns',
);
check(
  average(bottom.map((s) => s.output.concerns.length)) > average(bottom.map((s) => s.output.strengths.length)),
  'bottom-quarter teams get more concerns than strengths',
);
check(
  samples.every((s) => s.output.concerns.every((i) => !['DEAD_SLOT_HURTS_ROTATION', 'GREAT_STARTERS_WEAK_BENCH', 'TOP_HEAVY_ROTATION'].includes(i.id) || s.breakdown.benchDepthScore < 75)),
  'no thin-bench concern next to a Bench Depth chip of 75+',
);
check(
  samples.every((s) => s.output.strengths.every((i) => !['DEFENSIVE_COVERAGE_CAPACITY_ELITE', 'ELITE_DEFENSIVE_LAYERING', 'ELITE_DEFENSE_LOW_FGA_COST', 'ELITE_PERIMETER_DEFENSE', 'ELITE_RIM_PROTECTION'].includes(i.id) || s.breakdown.defenseScore >= 55)),
  'no elite-defense strength next to a Defense chip under 55',
);
check(uniqueIds.size >= 25, 'real drafted rosters activate a broad variety of description types');

console.log('Roster insight (slow, real-sample) tests complete.');
