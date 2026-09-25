/**
 * Fits the pre-1997 guard/wing rim-pressure proxy (`perimeterRimProxy`, rimPressure.ts) on every
 * 1997+ guard/wing span in the pool, where `rimPressureForFit`'s zone-data read is the truth, and
 * prints the baked constants to paste between the `--- baked ---` markers:
 *  - PERIMETER_PROXY_WEIGHTS: least squares of the target on [1, FTA over the knee, ppg, FG%]
 *  - SCORE/VALUE rungs: matching quantiles of that linear score and of the target, so the proxy
 *    reproduces the real distribution (a plain linear fit compresses the top).
 *  - SLASHER rungs: the same, over real slashers only (rim share >= SLASHER_RIM_SHARE) — the
 *    reference group for the verified-slasher list.
 *
 * Run: npx tsx scripts/buildPerimeterRimProxy.ts
 */
import { draftPool } from '../src/data/draftPool';
import { rimPressureForFit, perimeterRimFeatures, perimeterRimScore, SLASHER_RIM_SHARE } from '../src/engine/rimPressure';
import { computeOffensiveProfile } from '../src/engine/offensiveProfile';

const train = draftPool
  .filter((s) => s.primaryPosition !== 'C' && s.primaryPosition !== 'PF' && computeOffensiveProfile(s).hasZoneData)
  .map((s) => ({ f: perimeterRimFeatures(s), y: rimPressureForFit(s), rimShare: computeOffensiveProfile(s).rimShare }))
  .filter((r): r is { f: NonNullable<typeof r.f>; y: number } => r.f !== null);

// Least squares: basis = the score's own terms (unit weights on each, one at a time).
const basis = (f: (typeof train)[number]['f']) => [1, 0, 0, 0].map((_, i) => perimeterRimScore(f, [0, 0, 0, 0].map((__, j) => (j === i ? 1 : 0))));
const k = 4;
const A = Array.from({ length: k }, () => Array(k).fill(0));
const b = Array(k).fill(0);
for (const r of train) {
  const x = basis(r.f);
  for (let i = 0; i < k; i++) {
    b[i] += x[i] * r.y;
    for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j];
  }
}
for (let i = 0; i < k; i++) {
  for (let j = i + 1; j < k; j++) {
    const m = A[j][i] / A[i][i];
    for (let c = i; c < k; c++) A[j][c] -= m * A[i][c];
    b[j] -= m * b[i];
  }
}
const w = Array(k).fill(0);
for (let i = k - 1; i >= 0; i--) {
  let sum = b[i];
  for (let c = i + 1; c < k; c++) sum -= A[i][c] * w[c];
  w[i] = sum / A[i][i];
}

const Q = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 92, 94, 96, 97, 98, 98.5, 99, 99.25, 99.5, 99.6, 99.7, 99.8, 99.9, 100];
const quant = (sorted: number[], q: number) => sorted[Math.round((q / 100) * (sorted.length - 1))];
const scores = train.map((r) => perimeterRimScore(r.f, w)).sort((a, c) => a - c);
const values = train.map((r) => r.y).sort((a, c) => a - c);
const round = (v: number) => Math.round(v * 1000) / 1000;
console.log(`// ${train.length} guard/wing spans, 1997+`);
console.log(`const PERIMETER_PROXY_WEIGHTS = [${w.map(round).join(', ')}];`);
console.log(`const PERIMETER_PROXY_SCORE_RUNGS: number[] = [${Q.map((q) => round(quant(scores, q))).join(', ')}];`);
console.log(`const PERIMETER_PROXY_VALUE_RUNGS: number[] = [${Q.map((q) => round(quant(values, q))).join(', ')}];`);
const slashers = train.filter((r) => r.rimShare >= SLASHER_RIM_SHARE);
const sScores = slashers.map((r) => perimeterRimScore(r.f, w)).sort((a, c) => a - c);
const sValues = slashers.map((r) => r.y).sort((a, c) => a - c);
console.log(`// slasher reference group: ${slashers.length} spans with rim share >= ${SLASHER_RIM_SHARE}`);
console.log(`const PERIMETER_PROXY_SLASHER_SCORE_RUNGS: number[] = [${Q.map((q) => round(quant(sScores, q))).join(', ')}];`);
console.log(`const PERIMETER_PROXY_SLASHER_VALUE_RUNGS: number[] = [${Q.map((q) => round(quant(sValues, q))).join(', ')}];`);
