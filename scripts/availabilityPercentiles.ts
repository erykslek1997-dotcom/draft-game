/**
 * Measures the real availability distribution over the actual span dataset, so `durability.ts`'s
 * ladder rungs sit at percentiles rather than guesses — same method as scripts/spacingPercentiles.ts.
 * Also checks whether the distribution differs enough by position to need per-position ladders.
 */
import { players } from '../src/data/players';
import { availabilityForSpan } from '../src/engine/availabilityLookup';
import { POSITIONS, type Position } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';

const matched: { pos: Position; av: number; exact: boolean; endYear: number }[] = [];
let unmatched = 0;
for (const s of players) {
  const e = availabilityForSpan(s);
  if (!e) {
    unmatched++;
    continue;
  }
  const years = spanEndYears(s.spanLabel);
  matched.push({ pos: s.primaryPosition, av: Math.min(100, e.availability), exact: e.exact, endYear: years[years.length - 1] ?? 0 });
}
console.log(`spans: ${players.length}  matched: ${matched.length} (${((matched.length / players.length) * 100).toFixed(1)}%)  unmatched: ${unmatched}`);
console.log(`  exact year match: ${matched.filter((m) => m.exact).length}  overlap fallback: ${matched.filter((m) => !m.exact).length}`);

function pct(vals: number[], p: number): number {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))];
}
const PS = [0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98];

const all = matched.map((m) => m.av);
console.log('\n=== overall percentiles ===');
console.log(PS.map((p) => `p${(p * 100).toFixed(0)}=${pct(all, p).toFixed(1)}`).join('  '));

console.log('\n=== by primary position (is a per-position ladder warranted?) ===');
for (const pos of POSITIONS) {
  const v = matched.filter((m) => m.pos === pos).map((m) => m.av);
  console.log(
    `${pos}  n=${String(v.length).padStart(5)}  p10=${pct(v, 0.1).toFixed(1)}  median=${pct(v, 0.5).toFixed(1)}  p90=${pct(v, 0.9).toFixed(1)}  mean=${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}`,
  );
}
const medians = POSITIONS.map((pos) => pct(matched.filter((m) => m.pos === pos).map((m) => m.av), 0.5));
console.log(`spread of position medians: ${(Math.max(...medians) - Math.min(...medians)).toFixed(1)} points`);
console.log('=> a spread under ~2 points means one shared ladder is correct (cf. spacing.ts accuracy ladders)');

console.log('\n=== by era (does availability drift enough to need era-scaling?) ===');
for (const dec of [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]) {
  const v = matched.filter((m) => m.endYear >= dec && m.endYear < dec + 10).map((m) => m.av);
  if (!v.length) continue;
  console.log(`${dec}s  n=${String(v.length).padStart(5)}  p10=${pct(v, 0.1).toFixed(1)}  median=${pct(v, 0.5).toFixed(1)}  p90=${pct(v, 0.9).toFixed(1)}`);
}

console.log('\n=== paste-ready ladder rungs (0-10 points at p2..p98) ===');
const rungs = [0.02, 0.08, 0.16, 0.25, 0.34, 0.44, 0.55, 0.66, 0.77, 0.88, 0.96];
console.log(
  '[' + rungs.map((p, i) => `[${pct(all, p).toFixed(1)}, ${i}]`).join(', ') + ']',
);
