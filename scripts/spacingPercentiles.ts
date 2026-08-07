import { players } from '../src/data/players';
import { eraScaledThreePA } from '../src/engine/era';
import { POSITIONS } from '../src/data/schema';

/** Percentile reference for setting spacing.ts's ladder thresholds.
 * Run: npx tsx scripts/spacingPercentiles.ts */

const PCTS = [50, 75, 90, 95, 97, 98, 99, 99.5, 99.9];

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

console.log('=== Era-scaled 3PA/game percentiles, by position ===');
console.log('(all spans, then only spans with >=1.0 scaled 3PA)\n');
console.log(`${'Pos'.padEnd(5)}${'n'.padStart(7)}${PCTS.map((p) => `p${p}`.padStart(8)).join('')}`);

for (const pos of POSITIONS) {
  const all = players
    .filter((p) => p.primaryPosition === pos)
    .map((p) => eraScaledThreePA(p.spanLabel, p.box.threePA))
    .sort((a, b) => a - b);
  console.log(`${pos.padEnd(5)}${String(all.length).padStart(7)}${PCTS.map((p) => pct(all, p).toFixed(1).padStart(8)).join('')}`);
}

console.log('\n--- shooters only (scaled 3PA >= 1.0) ---');
console.log(`${'Pos'.padEnd(5)}${'n'.padStart(7)}${PCTS.map((p) => `p${p}`.padStart(8)).join('')}`);
for (const pos of POSITIONS) {
  const shooters = players
    .filter((p) => p.primaryPosition === pos && eraScaledThreePA(p.spanLabel, p.box.threePA) >= 1)
    .map((p) => eraScaledThreePA(p.spanLabel, p.box.threePA))
    .sort((a, b) => a - b);
  console.log(`${pos.padEnd(5)}${String(shooters.length).padStart(7)}${PCTS.map((p) => pct(shooters, p).toFixed(1).padStart(8)).join('')}`);
}

console.log('\n=== 3P% percentiles among spans with >=1.0 scaled 3PA ===');
console.log(`${'Pos'.padEnd(5)}${'n'.padStart(7)}${PCTS.map((p) => `p${p}`.padStart(8)).join('')}`);
for (const pos of POSITIONS) {
  const accs = players
    .filter((p) => p.primaryPosition === pos && eraScaledThreePA(p.spanLabel, p.box.threePA) >= 1)
    .map((p) => p.box.threePct)
    .sort((a, b) => a - b);
  console.log(
    `${pos.padEnd(5)}${String(accs.length).padStart(7)}${PCTS.map((p) => (pct(accs, p) * 100).toFixed(1).padStart(8)).join('')}`,
  );
}

console.log('\n=== How many spans clear BOTH a high-accuracy and high-volume bar ===');
for (const pos of POSITIONS) {
  const posSpans = players.filter((p) => p.primaryPosition === pos);
  const shooters = posSpans.filter((p) => eraScaledThreePA(p.spanLabel, p.box.threePA) >= 1);
  const accP95 = pct(
    shooters.map((p) => p.box.threePct).sort((a, b) => a - b),
    95,
  );
  const volP95 = pct(
    shooters.map((p) => eraScaledThreePA(p.spanLabel, p.box.threePA)).sort((a, b) => a - b),
    95,
  );
  const both = shooters.filter(
    (p) => p.box.threePct >= accP95 && eraScaledThreePA(p.spanLabel, p.box.threePA) >= volP95,
  ).length;
  console.log(
    `  ${pos}: acc p95=${(accP95 * 100).toFixed(1)}%  vol p95=${volP95.toFixed(1)}  both=${both} (${((both / posSpans.length) * 100).toFixed(2)}% of ${posSpans.length})`,
  );
}
