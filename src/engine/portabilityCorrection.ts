import type { PlayerSpan } from '../data/schema';
import { rawTalentBlend } from './talent';
import { computeOffensivePortability, computeDefensivePortability } from './portability';
import coefficients from '../data/awards/correctionCoefficients.json';

/**
 * 2026-08-06, "overall" `computePortability` was removed entirely (user's explicit ask, same
 * session as the O-POR/D-POR split) — this is the straight average of the two replacement
 * scores, used ONLY as this file's regression input, not exported/displayed anywhere. Simple
 * mean rather than reusing the old combined formula's two-way-bonus shape on purpose: that
 * shape existed to solve a UI-badge problem (make the single combined number discriminate
 * one-way from two-way players), which no longer applies now that the two axes are shown
 * separately — this file just needs *some* reasonable single scalar to regress against
 * `rawTalentBlend`, and a plain average is the least assumption-laden choice available.
 */
function combinedPortabilityForCorrection(span: PlayerSpan): number {
  return (computeOffensivePortability(span) + computeDefensivePortability(span)) / 2;
}

/**
 * Blends POR (Portability — "how well does this player's game travel next to another star")
 * into TAL, per the user's explicit request to stop treating it as purely informational.
 *
 * Not a straight `TAL + POR` add-in: POR and TAL already share several inputs (shooting
 * gravity, defensive role/versatility, low-usage efficiency all feed both independently), so
 * adding POR's raw value on top would double-count skills TAL already rewards under its own
 * name — the exact "mechanically inflates whoever's already good on the correlated dimension"
 * failure mode the project's blend-reweighting lesson warns about, just via a new dimension
 * instead of the old O/D one.
 *
 * Same shape as darkoDefenseBonus/hiddenValueBonus instead: regress POR against
 * `rawTalentBlend` (the pre-scale raw offense/defense blend — same reason hiddenValueBonus uses
 * it instead of `computeTalent`: this function is called from inside `computeTalent` itself, so
 * anchoring on `computeTalent` would be circular and, worse, would already have this bonus baked
 * into the "expected" line) across the full dataset, then reward only the EXCESS — portability
 * a player's raw talent level doesn't already predict. Asymmetric (only ever adds, matching
 * every other real-data/derived-signal correction in this file) and capped, so a player who's
 * portable in ways TAL's own inputs already capture gets ~0 bonus, while a player whose fit
 * value is unusually good FOR their talent level (a complementary specialist, not a star) gets
 * a small, meaningful lift.
 */
/**
 * Precomputed by `scripts/precomputeCorrectionCoefficients.ts` from the full ~13,145-span
 * dataset (2026-07-30, the load-time fix) rather than fit live in the browser — see that
 * script's own header for why, and re-run it after any change to `rawTalentBlend`,
 * `computePortability`, or the dataset itself.
 */
function getRegression(): { slope: number; intercept: number } {
  return coefficients.portability;
}

/** Calibrated (scripts/checkPortabilityBonusDist.ts) so the bonus stays in the same order of
 * magnitude as the other small TAL correction terms (hiddenValueBonus caps at 4, the two-way
 * synergy bonus at 7) rather than rivaling or swamping them. */
const EXCESS_TO_BONUS_SCALE = 0.12;
const MAX_PORTABILITY_BONUS = 4;

export function portabilityBonus(span: PlayerSpan): number {
  const { slope, intercept } = getRegression();
  const expected = slope * rawTalentBlend(span) + intercept;
  const excess = combinedPortabilityForCorrection(span) - expected;
  return excess > 0 ? Math.min(MAX_PORTABILITY_BONUS, excess * EXCESS_TO_BONUS_SCALE) : 0;
}

/**
 * Small, profile-level scalability corrections for real complementary skills that a single
 * O-POR/D-POR regression still compresses too aggressively. These are general basketball
 * profiles, not player-name overrides:
 *
 * - elite movement shooting that also survives defensively (Klay-type two-way off-ball wing),
 * - a passing/skilled big with real defensive portability (Pau/Marc-type connector),
 * - a low-usage stretch 5 who also anchors the rim (Brook-type spacing/rim-protection pairing).
 *
 * Each gate requires both sides of the claimed profile. A movement shooter must also own a real
 * point-of-attack/wing-stopper assignment; a skilled big must stay below high-volume creator usage
 * as well as clear the passing and D-POR gates; a generic stretch big does not receive the final
 * bonus without Anchor Big defense. The combined cap keeps overlap from creating a new star tier
 * by itself. This is deliberately separate from `portabilityBonus` so evidence reports can show
 * the profile correction explicitly instead of hiding it in the regression residual.
 */
export interface RoleScalabilityBreakdown {
  twoWayMovement: number;
  skilledTwoWayBig: number;
  stretchRimProtector: number;
  total: number;
}

const MAX_ROLE_SCALABILITY_BONUS = 3.5;

export function roleScalabilityBreakdown(span: PlayerSpan): RoleScalabilityBreakdown {
  const offensivePortability = computeOffensivePortability(span);
  const defensivePortability = computeDefensivePortability(span);

  let twoWayMovement = 0;
  if (
    (span.offensiveArchetype === 'Movement Shooter' || span.offensiveArchetype === 'Off Screen Shooter') &&
    (span.defensiveRole === 'Wing Stopper' || span.defensiveRole === 'Point of Attack') &&
    offensivePortability >= 85 &&
    defensivePortability >= 75
  ) {
    twoWayMovement = Math.min(
      2.5,
      1.25 + (offensivePortability - 85) * 0.08 + (defensivePortability - 75) * 0.06,
    );
  }

  let skilledTwoWayBig = 0;
  if (
    (span.primaryPosition === 'PF' || span.primaryPosition === 'C') &&
    (span.offensiveArchetype === 'Post Scorer' || span.offensiveArchetype === 'Versatile Big') &&
    span.fga <= 15 &&
    span.box.apg >= 3 &&
    defensivePortability >= 75
  ) {
    skilledTwoWayBig = Math.min(
      2.5,
      1 + (span.box.apg - 3) * 0.75 + (defensivePortability - 75) * 0.03,
    );
  }

  let stretchRimProtector = 0;
  if (
    span.offensiveArchetype === 'Stretch Big' &&
    span.defensiveRole === 'Anchor Big' &&
    span.fga <= 12 &&
    offensivePortability >= 55 &&
    defensivePortability >= 85
  ) {
    stretchRimProtector = Math.min(
      2.5,
      1 + (offensivePortability - 55) * 0.04 + (defensivePortability - 85) * 0.05 + (12 - span.fga) * 0.1,
    );
  }

  const total = Math.min(MAX_ROLE_SCALABILITY_BONUS, twoWayMovement + skilledTwoWayBig + stretchRimProtector);
  return { twoWayMovement, skilledTwoWayBig, stretchRimProtector, total };
}

export function roleScalabilityBonus(span: PlayerSpan): number {
  return roleScalabilityBreakdown(span).total;
}
