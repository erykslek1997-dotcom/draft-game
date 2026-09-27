import { normalizePlayerName } from '../data/schema';
import { USER_TAL_NUDGE, USER_TIER_CALIBRATION, USER_WINDOW_TIERS } from '../data/userTierCalibration';
import type { OverallTier } from './grades';

/**
 * 2026-09-27, the user's tier table (`userTierCalibration.ts`) turned into displayed TAL.
 *
 * Every tier owns a TAL band. A player's reviewed window lands inside his tier's band by where
 * his raw (uncapped) TAL sits among the other reviewed players of that tier, so the order inside
 * a tier still comes from the engine while the tier itself comes from the table. GOAT runs past
 * 100 (the user: "GOAT 100+"). His other windows are measured from the reviewed one on one shared
 * `windowMeasure`, and never read above his reviewed tier.
 */
const TIER_BANDS: Partial<Record<OverallTier, readonly [number, number]>> = {
  GOAT: [104, 105],
  'Greatest peak': [96, 99],
  MVP: [88, 95],
  'All-NBA': [80, 87],
  'All-star': [70, 79],
  Starter: [60, 69],
  'Sixth Man': [58, 66],
};

/**
 * How far one window sits from another, in TAL. The measure is the old displayed TAL (smoothed
 * across neighbouring windows, so a raw dip from an injury year does not sink a window), plus a
 * share of the raw talent above 100 that the old display's soft cap folded into 97-99. Without
 * that share every LeBron window from 2007 to 2024 would read as the same 99.
 */
const RAW_EXCESS_SHARE = 0.14;
export function windowMeasure(legacyDisplay: number, rawTal: number): number {
  return legacyDisplay + RAW_EXCESS_SHARE * Math.max(0, rawTal - 100);
}

interface CalibrationEntry {
  spanLabel: string;
  rawAtReview: number;
  tier: OverallTier;
}

const entries = new Map<string, CalibrationEntry>(
  USER_TIER_CALIBRATION.map(([name, spanLabel, rawAtReview, tier]) => [normalizePlayerName(name), { spanLabel, rawAtReview, tier }]),
);

const nudges = new Map<string, number>(Object.entries(USER_TAL_NUDGE).map(([name, nudge]) => [normalizePlayerName(name), nudge]));

/** The reviewed window's TAL: its place in the tier's band plus the user's nudge, kept in the band. */
function reviewedTalent(playerName: string, tier: OverallTier, raw: number, keepInBand = true): number {
  const [lo, hi] = TIER_BANDS[tier]!;
  const value = placeInBand(tier, raw, keepInBand) + (nudges.get(normalizePlayerName(playerName)) ?? 0);
  return keepInBand ? Math.max(lo, Math.min(hi, value)) : value;
}

const windowTiers = new Map<string, OverallTier>(
  USER_WINDOW_TIERS.map(([name, spanLabel, tier]) => [`${normalizePlayerName(name)}|${spanLabel}`, tier]),
);

const rawRangeByTier = new Map<OverallTier, [number, number]>();
for (const { rawAtReview, tier } of entries.values()) {
  const range = rawRangeByTier.get(tier);
  if (!range) rawRangeByTier.set(tier, [rawAtReview, rawAtReview]);
  else rawRangeByTier.set(tier, [Math.min(range[0], rawAtReview), Math.max(range[1], rawAtReview)]);
}

function placeInBand(tier: OverallTier, raw: number, keepInBand = true): number {
  const [lo, hi] = TIER_BANDS[tier]!;
  const [rmin, rmax] = rawRangeByTier.get(tier)!;
  if (rmax <= rmin) return hi;
  const unclamped = (raw - rmin) / (rmax - rmin);
  const share = keepInBand ? Math.max(0, Math.min(1, unclamped)) : unclamped;
  return Math.round(lo + share * (hi - lo));
}

/** The table entry for a player, if the user tiered him. */
export function tierCalibrationFor(playerName: string): CalibrationEntry | undefined {
  return entries.get(normalizePlayerName(playerName));
}

/**
 * Displayed TAL for a window of a tiered player; `undefined` for everyone else. `measure` is this
 * window's `windowMeasure`; `reviewedWindow` gives the reviewed window's measure and raw TAL.
 */
export function calibratedDisplayTalent(
  playerName: string,
  spanLabel: string | undefined,
  rawTal: number,
  measure: number,
  reviewedWindow: () => { measure: number; rawTal: number } | undefined,
): number | undefined {
  const entry = tierCalibrationFor(playerName);
  if (!entry) return undefined;
  if (spanLabel === entry.spanLabel) return reviewedTalent(playerName, entry.tier, rawTal);
  const anchor = reviewedWindow();
  if (anchor === undefined) return Math.min(TIER_BANDS[entry.tier]![1], Math.round(measure));
  // The reviewed window's current number, so its other windows move with it when the engine changes.
  // Not held in the band here: when the engine lifts the reviewed window past the top of its band,
  // its other windows should not read as having fallen away from it.
  const reviewed = reviewedTalent(playerName, entry.tier, anchor.rawTal, false);
  const value = Math.round(reviewed - (anchor.measure - measure));
  const windowTier = windowTiers.get(`${normalizePlayerName(playerName)}|${spanLabel}`);
  const floor = windowTier ? TIER_BANDS[windowTier]![0] : 0;
  return Math.max(floor, Math.min(TIER_BANDS[entry.tier]![1], value));
}

/** Highest TAL a player outside the table can show: everyone the user left untiered sits below
 * the 200 who were, so none of them reads above the top of All-star. */
export const UNCALIBRATED_DISPLAY_MAX = 79;
export const UNCALIBRATED_TIER_MAX: OverallTier = 'All-star';
