import { RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../data/schema';
import type { Position, PlayerSpan, OffensiveArchetype } from '../data/schema';
import type { Team } from './types';
import { positionFitMultiplier, STARTER_SLOTS, isUpwardSlide } from './positions';
import { computeOffensiveTalent, computeDefensiveTalent, computeDefensiveImpact } from './talent';
import { isPlusShooter } from './shooting';
import {
  isShootingAnomalyPlayer,
  spacingBreakdown,
  selfCreationRate,
  SHOOTING_ANOMALY_TEAM_SPACING_FLOOR,
  WALKING_GRAVITY_FLOOR,
} from './spacing';
import { rimPressureTeam } from './rimPressure';
import { teamSpacingValue } from './midrangeGravity';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { LOW_OFFENSE_BIG_OTAL_CEILING, LOW_USAGE_BIG_FGA_CEILING } from './aiDrafter';
import { positionCompetence, PARTIAL_POSITION_GRACE_MINUTES } from './positionCompetence';
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
import { fitScore, ELITE_SCORING_GRAVITY_OTAL, ELITE_PRIMARY_CREATOR_THRESHOLD } from './fit';
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
 *
 * 2026-09-16, user-reported live (a real drafted team: Dave Twardzik 1976-78 as the starting PG
 * next to peak Durant/Wade/Mourning/Rasheed Wallace — "to nie są gracze o wartości startera",
 * ranked ABOVE Kobe+Shaq / Hakeem / Drexler+D.Robinson / Chris Paul+Anthony Davis rosters — user:
 * "jestem pewny że chodziło o starting 5, a nie 5 najlepszych w rotacji"): re-derived from
 * `TOP_CORE_SIZE`-of-the-whole-9-man-roster (unweighted top 5 TAL ANYWHERE, bench included) to the
 * actual 5 tagged starters. The old shape let two truly elite complementary pieces (peak Durant 98,
 * peak Wade 97) fully hide a legitimately inadequate starting PG (TAL 61) from this metric
 * entirely — he never even made the "top 5" being averaged, so his own start never counted against
 * his team at all. This wasn't a guess: a 2026-09-03 re-validation already measured this exact
 * swap and left it unapplied pending more data —
 *   - old (effectiveTalent, top-5-of-9):        Spearman 0.536 (D1, n=15)
 *   - average of the 5 TAGGED starters instead: Spearman 0.700
 * The user's live case is a concrete instance of the same gap that measurement predicted. Also
 * folds in a starter floor (`STARTER_FLOOR_THRESHOLD`/`STARTER_FLOOR_PENALTY_PER_POINT`) —
 * switching to a starters-only average alone still lets 1-2 outlier-elite starters largely absorb
 * one glaringly weak one (Twardzik 61 + Durant 98 + Wade 97 + Wallace 82 + Mourning 87 still
 * averages 85, barely below a genuine top-tier roster's ~86-89) — so a starter reading clearly
 * below credible all-time-starter value now docks the score directly, regardless of how strong the
 * other four are. Deliberately NOT minutes- or position-fit-weighted otherwise, matching the
 * validated metric's own exact shape: bench depth/position legality already have their own
 * dedicated scores (rotationScore, position eligibility itself) — this one is purely "how strong
 * is the starting five, and is every one of them a credible starter."
 */
// 2026-08-19: switched from raw `computeTalent` to `effectiveTalent` as part of the project-wide
// display-vs-real unification (see that function's own docstring).
const STARTER_FLOOR_THRESHOLD = 70;
const STARTER_FLOOR_PENALTY_PER_POINT = 0.6;
export function talentScore(team: Team): number {
  const starterTals = primaryStarters(team).map((entry) => effectiveTalent(entry.player));
  if (starterTals.length === 0) return 0;
  const average = starterTals.reduce((sum, t) => sum + t, 0) / starterTals.length;
  const weakestStarter = Math.min(...starterTals);
  const floorPenalty = Math.max(0, STARTER_FLOOR_THRESHOLD - weakestStarter) * STARTER_FLOOR_PENALTY_PER_POINT;
  return Math.round(Math.max(0, Math.min(100, average - floorPenalty)));
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
/**
 * 2026-09-25, user ("ławka powinna mieć mniejszy impact" -> "offense x1,2 defense 0,8 spacing
 * 1,2"): one boost for all three axes over-weighted a weak bench defender (Matt Bonner's 16 minutes
 * counted like 24 in Defense) while bench players mostly defend other benches. Per axis now:
 * offense and spacing keep a mild boost (a second unit still has to score and space), defense
 * counts bench minutes at 0.8 — below their real share, since backups face backups
 * (`defensiveHuntability`'s own `BENCH_COMPETITION_DISCOUNT` already charges weak-link minutes at 0.4).
 */
const BENCH_WEIGHT_OFFENSE = 1.2;
const BENCH_WEIGHT_DEFENSE = 0.8;
const BENCH_WEIGHT_SPACING = 1.2;

/** Shared weighted-minutes reducer for `offenseScore`/`defenseScore`/`spacingScore` below —
 * same shape three times over, differing only in which per-player metric and whether
 * `positionFitMultiplier` applies (spacing deliberately excludes it — see its own docstring). */
function benchBoostedWeightedAverage(
  team: Team,
  valueFor: (player: PlayerSpan, slot: Position) => number,
  applyFitMultiplier: boolean,
  benchWeight: number = BENCH_INFLUENCE_BOOST,
): number {
  const assignments = allAssignments(team);
  const fullMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || fullMinutes === 0) return 0;
  const starterKeys = new Set(primaryStarters(team).map((s) => `${s.slot}|${s.player.id}`));
  let rawAssignedMinutes = 0;
  let weightSum = 0;
  const weighted = assignments.reduce((sum, { slot, player, minutes }) => {
    rawAssignedMinutes += minutes;
    const isBench = !starterKeys.has(`${slot}|${player.id}`);
    const effectiveMinutes = isBench ? minutes * benchWeight : minutes;
    weightSum += effectiveMinutes;
    const fitMultiplier = applyFitMultiplier ? positionFitMultiplier(player, slot) : 1;
    return sum + valueFor(player, slot) * fitMultiplier * effectiveMinutes;
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
  // 2026-09-25: a true weighted average (÷ the weighted minutes), times `LEGACY_BENCH_SCALE` —
  // the old reducer divided the bench-boosted sum by the plain 240, so the boost inflated the whole
  // number (~x1.14 for a typical 66 bench minutes) and every anchor was fitted on that inflated
  // scale. Dividing by the weights makes a bench-weight change move only the starter/bench MIX;
  // the constant keeps the anchors' scale. The short-rotation case above is still covered: a
  // missing slot adds no weight, so it can't dilute the average.
  void fullMinutes;
  void rawAssignedMinutes;
  return weightSum > 0 ? (weighted / weightSum) * LEGACY_BENCH_SCALE : 0;
}
/** The old reducer's typical inflation (bench-boosted sum ÷ 240 at x1.5), measured on 128 seeded
 * CPU rosters — keeps OFFENSE/DEFENSE/SPACING_SCORE_ANCHORS on the scale they were fitted on. */
const LEGACY_BENCH_SCALE = 1.1375;

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

// 2026-09-05, user-reported (D1S2 Drużyna 3, self-creation 47 too low for a Curry + Kareem core):
// two blind spots in the raw feed —
//  1. `selfCreationRate` (spacing.ts's shared archetype proxy) returns 0 for a `Post Scorer`. But
//     a post-up scorer creating on the block — Kareem's skyhook, Hakeem's Dream Shake — is the
//     purest self-creation there is. Reconstructed here as a local usage ramp (mirroring
//     spacing.ts's own 11→16 FGA ramp) so it stays OUT of that shared table, which feeds
//     `computeSpacing` → `computeTalent` → Taylor/GOAT.
//  2. `measuredSelfCreationForSpan` (real unassisted-FG rate, 1997+) reads Curry 2014-16 at ~54%
//     — correct as a fraction (much of his make diet is assisted catch-and-shoot off the Warriors'
//     motion) but it undersells his pull-up shot-creation THREAT. For a genuine primary-creator
//     archetype the archetype proxy is used as a FLOOR: measured can beat it, never fall under it.
const SC_USAGE_FLOOR = 11;
const SC_USAGE_FULL = 16;
const POST_SCORER_SELF_CREATION = 0.7;
const SELF_CREATION_PROXY_FLOOR_WEIGHT = 0.7;
const PRIMARY_CREATOR_ARCHETYPES: readonly OffensiveArchetype[] = ['Shot Creator', 'Primary Ball Handler'];

function selfCreationProxy(player: PlayerSpan): number {
  const base = selfCreationRate(player);
  if (base > 0 || player.offensiveArchetype !== 'Post Scorer') return base;
  const usage = Math.max(0, Math.min(1, (player.fga - SC_USAGE_FLOOR) / (SC_USAGE_FULL - SC_USAGE_FLOOR)));
  return POST_SCORER_SELF_CREATION * usage;
}

function starterSelfCreation(player: PlayerSpan): number {
  const measured = measuredSelfCreationForSpan(player, selfCreationFgByYear);
  const proxy = selfCreationProxy(player);
  if (measured == null) return proxy * 100;
  const floor = PRIMARY_CREATOR_ARCHETYPES.includes(player.offensiveArchetype) ? proxy * SELF_CREATION_PROXY_FLOOR_WEIGHT : 0;
  return Math.max(measured, floor) * 100;
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
// 2026-09-12, user-reported live with a real example (Tampa Eagles: spacing 30, still Offense 70
// and a top-3 PR finish): `offensiveCohesion` above already zeroes its own bonus below spacing 55
// (the `spacingReadiness` gate), so that wasn't the leak — the plain blend was. At 13.5% weight, a
// team can be near the worst legal spacing in the whole pool (`SPACING_SCORE_ANCHORS.worst`=20)
// and still only lose ~9 raw points versus a maxed-out spacer, while OTAL alone was worth exactly
// 3x that. Moved weight from OTAL into spacing (0.405->0.34, 0.135->0.20) rather than inventing a
// new penalty mechanism — same six components, same 1.0 sum, just closer to how much a genuinely
// broken floor should cost an NBA-realistic offense relative to raw scoring talent.
const OFFENSE_OTAL_BLEND_WEIGHT = 0.34;
const OFFENSE_SPACING_BLEND_WEIGHT = 0.2;
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

// 2026-09-16, user-reported live with a real example (Nash + Erving-peak + Garnett-peak + Ewing —
// "ta drużyna ofensywnie nie wiele się różni od core Phoenix Suns... a mimo to dostaje karę" — a
// scouting-report-backed argument, via Ben Taylor's own Nash writeup, that a genuine elite
// playmaking engine shouldn't pay full price for teammates who can't shoot). Investigated with a
// direct diagnostic before touching anything: `fitScore`'s own `spacingCompatibility` ALREADY
// applies exactly this discount (`hasGravityStarter`/`hasElitePrimaryCreator`, 2026-09-12, from a
// near-identical earlier ask) and reads a healthy 77 for this roster — that mechanism works. The
// gap is that `spacingScore` below (this function's own `spacing` field, 20% of `offenseScore`'s
// blend) is a plain weighted average with no equivalent — the same real insight was never ported
// over when spacing was blended into offense (2026-08-19). `hasElitePlaymakingEngine` mirrors
// `fitScore`'s own two gates exactly (same thresholds, imported rather than duplicated) so both
// numbers agree on WHO counts as a self-sufficient engine; `OFFENSE_SPACING_ELITE_ENGINE_BONUS` is
// deliberately more modest than fit.ts's own swing (that one can move a single `geometryScore`
// ladder step by up to 60 raw points before its 0.45 sub-weight; this is a flat, capped credit on
// the simple average, not a ladder-based mechanic) — a real, felt credit without fully erasing the
// cost of a genuinely bad-shooting frontcourt. `fitScore(team)` is computed once and reused for
// `mismatchStructure` below too, instead of the pre-existing redundant second call.
const OFFENSE_SPACING_ELITE_ENGINE_BONUS = 15;

function offenseScoreComponents(team: Team): OffenseScoreComponents {
  const starterAssignments = primaryStarters(team);
  const starters = starterAssignments.map((entry) => entry.player);
  const fit = fitScore(team);
  // 2026-09-17, user-reported live (real Magic Johnson/Klay Thompson/Paul Pierce/Shawn Kemp/
  // Dwight Howard construction: `spacingScore` already read 86 off Klay+Pierce clearing
  // `WALKING_GRAVITY_FLOOR` as starters, then this bonus added +15 more on the SAME signal,
  // capping the display at 100 despite 2 of 5 starters being flat non-shooters): the
  // `spacingBreakdown(...).points >= WALKING_GRAVITY_FLOOR` half of this gate was the literal same
  // check `spacingScore`'s own single/multi-gravity-threat branches already use to floor/boost
  // `rawSpacing` for that exact player — real double counting, not two independent signals. The
  // OTAL-based half is not: raw scoring talent isn't specifically a 3PT-shooting signal, so a
  // Nash-caliber engine who ISN'T necessarily a plus shooter still earns this credit on its own
  // terms, matching the mechanic's original Nash/Erving/Garnett/Ewing motivation. Kept OTAL-only.
  const hasEliteScoringEngine = starters.some((player) => computeOffensiveTalent(player) >= ELITE_SCORING_GRAVITY_OTAL);
  const hasElitePrimaryCreator = fit.inputs.primaryCreationSignal >= ELITE_PRIMARY_CREATOR_THRESHOLD;
  const hasElitePlaymakingEngine = hasEliteScoringEngine || hasElitePrimaryCreator;
  const rawSpacing = spacingScore(team);
  // 2026-09-18, user-reported live ("90 nadal za dużo w mojej opinii" — 90 is still too much,
  // after the fix below had already brought a real Magic Johnson/Klay Thompson/Paul Pierce/Shawn
  // Kemp/Dwight Howard construction from 100 to 90): the elite-engine bonus itself was still
  // uncapped by `spacingNonSpacerCeiling` — it could lift the DISPLAYED number past the same 75/65
  // ceiling `spacingScore` now enforces on the raw value, on the theory that a genuine elite
  // playmaking engine is a real, independent value source worth exceeding it for. The user's own
  // call: no — two non-shooting starters cap the team's spacing story regardless of how good the
  // engine running it is. Reusing the same ceiling here closes that gap; the bonus can still lift a
  // team TOWARD the ceiling, just never past it.
  const spacingCeiling = spacingNonSpacerCeiling(starterAssignments, restSpacesForCenter(starterAssignments));
  return {
    otal: rescaleToFullRange(benchBoostedWeightedAverage(team, (p) => computeOffensiveTalent(p), true, BENCH_WEIGHT_OFFENSE), OFFENSE_SCORE_ANCHORS),
    spacing: Math.min(spacingCeiling, hasElitePlaymakingEngine ? Math.min(100, rawSpacing + OFFENSE_SPACING_ELITE_ENGINE_BONUS) : rawSpacing),
    rimPressure: rimPressureTeam(starters),
    playmaking: teamPlaymakingQuality(starters),
    selfCreation: teamSelfCreationQuality(starters),
    mismatchStructure: fit.inputs.mismatchStructure,
  };
}

/**
 * 2026-09-09, user-reported for the 3rd time ("dużo łatwiej zrobić 100 def niż 100 off") and this
 * time with a top-5 human-vs-AI roster comparison as evidence: `defenseScore` gets an additive
 * `defensiveCohesion` bonus (a "you built a complete elite unit → ceiling" term) that routinely
 * pins elite defensive shells to 100, while `offenseScore` was a flat weighted average with no
 * equivalent, so even Curry + Barkley + Wilt + 93-spacing capped at ~81.
 *
 * The 5 previously-reverted attempts at an `offensiveCohesion` bonus all keyed it on offensive
 * STRUCTURE (playmaking chains, spacing geometry) and regressed the human-vote correlation —
 * humans reward STARS on offense, not structure (`analyzeD1HumanVote.ts`: `talentScore` and
 * `offenseScore` both correlate with the vote, structural offense signals do not). This one is
 * keyed on exactly that: a genuine two-elite-scorer starting core (2nd-best starter O-TAL) that
 * is ALSO real playoff offense (a spacing gate, the mirror of `defensiveCohesion`'s huntability-
 * resistance gate). An elite scoring pair with no spacing (Giannis + Ginóbili + weak shooting)
 * gets almost nothing — the same way an elite rim pair with a hunted perimeter does on defense.
 *
 * Same magnitude family as `defensiveCohesion`'s own (post-2026-09-09-cut) caps, so the two axes
 * can reach comparable ceilings for comparably-complete units. Additive on the blended `.score`,
 * clamped 0-100 — the 6 component fields stay raw for the UI breakdown, exactly like
 * `defenseScore`'s linear part vs its final adjusted value.
 */
export const MAX_ELITE_SCORING_CORE_BONUS = 9;
export const MAX_SECONDARY_SCORING_BONUS = 6;
const SECOND_SCORER_OTAL_START = 82;
const SECOND_SCORER_OTAL_FULL = 92;
const THIRD_SCORER_OTAL_START = 78;
const THIRD_SCORER_OTAL_FULL = 88;
const OFFENSE_COHESION_SPACING_START = 55;
const OFFENSE_COHESION_SPACING_FULL = 85;

export interface OffensiveCohesionResult {
  /** 0-1: a complete two-elite-scorer core that is also real spacing. */
  eliteScoringCore: number;
  secondScorerOtal: number;
  spacingReadiness: number;
  offenseScoreBonus: number;
}

export function offensiveCohesion(team: Team): OffensiveCohesionResult {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const starterOtals = primaryStarters(team)
    .map((entry) => computeOffensiveTalent(entry.player))
    .sort((a, b) => b - a);
  const second = starterOtals[1] ?? 0;
  const third = starterOtals[2] ?? 0;
  const teamSpacing = spacingScore(team);

  const coreReadiness = clamp01(
    (second - SECOND_SCORER_OTAL_START) / (SECOND_SCORER_OTAL_FULL - SECOND_SCORER_OTAL_START),
  );
  const thirdReadiness = clamp01(
    (third - THIRD_SCORER_OTAL_START) / (THIRD_SCORER_OTAL_FULL - THIRD_SCORER_OTAL_START),
  );
  const spacingReadiness = clamp01(
    (teamSpacing - OFFENSE_COHESION_SPACING_START) /
      (OFFENSE_COHESION_SPACING_FULL - OFFENSE_COHESION_SPACING_START),
  );

  // Complete elite core: two genuine elite scorers AND real spacing (the playoff gate).
  const eliteScoringCore = coreReadiness * spacingReadiness;
  const eliteCoreBonus = eliteScoringCore * MAX_ELITE_SCORING_CORE_BONUS;
  // Partial: a real 2nd + 3rd scorer with at least some spacing — bounded credit, mirrors
  // `defensiveCohesion`'s three-layer-core term.
  const secondaryBonus =
    coreReadiness * (0.5 + thirdReadiness * 0.5) * spacingReadiness * MAX_SECONDARY_SCORING_BONUS;

  return {
    eliteScoringCore,
    secondScorerOtal: second,
    spacingReadiness,
    offenseScoreBonus: Math.max(eliteCoreBonus, secondaryBonus),
  };
}

/**
 * 2026-09-25, user-reported ("5 różnicy między Jokiciem a Gobertem nie ma sensu, możliwe że
 * najlepszy w historii gracz w ataku vs słaby ofensywie center"): every offense component is a
 * minutes-weighted team average, so one starter is at most ~15% of each — swapping the best
 * offensive player ever (O-TAL 100) for a weak-offense center (Gobert, 63) moved the whole
 * offense by ~5 points. `offensiveCohesion` only rewards a PAIR of elite scorers, so a single
 * all-time engine had no star term at all. This is that term: an additive lift keyed on the best
 * starter's own O-TAL, scaled by his starter-minutes share (a bench-minutes star leverages less),
 * applied before the weak-starter cap so a star can't carry a lineup with a real offensive hole
 * past it. Spans -2 (no starter at O-TAL 85+) to +6 (a full-minutes O-TAL 100 engine) rather than
 * 0 to +8: a third of AI teams start an O-TAL 100 player, so a pure bonus shifted the whole league
 * (mean 77.0 -> 80.3 over 192 seeded teams); the offset keeps the same 8-point star-vs-no-star
 * spread with less drift (mean 78.9, teams above 90: 3 -> 14 of 192). Same Billups/White/E. Jones/
 * Pippen shell: Jokic 77 -> 83, Gobert stays 72 (engine floor).
 */
export const MAX_SUPERSTAR_ENGINE_BONUS = 6;
const NO_SUPERSTAR_ENGINE_MALUS = 2;
const SUPERSTAR_ENGINE_OTAL_START = 85;
const SUPERSTAR_ENGINE_OTAL_FULL = 100;

export function superstarEngineBonus(team: Team): number {
  let best = 0;
  for (const { player, minutes } of primaryStarters(team)) {
    if (minutes <= 0) continue;
    const readiness = Math.max(
      0,
      Math.min(
        1,
        (computeOffensiveTalent(player) - SUPERSTAR_ENGINE_OTAL_START) /
          (SUPERSTAR_ENGINE_OTAL_FULL - SUPERSTAR_ENGINE_OTAL_START),
      ),
    );
    best = Math.max(best, readiness * Math.min(1, minutes / STARTER_MINUTES));
  }
  return best * (MAX_SUPERSTAR_ENGINE_BONUS + NO_SUPERSTAR_ENGINE_MALUS) - NO_SUPERSTAR_ENGINE_MALUS;
}

/**
 * 2026-09-16, user's direct follow-up on `OFFENSE_SPACING_ELITE_ENGINE_BONUS` above ("chodzi mi
 * żeby można było zbudować wokół Nasha kompletnie defensywny zespół który i tak będzie mocny w
 * ataku" — a team built around a real elite offensive engine should be able to field an
 * all-defense supporting cast and still read as a genuine offense): mirrors `spacing.ts`'s
 * `SHOOTING_ANOMALY_TEAM_SPACING_FLOOR` (Curry's own minutes floor spacing at 85 regardless of his
 * teammates), but for the WHOLE `offenseScore` blend instead of just spacing — the spacing-only
 * bonus above still leaves a genuinely elite engine's team reading weak overall when literally
 * every teammate is defense-only.
 *
 * Verified against the motivating extreme case (Nash 2005-07 + four genuine defense-only starters
 * — Bruce Bowen, Tony Allen, Ben Wallace, Rudy Gobert): raw offenseScore reads 55 even WITH the
 * spacing bonus already applied (spacing itself only reaches 36). Floored at
 * `ELITE_OFFENSIVE_ENGINE_FLOOR`, scaled by the engine's actual starter-minutes share exactly like
 * Curry's spacing floor (a bench-minutes engine gets proportionally less credit, not the full
 * floor) — can only ever raise the number, and does nothing at 0 minutes.
 *
 * Deliberately gated on the SAME individually-attributable half of `hasGravityStarter` only (a
 * specific starter clearing `WALKING_GRAVITY_FLOOR` spacing or `ELITE_SCORING_GRAVITY_OTAL`
 * themselves) — NOT the team-aggregate `hasElitePrimaryCreator` signal, which has no single
 * attributable player and would otherwise misattribute the floor to whichever starter happens to
 * be first in, say, a Kobe+Shaq+Webber+Porter+Horry lineup (verified this doesn't fire there:
 * Porter himself clears neither threshold, so that team's raw 80 is untouched). A genuinely
 * stacked team (Nash + real shooters, raw 84; Curry + all-defense, raw 68 from Curry's own
 * existing mechanics) is likewise untouched or only lifted the remaining gap to the floor.
 */
const ELITE_OFFENSIVE_ENGINE_FLOOR = 72;

/**
 * 2026-09-25 engine audit: the spacing half of the engine gate used to be the shooting tier alone
 * ("Walking gravity"), so role shooters with no engine to speak of (Hedo Turkoglu O-TAL 69,
 * Khris Middleton 75, Ryan Anderson 57) floored their team at 72 while Kevin Garnett (O-TAL 82,
 * no jumper) got nothing — swapping KG for Ryan Anderson raised team offense 52 -> 64. A shooter
 * now also needs a genuine star O-TAL to count as an engine (Curry 98, Nash 97, Dirk 90 still do).
 */
const GRAVITY_ENGINE_OTAL_FLOOR = 85;

/**
 * 2026-09-23, user ("defensywni centrzy zbyt op - zbyt mało zaniżają ofensywę... brak elitarnego
 * playmakera obok defensywnego centra = spadek w ataku"): the "cheap because it isn't an
 * offense" low-usage defensive anchor `lowUsageBigMalus` (aiDrafter.ts) already targets for
 * draft-value reasons — reused directly rather than a second copy of the same three-condition
 * profile. `fga`/`niski o-tal` alone isn't enough by the user's own follow-up: a low-usage,
 * low-O-TAL big is only genuinely "needs a real passer to be fed" if he's ALSO a real defensive
 * anchor (high D-TAL) — a merely replaceable backup big isn't a case this floor should ever have
 * cared about either way.
 */
const DEFENSIVE_CENTER_DTAL_FLOOR = 70;
function isLowUsageDefensiveCenter(p: PlayerSpan): boolean {
  return (
    p.primaryPosition === 'C' &&
    computeOffensiveTalent(p) < LOW_OFFENSE_BIG_OTAL_CEILING &&
    p.fga < LOW_USAGE_BIG_FGA_CEILING &&
    computeDefensiveTalent(p) >= DEFENSIVE_CENTER_DTAL_FLOOR
  );
}

/**
 * Real passing quality bar for the engine itself, only checked once a starting defensive center
 * (above) needs someone to actually feed him. `playmakingScoreForPlayer`'s own real distribution
 * (fit.ts's docstring on `starterOnBallDemand`): 84 -> elite-adjacent, 90+ -> genuine elite. Set
 * well below that so the mechanism's own validated motivating case — Nash 2005-07 anchoring an
 * all-defense five including Ben Wallace AND Rudy Gobert — still clears it comfortably; this
 * only excludes an engine with real scoring/shooting but no real point-of-attack passing (a pure
 * shooter or isolation scorer), which is exactly the gap the user is pointing at.
 */
const DEFENSIVE_CENTER_ENGINE_PLAYMAKING_FLOOR = 65;

function eliteOffensiveEngineFloorContribution(team: Team): number {
  const starters = primaryStarters(team);
  const hasStartingDefensiveCenter = starters.some(
    ({ player, minutes }) => minutes > 0 && isLowUsageDefensiveCenter(player),
  );
  const engineAssignment = starters.find(({ player, minutes }) => {
    if (minutes <= 0) return false;
    const otal = computeOffensiveTalent(player);
    const clearsSoloOffenseBar =
      otal >= ELITE_SCORING_GRAVITY_OTAL ||
      (spacingBreakdown(player).points >= WALKING_GRAVITY_FLOOR && otal >= GRAVITY_ENGINE_OTAL_FLOOR);
    if (!clearsSoloOffenseBar) return false;
    if (!hasStartingDefensiveCenter) return true;
    return (playmakingScoreForPlayer(player) ?? 0) >= DEFENSIVE_CENTER_ENGINE_PLAYMAKING_FLOOR;
  });
  if (!engineAssignment) return 0;
  // 2026-09-25, user-reported ("jeśli podłoga ataku Jokicia jest taka sama jak Goberta, to poważny
  // błąd w silniku"): the minutes share was never capped at 1, so an engine playing 40 minutes
  // lifted the floor to 80 (72 x 40/36) instead of the intended 72 — enough to pull a Gobert
  // team's real 72 and a Jokic team's real 77.5 onto the same 80. The share only scales the floor
  // DOWN for an engine playing less than a starter's minutes, never above ELITE_OFFENSIVE_ENGINE_FLOOR.
  return ELITE_OFFENSIVE_ENGINE_FLOOR * Math.min(1, engineAssignment.minutes / STARTER_MINUTES);
}

/**
 * 2026-09-23, user-reported ("słaby center w ofensywie - cap na offense z lekkim gradientem",
 * then "tę zasadę można przenieść na inne pozycje"): a starting player with real offensive
 * limitations (O-TAL below `LOW_OFFENSE_BIG_OTAL_CEILING`) at ANY of the five slots shouldn't let
 * the blended offense score climb unchecked — but a hard flat cap felt too static, so this is a
 * gradient instead: the user's own worked example (raw ~90 -> 83, ~87 -> 82, ~85 -> 81) fits a
 * line, `raw*0.4 + 47`, floored at 80 below its own crossover (~82.5) so a modest raw score still
 * reads a flat 80, not something dragged under it. `Math.min(raw, ...)` means this only ever
 * pulls DOWN — a team whose raw blend is already below 80 is untouched, since there's nothing to
 * cap. Originally scoped to `primaryPosition === 'C'` only (matching the defensive-engine-floor
 * check above's own scope); widened to all five starter slots at the user's explicit follow-up —
 * the 75-point bar reads as "not a real all-time offensive threat," which is exactly as fair a
 * question for a starting PG/wing as it is for a center, not something specific to size.
 */
function weakOffensiveCenterCap(raw: number): number {
  return Math.min(raw, Math.max(80, raw * 0.4 + 47));
}

/**
 * 2026-09-24 correction to the widening above: a single 75 bar for every slot was universal, not
 * "weak" — measured on 96 seeded AI-drafted teams, 99% had at least one starter under O-TAL 75
 * (mean 1.9), so the cap moved 44% of all teams and crushed the top end (uncapped max 95 -> 89,
 * teams above 90: 6 -> 0; the ten best offenses all landed on 83-85). Centers keep the 75 bar the
 * original request (Gobert, O-TAL 62) was built on; every other slot now needs a genuinely weak
 * O-TAL (< 55: McMillan 40, Ward 43, Bowen 39). Same sample: 22/96 teams touched, mean 79.2 vs
 * 80.4 uncapped, max 92, two teams still above 90.
 */
const WEAK_OFFENSIVE_NON_CENTER_OTAL_CEILING = 55;

function hasWeakOffensiveStarter(team: Team): boolean {
  return primaryStarters(team).some(
    ({ player, minutes }) =>
      minutes > 0 &&
      computeOffensiveTalent(player) <
        (player.primaryPosition === 'C' ? LOW_OFFENSE_BIG_OTAL_CEILING : WEAK_OFFENSIVE_NON_CENTER_OTAL_CEILING),
  );
}

/** Single source of truth for the weighted blend — `offenseScore` (the number every other
 * consumer reads) and `offenseScoreBreakdown` (the UI's per-dimension view) both build on this so
 * the two can never drift apart. */
export function offenseScoreBreakdown(team: Team): OffenseScoreBreakdown {
  const components = offenseScoreComponents(team);
  const rawBlend =
    components.otal * OFFENSE_OTAL_BLEND_WEIGHT +
    components.spacing * OFFENSE_SPACING_BLEND_WEIGHT +
    components.rimPressure * OFFENSE_RIM_PRESSURE_BLEND_WEIGHT +
    components.playmaking * OFFENSE_PLAYMAKING_BLEND_WEIGHT +
    components.selfCreation * OFFENSE_SELF_CREATION_BLEND_WEIGHT +
    components.mismatchStructure * OFFENSE_MISMATCH_STRUCTURE_BLEND_WEIGHT;
  const blended = Math.max(0, Math.min(100, rawBlend + offensiveCohesion(team).offenseScoreBonus + superstarEngineBonus(team)));
  const cappedBlended = hasWeakOffensiveStarter(team) ? weakOffensiveCenterCap(blended) : blended;
  const score = Math.round(Math.max(cappedBlended, eliteOffensiveEngineFloorContribution(team)));
  return { ...components, score };
}

export function offenseScore(team: Team): number {
  return offenseScoreBreakdown(team).score;
}

/** The team's minutes-weighted D-TAL on the Defense score's own 0-100 scale, before the
 * huntability penalty, cohesion bonus and knee — the defense mirror of the O-TAL bar. */
export function teamDefensiveTalentScore(team: Team): number {
  return rescaleToFullRange(
    benchBoostedWeightedAverage(team, (p) => computeDefensiveTalent(p), true, BENCH_WEIGHT_DEFENSE),
    DEFENSE_SCORE_ANCHORS,
  );
}

export function defenseScore(team: Team): number {
  const linearScore = teamDefensiveTalentScore(team);
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
  return Math.round(Math.max(0, Math.min(100, applyDefenseKnee(adjusted))));
}

/**
 * 2026-09-24, user-reported after several passes ("nadal zbyt duża przewaga nad atakiem" — top
 * teams' Defense still outruns Offense): diminishing returns above `DEFENSE_SCORE_KNEE`, each
 * point past it counting `DEFENSE_SCORE_KNEE_SLOPE`. Same shape as the offense gradient the user
 * designed (raw 85 -> 81, 90 -> 83). Measured on 128 seeded AI-drafted teams (top-3 per draft):
 * mean Defense-minus-Offense gap +2.6 -> +0.3, teams with a gap >= 10 9/24 -> 4/24, top-1 gap
 * +5.4 -> +2.5, Defense >90 in 4/128 teams -> 0, while the mean Defense of ALL teams moves only
 * 69.9 -> 69.4 (a top-only lever). Rejected: rescaling `DEFENSE_SCORE_ANCHORS.best` (108 lowers
 * every team ~4 points, mean 65.8) and halving the cohesion bonus (gap only +0.7, and it touches
 * structural credit tuned over several sessions).
 */
const DEFENSE_SCORE_KNEE = 80;
const DEFENSE_SCORE_KNEE_SLOPE = 0.5;
function applyDefenseKnee(score: number): number {
  return score > DEFENSE_SCORE_KNEE ? DEFENSE_SCORE_KNEE + (score - DEFENSE_SCORE_KNEE) * DEFENSE_SCORE_KNEE_SLOPE : score;
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
/**
 * 2026-09-17, user-reported: the two-threat branch below used to apply no floor of its own —
 * just `base + 10`, capped at `MULTI_GRAVITY_TEAM_SPACING_CAP` — while the one-threat branch
 * above floors at 70. That let a two-genuine-shooter team (Nash + Porziņģis, three real
 * non-shooters around them) score LOWER (43) than a one-shooter team (Lewis alone, four real
 * non-shooters around him, which floors at 70 -> 69) once the `WALKING_GRAVITY_FLOOR` fix
 * (see spacing.ts) let Nash clear the bar on his own real number. Directly contradicts this
 * function's own stated rule two paragraphs up ("two genuine floor-warpers... regardless of who
 * else is out there") — two threats floor lower than one is never the intended ordering.
 *
 * Set above the single-threat floor (two real threats are worth more than one) and blended the
 * same way, over the AVERAGE of the threats' own minutes shares rather than the sum — two
 * shooters who each play a full starter's minutes shouldn't get double the workload credit of
 * one, since they're on the floor together, not back to back.
 */
const MULTI_WALKING_GRAVITY_TEAM_SPACING_FLOOR = 80;
/** Three credible perimeter spacers prevent a two-big lineup from reading like a broken floor.
 * The two non-shooting bigs still cap the ceiling; this is a solid, not elite, construction. */
const THREE_SHOOTER_LINEUP_SPACING_FLOOR = 58;
/**
 * 2026-09-17, user-reported live (Chris Paul 2013-15 + Rashard Lewis 2000-02, both real
 * `isPlusShooter` starters at 78/80 computeSpacing, alongside three genuine zeros): with only
 * TWO qualifying shooters, `THREE_SHOOTER_LINEUP_SPACING_FLOOR`'s `>= 3` gate doesn't fire, and
 * there was no floor at all below it — the roster fell straight to the raw weighted average
 * (~25), a cliff, not a taper. Two real plus-shooters are worse than three but still real: they
 * are exactly what keeps a Paul/Lewis-type five from playing like a truly dead floor. Set below
 * the three-shooter floor and un-gated on `hardNonSpacerCount` (redundant with `plusShooterCount
 * >= 2` here — five starters, two of them plus-shooters, means at most three hard non-spacers by
 * construction, and that's exactly the case this floor exists for). User's own target: "40-50
 * byłoby sprawiedliwe."
 */
const TWO_SHOOTER_LINEUP_SPACING_FLOOR = 45;

/**
 * 2026-09-17, user-reported live with a real construction (Magic Johnson 1988-90 + Klay Thompson
 * 2014-16 + Paul Pierce 2000-02 — two genuine Walking-gravity wings — alongside Shawn Kemp 1994-96
 * and Dwight Howard 2009-11, two flat `computeSpacing`=0 zeros at PF/C): every floor/bonus above
 * exists to make sure a real shooter's OWN gravity reads as real team spacing, but none of them has
 * ever asked how many of the OTHER starters simply cannot shoot at all. That roster's two real
 * gravity threats pushed `spacingScore` to 86 raw (100 once `offenseScoreComponents`'s elite-engine
 * bonus — see that function's own 2026-09-17 fix — added on top) despite 2 of 5 starters being
 * total non-threats a defense can freely sag or help off of. User's own proposed design: 2+ hard
 * non-spacer (`computeSpacing < 30`) starters caps the team at a good-not-elite 75 regardless of
 * how well the other three shoot; a non-shooting PG on top of that — the position whose own
 * shooting gravity most directly opens dribble-drive lanes for the rest of the offense — tightens
 * it further to 65. This is a pure CEILING, the mirror of `TWO_SHOOTER_LINEUP_SPACING_FLOOR`'s own
 * floor above, and — like every other cap in this function — never applies on Curry's own path
 * (`hasCurry`/`isCurry`), matching that mechanic's explicit "regardless of who else is out there"
 * design commitment.
 */
const TWO_NON_SPACER_STARTERS_CEILING = 75;
const NON_SPACER_PG_STARTER_CEILING = 65;

/**
 * 2026-09-25, user ("C powinno karać dopiero jeśli reszta spacingu ssie"): one non-shooting big in
 * a four-out lineup is normal basketball, not a spacing hole. When the four non-C starters average
 * at least `C_SPACING_REST_FLOOR` (65 — between the 25th and 50th percentile of CPU fives), a
 * player's minutes at C read at least `C_SPACING_NEUTRAL` and he stops counting as a hard
 * non-spacer. A lineup whose other four don't shoot still pays in full for a non-shooting C.
 */
const C_SPACING_REST_FLOOR = 65;
const C_SPACING_NEUTRAL = 45;
function restSpacesForCenter(starterAssignments: ReturnType<typeof primaryStarters>): boolean {
  const others = starterAssignments.filter(({ slot }) => slot !== 'C');
  if (others.length === 0) return false;
  return others.reduce((sum, { player }) => sum + teamSpacingValue(player), 0) / others.length >= C_SPACING_REST_FLOOR;
}
function spacingValueAt(player: PlayerSpan, slot: Position, cCovered: boolean): number {
  const value = teamSpacingValue(player);
  return slot === 'C' && cCovered ? Math.max(value, C_SPACING_NEUTRAL) : value;
}

function spacingNonSpacerCeiling(starterAssignments: ReturnType<typeof primaryStarters>, cCovered = false): number {
  const hardNonSpacers = starterAssignments.filter(({ player, slot }) => spacingValueAt(player, slot, cCovered) < 30);
  if (hardNonSpacers.length < 2) return 100;
  const pgIsNonSpacer = hardNonSpacers.some(({ slot }) => slot === 'PG');
  return pgIsNonSpacer ? NON_SPACER_PG_STARTER_CEILING : TWO_NON_SPACER_STARTERS_CEILING;
}

export function spacingScore(team: Team): number {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return 0;

  // See `BENCH_INFLUENCE_BOOST`'s own docstring above — the multi-gravity/anomaly-floor logic
  // below already gives bench-minute shooters full (not minutes-diluted) credit on its own terms,
  // so only this base weighted average needs the same boost offense/defense already get.
  // A team is judged first by the five opponents actually have to guard to open each game.
  // Bench shooting still matters, but cannot turn a Wade/Iguodala/Webber front line into an
  // elite-spacing starting lineup merely because Barry or Bonner appears later in the rotation.
  const starterAssignments = primaryStarters(team);
  const cCovered = restSpacesForCenter(starterAssignments);
  const fullRotationBase = benchBoostedWeightedAverage(team, (p, slot) => spacingValueAt(p, slot, cCovered), false, BENCH_WEIGHT_SPACING);
  const starters = starterAssignments.map((entry) => entry.player);
  const starterBase = starterAssignments.length > 0
    ? starterAssignments.reduce((sum, { player, slot }) => sum + spacingValueAt(player, slot, cCovered), 0) / starterAssignments.length
    : fullRotationBase;
  const base = fullRotationBase * 0.35 + starterBase * 0.65;
  const plusShooterCount = starters.filter(isPlusShooter).length;
  const hardNonSpacerCount = starterAssignments.filter(({ player, slot }) => spacingValueAt(player, slot, cCovered) < 30).length;
  const nonSpacerCeiling = spacingNonSpacerCeiling(starterAssignments, cCovered);

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
    // strong bounded floor (see `MULTI_WALKING_GRAVITY_TEAM_SPACING_FLOOR`'s own note) and still
    // pay for non-shooters around them over the minutes the threats aren't both on the floor.
    const hasCurry = gravityThreatAssignments.some(({ player }) => isShootingAnomalyPlayer(player));
    if (hasCurry) return 100;
    const uniqueThreats = [...new Map(gravityThreatAssignments.map((entry) => [entry.player.id, entry])).values()];
    const avgThreatShare =
      uniqueThreats.reduce((sum, { minutes }) => sum + Math.max(0, Math.min(1, minutes / STARTER_MINUTES)), 0) /
      uniqueThreats.length;
    const floored = Math.max(base, MULTI_WALKING_GRAVITY_TEAM_SPACING_FLOOR);
    const withGravityFloor = base * (1 - avgThreatShare) + floored * avgThreatShare;
    const baseScore = rescaleToFullRange(withGravityFloor, SPACING_SCORE_ANCHORS);
    return Math.round(Math.min(MULTI_GRAVITY_TEAM_SPACING_CAP, nonSpacerCeiling, baseScore));
  }

  // A single Walking-gravity span is an enormous individual asset, but it is not automatically
  // a well-spaced five. Curry retains his unique 85 on-court floor; another elite shooter gets
  // a strong 70 floor over his own minutes. This prevents one shooter from turning
  // Wade/Iguodala/Webber/Embiid into a 90-spacing construction while preserving real gravity.
  //
  // 2026-09-17, audit-found: this branch had NO cap at all, while the two-threat branch above
  // caps non-Curry duos at `MULTI_GRAVITY_TEAM_SPACING_CAP` (97) specifically so 100 stays
  // reserved for the Curry+another-threat case. Verified live: swapping a team's second starter
  // from a good-but-not-elite shooter (Ryan Anderson, not a threat) to a genuinely elite one
  // (Dāvis Bertāns, becomes threat #2) moved the roster from this uncapped branch (Anderson,
  // -> 100) into the capped one (Bertāns, -> 97) — a strictly BETTER shooter lowered the team's
  // spacing score by 3. Applying the same 97 ceiling here (Curry's own case is exempted the same
  // way, via `isShootingAnomalyPlayer` below, matching the two-threat branch's `hasCurry` carve-
  // out) closes that gap: a non-Curry configuration can never score lower by gaining a genuine
  // second threat, because neither a 1-threat nor a 2-threat non-Curry team can exceed 97.
  if (distinctGravityThreatIds.size === 1) {
    const threatMinutes = gravityThreatAssignments.reduce((sum, { minutes }) => sum + minutes, 0);
    const threatShare = Math.max(0, Math.min(1, threatMinutes / STARTER_MINUTES));
    const isCurry = isShootingAnomalyPlayer(gravityThreatAssignments[0]!.player);
    const floor = isCurry ? SHOOTING_ANOMALY_TEAM_SPACING_FLOOR : SINGLE_WALKING_GRAVITY_TEAM_SPACING_FLOOR;
    const floored = Math.max(base, floor);
    const withGravityFloor = base * (1 - threatShare) + floored * threatShare;
    const baseScore = rescaleToFullRange(withGravityFloor, SPACING_SCORE_ANCHORS);
    return Math.round(isCurry ? baseScore : Math.min(MULTI_GRAVITY_TEAM_SPACING_CAP, nonSpacerCeiling, baseScore));
  }

  const baseScore = rescaleToFullRange(base, SPACING_SCORE_ANCHORS);
  const constructionFloor =
    plusShooterCount >= 3 && hardNonSpacerCount <= 2
      ? THREE_SHOOTER_LINEUP_SPACING_FLOOR
      : plusShooterCount >= 2
        ? TWO_SHOOTER_LINEUP_SPACING_FLOOR
        : 0;
  return Math.round(Math.min(nonSpacerCeiling, Math.max(baseScore, constructionFloor)));
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
  // 2026-09-25: the named PG list above now lives in `positionCompetence.ts` (it seeds 'partial'
  // at PG there) together with every other position — a 'full' second position is never a
  // downward misuse, and a 'partial' one covers `PARTIAL_POSITION_GRACE_MINUTES` before the
  // ramp starts (Wade/Manu can run point for stretches, not a whole game).
  const downwardOffenders: string[] = [];
  let downwardPenalty = 0;
  for (const { slot, player, minutes } of allAssignments(team)) {
    if (minutes <= 0) continue;
    if (player.primaryPosition === slot) continue;
    if (isUpwardSlide(player, slot)) continue;
    const competence = positionCompetence(player, slot);
    if (competence === 'natural' || competence === 'full') continue;
    const grace = Math.max(
      DOWNWARD_POSITION_GRACE_MINUTES[player.primaryPosition],
      competence === 'partial' ? PARTIAL_POSITION_GRACE_MINUTES : 0,
    );
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
