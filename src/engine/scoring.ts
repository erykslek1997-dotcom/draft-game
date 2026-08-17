import { HIGH_USAGE_ARCHETYPE_WEIGHT, RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../data/schema';
import type { Position, PlayerSpan } from '../data/schema';
import type { Team } from './types';
import { positionFitMultiplier, STARTER_SLOTS, isUpwardSlide } from './positions';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent, computeDefensiveImpact } from './talent';
import { isPlusShooter } from './shooting';
import {
  computeSpacing,
  isShootingAnomalyPlayer,
  spacingBreakdown,
  SHOOTING_ANOMALY_TEAM_SPACING_FLOOR,
  WALKING_GRAVITY_FLOOR,
} from './spacing';
import { isRimGravityScorer, isSelfSufficientEngine } from './offensiveProfile';
import { maxSustainableMinutes } from './durability';
import { overallTier, type OverallTier } from './grades';
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

/** Talent points per FGA a "normal" cap-legal roster produces — calibrated (scripts/calibrate.ts)
 * against the actual in-game draft pool, FGA-weighted. Recalibrated after the position/usage-
 * adjusted TS% baseline and continuous defensive role weight changed computeTalent's scale. */
const BASELINE_EFFICIENCY = 4.05;

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

/** Combined starters' raw rpg, below which a starting five is a real rebounding liability —
 * e.g. an all-guard lineup. Calibrated against the actual pool's real per-position mean rpg
 * (scripts/checkReboundingBaseline.ts): PG/SG ~3.9, SF ~5.3, PF ~7.6, C ~9.5, so a normal
 * one-per-position starting five nets ~30 combined; 25 sits comfortably below that (so a
 * balanced five is never falsely flagged) but well above an all-guard five's ~19-20. Previously
 * nothing in fitScore checked team rebounding at all — an all-PG roster paid no penalty for it. */
const STARTER_REBOUNDING_FLOOR = 25;

/** Points deducted per minute a player is pushed past their durability-safe cap
 * (`maxSustainableMinutes`), in `rotationScore`. 0.8 means a single Walking-Glass-tier player
 * (cap 22) forced to a full 40 minutes — 18 over — costs ~14 points on its own, a real but not
 * score-annihilating hit, similar magnitude to the +7 bench-covers-a-gap bonuses nearby. */
const DURABILITY_OVERWORK_PENALTY_PER_MINUTE = 0.8;
/** Caps the total penalty so a wildly abusive rotation (e.g. three fragile players all pushed
 * to 40+) can't single-handedly drag `rotationScore` to 0 — it's still one term among several. */
const DURABILITY_OVERWORK_MAX_PENALTY = 25;

/**
 * 2026-08-01, user-supplied table ("rotation minutes value.xlsx"): how many minutes a player at
 * a given OVERALL tier (`grades.ts`'s `overallTier`, keyed off TAL — not durability) should
 * ideally play ("optimal") and, for the three star tiers, the floor below which they're being
 * meaningfully under-used ("minimal"). MVP uses the same numbers as Greatest peak per the
 * user's explicit "MVP same as greatest peak" — the source table only had a row for the latter.
 * Below Starter there's no minimal floor (a bench/role player being under-played isn't a
 * rotation mistake the way benching a star is).
 */
const OVERALL_TIER_MINUTES_TARGET: Record<OverallTier, { optimal: number; minimal: number | null }> = {
  // GOAT (grades.ts) is a display-only tier `overallTier(value)` — the function this table is
  // actually keyed against — never returns; it only exists via `overallTierForSpan`'s per-span
  // upgrade. Included here purely so this Record type-checks as exhaustive; same numbers as
  // 'Greatest peak', which is the real tier any GOAT-badged span still carries for this table.
  GOAT: { optimal: 36, minimal: 32 },
  'Greatest peak': { optimal: 36, minimal: 32 },
  MVP: { optimal: 36, minimal: 32 },
  'All-NBA': { optimal: 34, minimal: 24 },
  'All-star': { optimal: 32, minimal: 24 },
  Starter: { optimal: 24, minimal: null },
  // 2026-08-15, user's explicit ask: a real Sixth Man profile (sixthMan.ts) should pull real
  // minutes toward it — meaningfully more than a generic Role Player (16), less than a full
  // Starter (24 optimal / would-be 32 minimal if it had one) — this is a bench role by
  // definition (`tierContextWithSixthMan` only ever relabels a span that would otherwise sit at
  // Role Player/Starter-and-below), so no `minimal` floor, matching every other below-All-star
  // tier's own "no minimum, only Starter-and-up get benched-mistake penalties" convention.
  'Sixth Man': { optimal: 28, minimal: null },
  'Role Player': { optimal: 16, minimal: null },
  'Bench Warmer': { optimal: 8, minimal: null },
  'Cigarette Butt': { optimal: 0, minimal: null },
};

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
    const tier = overallTier(computeTalent(player));
    const target = OVERALL_TIER_MINUTES_TARGET[tier];
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
// BOOST` and `ROSTER_SIZE` 9→8 both changed the underlying weighted-average math these anchors
// are fit against — old values (21/78, 8/94, 0/94) were measured against the pre-boost, 9-man
// formula and were now stale per this file's own "re-run whenever the underlying formulas
// change" rule. New worst/best achieved by the true best/worst-possible legal roster search:
// offense 23-92, defense 5-102, spacing 0-115.
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
export function talentScore(team: Team): number {
  const tals = team.roster.map((player) => computeTalent(player)).sort((a, b) => b - a);
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
  const tals = team.roster.map((player) => computeTalent(player)).sort((a, b) => b - a);
  const depth = tals.slice(TOP_CORE_SIZE);
  if (depth.length === 0) return 0;
  const rawAverage = depth.reduce((sum, t) => sum + t, 0) / depth.length;
  // 2026-08-17: this used to return rawAverage directly. In real 8-player drafts that value
  // clusters around 45-66, so even an excellent bench could never display a strong 0-100 score.
  // 35 represents replacement-level depth; an average of 68 across roster spots 6-8 is an
  // exceptionally strong, realistically achievable bench under the FGA cap.
  return Math.round(rescaleToFullRange(rawAverage, { worst: 35, best: 68 }));
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

/** Minutes-weighted team average of O-TAL / D-TAL, the same shape as `talentScore` but reading
 * off the split offense/defense components instead of the blended number — purely informational
 * (matches how O-TAL/D-TAL are already informational-only at the per-player level), so they
 * don't feed `overall`. */
export function offenseScore(team: Team): number {
  return Math.round(rescaleToFullRange(benchBoostedWeightedAverage(team, computeOffensiveTalent, true), OFFENSE_SCORE_ANCHORS));
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
const MULTI_GRAVITY_TEAM_SPACING = 100;

export function spacingScore(team: Team): number {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return 0;

  // See `BENCH_INFLUENCE_BOOST`'s own docstring above — the multi-gravity/anomaly-floor logic
  // below already gives bench-minute shooters full (not minutes-diluted) credit on its own terms,
  // so only this base weighted average needs the same boost offense/defense already get.
  const base = benchBoostedWeightedAverage(team, computeSpacing, false);

  const anomalyMinutes = assignments
    .filter(({ player }) => isShootingAnomalyPlayer(player))
    .reduce((sum, { minutes }) => sum + minutes, 0);
  const anomalyShare = Math.max(0, Math.min(1, anomalyMinutes / STARTER_MINUTES));

  const hasSecondGravityThreat = assignments.some(
    ({ player, minutes }) =>
      minutes > 0 && !isShootingAnomalyPlayer(player) && spacingBreakdown(player).points >= WALKING_GRAVITY_FLOOR,
  );
  if (anomalyMinutes > 0 && hasSecondGravityThreat) return MULTI_GRAVITY_TEAM_SPACING;

  const floored = Math.max(base, SHOOTING_ANOMALY_TEAM_SPACING_FLOOR);
  const withCurryFloor = base * (1 - anomalyShare) + floored * anomalyShare;
  return Math.round(rescaleToFullRange(withCurryFloor, SPACING_SCORE_ANCHORS));
}

export interface FitScoreComponents {
  base: number;
  creationHierarchy: number;
  rimGravitySynergy: number;
  continuousSpacing: number;
  teamDefense: number;
  rebounding: number;
  capEfficiency: number;
}

export interface FitScoreResult {
  score: number;
  notes: string[];
  raw: number;
  components: FitScoreComponents;
}

export function fitScore(team: Team): FitScoreResult {
  const starters = primaryStarters(team).map((e) => e.player);
  const notes: string[] = [];
  let score = 70;
  const components: FitScoreComponents = {
    base: score,
    creationHierarchy: 0,
    rimGravitySynergy: 0,
    continuousSpacing: 0,
    teamDefense: 0,
    rebounding: 0,
    capEfficiency: 0,
  };

  const creationStart = score;
  const usageWeight = starters.reduce((sum, p) => sum + (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0), 0);
  // 2026-08-07: `isSelfSufficientEngine` (offensiveProfile.ts, Nash-type — elite playmaking, no
  // dominant shot zone) generates real offense alone even when his own archetype tag reads as
  // low/no on-ball-usage weight (a facilitation-heavy hub isn't "Shot Creator"/"Slasher" in the
  // redundancy sense) — without this check a genuine Nash/Stockton-caliber hub can still trip the
  // "no go-to shot creator" penalty below despite objectively not needing one.
  const hasSelfSufficientEngine = starters.some(isSelfSufficientEngine);
  if (usageWeight === 0) {
    if (hasSelfSufficientEngine) {
      notes.push('A self-sufficient offensive engine covers creation alone — no redundant isolation usage needed.');
    } else {
      score -= 15;
      notes.push('No go-to shot creator among starters — offense will stall in isolation situations.');
    }
  } else if (usageWeight > 3) {
    score -= 20;
    notes.push('Starters are redundant — too much isolation usage competing for the same shots.');
  } else if (usageWeight > 2) {
    score -= 10;
    notes.push('Starters will compete for touches.');
  } else {
    notes.push('Clean creation hierarchy among starters.');
  }
  components.creationHierarchy = score - creationStart;

  // 2026-08-17 scoring audit: average O-POR across all five starters was removed from Fit.
  // It penalized the legitimate primary engine instead of asking whether the *complements*
  // travel, and duplicated the creation-hierarchy signal above. Shooter count likewise no
  // longer scores independently: continuous spacing below already measures the same property.
  // Both values remain available to the insight layer and the conditional rim-gravity check.
  const plusShooters = starters.filter(isPlusShooter);
  const hasShootingAnomaly = starters.some(isShootingAnomalyPlayer);

  // Rim-gravity synergy — 2026-08-07, the user's own (a)/(c) framework (offensiveProfile.ts):
  // a rim-dominant scorer's whole value depends on real shooters punishing the help defense he
  // draws. Distinct from and stacks with the generic no-shooter penalty above — a rim-gravity
  // scorer with zero shooters around him is a WORSE fit failure than a merely shooter-less team
  // in general, not just the same one twice.
  const rimGravityStart = score;
  const rimGravityStarters = starters.filter(isRimGravityScorer);
  const RIM_GRAVITY_WASTED_PENALTY_PER_PLAYER = 7;
  const MAX_RIM_GRAVITY_WASTED_PENALTY = 14;
  if (rimGravityStarters.length > 0) {
    if (!hasShootingAnomaly && plusShooters.length === 0) {
      const penalty = Math.min(MAX_RIM_GRAVITY_WASTED_PENALTY, rimGravityStarters.length * RIM_GRAVITY_WASTED_PENALTY_PER_PLAYER);
      score -= penalty;
      notes.push(`${rimGravityStarters.map((p) => p.playerName).join('/')} draws real rim gravity with nobody to punish the help defense.`);
    } else if (hasShootingAnomaly || plusShooters.length >= 2) {
      score += 5;
      notes.push('Shooters properly surround the roster\'s rim-gravity scorer(s).');
    }
  }
  components.rimGravitySynergy = score - rimGravityStart;

  // Real team spacing, continuous — 2026-08-07, the user's own first-named reason for the BAD
  // example roster ("nieistniejący spacing" — spacing that doesn't exist at all, not just "no
  // plus shooter"). The binary plus-shooter check above can't distinguish a team that's merely
  // short of the plus-shooter bar from one where literally every starter reads 0 on
  // `computeSpacing` — checked directly, the user's own BAD example is the latter (all five
  // starters score exactly 0). Anchored on real draft-pool per-player SPACING percentiles: p50=40
  // (neutral), p10=0/p90=85 — asymmetric spans on purpose, matching the asymmetric real
  // distribution (a quarter of the whole pool reads 0).
  const continuousSpacingStart = score;
  const SPACING_TAL_NEUTRAL = 40;
  const SPACING_PENALTY_SPAN = 40; // neutral - p10
  const SPACING_BONUS_SPAN = 45; // p90 - neutral
  const SPACING_MAX_PENALTY = 26;
  const SPACING_MAX_BONUS = 12;
  const avgStarterSpacing = starters.reduce((sum, p) => sum + computeSpacing(p), 0) / starters.length;
  if (avgStarterSpacing < SPACING_TAL_NEUTRAL) {
    const deficitRatio = Math.min(1, (SPACING_TAL_NEUTRAL - avgStarterSpacing) / SPACING_PENALTY_SPAN);
    const penalty = Math.round(deficitRatio * SPACING_MAX_PENALTY);
    score -= penalty;
    if (penalty >= 10) notes.push('Team spacing is essentially non-existent across the starting five.');
  } else {
    const excessRatio = Math.min(1, (avgStarterSpacing - SPACING_TAL_NEUTRAL) / SPACING_BONUS_SPAN);
    const bonus = Math.round(excessRatio * SPACING_MAX_BONUS);
    score += bonus;
  }
  components.continuousSpacing = score - continuousSpacingStart;

  // 2026-08-17 weak-link pass: a starter-average D-TAL term let three strong defenders erase one
  // or more obvious playoff targets from the mean. `defenseScore` already rewards average quality,
  // so FIT now measures the separate complement question: how many assigned minutes can opponents
  // hunt? Every D-TAL<60 player's real rotation minutes stack; this roster-level penalty cannot be
  // satisfied by one noisy role tag or hidden by one elite rim protector.
  const teamDefenseStart = score;
  const DTAL_NEUTRAL = 42;
  const DTAL_ELITE_SPAN = 37; // p90 - p50
  const avgStarterDTal = starters.reduce((sum, p) => sum + computeDefensiveTalent(p), 0) / starters.length;
  const huntability = defensiveHuntability(team);
  // Average D-TAL is already a direct Overall axis through `defenseScore`; re-awarding it here
  // duplicated quality and let Stockton/OG/Shaq erase Nash from the mean. FIT keeps only the
  // nonlinear complement question: how many attackable minutes this rotation exposes.
  const huntabilityPenalty = Math.round(huntability.penalty);
  score -= huntabilityPenalty;
  if (huntabilityPenalty >= 8) {
    notes.push(
      `Defense exposes ${huntability.targetableMinutes} targetable minutes: ${huntability.offenders
        .slice(0, 3)
        .map((offender) => `${offender.playerName} (D-TAL ${offender.defensiveTalent}, ${offender.minutes}m)`)
        .join(', ')}.`,
    );
  } else if (avgStarterDTal >= DTAL_NEUTRAL + DTAL_ELITE_SPAN * 0.7) {
    notes.push('Starting five has strong defensive talent without a major huntable-minutes problem.');
  }
  components.teamDefense = score - teamDefenseStart;

  // 2026-08-17 scoring audit: the former defensive-shell, corroborated-role and engine-
  // complement bonuses were removed from the numeric score. The first two re-counted the same
  // D-TAL already measured continuously above; the last fired for every roster in the 48-team
  // blind sample and therefore carried no ranking information. Role composition still belongs
  // in Strengths/Concerns, where it can explain a lineup without silently adding D-TAL twice.

  const reboundingStart = score;
  const totalStarterRpg = starters.reduce((sum, p) => sum + p.box.rpg, 0);
  if (totalStarterRpg < STARTER_REBOUNDING_FLOOR) {
    score -= 10;
    notes.push('Starting five is a rebounding liability — thin at the glass on both ends.');
  } else {
    notes.push('Starting five rebounds well enough to hold its own on the glass.');
  }
  components.rebounding = score - reboundingStart;

  // 2026-08-13, real D1 human-vote diagnostic: of every fitScore input signal checked
  // independently against the real 15-roster vote, cap efficiency (talent/FGA) was by far the
  // strongest (0.521) — stronger than any other fitScore ingredient, and close to `offenseScore`
  // (0.529) despite fitScore's blended total correlating near zero (0.021) beforehand. It was
  // capped to the narrowest, most conservative band of any term here (-10/+15) — widened
  // (doubled) to actually carry the weight this signal earned, rather than clipping most of a
  // proven-strong real predictor for no evidenced reason.
  const capEfficiencyStart = score;
  const allPlayers = team.roster;
  const totalTalent = allPlayers.reduce((sum, p) => sum + computeTalent(p), 0);
  const totalFga = allPlayers.reduce((sum, p) => sum + p.fga, 0);
  const efficiency = totalFga > 0 ? totalTalent / totalFga : 0;
  const efficiencyDelta = ((efficiency - BASELINE_EFFICIENCY) / BASELINE_EFFICIENCY) * 40;
  const efficiencyAdj = Math.max(-20, Math.min(30, Math.round(efficiencyDelta)));
  score += efficiencyAdj;
  if (efficiencyAdj > 3) {
    notes.push('Efficient cap usage: strong talent-per-shot value from your role players.');
  } else if (efficiencyAdj < -3) {
    notes.push('Inefficient cap usage: too much of the cap spent on redundant high-usage scorers.');
  }
  components.capEfficiency = score - capEfficiencyStart;

  // 2026-08-07 rework: analytically summing each term's own min/max (the previous approach —
  // "worst case sums every penalty, best case sums every bonus") assumes a realistic roster can
  // actually trip every penalty or clear every bonus AT ONCE, which the user's own two named
  // acceptance-test rosters showed isn't true in practice — a real bad-fit five doesn't
  // necessarily fail every single check (e.g. Ben Simmons individually clears the perimeter-
  // defense check even on a team the user correctly calls poorly fit). `ACHIEVABLE_MIN`/
  // `ACHIEVABLE_MAX` are instead **empirically calibrated** (`scripts/calibrateFitScoreRange.ts`,
  // same discipline as `OFFENSE_SCORE_ANCHORS`/etc. above) against real worst/best-constructible
  // rosters under the ACTUAL mechanics above, not a hand-summed analytical bound. Recalibrate
  // (rerun that script, paste its printed anchors here) after changing any term's magnitude.
  // 2026-08-13: recalibrated after widening the efficiency band and replacing the two binary
  // rim/perimeter checks with a bidirectional D-TAL term (see those changes' own docstrings
  // above) — MAX moved 133->150 (the wider efficiency band raises the real achievable ceiling),
  // MIN held at -44 (the new D-TAL penalty's max magnitude, 20, is smaller than the two removed
  // binary penalties combined, 25, so the real floor didn't move).
  // 2026-08-14: recalibrated after adding the D-TAL-gated defensive-role-composition bonus above
  // (+8 max). `calibrateFitScoreRange.ts`'s hill-climbing search has real run-to-run variance
  // (unseeded randomness) — 5 separate runs after this change returned MIN in [-55,-38] and MAX
  // in [150,157], not a single stable answer. Used the median-ish of those runs (-46/154) rather
  // than chasing one noisy extreme. Re-run `scripts/calibrateFitScoreRange.ts` a few times (not
  // just once) and paste a representative value here after any future term change.
  // 2026-08-17: recalibrated after the scoring audit removed five duplicated/non-discriminating
  // terms (average O-POR, shooter count, defensive shell, role coverage, engine complements).
  // The live legal-roster search found -2/124; the two named acceptance rosters land near the
  // intended ends of that range again (bad fit near 0, good fit near 90).
  // 2026-08-17, weak-link pass: average starter D-TAL was replaced by the nonlinear targetable-
  // minutes penalty shared with Defense/DRTG. Two independent hill-climb runs returned
  // [-15,112] and [-13,114]; use their midpoint rather than one stochastic extreme.
  const ACHIEVABLE_MIN = -14;
  const ACHIEVABLE_MAX = 113;
  const rescaled = ((score - ACHIEVABLE_MIN) / (ACHIEVABLE_MAX - ACHIEVABLE_MIN)) * 100;

  return { score: Math.max(0, Math.min(100, Math.round(rescaled))), notes, raw: score, components };
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
  const TIER_MAX_MINUTES: Record<OverallTier, number> = {
    // Same "never actually returned by overallTier(value)" note as OVERALL_TIER_MINUTES_TARGET.
    GOAT: MAX_MINUTES_PER_PLAYER,
    'Greatest peak': MAX_MINUTES_PER_PLAYER,
    MVP: MAX_MINUTES_PER_PLAYER,
    'All-NBA': MAX_MINUTES_PER_PLAYER,
    'All-star': MAX_MINUTES_PER_PLAYER,
    Starter: 32,
    // 2026-08-15, user's explicit ask ("cap można ustawić na 28") — see the matching entry's own
    // docstring on `OVERALL_TIER_MINUTES_TARGET` above.
    'Sixth Man': 28,
    'Role Player': 24,
    'Bench Warmer': 16,
    'Cigarette Butt': 8,
  };
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
    const tier = overallTier(computeTalent(p));
    const cap = TIER_MAX_MINUTES[tier];
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
  const hasWeakStarter = starters.some(({ player }) => computeTalent(player) < WEAK_STARTER_TAL_THRESHOLD);
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
 */
const TALENT_WEIGHT = 0.40;
const BENCH_DEPTH_WEIGHT = 0.10;
const OFFENSE_WEIGHT = 0.12;
const DEFENSE_WEIGHT = 0.12;
const SPACING_WEIGHT = 0.03;
const FIT_WEIGHT = 0.15;
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
      spacing * SPACING_WEIGHT +
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
