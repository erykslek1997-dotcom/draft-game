import { overallTier } from '../src/engine/grades';

/** Standing check for the 2026-07-30 overall-rating tier bands, including the 94-boundary
 * resolution (top band wins the tie the user's own spec left overlapping). */
const CASES: [number, string][] = [
  [100, 'Greatest peak'], [95, 'Greatest peak'], [94, 'Greatest peak'],
  [93, 'MVP'], [90, 'MVP'], [88, 'MVP'],
  [87, 'All-NBA'], [83, 'All-NBA'], [80, 'All-NBA'],
  [79, 'All-star'], [75, 'All-star'], [70, 'All-star'],
  [69, 'Starter'], [65, 'Starter'], [60, 'Starter'],
  [59, 'Role Player'], [55, 'Role Player'], [50, 'Role Player'],
  [49, 'Bench Warmer'], [45, 'Bench Warmer'], [40, 'Bench Warmer'],
  [39, 'Cigarette Butt'], [20, 'Cigarette Butt'], [0, 'Cigarette Butt'],
];
let failures = 0;
for (const [value, want] of CASES) {
  const got = overallTier(value);
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${String(value).padStart(3)} -> ${got.padEnd(16)} want ${want.padEnd(16)} ${ok ? 'ok' : 'FAIL'}`);
}
console.log(`\n${failures === 0 ? 'PASS' : `FAIL: ${failures} mismatch(es)`}`);
