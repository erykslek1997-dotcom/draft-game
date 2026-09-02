import type { PlayerSpan } from '../data/schema';
import { overallTierForSpan, type OverallTier } from './grades';
import { tierContextWithSixthMan } from './sixthMan';

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

export function minuteProfileForSpan(span: PlayerSpan): TierMinuteProfile {
  if (span.fga < 2) return { optimal: 0, minimal: null, ceiling: 0 };
  return TIER_MINUTE_PROFILE[overallTierForSpan(tierContextWithSixthMan(span))];
}

