import type { PlayerSpan } from '../data/schema';
import { overallTierForSpan, type OverallTier } from './grades';
import { tierContextWithSixthMan } from './sixthMan';
import { realMinutesCapForSpan } from './usageLookup';
import { playoffMinutesPerGame } from './playoffBpm2Lookup';
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
/**
 * 2026-10-01, the user ("wysocy rzadko kiedy grają tyle minut", then the star minutes comparison):
 * every star played ~37-38 minutes, while real playoff minutes run from Embiid 2019-21 (32.9) and
 * Giannis 2018-20 (33.8) to Hakeem 1992-94 (43.1) and Wilt 1967-69 (47.2). A star's ceiling is his
 * real playoff minutes per game (8+ playoff games in the span), else his real regular-season minutes
 * plus `PLAYOFF_MINUTES_MARGIN` (usageLookup.ts), else the tier ceiling, never above 40. Below
 * All-star the real minutes only ever raise the tier ceiling: as a hard limit they starved
 * rotations of bench minutes.
 */
const STAR_MINUTE_TIERS = new Set<OverallTier>(['GOAT', 'Greatest peak', 'MVP', 'All-NBA', 'All-star']);
export function minuteProfileForSpan(span: PlayerSpan): TierMinuteProfile {
  if (span.fga < 2) return { optimal: 0, minimal: null, ceiling: 0 };
  const tier = overallTierForSpan(tierContextWithSixthMan(span));
  const tierProfile = TIER_MINUTE_PROFILE[tier];
  if (STAR_MINUTE_TIERS.has(tier)) {
    const playoff = playoffMinutesPerGame(span);
    const real = playoff !== null ? Math.round(playoff) : realMinutesCapForSpan(span);
    if (real === null) return tierProfile;
    const ceiling = Math.min(MAX_REAL_MINUTES_CEILING, real);
    return {
      optimal: Math.min(tierProfile.optimal, ceiling),
      minimal: tierProfile.minimal === null ? null : Math.min(tierProfile.minimal, ceiling),
      ceiling,
    };
  }
  // With real minutes on record (1996-97 on) a role player's ceiling can rise to what he really
  // played plus the playoff margin (Josh Hart 2023-25: 34 mpg, not the Role Player 24).
  const realCap = realMinutesCapForSpan(span);
  if (realCap === null || realCap <= tierProfile.ceiling) return tierProfile;
  return { ...tierProfile, ceiling: Math.min(MAX_REAL_MINUTES_CEILING, realCap) };
}

/** The most minutes a player can carry in one game: his minutes ceiling, zero for a DNP span. */
export function playableMinutesCap(span: PlayerSpan, maxMinutesPerPlayer: number): number {
  return Math.min(minuteProfileForSpan(span).ceiling, maxSustainableMinutes(span, maxMinutesPerPlayer));
}
