import type { PlayerSpan } from '../data/schema';
import { rawTalentBlend } from './talent';
import { blendedRealValueForSpan } from './blendedRealValueLookup';
import coefficients from '../data/awards/correctionCoefficients.json';

/**
 * Extends the DARKO-defense-only correction in darkoCorrection.ts (defensive real plus-minus
 * exceeding box-score defense) to a broader, TOTAL real-value correction, using the same
 * coverage-weighted DARKO+historical-APM blend `impact.ts` already shows informationally.
 * Motivated directly: Rasheed Wallace, Pau Gasol, and Dirk Nowitzki all read as real, sizable
 * positive residuals in `computeImpact` (real total plus-minus exceeding what their box-score
 * talent predicts) that AREN'T fully explained by defense alone (Gasol/Dirk are offense-oriented
 * bigs; darkoDefenseBonus wouldn't touch them) - `computeImpact` already surfaces this as
 * information, this promotes the same signal into an actual TAL correction.
 *
 * Regressed against `rawTalentBlend` (the pre-scale offense*0.6+defense*0.4 blend), not
 * `computeTalent` itself, to avoid a circular import (talent.ts -> this file -> talent.ts) -
 * same reason `darkoDefenseBonus` regresses against `computeDefensiveImpact` rather than D-TAL.
 * Two separate regressions (modern vs. pre-1997), same reasoning as impact.ts: the combined
 * matched pool is mostly 1997+, so a single regression would calibrate old-school spans against
 * a mostly-modern baseline.
 *
 * Asymmetric and capped like every other real-data correction in this project (darkoDefenseBonus,
 * the DARKO-defense floor's rebounding-versatility bonus): only ever ADDS talent when real value
 * exceeds prediction, never subtracts when it falls short - a negative residual usually means
 * the player benefited from favorable circumstances (great teammates, era) real plus-minus can't
 * cleanly separate from individual skill, which isn't grounds to mark someone down.
 */
/**
 * Precomputed by `scripts/precomputeCorrectionCoefficients.ts` from the full ~13,145-span
 * dataset (2026-07-30, the load-time fix) rather than fit live in the browser — see that
 * script's own header for why, and re-run it after any change to `rawTalentBlend`, the
 * DARKO/historical-APM data, or the dataset itself.
 */
function getModernRegression(): { slope: number; intercept: number } {
  return coefficients.hiddenValueModern;
}
function getPre1997Regression(): { slope: number; intercept: number } {
  return coefficients.hiddenValuePre1997;
}

/** How much of a real-value-vs-expectation excess turns into extra talent points, and a cap on
 * the bonus itself - originally calibrated (scripts/calibrateHistoricalApmBonus.ts, no longer
 * in the repo) against Wallace/Gasol/Dirk's real residuals so they land as a clear, meaningful
 * lift without rivaling the two-way synergy bonus's own cap or pushing already-elite two-way
 * bigs (Duncan, Garnett - already well-served by darkoDefenseBonus) past the top of the scale.
 *
 * **Retuned 2026-08-05**: diagnosed directly against Shaquille O'Neal (playtest feedback: "AD a
 * bit too high, Shaq a bit too low" after the same-day durability changes to `pickForAi`) -
 * his peak spans' real blended value clearly exceeds Anthony Davis's (DPM ~6.7-7.2 vs ~3.3-4.6),
 * yet his total bonus here (was ~1.4-1.7) landed far below AD's `darkoDefenseBonus` (~6.2-7.7),
 * because Shaq's edge is in *total* value (offense-heavy, not defense-specific DDPM) while AD's
 * shows up specifically in DDPM. Checked the OLD scale=0.6/cap=4 against the full modern-era
 * excess distribution first (n=2253): p90=2.12, p95=2.64, p99=3.74, max=4.95 - the cap of 4 was
 * **never actually binding** at that scale (even the single largest excess in the whole dataset
 * only reaches bonus=2.97), so raising the cap alone would have done nothing; the scale was the
 * real constraint. Doubled the scale (0.6->1.2) and raised the cap in proportion (4->6, keeping
 * it comfortably non-binding for the new scale's p99/max the same way 4 was non-binding for the
 * old one) rather than cranking either alone. Independently corroborated, not just DARKO-driven:
 * BEFORE this change, Shaq already ranked below both Ben Taylor's real top-10 (our #7 vs
 * Taylor's #3) and Backpicks GOAT-40 (our #9 vs their #5) - this direction of correction moves
 * him toward, not away from, two independent expert rankings. Re-validated after
 * (`validateAgainstTaylorTop10.ts`/`validateAgainstBackpicksGoat.ts`) - see
 * `alltime_draft_game_project.md` memory for the before/after numbers. */
const EXCESS_TO_BONUS_SCALE = 1.2;
const MAX_HIDDEN_VALUE_BONUS = 6;

export function hiddenValueBonus(span: PlayerSpan): number {
  const real = blendedRealValueForSpan(span);
  if (real === null) return 0;
  const { slope, intercept } = real.isModernEra ? getModernRegression() : getPre1997Regression();
  const expected = slope * rawTalentBlend(span) + intercept;
  const excess = real.value - expected;
  return excess > 0 ? Math.min(MAX_HIDDEN_VALUE_BONUS, excess * EXCESS_TO_BONUS_SCALE) : 0;
}
