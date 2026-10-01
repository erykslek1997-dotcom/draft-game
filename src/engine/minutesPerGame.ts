import type { PlayerSpan } from '../data/schema';
import { realMinutesPerGame } from './usageLookup';
import { playoffMinutesPerGame } from './playoffBpm2Lookup';

/**
 * 2026-10-01, the user ("jak wymagamy 5+ zbiórek, a ktoś gra 20 minut na mecz, to tego nie
 * osiągnie"): per-game thresholds read low-minute players as worse than they are. A span's
 * regular-season minutes per game come from, in order:
 *   1. real minutes (usage data, 1996-97 on, 40+ games);
 *   2. an estimate from real playoff minutes (8+ playoff games, every era):
 *      MPG ≈ 9.5 + 0.64 × playoff MPG — fitted on the 2,919 spans with both (RMSE 3.3, against 4.7
 *      for "regular season = playoffs"; playoff rotations tighten, so the slope is under 1);
 *   3. nothing — callers keep their per-game reading.
 * A future export of real pre-1997 minutes plugs in as source 1.
 */
const PLAYOFF_TO_SEASON_INTERCEPT = 9.5;
const PLAYOFF_TO_SEASON_SLOPE = 0.64;
export function estimatedMinutesPerGame(span: PlayerSpan): number | null {
  const real = realMinutesPerGame(span);
  if (real !== null) return real;
  const playoff = playoffMinutesPerGame(span);
  return playoff === null ? null : PLAYOFF_TO_SEASON_INTERCEPT + PLAYOFF_TO_SEASON_SLOPE * playoff;
}

/** Per-game stat to per-36 minutes; per-game unchanged when the span's minutes are unknown. The
 * 15-minute floor keeps a 6-minute man's two rebounds from reading as twelve. */
const PER_36_MINUTES_FLOOR = 15;
export function per36(perGame: number, span: PlayerSpan): number {
  const mpg = estimatedMinutesPerGame(span);
  return mpg === null ? perGame : (perGame * 36) / Math.max(mpg, PER_36_MINUTES_FLOOR);
}
