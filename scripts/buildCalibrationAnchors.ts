/**
 * Freezes each calibrated player's reviewed window (its measure and raw TAL) into
 * src/data/calibrationAnchors.json, which `grades.ts` uses instead of recomputing it live.
 *
 * Run it right after the calibration table (src/data/userTierCalibration.ts) is reviewed, while the
 * engine still rates the reviewed windows the way the review saw them. Do NOT run it after an
 * unrelated engine change: the point of the file is that such a change moves every other window
 * of a player by its own amount, instead of dragging them all along with the reviewed window.
 *
 *   npx tsx scripts/buildCalibrationAnchors.ts
 */
import { writeFileSync } from 'node:fs';
import { USER_TIER_CALIBRATION } from '../src/data/userTierCalibration';
import { normalizePlayerName } from '../src/data/schema';
import { liveReviewedWindow } from '../src/engine/grades';

const out: Record<string, { measure: number; rawTal: number }> = {};
for (const [name] of USER_TIER_CALIBRATION) {
  const anchor = liveReviewedWindow(name);
  if (anchor) out[normalizePlayerName(name)] = { measure: Math.round(anchor.measure * 1000) / 1000, rawTal: anchor.rawTal };
}
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync('src/data/calibrationAnchors.json', JSON.stringify(sorted, null, 1) + '\n');
console.log(`Wrote ${Object.keys(sorted).length} calibration anchors.`);
