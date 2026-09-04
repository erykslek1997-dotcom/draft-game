import type { DefensiveRole, PlayerSpan } from '../data/schema';
import { eraBaseline, LEAGUE_PACE_BASELINE, stealRateEraResidual } from './era';

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
  'Post Defender': 7,
  Chaser: 4,
  'Low Activity': 0,
};

/** Typical (dataset mean) pace-adjusted (spg+bpg) activity for a player actually carrying
 * each role tag — calibrated via scripts/calibrateDefenseRole.ts. Used to scale the role
 * bonus continuously instead of as a flat category reward. */
const DEFENSIVE_ROLE_TYPICAL_ACTIVITY: Record<DefensiveRole, number> = {
  'Anchor Big': 13.6,
  'Point of Attack': 9.7,
  'Wing Stopper': 10.2,
  Helper: 5.3,
  'Mobile Big': 7.3,
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
  return span.box.rpg * (LEAGUE_PACE_BASELINE / pace) * 0.9;
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
  const rebounding = reboundingTerm(span);

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
