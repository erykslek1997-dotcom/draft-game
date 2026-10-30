import { normalizePlayerName } from '../data/schema';
import { USER_TAL_NUDGE, USER_TIER_CALIBRATION, USER_TIER_REVIEW_2, USER_WINDOW_ORDER, USER_WINDOW_TIERS } from '../data/userTierCalibration';
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
  'Legend': [96, 99],
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
  [...USER_TIER_CALIBRATION, ...USER_TIER_REVIEW_2].map(([name, spanLabel, rawAtReview, tier]) => [normalizePlayerName(name), { spanLabel, rawAtReview, tier }]),
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
// Each band's raw range comes from the first table only, so a later tier change moves that player
// without moving everyone else in the band.
for (const [, , rawAtReview, tier] of USER_TIER_CALIBRATION) {
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

/** Half rate up; a quarter down (the user on the first cut: Kirilenko 2002-04 74 "bardziej 80-81",
 * Danny Green a bench warmer, Penny and Conley underrated). */
const windowRawShare = (gap: number) => (gap > 0 ? 0.5 : 0.25);
const RAW_SCALE_TOP = 100;

const windowOrders = new Map<string, readonly string[]>(Object.entries(USER_WINDOW_ORDER).map(([name, order]) => [normalizePlayerName(name), order]));

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
  const value = calibratedUnordered(entry, playerName, spanLabel, rawTal, measure, reviewedWindow);
  const order = windowOrders.get(normalizePlayerName(playerName));
  if (!order) return value;
  const top = TIER_BANDS[entry.tier]![1];
  const place = spanLabel === undefined ? -1 : order.indexOf(spanLabel);
  return place >= 0 ? top - place : Math.min(value, top - order.length);
}

function calibratedUnordered(
  entry: CalibrationEntry,
  playerName: string,
  spanLabel: string | undefined,
  rawTal: number,
  measure: number,
  reviewedWindow: () => { measure: number; rawTal: number } | undefined,
): number {
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
  // 2026-10-30, the user's review (Jaylen Brown 2021-26 at 87 beside his reviewed 82 on the same
  // raw talent; Conley 2010-12 at 77, raw 58, beside his reviewed 74): another window reads above
  // the reviewed one only by what its own raw talent is higher, at half rate, and a window with less
  // raw talent reads lower, at a quarter rate. Raw talent past 100 is compressed (LeBron 161), so
  // differences up there do not count.
  const ceiling = Math.round(reviewedTalent(playerName, entry.tier, anchor.rawTal) + windowRawShare(rawTal - anchor.rawTal) * (Math.min(RAW_SCALE_TOP, rawTal) - Math.min(RAW_SCALE_TOP, anchor.rawTal)));
  return Math.max(floor, Math.min(TIER_BANDS[entry.tier]![1], ceiling, value));
}

/** Highest TAL a player outside the table can show: everyone the user left untiered sits below
 * the 200 who were, so none of them reads above the top of All-star. */
export const UNCALIBRATED_DISPLAY_MAX = 79;
export const UNCALIBRATED_TIER_MAX: OverallTier = 'All-star';
