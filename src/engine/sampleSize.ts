import type { PlayerSpan } from '../data/schema';
import { runtimeAvailabilityForSpan } from './runtimeSpanLookups';

/**
 * G_SMALL_SAMPLE, 2026-08-12: purely presentational — flags a span whose box stats rest on a
 * genuinely thin real game count, distinct from `durability.ts`'s availability RATIO
 * (games/possibleGames, "how healthy was this player"). A span can be 100% available and still
 * be a small sample (a single 50-game lockout season) — this reads the raw numerator, `games`,
 * not the ratio.
 *
 * Threshold picked from the real distribution (`availability.json`, 13,144 rated spans): median
 * real games across a span is 143, p5 is 112 — `<100` sits below the 5th percentile and flags
 * 113 spans (0.9%), not a broad band. Confirmed the population it catches is the right one:
 * genuine outliers (Joel Embiid 2023-25 at 58 games, several 1997-99/1998-00 lockout-window
 * spans at 88-93 of a 132-game slate, a couple of 1953-55 BAA-merger partial spans), not an
 * ordinary healthy span that happens to read slightly below the pool median.
 *
 * Deliberately does not feed TAL/POR/any scoring path — an unrated span (no source match, ~1 of
 * 13,145) reads as NOT small-sample (same "don't penalize what we don't know" default
 * `durability.ts` uses), since this is a badge, not a correction.
 */
export const SMALL_SAMPLE_GAMES_THRESHOLD = 100;

export function isSmallSampleSpan(span: PlayerSpan): boolean {
  const entry = runtimeAvailabilityForSpan(span);
  if (!entry) return false;
  return entry.games < SMALL_SAMPLE_GAMES_THRESHOLD;
}

/** For the badge's tooltip/detail text — null when unrated (badge doesn't render at all then). */
export function sampleSizeGames(span: PlayerSpan): number | null {
  return runtimeAvailabilityForSpan(span)?.games ?? null;
}
