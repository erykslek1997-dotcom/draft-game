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
  SHOOTING_ANOMALY_TEAM_SPACING_FLOOR,
  WALKING_GRAVITY_FLOOR,
} from './spacing';
import { maxSustainableMinutes } from './durability';
import { effectiveTalent, overallTierForSpan } from './grades';
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
// display-vs-real unification (see that function's own docstring). Flagged explicitly because
// THIS function's own validation (0.82 Spearman against 15 real human-ranked rosters, see the
// docstring above) was measured against the raw number specifically — the original human-vote
// dataset isn't available in this session to re-validate against the tier-capped version, so
// treat that correlation figure as provisional until it's re-checked.
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
 * The natural complement of `talentScore`'s own metric: unweighted average TAL of the roster's
 * BOTTOM `ROSTER_SIZE - TOP_CORE_SIZE` players (4 on a 9-man roster) — same shape, same units, so
 * it composes cleanly with `talentScore` in `overall` without inventing a new scale to calibrate.
 * Deliberately not a "gap vs. the top 5" metric — a team can have a real gap between an elite core
 * and an ordinary-but-respectable bench without that being a mistake; what the user's example
 * actually showed was a bench that was bad in absolute terms (much of it well under Role Player
 * territory), which an absolute floor measures directly and a relative-gap metric could still miss
 * (a mediocre top-5 could "pass" a gap check with an equally mediocre bench).
 */
export function benchDepthScore(team: Team): number {
  const tals = team.roster.map((player) => effectiveTalent(player)).sort((a, b) => b - a);
  const depth = tals.slice(TOP_CORE_SIZE);
  if (depth.length === 0) return 0;
  const rawAverage = depth.reduce((sum, t) => sum + t, 0) / depth.length;
  // 2026-08-17: this used to return rawAverage directly. In real 8-player drafts that value
  // clusters around 45-66, so even an excellent bench could never display a strong 0-100 score.
  // 35 represents replacement-level depth; an average of 68 across roster spots 6-8 is an
  // exceptionally strong, realistically achievable bench under the FGA cap.
  // 2026-08-31: a 77/61/58/49 bottom four previously saturated at 100 because `best=63` treated
  // an ordinary 61-point average as essentially perfect. Bench depth should answer "can the
  // reserves carry useful minutes?", not "is this near the best bench an AI draft happened to
  // produce in one small simulation." A 72 average is now the elite endpoint; 61 reads as good,
  // not historic. The score remains an absolute depth measure, independent of the starting five.
  return Math.round(rescaleToFullRange(rawAverage, { worst: 35, best: 72 }));
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
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return 0;
  const starterKeys = new Set(primaryStarters(team).map((s) => `${s.slot}|${s.player.id}`));
  const weighted = assignments.reduce((sum, { slot, player, minutes }) => {
    const isBench = !starterKeys.has(`${slot}|${player.id}`);
    const effectiveMinutes = isBench ? minutes * BENCH_INFLUENCE_BOOST : minutes;
    const fitMultiplier = applyFitMultiplier ? positionFitMultiplier(player, slot) : 1;
    return sum + valueFor(player) * fitMultiplier * effectiveMinutes;
  }, 0);
  return weighted / totalMinutes;
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
const OFFENSE_OTAL_BLEND_WEIGHT = 0.7;
const OFFENSE_SPACING_BLEND_WEIGHT = 0.3;

export function offenseScore(team: Team): number {
  const otalComponent = rescaleToFullRange(benchBoostedWeightedAverage(team, computeOffensiveTalent, true), OFFENSE_SCORE_ANCHORS);
  const spacingComponent = spacingScore(team);
  return Math.round(otalComponent * OFFENSE_OTAL_BLEND_WEIGHT + spacingComponent * OFFENSE_SPACING_BLEND_WEIGHT);
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

export function spacingScore(team: Team): number {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return 0;

  // See `BENCH_INFLUENCE_BOOST`'s own docstring above — the multi-gravity/anomaly-floor logic
  // below already gives bench-minute shooters full (not minutes-diluted) credit on its own terms,
  // so only this base weighted average needs the same boost offense/defense already get.
  const base = benchBoostedWeightedAverage(team, computeSpacing, false);

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
  const gravityThreatAssignments = assignments.filter(
    ({ player, minutes }) => minutes > 0 && spacingBreakdown(player).points >= WALKING_GRAVITY_FLOOR,
  );
  const distinctGravityThreatIds = new Set(gravityThreatAssignments.map(({ player }) => player.id));

  if (distinctGravityThreatIds.size >= 2) {
    // Two elite threats add real geometric value, but they do not make the other three players
    // disappear. Preserve the user's Curry + another gravity threat = 100 rule; other duos get a
    // strong bounded lift and still pay for non-shooters around them.
    const baseScore = rescaleToFullRange(base, SPACING_SCORE_ANCHORS);
    const hasCurry = gravityThreatAssignments.some(({ player }) => isShootingAnomalyPlayer(player));
    return Math.round(hasCurry ? 100 : Math.min(MULTI_GRAVITY_TEAM_SPACING_CAP, baseScore + 10));
  }

  if (distinctGravityThreatIds.size === 1) {
    const threatMinutes = gravityThreatAssignments.reduce((sum, { minutes }) => sum + minutes, 0);
    const threatShare = Math.max(0, Math.min(1, threatMinutes / STARTER_MINUTES));
    const floored = Math.max(base, SHOOTING_ANOMALY_TEAM_SPACING_FLOOR);
    const withGravityFloor = base * (1 - threatShare) + floored * threatShare;
    return Math.round(rescaleToFullRange(withGravityFloor, SPACING_SCORE_ANCHORS));
  }

  return Math.round(rescaleToFullRange(base, SPACING_SCORE_ANCHORS));
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
  const downwardOffenders: string[] = [];
  let downwardPenalty = 0;
  for (const { slot, player, minutes } of allAssignments(team)) {
    if (minutes <= 0) continue;
    if (player.primaryPosition === slot) continue;
    if (player.secondaryPositions.includes(slot)) continue;
    if (isUpwardSlide(player, slot)) continue;
    const penalty = DOWNWARD_POSITION_PENALTY[player.primaryPosition];
    if (penalty > 0) {
      downwardPenalty += penalty;
      downwardOffenders.push(`${player.playerName} (${player.primaryPosition}) at ${slot} (${minutes}m)`);
    }
  }
  if (downwardPenalty > 0) {
    const penalty = Math.min(MAX_DOWNWARD_POSITION_PENALTY, downwardPenalty);
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
  const WEAK_STARTER_TAL_THRESHOLD = 55;
  const hasWeakStarter = starters.some(({ player }) => effectiveTalent(player) < WEAK_STARTER_TAL_THRESHOLD);
  if (hasWeakStarter) {
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
const TALENT_WEIGHT = 0.30;
const BENCH_DEPTH_WEIGHT = 0.10;
const OFFENSE_WEIGHT = 0.17;
const DEFENSE_WEIGHT = 0.17;
const FIT_WEIGHT = 0.18;
const ROTATION_WEIGHT = 0.08;

export function scoreTeam(team: Team): ScoreBreakdown {
  const talent = talentScore(team);
  const benchDepth = benchDepthScore(team);
  const offense = offenseScore(team);
  const defense = defenseScore(team);
  const spacing = spacingScore(team);
  const fit = fitScore(team);
  const rotation = rotationScore(team);
  const overall = Math.round(
    talent * TALENT_WEIGHT +
      benchDepth * BENCH_DEPTH_WEIGHT +
      offense * OFFENSE_WEIGHT +
      defense * DEFENSE_WEIGHT +
      fit.score * FIT_WEIGHT +
      rotation.score * ROTATION_WEIGHT,
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
