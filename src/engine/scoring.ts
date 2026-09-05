import { RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../data/schema';
import type { Position, PlayerSpan } from '../data/schema';
import type { Team } from './types';
import { positionFitMultiplier, STARTER_SLOTS, isUpwardSlide } from './positions';
import { computeOffensiveTalent, computeDefensiveTalent, computeDefensiveImpact } from './talent';
import { isPlusShooter } from './shooting';
import {
  computeSpacing,
  isShootingAnomalyPlayer,
  spacingBreakdown,
  selfCreationRate,
  SHOOTING_ANOMALY_TEAM_SPACING_FLOOR,
  WALKING_GRAVITY_FLOOR,
} from './spacing';
import { rimPressureTeam } from './rimPressure';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { isNamedPgEligible } from './pgEligibility';
import { buildSelfCreationYearMap, measuredSelfCreationForSpan } from './selfCreationLookup';
import { maxSustainableMinutes } from './durability';
import { effectiveTalent, overallTierForSpan, tierRank } from './grades';
import { tierContextWithSixthMan } from './sixthMan';
import { minuteProfileForSpan } from './rotationRoleMinutes';
import {
  allAssignments,
  benchWithMinutes,
  primaryStarters,
  totalMinutesForPlayer,
  GAME_MINUTES,
  MAX_MINUTES_PER_PLAYER,
  STARTER_MINUTES,
} from './rotation';
import { defensiveHuntability } from './defensiveHuntability';
import { defensiveCohesion } from './defensiveCohesion';
import { fitScore } from './fit';
export type { FitScoreResult, FitScoreComponents } from './fit';

/** Minimum defensive-impact score (box-score activity + rebounding + role weight) required,
 * on top of the role tag itself, for a starter to actually count as a rim protector or
 * perimeter stopper — a generous role label alone shouldn't paper over weak real production. */
const RIM_PROTECTOR_IMPACT_THRESHOLD = 18;
const PERIMETER_DEFENDER_IMPACT_THRESHOLD = 10;

export function isStrongRimProtector(player: { defensiveRole: string }): boolean {
  return (
    RIM_PROTECTOR_ROLES.includes(player.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number]) &&
    computeDefensiveImpact(player as Parameters<typeof computeDefensiveImpact>[0]) >= RIM_PROTECTOR_IMPACT_THRESHOLD
  );
}

export function isStrongPerimeterDefender(player: { defensiveRole: string }): boolean {
  return (
    PERIMETER_DEFENDER_ROLES.includes(player.defensiveRole as (typeof PERIMETER_DEFENDER_ROLES)[number]) &&
    computeDefensiveImpact(player as Parameters<typeof computeDefensiveImpact>[0]) >= PERIMETER_DEFENDER_IMPACT_THRESHOLD
  );
}

/** Points deducted per minute a player is pushed past their durability-safe cap
 * (`maxSustainableMinutes`), in `rotationScore`. 0.8 means a single Walking-Glass-tier player
 * (cap 22) forced to a full 40 minutes — 18 over — costs ~14 points on its own, a real but not
 * score-annihilating hit, similar magnitude to the +7 bench-covers-a-gap bonuses nearby. */
const DURABILITY_OVERWORK_PENALTY_PER_MINUTE = 0.8;
/** Caps the total penalty so a wildly abusive rotation (e.g. three fragile players all pushed
 * to 40+) can't single-handedly drag `rotationScore` to 0 — it's still one term among several. */
const DURABILITY_OVERWORK_MAX_PENALTY = 25;

/** Average per-player closeness-to-optimal (0-1) scaled up to this many points, added to
 * `rotationScore`. Kept modest and comparable to the existing +7 gap-covering bonuses and the
 * -25 max overwork penalty nearby, rather than letting this one mechanic dominate the score. */
const OPTIMAL_MINUTES_BONUS_SCALE = 10;
/** Flat deduction per star-tier player whose actual minutes fall below their (durability-
 * capped) minimal floor — a real rotation mistake (benching a star), distinct from the closeness
 * bonus above, which only rewards/tolerates deviation, not specifically punishes under-use.
 * 2026-08-15, user-reported (real diagnostic: "Cedric Maxwell (All-star) underplayed: 12/24 min
 * minimum" barely dented the score at the old 5): raised to 12 — closer in weight to
 * `DOWNWARD_POSITION_PENALTY`'s SF tier (12) below, a comparably real rotation mistake, and still
 * well under its PF/C tiers (25/50) since burying a star's MINUTES is bad but not quite the same
 * category of unrealistic as playing a center at guard. Left uncapped across multiple offenders
 * on purpose, same shape as `downwardPenalty` below — benching two stars is genuinely worse than
 * benching one, not a flat "rotation has a problem" toggle. */
const UNDERPLAYED_STAR_PENALTY = 12;

/**
 * "Cap minutes applied to greatest peak, optimal minutes gives a bonus to rotation, scale cap
 * minutes to the rest" — user's own spec, three pieces:
 * 1. A durability cap still applies to a Greatest-peak/MVP-tier player exactly like anyone else
 *    (no exemption for being a star) — `effectiveOptimal`/`effectiveMinimal` below are both
 *    clamped to the player's own `maxSustainableMinutes`, so a fragile superstar isn't penalized
 *    for missing a 36-minute target their own durability never let them reach.
 * 2. When a player's target gets clamped down by durability, the "lost" optimal-minutes budget
 *    doesn't just vanish — it scales UP the remaining (non-durability-capped) players' own
 *    targets proportionally, since the team still needs real bodies covering ~240 total
 *    game-minutes regardless of any one player's ceiling.
 * 3. The actual bonus rewards closeness between a player's real assigned minutes and their
 *    (redistributed) target, plus a flat penalty for leaving a star under their minimal floor.
 */
function optimalMinutesRotationBonus(team: Team): { bonus: number; notes: string[] } {
  const rows = team.roster.map((player) => {
    const tier = overallTierForSpan(tierContextWithSixthMan(player));
    const target = minuteProfileForSpan(player);
    const cap = maxSustainableMinutes(player, MAX_MINUTES_PER_PLAYER);
    const effectiveOptimal = Math.min(target.optimal, cap);
    const effectiveMinimal = target.minimal === null ? null : Math.min(target.minimal, cap);
    return {
      player,
      tier,
      target,
      cap,
      effectiveOptimal,
      durabilityCapped: effectiveOptimal < target.optimal,
      effectiveMinimal,
      actual: totalMinutesForPlayer(team.rotation, player.id),
    };
  });

  const shortfall = rows.reduce((sum, r) => (r.durabilityCapped ? sum + (r.target.optimal - r.effectiveOptimal) : sum), 0);
  const uncappedTotalOptimal = rows.reduce((sum, r) => (r.durabilityCapped ? sum : sum + r.target.optimal), 0);
  const redistributionScale = uncappedTotalOptimal > 0 ? 1 + shortfall / uncappedTotalOptimal : 1;

  const notes: string[] = [];
  let closenessSum = 0;
  let closenessCount = 0;
  let starPenalty = 0;

  for (const r of rows) {
    const scaledOptimal = r.durabilityCapped ? r.effectiveOptimal : r.target.optimal * redistributionScale;
    if (scaledOptimal > 0) {
      const closeness = Math.max(0, 1 - Math.abs(r.actual - scaledOptimal) / scaledOptimal);
      closenessSum += closeness;
      closenessCount += 1;
    }
    if (r.effectiveMinimal !== null && r.actual < r.effectiveMinimal) {
      starPenalty += UNDERPLAYED_STAR_PENALTY;
      notes.push(`${r.player.playerName} (${r.tier}) underplayed: ${r.actual}/${r.effectiveMinimal} min minimum.`);
    }
  }

  const bonus = closenessCount > 0 ? Math.round((closenessSum / closenessCount) * OPTIMAL_MINUTES_BONUS_SCALE) - starPenalty : 0;
  return { bonus, notes };
}

export interface ScoreBreakdown {
  talentScore: number;
  benchDepthScore: number;
  offenseScore: number;
  defenseScore: number;
  spacingScore: number;
  fitScore: number;
  rotationScore: number;
  overall: number;
  notes: string[];
}

/**
 * `offenseScore`/`defenseScore`/`spacingScore` (all: minutes-weighted team average of a
 * per-player 0-100 metric) never actually reach their nominal 0-100 range in practice — the
 * cap/position rules that make a legal 9-man roster mean even the best-possible-for-that-one-
 * thing team can't hit 100, and the worst-possible team doesn't necessarily bottom out at 0
 * either. User-diagnosed (2026-08-05) and measured directly with a dedicated
 * best-possible/worst-possible-roster search (`scripts/calibrateExtremeTeamScores.ts` — no fit,
 * no talent, no need signal, purely maximizing/minimizing one metric under the real cap/position
 * rules, several attempts to hedge against greedy-fill-order artifacts): offense capped at raw
 * 78 (never near 100) with a real floor of 21, defense reached 94/8, spacing reached 94/0. These
 * three constants stretch each raw average linearly so the *actual* worst/best achievable team
 * read as 0/100 the way the display always implied. **Re-run that script and update these
 * anchors whenever the pool or the underlying OTAL/DTAL/SPC formulas change** — stale anchors
 * quietly drift the displayed 0-100 range away from what's actually achievable again.
 */
// 2026-08-15, recalibrated (`scripts/calibrateExtremeTeamScores.ts`) after `BENCH_INFLUENCE_
// BOOST` and the temporary ROSTER_SIZE 9→8 experiment changed the underlying weighted-average
// math. The roster returned to 9 on 2026-08-19; these anchors remain the current production
// calibration, but should be re-audited before any future scoring change rather than assumed to
// be fresh 9-man extrema. The 2026-08-15 search produced offense 23-92, defense 5-102, spacing
// 0-115.
// 2026-08-31: `best` briefly regressed to 92 in uncommitted work, contradicting the measured
// 5-102 range documented directly above with no re-measurement behind the change — restored to
// 102 after confirming directly (`scripts/calibrateExtremeTeamScores.ts`) that the underlying
// formula was unchanged.
const OFFENSE_SCORE_ANCHORS = { worst: 23, best: 92 };
const DEFENSE_SCORE_ANCHORS = { worst: 5, best: 102 };
/**
 * Unlike the offense/defense axes, spacing is judged against a useful basketball range rather
 * than the optimizer's literal 0/115 extremes. The old 115 ceiling meant a genuinely strong
 * four-shooter construction still displayed in the high 60s. A raw 20 is a cramped floor and
 * 90 is already elite legal-roster spacing; values outside that range still clamp to 0/100.
 */
const SPACING_SCORE_ANCHORS = { worst: 20, best: 90 };

function rescaleToFullRange(raw: number, anchors: { worst: number; best: number }): number {
  const scaled = ((raw - anchors.worst) / (anchors.best - anchors.worst)) * 100;
  return Math.max(0, Math.min(100, scaled));
}

/** How many of the roster's best-TAL players get averaged for `talentScore` below — matches
 * `scripts/analyzeD1HumanVote.ts`'s own validated "top5avg" metric exactly (unweighted average of
 * the 5 highest `computeTalent` values across the whole 9-man roster, not just starters). */
const TOP_CORE_SIZE = 5;

/**
 * 2026-08-05 (original), redefined 2026-08-13 per the D1 real in-person human-vote validation
 * ([[alltime_draft_game_project]] memory): the old formula — minutes-weighted average TAL across
 * every rotation assignment, position-fit-discounted — correlated only 0.45-0.49 with the real
 * human vote ranking of 15 actual drafted rosters. The single best predictor found in that
 * validation was a metric this function didn't compute at all: the unweighted average TAL of a
 * roster's 5 best players (0.69 correlation) — a genuinely stronger signal than the old
 * minutes-weighted whole-roster version, and the OPPOSITE of what peak single-player TAL predicts
 * (-0.37 — stacking one superstar and coasting doesn't win real human favor; a deep top-5 core
 * does). Reusing `talentScore`'s existing name/slot/weight in `overall` rather than adding a
 * parallel metric — it's a strictly better answer to the exact same question ("how much real
 * talent does this roster have"), not a different question needing its own new weight.
 * Deliberately NOT minutes- or position-fit-weighted, matching the validated metric's own exact
 * shape: bench depth/position legality already have their own dedicated scores (rotationScore,
 * position eligibility itself) — this one is purely "how strong is the core."
 */
// 2026-08-19: switched from raw `computeTalent` to `effectiveTalent` as part of the project-wide
// display-vs-real unification (see that function's own docstring).
//
// 2026-09-03 RE-VALIDATION (the "0.82" claim was stale — TE-1 in the draft/Best-5 audit). The
// D1 human-vote dataset IS available after all — `scripts/analyzeD1HumanVote.ts` carries all 15
// transcribed rosters + the vote ranking (an earlier session's comment wrongly said it wasn't).
// Re-ran it against the current engine:
//   - `talentScore` (effectiveTalent, top-5-of-9):  Spearman 0.536
//   - the same metric on raw `computeTalent`:        0.550   → the effectiveTalent switch cost ~0.01, not the problem
//   - `benchDepthScore`:                             0.686   (now the strongest single axis, not this one)
//   - average of the 5 TAGGED starters (not top-5-of-9): 0.700
//   - `overall` (scoreTeam blend):                   0.543
// So the docstring above's "0.82 / strongest predictor" no longer holds — it was measured on a
// different player-dataset era (the whole scoring stack has been recalibrated many times since).
// At n=15 the Spearman standard error is ~0.27, so these differences are noisy; NOT re-tuning the
// blend or the top-5-vs-starters definition off this alone. Flagged for a deliberate calibration
// session with more data. The metric's shape (unweighted mean of the roster's best 5) is unchanged.
export function talentScore(team: Team): number {
  const tals = team.roster.map((player) => effectiveTalent(player)).sort((a, b) => b - a);
  if (tals.length === 0) return 0;
  const core = tals.slice(0, TOP_CORE_SIZE);
  return Math.round(core.reduce((sum, t) => sum + t, 0) / core.length);
}

/**
 * 2026-08-15, user-reported (real diagnostic: an elite top-5 core, 84-98 TAL, paired with a
 * 39-69 TAL bench that never got any real attention — "taki skład nie powinien kończyć top5").
 * Root-caused, not guessed: `talentScore` above is DELIBERATELY blind to everything past the top
 * 5 (its own docstring explains why — it's the strongest validated predictor of the real human
 * vote), and `fitScore` below only ever reads `primaryStarters`, so between them 0.65 of
 * `overall`'s weight (see `scoreTeam`) never looks at the other 4 roster spots at all. Nothing
 * else in `overall` measures bench TALENT specifically either — `rotationScore` only checks
 * whether minutes are deployed sensibly, not whether the players receiving them are any good.
 *
 * Redefined after the user spotted that the ninth player at 0 minutes lowered the score while the
 * actual reserve unit's fit was invisible. This now reads only non-starters who really play:
 * minute-weighted TAL (55%), position/role fit (25%), and active depth resilience (20%). A DNP is
 * emergency depth, not part of the current bench product, so adding one cannot lower this score.
 */
export function benchDepthScore(team: Team): number {
  const activeBench = benchWithMinutes(team).filter(({ minutes }) => minutes > 0);
  if (activeBench.length === 0) return 0;

  const activeIds = new Set(activeBench.map(({ player }) => player.id));
  const totalBenchMinutes = activeBench.reduce((sum, entry) => sum + entry.minutes, 0);
  const talentRaw = activeBench.reduce(
    (sum, { player, minutes }) => sum + effectiveTalent(player) * minutes,
    0,
  ) / totalBenchMinutes;
  // An active bench is minute-selected, so its weighted TAL naturally runs above the old bottom-
  // four average. An 85 average is the elite endpoint; using the old 72 ceiling made a merely
  // strong Derrick White/Ingles/Noel unit read as virtually perfect.
  const talentComponent = rescaleToFullRange(talentRaw, { worst: 35, best: 85 });

  const activeAssignments = allAssignments(team).filter(({ player, minutes }) => activeIds.has(player.id) && minutes > 0);
  const deploymentMinutes = activeAssignments.reduce((sum, entry) => sum + entry.minutes, 0);
  const deploymentFit = deploymentMinutes > 0
    ? activeAssignments.reduce(
      (sum, { player, slot, minutes }) => sum + positionFitMultiplier(player, slot) * minutes,
      0,
    ) / deploymentMinutes * 100
    : 0;

  const hasCreator = activeBench.some(({ player }) =>
    ['Primary Ball Handler', 'Secondary Ball Handler', 'Shot Creator'].includes(player.offensiveArchetype),
  );
  const hasSpacer = activeBench.some(({ player }) => isPlusShooter(player));
  const hasDefensiveRole = activeBench.some(({ player }) =>
    isStrongPerimeterDefender(player) || isStrongRimProtector(player),
  );
  const roleCoverage = [hasCreator, hasSpacer, hasDefensiveRole]
    .reduce((sum, covered) => sum + (covered ? 100 : 40), 0) / 3;
  const fitComponent = deploymentFit * 0.65 + roleCoverage * 0.35;
  const resilienceComponent = Math.min(100, (activeBench.length / 3) * 100);

  // Active quality owns most of the score. Fit asks whether those minutes are playable and
  // complementary; resilience rewards a real three-player bench without charging DNP depth.
  return Math.round(
    talentComponent * 0.55 +
    fitComponent * 0.25 +
    resilienceComponent * 0.20,
  );
}

/**
 * 2026-08-15, user's explicit ask, same underlying complaint as `benchDepthScore`'s own docstring
 * (bench should influence more than just TAL) applied to offense/defense/spacing too: these three
 * already read bench minutes proportionally (a 12-minute backup already counts 12/240 of the
 * team average), but that's still a small voice by construction — a real bench upgrade barely
 * moves the number. Backup (non-primary-starter) minutes count `BENCH_INFLUENCE_BOOST`x toward
 * these three weighted averages specifically — inflates bench's real influence without also
 * inflating a starter's (who already dominates by raw minutes share, 36 of 48 a slot, and doesn't
 * need a boost to be heard). Requires recalibrating `OFFENSE_SCORE_ANCHORS`/`DEFENSE_SCORE_
 * ANCHORS`/`SPACING_SCORE_ANCHORS` — `rescaleToFullRange`'s own docstring already instructs this
 * "whenever... the underlying formulas change" (`scripts/calibrateExtremeTeamScores.ts` re-run
 * alongside this change).
 */
const BENCH_INFLUENCE_BOOST = 1.5;

/** Shared weighted-minutes reducer for `offenseScore`/`defenseScore`/`spacingScore` below —
 * same shape three times over, differing only in which per-player metric and whether
 * `positionFitMultiplier` applies (spacing deliberately excludes it — see its own docstring). */
function benchBoostedWeightedAverage(
  team: Team,
  valueFor: (player: PlayerSpan) => number,
  applyFitMultiplier: boolean,
): number {
  const assignments = allAssignments(team);
  const fullMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || fullMinutes === 0) return 0;
  const starterKeys = new Set(primaryStarters(team).map((s) => `${s.slot}|${s.player.id}`));
  let rawAssignedMinutes = 0;
  const weighted = assignments.reduce((sum, { slot, player, minutes }) => {
    rawAssignedMinutes += minutes;
    const isBench = !starterKeys.has(`${slot}|${player.id}`);
    const effectiveMinutes = isBench ? minutes * BENCH_INFLUENCE_BOOST : minutes;
    const fitMultiplier = applyFitMultiplier ? positionFitMultiplier(player, slot) : 1;
    return sum + valueFor(player) * fitMultiplier * effectiveMinutes;
  }, 0);
  // Normally the rotation fills every slot to exactly 48 (Σ = 240) so this divides by `fullMinutes`
  // and nothing changes. But `autoAssignRotation` deliberately leaves a slot short when a
  // genuinely threadbare roster has every player at their durability cap (see rotation.ts's
  // "leave the slot short" branch): those missing minutes would otherwise dilute the average
  // toward zero as if a 0-value player were on the floor. `Math.min` clamps the denominator to
  // what's actually assigned in that case — the score then reflects who's really playing, and the
  // roster-construction gap stays the concern of bench-depth / rotation / fit, not a silent hit
  // here. Can only ever affect a rotation that already failed to fill 240; every real 9-man
  // roster is untouched.
  return weighted / Math.min(fullMinutes, rawAssignedMinutes || fullMinutes);
}

/** Minutes-weighted team average of O-TAL, the same shape as `talentScore` but reading off the
 * split offense component instead of the blended number.
 *
 * 2026-08-19, user's explicit ask ("spacing should be part of offense to be honest"): a team of
 * real plus-shooters (Curry/Drexler/Miller) previously couldn't move this number at all — it read
 * purely off `computeOffensiveTalent`, completely blind to floor spacing. Blended with
 * `spacingScore` below (70% O-TAL / 30% spacing) rather than reimplemented inline — `spacingScore`
 * already carries its own real, separately-validated mechanics (multi-gravity threshold, the
 * Curry-floor blend, anomaly handling) that a from-scratch merge would either duplicate or lose.
 * Both inputs are already independently rescaled to 0-100 (`OFFENSE_SCORE_ANCHORS`/
 * `SPACING_SCORE_ANCHORS`), so the blend needs no new anchor calibration of its own — a weighted
 * average of two 0-100 numbers with weights summing to 1 stays in 0-100 by construction. Spacing
 * no longer gets its own separate weight in `overall` (see `scoreTeam` below) — this is that
 * weight moving structurally inside Offense instead of just being reallocated to it.
 */
/**
 * 2026-09-04, user's explicit ask: `offenseScore` only ever saw two offensive-geometry
 * dimensions — team talent and arc spacing. It was blind to paint pressure (`rimPressureTeam`,
 * shipped earlier this session as a `fitScore`-only signal — "spacing + rim pressure powinno
 * karmić offense") and to two more real offensive qualities entirely absent from any team score:
 * **playmaking** (is there a real engine running this offense, distinct from `fitScore`'s
 * `creationStructure`, which asks whether the hierarchy is clean/uncrowded, not how good the
 * playmaking itself is) and **self-creation** ("czy drużyna potrafi wygenerować rzut po koźle" —
 * can this five get a shot when the set play breaks down, distinct from spacing/talent).
 *
 * Both new components are starter-only, best-player-weighted (60/55% weight on the single best,
 * the rest on the starter mean) — one elite engine or shot-creator matters far more than five
 * mediocre ones averaged flat, but a genuine second option still counts. `selfCreationFgByYear`
 * reads real unassisted-FG rate (1997+, made-weighted, `selfCreationLookup.ts`) with the
 * archetype proxy (`selfCreationRate`) as fallback pre-1997 or below the measured volume floor —
 * the same fallback shape every other real-data lookup in this project uses.
 */
const selfCreationFgByYear = buildSelfCreationYearMap('unassistedFg');
/** Missing career playmaking coverage defaults to a below-average 35, not 0 — most uncovered
 * players are uncatalogued role players, not proven non-playmakers. */
const PLAYMAKING_COVERAGE_DEFAULT = 35;

function teamPlaymakingQuality(starters: PlayerSpan[]): number {
  if (starters.length === 0) return 0;
  const values = starters.map((p) => playmakingScoreForPlayer(p) ?? PLAYMAKING_COVERAGE_DEFAULT);
  const best = Math.max(...values);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(best * 0.6 + mean * 0.4);
}

function starterSelfCreation(player: PlayerSpan): number {
  const measured = measuredSelfCreationForSpan(player, selfCreationFgByYear);
  return (measured ?? selfCreationRate(player)) * 100;
}

function teamSelfCreationQuality(starters: PlayerSpan[]): number {
  if (starters.length === 0) return 0;
  const values = starters.map(starterSelfCreation);
  const best = Math.max(...values);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(best * 0.55 + mean * 0.45);
}

// 2026-09-05: re-normalized (each old weight x0.9) to make room for `mismatchStructure` (0.10)
// below without silently rescaling the whole formula's range — see that field's own docstring.
const OFFENSE_OTAL_BLEND_WEIGHT = 0.405;
const OFFENSE_SPACING_BLEND_WEIGHT = 0.135;
const OFFENSE_RIM_PRESSURE_BLEND_WEIGHT = 0.135;
const OFFENSE_PLAYMAKING_BLEND_WEIGHT = 0.135;
const OFFENSE_SELF_CREATION_BLEND_WEIGHT = 0.09;
/** 2026-09-05, user's explicit follow-up to `huntingPotential` (matchup.ts): playmaking and
 * self-creation already price individual SKILL into `offenseScore` on their own terms above.
 * "podpięte pod offense" turned out to mean something genuinely different, not a restatement of
 * those two numbers — "czy skład ma realną STRUKTURĘ do wymuszania switchy (odpowiednie
 * archetypy, spacing wymuszający przełączenia) niezależnie od czystego playmakingu/scoringu."
 * `fit.ts`'s `mismatchStructureScore` (via `fitScore(team).inputs.mismatchStructure`) reads the
 * roster's actual pick-and-roll structure — a real initiator paired with a screener whose own
 * gravity forces a decision, surrounded by real spacing — independent of either player's own
 * skill rating. Reads `fitScore` here (already computed elsewhere in `scoreTeam`, but not
 * threaded through this function) rather than recomputing the underlying shadow-role-profile
 * machinery a second time. */
const OFFENSE_MISMATCH_STRUCTURE_BLEND_WEIGHT = 0.10;

/** The 6 raw 0-100 dimensions `offenseScore` blends, exposed together so the UI can show
 * playmaking/self-creation individually — 2026-09-05, user's explicit ask ("playmaking i shot
 * creation widoczne do podglądu w ocenie zespołu"). Both were real inputs to `offenseScore`
 * already (same day, earlier session — see that function's own docstring) but had no visible
 * home of their own; a team could read a middling Offense number with no way to tell whether that
 * came from a weak engine, weak self-creation, or just poor spacing. */
export interface OffenseScoreComponents {
  otal: number;
  spacing: number;
  rimPressure: number;
  playmaking: number;
  selfCreation: number;
  mismatchStructure: number;
}
export interface OffenseScoreBreakdown extends OffenseScoreComponents {
  score: number;
}

function offenseScoreComponents(team: Team): OffenseScoreComponents {
  const starters = primaryStarters(team).map((entry) => entry.player);
  return {
    otal: rescaleToFullRange(benchBoostedWeightedAverage(team, computeOffensiveTalent, true), OFFENSE_SCORE_ANCHORS),
    spacing: spacingScore(team),
    rimPressure: rimPressureTeam(starters),
    playmaking: teamPlaymakingQuality(starters),
    selfCreation: teamSelfCreationQuality(starters),
    mismatchStructure: fitScore(team).inputs.mismatchStructure,
  };
}

/** Single source of truth for the weighted blend — `offenseScore` (the number every other
 * consumer reads) and `offenseScoreBreakdown` (the UI's per-dimension view) both build on this so
 * the two can never drift apart. */
export function offenseScoreBreakdown(team: Team): OffenseScoreBreakdown {
  const components = offenseScoreComponents(team);
  const score = Math.round(
    components.otal * OFFENSE_OTAL_BLEND_WEIGHT +
      components.spacing * OFFENSE_SPACING_BLEND_WEIGHT +
      components.rimPressure * OFFENSE_RIM_PRESSURE_BLEND_WEIGHT +
      components.playmaking * OFFENSE_PLAYMAKING_BLEND_WEIGHT +
      components.selfCreation * OFFENSE_SELF_CREATION_BLEND_WEIGHT +
      components.mismatchStructure * OFFENSE_MISMATCH_STRUCTURE_BLEND_WEIGHT,
  );
  return { ...components, score };
}

export function offenseScore(team: Team): number {
  return offenseScoreBreakdown(team).score;
}

export function defenseScore(team: Team): number {
  const linearScore = rescaleToFullRange(
    benchBoostedWeightedAverage(team, computeDefensiveTalent, true),
    DEFENSE_SCORE_ANCHORS,
  );
  // Linear minute-weighting lets an elite anchor conceal several attackable defenders. In a
  // series those minutes are hunted repeatedly, so the shared nonlinear penalty stacks every
  // weak stint instead of stopping after the first bad player. At the opposite extreme, a full
  // POA + wing + rim structure earns bounded credit that an average of individual D-TAL values
  // cannot express. A complete no-weak-link shell gets the ceiling treatment; a partial shell
  // can receive only a smaller structural bonus while every weak player's actual minutes remain
  // charged by huntability.
  const adjusted =
    linearScore -
    defensiveHuntability(team).penalty +
    defensiveCohesion(team).defenseScoreBonus;
  return Math.round(Math.max(0, Math.min(100, adjusted)));
}

/**
 * Minutes-weighted team spacing, 0-100 — "how well-spaced is this team's floor across a game."
 * Informational like `offenseScore`/`defenseScore`; spacing's effect on `overall` still runs
 * through `fitScore`'s plus-shooter checks, not through this number.
 *
 * Deliberately NOT multiplied by `positionFitMultiplier`, unlike the other three team averages.
 * That factor models a player being less effective out of position, and a jump shot isn't: a
 * shooter slotted at SF instead of SG spaces the floor exactly as well.
 *
 * The shooting-anomaly floor (`SHOOTING_ANOMALY_TEAM_SPACING_FLOOR`, currently Curry only) is
 * applied over **his share of a normal starter's workload**, not a flat override and not
 * measured against the full 48-minute game — `STARTER_MINUTES` (36) is what a real starter
 * actually plays in this engine, so a starter given his normal allocation gets the floor at full
 * strength immediately, not at 75% of it. (Originally measured against 48 and correctly caught
 * that nobody in this rotation model ever plays a full game — the user's own correction:
 * "85 Curry spacing should be in effect at 36 minutes (real starter minutes).") It can only ever
 * raise the number, and at 0 minutes it does nothing at all.
 *
 * **A second real gravity threat solves the problem outright.** The user's own rule (2026-07-30,
 * after a real Curry+Reggie Miller(+Pippen) roster still read only ~80): "Curry + one walking
 * gravity should be 100 spacing, let alone Curry + 2 walking gravity players." The single-player
 * floor above can't reach that on its own — it only guarantees CURRY's minutes clear 85, still
 * blended against whatever the rest of the roster actually is for his time off the floor, which
 * a couple of non-shooting bigs can hold well under 100 even with Miller himself starting.
 * `MULTI_GRAVITY_TEAM_SPACING` is a flat override, not another share-weighted blend, once a
 * shooting-anomaly player AND at least one other real (minutes > 0) span clearing
 * `WALKING_GRAVITY_FLOOR` both share the roster — two genuine floor-warpers is not a partial
 * fix, it's the spacing question being closed, regardless of who else is out there.
 */
const MULTI_GRAVITY_TEAM_SPACING_CAP = 97;
// A non-Curry walking-gravity shooter raises the offense's geometry substantially, but cannot
// supply Curry's off-ball/on-ball floor by himself. This sits at a strong, not elite, raw team
// spacing level; it is blended only across the shooter's actual starter minutes below.
const SINGLE_WALKING_GRAVITY_TEAM_SPACING_FLOOR = 70;
/** Three credible perimeter spacers prevent a two-big lineup from reading like a broken floor.
 * The two non-shooting bigs still cap the ceiling; this is a solid, not elite, construction. */
const THREE_SHOOTER_LINEUP_SPACING_FLOOR = 58;

export function spacingScore(team: Team): number {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return 0;

  // See `BENCH_INFLUENCE_BOOST`'s own docstring above — the multi-gravity/anomaly-floor logic
  // below already gives bench-minute shooters full (not minutes-diluted) credit on its own terms,
  // so only this base weighted average needs the same boost offense/defense already get.
  const fullRotationBase = benchBoostedWeightedAverage(team, computeSpacing, false);
  // A team is judged first by the five opponents actually have to guard to open each game.
  // Bench shooting still matters, but cannot turn a Wade/Iguodala/Webber front line into an
  // elite-spacing starting lineup merely because Barry or Bonner appears later in the rotation.
  const starters = primaryStarters(team).map((entry) => entry.player);
  const starterBase = starters.length > 0
    ? starters.reduce((sum, player) => sum + computeSpacing(player), 0) / starters.length
    : fullRotationBase;
  const base = fullRotationBase * 0.35 + starterBase * 0.65;
  const plusShooterCount = starters.filter(isPlusShooter).length;
  const hardNonSpacerCount = starters.filter((player) => computeSpacing(player) < 30).length;

  // 2026-08-19, user-reported: a real Paul George "Walking gravity" span (SPC 100, no Curry on
  // the roster) got NONE of this mechanic's credit — both the single-player floor and the
  // multi-threat override below were gated on `isShootingAnomalyPlayer` (Curry by literal name),
  // even though "Walking gravity" is already the same top individual tier Curry's own qualifying
  // spans cap at (`spacingBreakdown`'s points are capped at `MAX_SPACING_POINTS` the moment they
  // clear `WALKING_GRAVITY_FLOOR` — there's no numeric distinction between "Curry" and "any other
  // Walking-Gravity-tier span" left to justify treating them differently here). Generalized to
  // ANY real (minutes>0) Walking-Gravity-tier span, matching this mechanic's own stated intent
  // ("two genuine floor-warpers... regardless of who else is out there" — see this function's own
  // docstring above) instead of just the one motivating example (Curry) it happened to be built
  // around. Scoped to this function only — `isShootingAnomalyPlayer` itself, and its separate
  // consumers in fit.ts/insightMapper.ts, are untouched.
  const gravityThreatAssignments = primaryStarters(team)
    .filter(({ player, minutes }) => minutes > 0 && spacingBreakdown(player).points >= WALKING_GRAVITY_FLOOR);
  const distinctGravityThreatIds = new Set(gravityThreatAssignments.map(({ player }) => player.id));

  if (distinctGravityThreatIds.size >= 2) {
    // Two elite threats add real geometric value, but they do not make the other three players
    // disappear. Preserve the user's Curry + another gravity threat = 100 rule; other duos get a
    // strong bounded lift and still pay for non-shooters around them.
    const baseScore = rescaleToFullRange(base, SPACING_SCORE_ANCHORS);
    const hasCurry = gravityThreatAssignments.some(({ player }) => isShootingAnomalyPlayer(player));
    return Math.round(hasCurry ? 100 : Math.min(MULTI_GRAVITY_TEAM_SPACING_CAP, baseScore + 10));
  }

  // A single Walking-gravity span is an enormous individual asset, but it is not automatically
  // a well-spaced five. Curry retains his unique 85 on-court floor; another elite shooter gets
  // a strong 70 floor over his own minutes. This prevents one shooter from turning
  // Wade/Iguodala/Webber/Embiid into a 90-spacing construction while preserving real gravity.
  if (distinctGravityThreatIds.size === 1) {
    const threatMinutes = gravityThreatAssignments.reduce((sum, { minutes }) => sum + minutes, 0);
    const threatShare = Math.max(0, Math.min(1, threatMinutes / STARTER_MINUTES));
    const floor = isShootingAnomalyPlayer(gravityThreatAssignments[0]!.player)
      ? SHOOTING_ANOMALY_TEAM_SPACING_FLOOR
      : SINGLE_WALKING_GRAVITY_TEAM_SPACING_FLOOR;
    const floored = Math.max(base, floor);
    const withGravityFloor = base * (1 - threatShare) + floored * threatShare;
    return Math.round(rescaleToFullRange(withGravityFloor, SPACING_SCORE_ANCHORS));
  }

  const baseScore = rescaleToFullRange(base, SPACING_SCORE_ANCHORS);
  const constructionFloor = plusShooterCount >= 3 && hardNonSpacerCount <= 2
    ? THREE_SHOOTER_LINEUP_SPACING_FLOOR
    : 0;
  return Math.round(Math.max(baseScore, constructionFloor));
}

export interface RotationScoreComponents {
  basePositionFit: number;
  benchSpacingCoverage: number;
  benchRimCoverage: number;
  durabilityOverwork: number;
  optimalMinutes: number;
  downwardPosition: number;
  tierMinutesOverage: number;
  weakStarterTransform: number;
}

export interface RotationScoreResult {
  score: number;
  notes: string[];
  components: RotationScoreComponents;
}

export function rotationScore(team: Team): RotationScoreResult {
  const starters = primaryStarters(team);
  const notes: string[] = [];
  const components: RotationScoreComponents = {
    basePositionFit: 0,
    benchSpacingCoverage: 0,
    benchRimCoverage: 0,
    durabilityOverwork: 0,
    optimalMinutes: 0,
    downwardPosition: 0,
    tierMinutesOverage: 0,
    weakStarterTransform: 0,
  };
  if (starters.length < STARTER_SLOTS.length) {
    return { score: 0, notes: ['Lineup incomplete.'], components };
  }

  const avgMultiplier =
    starters.reduce((sum, { slot, player }) => sum + positionFitMultiplier(player, slot), 0) / starters.length;
  let score = Math.round(avgMultiplier * 100);
  components.basePositionFit = score;

  const offPosition = starters.filter(({ slot, player }) => positionFitMultiplier(player, slot) < 0.9);
  if (offPosition.length > 0) {
    notes.push(
      `${offPosition.length} starter(s) out of natural position: ${offPosition
        .map(({ player, slot }) => `${player.playerName} at ${slot}`)
        .join(', ')}.`,
    );
  } else {
    notes.push('All starters in natural or realistic secondary positions.');
  }

  const bench = benchWithMinutes(team).map((b) => b.player);
  const startersRoles = starters.map((s) => s.player.defensiveRole);

  const spacingGap = !starters.some((s) => isPlusShooter(s.player));
  if (spacingGap && bench.some(isPlusShooter)) {
    score += 7;
    components.benchSpacingCoverage = 7;
    notes.push('Bench brings shooting the starting five lacks.');
  }

  const rimGap = !startersRoles.some((r) => RIM_PROTECTOR_ROLES.includes(r));
  if (rimGap && bench.some((p) => RIM_PROTECTOR_ROLES.includes(p.defensiveRole))) {
    score += 7;
    components.benchRimCoverage = 7;
    notes.push('Bench brings rim protection the starting five lacks.');
  }

  // 2026-09-03, D2 calibration (user: #1 "brak prawdziwego centra z ławki", #5 "brak realnej siły
  // pod koszem"). Center is the least substitutable position — a 9-man rotation can cover a hurt
  // guard with a combo guard, but a hurt center means a power forward playing out of position
  // with no rim protection. A roster with only one credible center has no real answer to foul
  // trouble or an injury there. Nothing else in `overall` sees it — `benchDepthScore` reads the
  // bench as a whole, `fitScore` only the starting five. Roster-level, not rotation-level (the
  // backup a 9-man auto-rotation lands on is too noisy a signal — it slides a PF up to C and
  // papers the gap over). Informational for now — a note, no score change — until the D2 human
  // vote says whether it should also cost points.
  const credibleCenters = team.roster.filter(
    (p) =>
      (p.primaryPosition === 'C' || p.secondaryPositions.includes('C')) &&
      tierRank(overallTierForSpan(tierContextWithSixthMan(p))) >= tierRank('Role Player'),
  );
  if (credibleCenters.length <= 1) {
    notes.push(
      credibleCenters.length === 1
        ? 'Thin at center — one credible option, so foul trouble or an injury there has no real answer.'
        : 'No credible center on the roster — the position is covered only by out-of-position or replacement-level players.',
    );
  }

  // `autoAssignRotation` never produces this — every path through it checks
  // `maxSustainableMinutes` before granting minutes, so a durability cap is never exceeded by
  // the auto-fill. This can only fire when a human has manually pushed a fragile player's total
  // minutes past their safe ceiling in RotationBuilder, which (like the human's FGA cap) is
  // allowed, not blocked — it costs rotation score instead of being an illegal state.
  //
  // Scaled by how far over the cap a player is pushed, not just a flat per-player count: 1-2
  // minutes over a rounded cap is a rounding-adjacent nudge and shouldn't read the same as
  // deliberately playing a Load-Management-tier player well past their limit.
  const overworked = team.roster
    .map((p) => ({
      player: p,
      minutes: totalMinutesForPlayer(team.rotation, p.id),
      cap: maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER),
    }))
    .filter(({ minutes, cap }) => minutes > cap);
  if (overworked.length > 0) {
    const totalOverage = overworked.reduce((sum, { minutes, cap }) => sum + (minutes - cap), 0);
    const penalty = Math.min(DURABILITY_OVERWORK_MAX_PENALTY, Math.round(totalOverage * DURABILITY_OVERWORK_PENALTY_PER_MINUTE));
    score -= penalty;
    components.durabilityOverwork = -penalty;
    notes.push(
      `Overworked for their durability: ${overworked
        .map(({ player, minutes, cap }) => `${player.playerName} (${minutes}/${cap} safe min)`)
        .join(', ')}.`,
    );
  }

  const { bonus: optimalBonus, notes: optimalNotes } = optimalMinutesRotationBonus(team);
  score += optimalBonus;
  components.optimalMinutes = optimalBonus;
  notes.push(...optimalNotes);

  // 2026-08-07, user's explicit rule: playing BELOW your natural position (toward the
  // perimeter) is realistically bad and costs real rotation value — even for bench minutes,
  // not just starters ("nawet na ławce"). Upward slides (PG->SG, SF->PF, etc.) stay free, same
  // asymmetry `positions.ts`'s `isUpwardSlide` already established for the starter-search talent
  // multiplier — this is the same real-basketball claim ("a big missing the guard skill set")
  // showing up as an explicit score cost instead of just a softer talent discount. A center off
  // position at all is the extreme, flat case; the penalty tapers going down the ladder for the
  // other positions ("i tak w dół" — PF at SF costs less than a full center misuse, and so on).
  // Explicit secondary positions are real, curated fits, not a fallback stretch, so they're
  // exempt even when technically "downward" (e.g., a big whose actual secondary is one spot down).
  //
  // 2026-08-16, user-reported (real diagnostic: "Rotation 0" despite Talent 93/Fit 82 — Bam
  // Adebayo, a real C, stretched to BOTH SF (6m) and PF (12m) backup on a roster that already had
  // two other real centers). Root cause: unlike every other penalty in this function
  // (`DURABILITY_OVERWORK_MAX_PENALTY`/`MAX_TIER_OVERAGE_PENALTY`, both 25), this one had NO cap —
  // it fires once per (slot, player, minutes>0) ASSIGNMENT, so the same misplaced player counted
  // twice here (once for SF, once for PF) stacked to -100 alone, crashing an otherwise-strong
  // rotation to 0 outright. Capped at **50** — not reused from the other two penalties' 25, since
  // this category's whole design intent (see the 2026-08-07 comment above) is that a single real
  // center-at-a-perimeter-slot instance is a worse, flatter hit than a durability/tier mistake
  // (`DOWNWARD_POSITION_PENALTY.C` itself is already 50) — capping at 25 would have undercut even
  // a single genuine C misplacement, which was never the reported problem. 50 preserves that one
  // single worst-case instance at its full original value while stopping the same or a second
  // misplaced player from stacking past it.
  const DOWNWARD_POSITION_PENALTY: Record<Position, number> = { C: 50, PF: 25, SF: 12, SG: 6, PG: 0 };
  const MAX_DOWNWARD_POSITION_PENALTY = 50;
  // 2026-09-04, user-reported (Manu Ginóbili, SG, playing 12 real minutes at PG in a D2 rotation —
  // a combo guard covering a swing stint, not a rotation mistake): the ramp used to reach its own
  // FULL_PENALTY_MINUTES at exactly 12, so a normal, brief positional swing already read as the
  // single worst-case misuse. A grace window now costs nothing before the ramp starts, sized to
  // how big a stretch the move actually is — a guard sliding one spot (PG<->SG range) is common
  // NBA usage; a genuine size mismatch (a center at the point) almost never happens even briefly,
  // so it keeps none. The ramp's own top end also moves out to 24 so a real, sustained misuse
  // (a center actually playing 24+ minutes of guard) still reaches the full historical penalty —
  // this is a wider grace window, not a smaller maximum.
  const DOWNWARD_POSITION_GRACE_MINUTES: Record<Position, number> = { C: 0, PF: 4, SF: 8, SG: 12, PG: 12 };
  const DOWNWARD_POSITION_FULL_PENALTY_MINUTES = 24;
  // 2026-09-04, user's follow-up ("Manu pasuje na PG ze względu na playmaking" — Manu fits at PG
  // because of his playmaking, not a curated position tag): a guard or wing with a real point-
  // guard skillset can credibly run point regardless of what `secondaryPositions` says, the same
  // real-basketball fact the engine's own shadow role-model (`fit.ts`/`players.ts`/`draftPool.ts`
  // only — this file is deliberately not one of its import-surface's named consumers) already
  // reads for other role proposals. First tried as
  // a scalar `playmakingScoreForPlayer >= 90` cut; the user's own counter-example broke it same
  // day — Jerry West (81.7) and Danny Ainge (84.2) were offered as fits, Jordan (86.8) / Kobe
  // (86.7) / Pippen (86.9) as not, all with a *higher* score. `offensiveArchetype` doesn't
  // separate them either (Pippen shares Manu's own "Secondary Ball Handler" tag). Replaced with a
  // curated named list (`pgEligibility.ts`) built by putting every SG/SF with playmaking >=75
  // (149 players) in front of the user as a checklist and deciding one-by-one — see that file's
  // docstring for the full result (48 yes / 101 no, ranges fully overlapping either way).
  // Scoped to PG only (not every downward slot — ball-handling competence doesn't make a guard a
  // credible power forward) and to guards/wings only (an elite-passing big, e.g. Draymond/Jokić,
  // still isn't a positional point guard — that's a different kind of "can play the point").
  const isElitePlaymakingGuardOrWing = (player: PlayerSpan): boolean =>
    player.primaryPosition !== 'C' &&
    player.primaryPosition !== 'PF' &&
    isNamedPgEligible(player);
  const downwardOffenders: string[] = [];
  let downwardPenalty = 0;
  for (const { slot, player, minutes } of allAssignments(team)) {
    if (minutes <= 0) continue;
    if (player.primaryPosition === slot) continue;
    if (player.secondaryPositions.includes(slot)) continue;
    if (isUpwardSlide(player, slot)) continue;
    if (slot === 'PG' && isElitePlaymakingGuardOrWing(player)) continue;
    const grace = DOWNWARD_POSITION_GRACE_MINUTES[player.primaryPosition];
    const rampMinutes = Math.max(0, minutes - grace);
    const rampSpan = Math.max(1, DOWNWARD_POSITION_FULL_PENALTY_MINUTES - grace);
    const penalty = DOWNWARD_POSITION_PENALTY[player.primaryPosition] * Math.min(1, rampMinutes / rampSpan);
    if (penalty > 0) {
      downwardPenalty += penalty;
      downwardOffenders.push(`${player.playerName} (${player.primaryPosition}) at ${slot} (${minutes}m)`);
    }
  }
  if (downwardPenalty > 0) {
    const penalty = Math.min(MAX_DOWNWARD_POSITION_PENALTY, Math.round(downwardPenalty));
    score -= penalty;
    components.downwardPosition = -penalty;
    notes.push(`Playing below natural position: ${downwardOffenders.join(', ')}.`);
  }

  // 2026-08-07, user's explicit rule: each overall tier has a real minutes ceiling, not just an
  // "optimal" target — Starter 32 / Role Player 24 / Bench Warmer 16 / Cigarette Butt 8 (the
  // top four tiers are already effectively uncapped here, since their own optimal+8 would clear
  // `MAX_MINUTES_PER_PLAYER`). Checked against TOTAL minutes across every slot a player appears
  // in (`totalMinutesForPlayer`, already sums across slots) — a player split 24/12 across two
  // real positions is 36 total minutes on his OWN tier's budget, not evaluated per slot.
  // 2026-08-15, user-reported (real diagnostic: "Chris Duhon (Bench Warmer) 24/16m" — 8 minutes
  // over his tier's real ceiling cost only -8 at the old rate of 1/minute, barely registering).
  // Doubled to 2/minute — Duhon's exact case now costs -16, a real dent rather than a rounding
  // error, while `MAX_TIER_OVERAGE_PENALTY` stays at 25 (already matches `DURABILITY_OVERWORK_
  // MAX_PENALTY`'s own ceiling nearby — a consistent, already-calibrated cap for "how much any
  // one minutes-deployment mistake can cost," not something this specific complaint asked to move).
  const TIER_OVERAGE_PENALTY_PER_MINUTE = 2;
  const MAX_TIER_OVERAGE_PENALTY = 25;
  let tierOveragePenalty = 0;
  const tierOverageOffenders: string[] = [];
  for (const p of team.roster) {
    const minutes = totalMinutesForPlayer(team.rotation, p.id);
    if (minutes <= 0) continue;
    const tier = overallTierForSpan(tierContextWithSixthMan(p));
    const cap = minuteProfileForSpan(p).ceiling;
    if (minutes > cap) {
      tierOveragePenalty += (minutes - cap) * TIER_OVERAGE_PENALTY_PER_MINUTE;
      tierOverageOffenders.push(`${p.playerName} (${tier}) ${minutes}/${cap}m`);
    }
  }
  if (tierOveragePenalty > 0) {
    const penalty = Math.min(MAX_TIER_OVERAGE_PENALTY, Math.round(tierOveragePenalty));
    score -= penalty;
    components.tierMinutesOverage = -penalty;
    notes.push(`Over their tier's real minutes ceiling: ${tierOverageOffenders.join(', ')}.`);
  }

  // 2026-08-07, user's explicit rule: a genuinely weak starter (TAL<55 — below even "Starter"
  // tier's own floor of 60, so only reachable if a slot's real options were all this thin) drags
  // the WHOLE team's rotation value, not just his own slot — halved outright, not a small
  // deduction. Largely a belt-and-suspenders backstop now that `bestPrimaryAssignment` (rotation.ts)
  // already refuses to start anyone below Starter tier when a real alternative or an empty slot
  // is available — this only fires in the genuine edge case none exists.
  //
  // 2026-09-04, user-reported (D2 #3: KCP designated the SG starter at TAL 53, but plays only 24
  // of the slot's 48 minutes — a genuine 24/24 timeshare with Manu Ginóbili, TAL 81 — "gra tylko
  // 24 minuty więc nie jest to pełnosprawny starter"). The designated-starter identity stays
  // authoritative (see `primaryStarters`'s own docstring — column order, not raw minutes, is the
  // real lineup intent), but a weak "starter" who is genuinely splitting the slot with a real
  // (TAL>=55) co-starter taking a comparable share of the minutes isn't actually anchoring the
  // position the way this rule is meant to catch. Relief requires the co-starter to play at least
  // 80% as many minutes as the weak starter — a token 4-minute mercy appearance doesn't count.
  const WEAK_STARTER_TAL_THRESHOLD = 55;
  const TIMESHARE_RELIEF_MIN_SHARE = 0.8;
  const hasGenuineTimeshareRelief = (weak: { slot: Position; player: PlayerSpan; minutes: number }): boolean =>
    allAssignments(team).some(
      (a) =>
        a.slot === weak.slot &&
        a.player.id !== weak.player.id &&
        effectiveTalent(a.player) >= WEAK_STARTER_TAL_THRESHOLD &&
        a.minutes >= weak.minutes * TIMESHARE_RELIEF_MIN_SHARE,
    );
  const unrelievedWeakStarter = starters.find(
    (entry) => effectiveTalent(entry.player) < WEAK_STARTER_TAL_THRESHOLD && !hasGenuineTimeshareRelief(entry),
  );
  if (unrelievedWeakStarter) {
    const beforeWeakStarter = score;
    score = Math.round(score * 0.5);
    components.weakStarterTransform = score - beforeWeakStarter;
    notes.push('Weak starter (TAL<55) present — whole team rotation value halved.');
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), notes, components };
}

/**
 * 2026-08-05, explicit user request: `offenseScore`/`defenseScore`/`spacingScore` now feed
 * `overall` — previously deliberately informational-only ("don't feed overall", see the
 * comments on those three functions above, left as historical context rather than edited to
 * avoid erasing the record of that earlier decision). Reopened specifically because those three
 * scores were just fixed to actually span their full 0-100 range (`rescaleToFullRange` above) —
 * before that fix they'd have been unusable as a scoring input (offense topped out at a raw 78,
 * which would've silently capped any team's contribution from this term well under its nominal
 * share no matter how good the roster).
 *
 * Averaged **equally** into one `teamQuality` term, not weighted toward any one of the three —
 * the user's own stated goal ("two-way shooterami" should score highest, second only to
 * genuine greatest-peak talent) is exactly what an equal average rewards: a player/roster
 * excellent at only one of offense/defense/spacing tops out that one axis but drags the other
 * two toward the middle, while a genuine two-way shooter roster scores well on all three
 * simultaneously and wins the average outright. Weighting any single axis higher would blunt
 * exactly that effect.
 *
 * `overall`'s existing three weights (talent 0.4 / fit 0.45 / rotation 0.15) are scaled down
 * proportionally by 0.75 (0.3 / 0.35 / 0.15 — rotation held rather than also cut 25%, since it's
 * measuring something distinct — legal/sensible minutes deployment — that has nothing to do with
 * *which* players were drafted, so diluting it to make room for a roster-construction signal
 * doesn't make sense the way diluting talent/fit does) to make room for `teamQuality` at 0.2,
 * keeping the total at 1.0 (0.3+0.35+0.15+0.2). Not a re-derivation from scratch — `fitScore`
 * still carries the largest single weight, since it's the project's actual "does this roster
 * make basketball sense" judge and this change doesn't reopen that.
 */
/**
 * 2026-08-15, user-reported ("taki skład nie powinien kończyć top5" — see `benchDepthScore`'s own
 * docstring for the root cause): `talentScore` (0.3) and `fitScore` (0.35) together are 0.65 of
 * `overall` and neither one ever looks past the starting five, so an elite top-5-core-plus-garbage-
 * bench roster could rank unrealistically high. Same rebalancing move this file already made once
 * before when `teamQuality` was added (see that change's own docstring above) — scale the existing
 * roster-construction weights (talent/fit/teamQuality) down proportionally to make room, leave
 * `rotation` alone (still measuring something orthogonal: legal/sensible minutes deployment, not
 * which players were drafted). `BENCH_DEPTH_WEIGHT` matches `ROTATION_WEIGHT` (0.15) — a real,
 * meaningful dimension, not a token one, but not bigger than the project's actual "does this
 * roster make basketball sense" judge (`fitScore`, still the largest single weight).
 */
/**
 * 2026-08-17 scoring audit: the former blend let Rotation and Fit dominate the *observed*
 * variance even though Talent had the strongest external signal. On 15 genuinely human-ranked
 * rosters the old blend reached 0.53 Spearman versus 0.82 for top-five TAL; on the separate
 * 48-roster blind qualitative sample it reached 0.02. These weights were selected from a small,
 * predeclared candidate set (not a free parameter fit) and improved both samples to roughly
 * 0.65/0.12. Offense and defense remain meaningful direct axes; spacing stays present but has a
 * smaller direct weight because continuous spacing and rim-gravity interactions already live in
 * Fit. Rotation remains punitive for genuine deployment mistakes, without owning the ranking.
 *
 * 2026-08-19, user's explicit rebalance ask ("lower TAL weight, higher offense, defense and fit.
 * spacing should be part of offense"): the note above is preserved as real history — Talent's
 * 0.82 Spearman against real human rankings was, and remains, the single strongest validated
 * signal this project has measured, so lowering its weight is a deliberate move AWAY from the
 * best empirical fit to real human judgment, not toward it. The user's own goal here is a
 * different, legitimate one (basketball-accuracy over matching intuitive human ranking), made with
 * that trade-off explicit rather than silently reopened. `SPACING_WEIGHT` is removed outright, not
 * folded into `OFFENSE_WEIGHT`'s number — spacing now lives structurally inside `offenseScore`
 * itself (see that function's own docstring), so giving it a second separate weight here would
 * double-count it. The freed 0.10 (talent) + 0.03 (spacing) = 0.13 is split 0.05/0.05/0.03 across
 * offense/defense/fit.
 */
/**
 * 2026-09-04, user's explicit restructure ("overall = tal × 0,5 + fit × 0,5; benchDepth działa na
 * TAL; offense, defense i rotacja działają na FIT"). Two axes, split 50/50:
 *
 *  - **quality** — how good the roster is: top-5 core TAL (`talentScore`) + active bench TAL
 *    (`benchDepthScore`). `TEAM_QUALITY_TALENT_WEIGHT` keeps the old 0.30:0.10 core:bench ratio.
 *  - **fit** — how well it coheres: `fitScore` (the full roster-construction judge, which on this
 *    same date absorbed switchability / hunt resistance / defensive cohesion) plus deployment
 *    sanity (`rotationScore`). `TEAM_FIT_COHERENCE_WEIGHT` leaves rotation ~0.075 of `overall`,
 *    matching its old direct weight.
 *
 * `offenseScore` / `defenseScore` / `spacingScore` no longer feed `overall` — the O-TAL / D-TAL
 * *level* they carry is already the quality half's job, and their contextual half (spacing
 * geometry, rim-protection coverage, huntability) is `fitScore`'s. They stay on `ScoreBreakdown`
 * as display roll-ups and are still consumed directly by `historicalChallenges` / `seasonProfile`
 * / `closingLineups` / `bestFive` (which pins its own weights).
 *
 * Measured on the D1 human vote (n=15, `scripts/analyzeD1HumanVote.ts` + `_fitDecomp.ts`): the
 * old blend reached Spearman 0.536, below `talentScore` alone (0.571) — `fitScore` at −0.06 and
 * `spacingScore` at −0.16 were net-negative dead weight. This structure with the fit rebuild
 * lands ~0.56-0.59. At n=15 (SE ~0.27) that gap is noise; the change is justified by the cleaner
 * model and by folding in two real, previously-unscored signals, not by chasing the number.
 */
const QUALITY_FIT_SPLIT = 0.5;

/**
 * 2026-09-04, later same day again: re-grouped once more, user's own correction —
 * "fit = fitscore + offensescore + defensescore / TAL = TAL + BENCH + ROTATION, liczone po 50%".
 * Rotation moves OUT of the fit half and into quality: how well you deployed the talent you
 * drafted (rotation) is closer to "how good is this roster, used correctly" than to "does this
 * roster complement itself" (offense/defense/fitScore's own coherence read). Two 3-way axes:
 *
 *  quality = talentScore + benchDepthScore + rotationScore
 *  fit     = fitScore + offenseScore + defenseScore
 *  overall = quality*0.5 + fit*0.5
 *
 * Both axes' internal weights renormalize the project's last validated 6-way split (talent .30 /
 * bench .10 / offense .17 / defense .17 / fit .18 / rotation .08) to sum to 1 within their new
 * 3-way bucket, rather than freehand new numbers — quality's bucket sums to .48, fit's to .52,
 * which is itself a rough check that grouping them 50/50 isn't far from what the original
 * 6-way weights already implied.
 */
const QUALITY_TALENT_WEIGHT = 0.30 / 0.48;
const QUALITY_BENCH_WEIGHT = 0.10 / 0.48;
const QUALITY_ROTATION_WEIGHT = 0.08 / 0.48;
const FIT_COHERENCE_WEIGHT = 0.18 / 0.52;
const FIT_OFFENSE_WEIGHT = 0.17 / 0.52;
const FIT_DEFENSE_WEIGHT = 0.17 / 0.52;

export function teamQualityScore(talent: number, benchDepth: number, rotation: number): number {
  return talent * QUALITY_TALENT_WEIGHT + benchDepth * QUALITY_BENCH_WEIGHT + rotation * QUALITY_ROTATION_WEIGHT;
}

export function teamFitCompositeScore(fit: number, offense: number, defense: number): number {
  return fit * FIT_COHERENCE_WEIGHT + offense * FIT_OFFENSE_WEIGHT + defense * FIT_DEFENSE_WEIGHT;
}

export function scoreTeam(team: Team): ScoreBreakdown {
  const talent = talentScore(team);
  const benchDepth = benchDepthScore(team);
  const offense = offenseScore(team);
  const defense = defenseScore(team);
  const spacing = spacingScore(team);
  const fit = fitScore(team);
  const rotation = rotationScore(team);
  const overall = Math.round(
    teamQualityScore(talent, benchDepth, rotation.score) * QUALITY_FIT_SPLIT +
      teamFitCompositeScore(fit.score, offense, defense) * (1 - QUALITY_FIT_SPLIT),
  );
  return {
    talentScore: talent,
    benchDepthScore: benchDepth,
    offenseScore: offense,
    defenseScore: defense,
    spacingScore: spacing,
    fitScore: fit.score,
    rotationScore: rotation.score,
    overall,
    notes: [...fit.notes, ...rotation.notes],
  };
}

export function rankTeams(teams: Team[]): { team: Team; breakdown: ScoreBreakdown; rank: number }[] {
  const scored = teams.map((team) => ({ team, breakdown: scoreTeam(team) }));
  scored.sort((a, b) => b.breakdown.overall - a.breakdown.overall);
  return scored.map((entry, index) => ({ ...entry, rank: index + 1 }));
}
