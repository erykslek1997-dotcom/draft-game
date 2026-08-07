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
