import type { DefensiveRole, PlayerSpan, Position } from '../data/schema';
import { eraBaseline, LEAGUE_PACE_BASELINE, reboundAvailabilityFactor, stealRateEraResidual } from './era';

/**
 * Box-score-only defensive impact — split out from talent.ts so `darkoCorrection.ts` can
 * import it to build its real-plus-minus regression without creating a circular dependency
 * (talent.ts imports the DARKO correction, so the DARKO correction can't import talent.ts).
 */

const DEFENSIVE_ROLE_BASE_WEIGHT: Record<DefensiveRole, number> = {
  'Anchor Big': 9,
  'Point of Attack': 8,
  'Wing Stopper': 7,
  Helper: 6,
  'Mobile Big': 6,
  // Deliberately identical to 'Mobile Big': `Switch Big` is only ever a curated SECONDARY role
  // (see defensiveRoleProfiles.ts), never a span's primary `defensiveRole`, so this entry is here
  // purely for `Record<DefensiveRole>` exhaustiveness — matching Mobile Big means that if a span
  // were ever primary-tagged `Switch Big`, `computeDefensiveImpact` (and therefore TAL) would be
  // byte-identical to the Mobile Big it replaced. The archetype's real value lands FIT-side.
  'Switch Big': 6,
  'Post Defender': 7,
  Chaser: 4,
  'Low Activity': 0,
};

/** Typical (dataset mean) pace-adjusted (spg+bpg) activity for a player actually carrying
 * each role tag — calibrated via scripts/calibrateDefenseRole.ts. Used to scale the role
 * bonus continuously instead of as a flat category reward.
 *
 * 2026-09-23, roleWeight double-counting attempt, REVERTED: the confirmed bug is that crossing a
 * `classifyDefense` tag boundary (scripts/lib/rawPlayerData.ts) changes BOTH `baseWeight` AND this
 * scaling denominator at once, since the tag is 100% mechanically derived from the same activity
 * this table scales against (real case: Dirk Nowitzki reads B- in "Mobile Big" seasons vs C- in
 * near-identical-stat "Low Activity" seasons). Tried keying this by POSITION instead of role (one
 * fixed denominator per position, credited-defenders-only mean, so it can't jump when the tag
 * does) — measured directly against the 46-name reference suite: introduced 2 NEW misses (Kevin
 * McHale 69->83, target 65-79; Kobe Bryant 80->82, target <=80) neither present before. Root
 * cause: the two highest-`baseWeight` roles (Anchor Big=9, Point of Attack=8) had by far the
 * highest OLD role-specific typicals (13.6, 9.7) relative to their position's broad average
 * (PF/SG credited-only ~6.9), so swapping to a shared position denominator systematically lifts
 * exactly those two roles' roleWeight — trading one discreteness bug for a different, real
 * calibration bias. The role-specific typical isn't arbitrary: an Anchor Big genuinely should be
 * compared against real anchor-tier activity, not diluted by Helpers/Chasers at the same position.
 * Reverted to keep the reference suite at its prior 8/46. A real fix needs either regenerating
 * `classifyDefense`'s stored tags with smoothed/blended boundaries (touches all baked player data,
 * out of scope for a quick pass) or a boundary-aware blend between adjacent roles' weight/typical —
 * both bigger than tonight's session; left open, matching this project's own "needs a dedicated
 * session" pattern for hard calibration problems. */
const DEFENSIVE_ROLE_TYPICAL_ACTIVITY: Record<DefensiveRole, number> = {
  'Anchor Big': 13.6,
  'Point of Attack': 9.7,
  'Wing Stopper': 10.2,
  Helper: 5.3,
  'Mobile Big': 7.3,
  'Switch Big': 7.3, // = Mobile Big, see DEFENSIVE_ROLE_BASE_WEIGHT
  'Post Defender': 9,
  Chaser: 7.4,
  'Low Activity': 1, // unused — base weight is 0
};
const ROLE_SCALE_MIN = 0.5;
const ROLE_SCALE_MAX = 1.8;

/** The defensive half of the talent formula, exposed separately so fit checks (rim/perimeter
 * defense) can require actual defensive impact, not just a role tag. */
/** The rebounding half of `computeDefensiveImpact`, on its own — exported so
 * `defensiveTalent.ts` can apply diminishing returns to it without duplicating the
 * pace-adjustment math (and so the two can't drift apart). */
export function reboundingTerm(span: PlayerSpan): number {
  const { pace } = eraBaseline(span.spanLabel);
  return span.box.rpg * (LEAGUE_PACE_BASELINE / pace) * reboundAvailabilityFactor(span.spanLabel) * 0.9;
}

/**
 * 2026-09-23, "sprawdźmy zbiórki... z mniejszym impactem": these two constants and `reboundTrim`
 * used to live only in `defensiveTalent.ts`, subtracted from the DISPLAY-only `displayDefenseRaw`
 * — meaning the ladder saw trimmed rebounding, but `computeDefensiveImpact` (which ALSO feeds
 * `darkoDefenseBonus`'s "expected" regression baseline) still saw the full, untrimmed value.
 * Moved here so the trim applies once, upstream of both consumers — real, measured consequence:
 * previously, fully REMOVING rebounding from `computeDefensiveImpact` (a temp experiment) dropped
 * Magic Johnson's D-TAL 71->48 and Barkley 71->53 (real, deserved — both are big rebounding-
 * inflated cases) but ALSO dropped Ben Wallace 100->93 / Gobert 96->91 / Garnett/Duncan ~93/90
 * (undeserved — elite rim/rebounding presence IS real value for a true anchor) — full removal
 * throws out real signal along with the excess. Trimming only the part ABOVE each position's own
 * real p90 (the existing, already-validated `REBOUND_DIMINISHING_THRESHOLD`/`_RATE`) keeps a true
 * anchor's real rebounding volume intact up to a generous bar and only discounts the excess most
 * players never approach — verified this preserves Wallace/Gobert/Garnett/Duncan while still
 * meaningfully reducing Magic/Barkley, whose real rebounding sits well past it. `defensiveTalent.ts`
 * no longer applies its own copy of this trim (see that file) — it would double-count now that
 * `computeDefensiveImpact` already includes it.
 */
const REBOUND_DIMINISHING_THRESHOLD: Record<Position, number> = {
  PG: 3.98,
  SG: 4.38,
  SF: 6.26,
  PF: 9.05,
  C: 10.08,
};
const REBOUND_DIMINISHING_RATE = 0.6;
export function reboundTrim(span: PlayerSpan): number {
  const excess = reboundingTerm(span) - REBOUND_DIMINISHING_THRESHOLD[span.primaryPosition];
  return excess > 0 ? excess * (1 - REBOUND_DIMINISHING_RATE) : 0;
}

/**
 * The three separable pieces of `computeDefensiveImpact`, exposed so `predictedDefense.ts` can
 * regress a real-plus-minus model against steals and blocks INDEPENDENTLY (the box formula below
 * weights them identically at `* 4.5`, which the pool audit vs `peakRapm.json` confirmed is wrong
 * in both directions — it under-credits shot-blocking interior anchors and over-credits steal-
 * gambling guards). Returns the exact intermediate values `computeDefensiveImpact` sums, so the
 * two can never drift.
 */
export function defensiveBoxParts(span: PlayerSpan): {
  stealActivity: number;
  blockActivity: number;
  activity: number;
  rebounding: number;
  roleWeight: number;
} {
  const { box, defensiveRole } = span;
  const { pace } = eraBaseline(span.spanLabel);
  const paceFactor = LEAGUE_PACE_BASELINE / pace;

  // 2026-08-05, user explicit ask (Drexler, Erving): steals specifically get a small additional
  // era residual on top of the existing pace factor — see stealRateEraResidual's own docstring
  // for why this is scoped to steals only (not blocks) and capped narrowly (0.85-1.0, a top-up
  // correction, not a second full era-scale) to avoid double-counting what paceFactor already
  // corrects for.
  const stealActivity = box.spg * paceFactor * stealRateEraResidual(span.spanLabel);
  const blockActivity = box.bpg * paceFactor;
  const activity = (stealActivity + blockActivity) * 4.5;
  const rebounding = reboundingTerm(span) - reboundTrim(span);

  const baseWeight = DEFENSIVE_ROLE_BASE_WEIGHT[defensiveRole];
  // Scales the role bonus by how the player's actual activity compares to what's typical for
  // that tag, rather than a flat bonus identical whether someone barely clears the tag's
  // classification threshold or dominates it (previously: Kareem and a marginal Anchor Big
  // both just got +9). Clamped so the tag itself still carries some weight even at the
  // extremes — a hand-tagged role isn't purely a function of the box-stat activity number.
  const roleWeight =
    baseWeight === 0
      ? 0
      : baseWeight *
        Math.max(ROLE_SCALE_MIN, Math.min(ROLE_SCALE_MAX, activity / DEFENSIVE_ROLE_TYPICAL_ACTIVITY[defensiveRole]));

  return { stealActivity, blockActivity, activity, rebounding, roleWeight };
}

export function computeDefensiveImpact(span: PlayerSpan): number {
  const { activity, rebounding, roleWeight } = defensiveBoxParts(span);
  return activity + rebounding + roleWeight;
}
