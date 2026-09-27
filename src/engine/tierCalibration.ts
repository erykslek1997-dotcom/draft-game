import { normalizePlayerName } from '../data/schema';
import { USER_TIER_CALIBRATION } from '../data/userTierCalibration';
import type { OverallTier } from './grades';

/**
 * 2026-09-27, the user's tier table (`userTierCalibration.ts`) turned into displayed TAL.
 *
 * Every tier owns a TAL band. A player's reviewed window lands inside his tier's band by where
 * his raw (uncapped) TAL sits among the other reviewed players of that tier, so the order inside
 * a tier still comes from the engine while the tier itself comes from the table. GOAT runs past
 * 100 (the user: "GOAT 100+"). His other windows are measured from the reviewed one on one shared
 * raw-to-TAL scale (`scaleFromRaw`), and never read above his reviewed tier.
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

/** Raw TAL -> TAL on one continuous scale, anchored near each tier's median reviewed raw (Starter
 * 76, All-star 82, All-NBA 90, MVP 105, Greatest peak 132, GOAT 162). Only differences along it
 * are used: how far a player's other windows sit below (or above) his reviewed one. */
const SCALE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [40, 40],
  [60, 58],
  [76, 64],
  [82, 75],
  [90, 84],
  [105, 92],
  [132, 97.5],
  [162, 104.5],
  [200, 110],
];

function scaleFromRaw(raw: number): number {
  if (raw <= SCALE_ANCHORS[0][0]) return SCALE_ANCHORS[0][1];
  for (let i = 1; i < SCALE_ANCHORS.length; i++) {
    const [x1, y1] = SCALE_ANCHORS[i];
    if (raw <= x1) {
      const [x0, y0] = SCALE_ANCHORS[i - 1];
      return y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return SCALE_ANCHORS[SCALE_ANCHORS.length - 1][1];
}

interface CalibrationEntry {
  spanLabel: string;
  rawAtReview: number;
  tier: OverallTier;
}

const entries = new Map<string, CalibrationEntry>(
  USER_TIER_CALIBRATION.map(([name, spanLabel, rawAtReview, tier]) => [normalizePlayerName(name), { spanLabel, rawAtReview, tier }]),
);

const rawRangeByTier = new Map<OverallTier, [number, number]>();
for (const { rawAtReview, tier } of entries.values()) {
  const range = rawRangeByTier.get(tier);
  if (!range) rawRangeByTier.set(tier, [rawAtReview, rawAtReview]);
  else rawRangeByTier.set(tier, [Math.min(range[0], rawAtReview), Math.max(range[1], rawAtReview)]);
}

function placeInBand(tier: OverallTier, raw: number): number {
  const [lo, hi] = TIER_BANDS[tier]!;
  const [rmin, rmax] = rawRangeByTier.get(tier)!;
  if (rmax <= rmin) return hi;
  const share = Math.max(0, Math.min(1, (raw - rmin) / (rmax - rmin)));
  return Math.round(lo + share * (hi - lo));
}

/** The table entry for a player, if the user tiered him. */
export function tierCalibrationFor(playerName: string): CalibrationEntry | undefined {
  return entries.get(normalizePlayerName(playerName));
}

/** Displayed TAL for a window of a tiered player; `undefined` for everyone else. */
export function calibratedDisplayTalent(playerName: string, spanLabel: string | undefined, rawTal: number): number | undefined {
  const entry = tierCalibrationFor(playerName);
  if (!entry) return undefined;
  if (spanLabel === entry.spanLabel) return placeInBand(entry.tier, rawTal);
  const reviewed = placeInBand(entry.tier, entry.rawAtReview);
  const value = Math.round(reviewed - (scaleFromRaw(entry.rawAtReview) - scaleFromRaw(rawTal)));
  return Math.max(0, Math.min(TIER_BANDS[entry.tier]![1], value));
}

/** Highest TAL a player outside the table can show: everyone the user left untiered sits below
 * the 200 he did tier, so none of them reads above the top of All-star. */
export const UNCALIBRATED_DISPLAY_MAX = 79;
export const UNCALIBRATED_TIER_MAX: OverallTier = 'All-star';
