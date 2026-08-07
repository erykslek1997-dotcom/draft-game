import { players } from '../src/data/players';
import { shootingGravity } from '../src/engine/shooting';
import { computeSpacing } from '../src/engine/spacing';
import { computePortability } from '../src/engine/portability';

/** Measures the term being swapped inside portability.ts, so the replacement can be scaled to
 * land in the same place instead of silently re-calibrating POR (which feeds portabilityBonus
 * -> computeTalent). Run BEFORE the swap to capture the baseline, and again after.
 * Run: npx tsx scripts/comparePorSpacingTerm.ts */

const SHOOTING_GRAVITY_SCALE = 26;

function stats(values: number[], label: string) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))];
  console.log(
    `${label.padEnd(28)} mean ${mean.toFixed(2).padStart(7)}  min ${sorted[0].toFixed(2).padStart(7)}  ` +
      `p10 ${p(10).toFixed(2).padStart(6)}  p50 ${p(50).toFixed(2).padStart(6)}  p90 ${p(90).toFixed(2).padStart(6)}  ` +
      `p99 ${p(99).toFixed(2).padStart(6)}  max ${sorted[sorted.length - 1].toFixed(2).padStart(7)}`,
  );
}

const gravityTerm = players.map((s) => shootingGravity(s) * SHOOTING_GRAVITY_SCALE);
const spacingRaw = players.map((s) => computeSpacing(s));

console.log('--- The term being replaced (gravity x 26) vs. the raw replacement ---');
stats(gravityTerm, 'gravity x 26 (current)');
stats(spacingRaw, 'computeSpacing (0-100)');

// To match the old term's spread and its ability to go negative for a spacing liability,
// the new term is (spacing - neutral) / 100 * scale. Solve for constants that reproduce the
// old term's p10/p90 spread.
const sortedGravity = [...gravityTerm].sort((a, b) => a - b);
const sortedSpacing = [...spacingRaw].sort((a, b) => a - b);
const q = (arr: number[], v: number) => arr[Math.min(arr.length - 1, Math.floor((v / 100) * arr.length))];

const gLo = q(sortedGravity, 10);
const gHi = q(sortedGravity, 99);
const sLo = q(sortedSpacing, 10);
const sHi = q(sortedSpacing, 99);

const scale = ((gHi - gLo) / (sHi - sLo)) * 100;
const neutral = sLo - (gLo / scale) * 100;

console.log(`\nMatching p10 and p99 of the old term:`);
console.log(`  SPACING_SCALE   ~ ${scale.toFixed(1)}`);
console.log(`  SPACING_NEUTRAL ~ ${neutral.toFixed(1)}`);

const proposed = spacingRaw.map((v) => ((v - neutral) / 100) * scale);
stats(proposed, 'proposed replacement');

console.log('\n--- Current POR distribution (baseline to preserve) ---');
stats(players.map(computePortability), 'POR');
