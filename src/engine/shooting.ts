import type { PlayerSpan } from '../data/schema';
import { eraBaseline } from './era';
import { computeSpacing } from './spacing';

/**
 * Volume x efficiency, not raw percentage: a "plus shooter" needs to both take a real
 * number of threes AND convert them above the era-average rate. A guy hitting 40% on 1
 * attempt a game isn't bending a defense; a high-volume shooter at league-average isn't
 * either. Negative for high-volume-but-below-average shooters (a real spacing liability),
 * near-zero for low-volume shooters regardless of percentage.
 *
 * Still the shooting term inside `computeTalent` (where it is capped tightly and carries a
 * named Curry exception), but no longer what defines a "plus shooter" — see `isPlusShooter`.
 */
export function shootingGravity(span: PlayerSpan): number {
  const { avgThreePct } = eraBaseline(span.spanLabel);
  return span.box.threePA * (span.box.threePct - avgThreePct);
}

/** Retained for `computeTalent`'s gravity term and the calibration scripts that reference it.
 * No longer the `isPlusShooter` cutoff — that moved onto the SPACING scale. */
export const PLUS_SHOOTER_THRESHOLD = 0.15;

/**
 * Whether a span provides real floor spacing. Drives roster-level "do we have shooting"
 * questions: `aiDrafter`'s `lacksSpacing` need signal and `scoring.ts`'s spacing-gap checks.
 *
 * Defined against SPACING rather than raw `shootingGravity` because those are era-comparison
 * questions and gravity's volume term is measured in raw attempts against a fixed yardstick.
 * Under the old definition a starting five of Larry Bird, Reggie Miller and Dale Ellis — three
 * of the best floor-spacers of their generation — registered as having no plus shooter at all,
 * because 1980s attempt volume can't clear a threshold set by modern volume. SPACING scales
 * volume to the player's own era first, so the check now asks "did this player space the floor
 * for his team," which is what both call sites actually want to know.
 *
 * The cutoff is the bottom of the `Good shooter` tier — the same "genuine floor-spacer, not
 * merely competent" population the old gravity threshold was calibrated to pick out.
 */
export const PLUS_SHOOTER_SPACING = 65;

export function isPlusShooter(span: PlayerSpan): boolean {
  return computeSpacing(span) >= PLUS_SHOOTER_SPACING;
}
