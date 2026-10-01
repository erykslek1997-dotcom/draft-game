import type { PlayerSpan } from '../data/schema';
import { overallTierForSpan, type OverallTier } from './grades';
import { tierContextWithSixthMan } from './sixthMan';
import { realMinutesCapForSpan } from './usageLookup';
import { maxSustainableMinutes } from './durability';

export interface TierMinuteProfile {
  optimal: number;
  minimal: number | null;
  ceiling: number;
}

/** One source of truth for both automatic minute allocation and rotation grading. */
export const TIER_MINUTE_PROFILE: Record<OverallTier, TierMinuteProfile> = {
  GOAT: { optimal: 36, minimal: 32, ceiling: 40 },
  'Greatest peak': { optimal: 36, minimal: 32, ceiling: 40 },
  MVP: { optimal: 36, minimal: 32, ceiling: 40 },
  'All-NBA': { optimal: 34, minimal: 24, ceiling: 40 },
  'All-star': { optimal: 32, minimal: 24, ceiling: 38 },
  Starter: { optimal: 24, minimal: null, ceiling: 32 },
  'Sixth Man': { optimal: 28, minimal: null, ceiling: 28 },
  'Role Player': { optimal: 16, minimal: null, ceiling: 24 },
  'Bench Warmer': { optimal: 8, minimal: null, ceiling: 16 },
  'Cigarette Butt': { optimal: 0, minimal: null, ceiling: 8 },
};

const MAX_REAL_MINUTES_CEILING = 40;
export function minuteProfileForSpan(span: PlayerSpan): TierMinuteProfile {
  if (span.fga < 2) return { optimal: 0, minimal: null, ceiling: 0 };
  const tierProfile = TIER_MINUTE_PROFILE[overallTierForSpan(tierContextWithSixthMan(span))];
  // 2026-10-01: with real minutes on record (1996-97 on), the ceiling is what he really played plus
  // the playoff margin (Josh Hart 2023-25: 34 mpg, not the Role Player 24); the tier still sets the
  // preferred and guaranteed minutes, clamped under that ceiling.
  const realCap = realMinutesCapForSpan(span);
  if (realCap === null || realCap <= tierProfile.ceiling) return tierProfile;
  return { ...tierProfile, ceiling: Math.min(MAX_REAL_MINUTES_CEILING, realCap) };
}


/** The most minutes a player can carry in one game: his minutes ceiling, zero for a DNP span. */
export function playableMinutesCap(span: PlayerSpan, maxMinutesPerPlayer: number): number {
  return Math.min(minuteProfileForSpan(span).ceiling, maxSustainableMinutes(span, maxMinutesPerPlayer));
}
