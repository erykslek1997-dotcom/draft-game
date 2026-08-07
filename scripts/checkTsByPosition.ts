/**
 * Diagnostic: does TS% actually run higher for bigs and for low-usage role players in our
 * own dataset, the way the user described? Check before designing an adjustment.
 */
import { draftPool } from '../src/data/draftPool';

function mean(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

console.log('=== mean TS% by primary position ===');
for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
  const spans = draftPool.filter((p) => p.primaryPosition === pos);
  console.log(`  ${pos}: mean TS% ${(mean(spans.map((s) => s.box.tsPct)) * 100).toFixed(1)}  (n=${spans.length})`);
}

console.log('\n=== mean TS% by FGA (usage) bucket, all positions pooled ===');
const buckets: [string, (fga: number) => boolean][] = [
  ['<6 FGA (deep bench)', (f) => f < 6],
  ['6-10 FGA (role player)', (f) => f >= 6 && f < 10],
  ['10-15 FGA (regular)', (f) => f >= 10 && f < 15],
  ['15-20 FGA (featured)', (f) => f >= 15 && f < 20],
  ['20+ FGA (star usage)', (f) => f >= 20],
];
for (const [label, test] of buckets) {
  const spans = draftPool.filter((p) => test(p.fga));
  console.log(`  ${label}: mean TS% ${(mean(spans.map((s) => s.box.tsPct)) * 100).toFixed(1)}  (n=${spans.length})`);
}

console.log('\n=== mean TS% by FGA bucket, WITHIN each position ===');
for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
  console.log(`${pos}:`);
  for (const [label, test] of buckets) {
    const spans = draftPool.filter((p) => p.primaryPosition === pos && test(p.fga));
    if (spans.length === 0) continue;
    console.log(`  ${label}: mean TS% ${(mean(spans.map((s) => s.box.tsPct)) * 100).toFixed(1)}  (n=${spans.length})`);
  }
}
