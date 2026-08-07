import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';

const ratios = draftPool.filter((p) => p.fga > 0).map((p) => computeTalent(p) / p.fga);
const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
const sorted = [...ratios].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];

console.log(`Dataset-wide mean talent-per-FGA: ${mean.toFixed(2)}`);
console.log(`Median talent-per-FGA: ${median.toFixed(2)}`);
console.log(`Current BASELINE_EFFICIENCY constant in scoring.ts: 3.83`);

// Simulate a typical cap-legal 9-man roster's efficiency to sanity check the fitScore
// efficiency adjustment band (-10 to +15) still produces reasonable swings.
const talents = draftPool.map((p) => ({ p, t: computeTalent(p) })).sort((a, b) => b.t - a.t);
