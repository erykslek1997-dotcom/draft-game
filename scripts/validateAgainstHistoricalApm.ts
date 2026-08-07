/**
 * Validates computeTalent against the new historical APM data (src/data/awards/historicalApm.json
 * - see historicalApmLookup.ts for provenance/known gaps). Per-span, not peak-only, so it can be
 * split by era: the 1997+ portion is real RAPM (already cross-checked by validateAgainstRapm.ts
 * against a DIFFERENT real dataset - peakRapm.json), so agreement there is a sanity check on this
 * new source itself; the pre-1997 "Augmented PM" portion is the genuinely new signal this project
 * hasn't had access to before (WOWYR was the only prior pre-1997 real-data source, and
 * validateAgainstWowyr.ts found it too noisy to correct against).
 *
 * Temporarily swaps the full darko.json/historicalApm.json/pipm.json/raptor.json over
 * darko.pool.json/historicalApm.pool.json/pipm.pool.json/raptor.pool.json before this script's
 * imports resolve, same technique and same reason as precomputeCorrectionCoefficients.ts:
 * `computeTalent` bakes `darkoDefenseBonus`/`hiddenValueBonus` directly into its formula (via
 * `rawComponents`), which read the draft-pool-trimmed files in production (2026-07-30, extended
 * to pipm.json and raptor.json 2026-07-31) — this script needs to validate against the FULL
 * historical population, not just the current draft pool, so a straight import of the production
 * lookups would silently understate agreement for every non-pool span. Restored in a `finally`
 * block even on error.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const DARKO_POOL = 'src/data/awards/darko.pool.json';
const DARKO_FULL = 'src/data/awards/darko.json';
const HISTAPM_POOL = 'src/data/awards/historicalApm.pool.json';
const HISTAPM_FULL = 'src/data/awards/historicalApm.json';
const PIPM_POOL = 'src/data/awards/pipm.pool.json';
const PIPM_FULL = 'src/data/awards/pipm.json';
const RAPTOR_POOL = 'src/data/awards/raptor.pool.json';
const RAPTOR_FULL = 'src/data/awards/raptor.json';
const MATCHUP_POOL = 'src/data/awards/matchupDefense.pool.json';
const MATCHUP_FULL = 'src/data/awards/matchupDefense.json';

const darkoPoolBackup = readFileSync(DARKO_POOL, 'utf8');
const histApmPoolBackup = readFileSync(HISTAPM_POOL, 'utf8');
const pipmPoolBackup = readFileSync(PIPM_POOL, 'utf8');
const raptorPoolBackup = readFileSync(RAPTOR_POOL, 'utf8');
const matchupPoolBackup = readFileSync(MATCHUP_POOL, 'utf8');

async function main() {
  copyFileSync(DARKO_FULL, DARKO_POOL);
  copyFileSync(HISTAPM_FULL, HISTAPM_POOL);
  copyFileSync(PIPM_FULL, PIPM_POOL);
  copyFileSync(RAPTOR_FULL, RAPTOR_POOL);
  copyFileSync(MATCHUP_FULL, MATCHUP_POOL);

  const { players } = await import('../src/data/players');
  const { normalizePlayerName } = await import('../src/data/schema');
  type Position = import('../src/data/schema').Position;
  const { computeTalent } = await import('../src/engine/talent');
  const { buildHistoricalApmYearMap, avgHistoricalApmForSpan } = await import('../src/engine/historicalApmLookup');
  const { spanEndYears } = await import('../src/engine/era');

  const yearMap = buildHistoricalApmYearMap();

  interface Row {
    name: string;
    spanLabel: string;
    position: Position;
    talent: number;
    apm: number;
    era: 'pre1997' | '1997plus';
  }
  const rows: Row[] = [];
  for (const p of players) {
    const apm = avgHistoricalApmForSpan(p, yearMap);
    if (apm === null) continue;
    const years = spanEndYears(p.spanLabel);
    const era = years.every((y) => y < 1997) ? 'pre1997' : '1997plus';
    rows.push({ name: p.playerName, spanLabel: p.spanLabel, position: p.primaryPosition, talent: computeTalent(p), apm, era });
  }
  console.log(`Matched spans: ${rows.length} (pre1997: ${rows.filter((r) => r.era === 'pre1997').length}, 1997plus: ${rows.filter((r) => r.era === '1997plus').length})`);
  console.log(`Distinct players matched: ${new Set(rows.map((r) => normalizePlayerName(r.name))).size}`);

  function pearson(a: number[], b: number[]): number {
    const n = a.length;
    const meanA = a.reduce((s, x) => s + x, 0) / n;
    const meanB = b.reduce((s, x) => s + x, 0) / n;
    const cov = a.reduce((s, x, i) => s + (x - meanA) * (b[i] - meanB), 0);
    const stdA = Math.sqrt(a.reduce((s, x) => s + (x - meanA) ** 2, 0));
    const stdB = Math.sqrt(b.reduce((s, x) => s + (x - meanB) ** 2, 0));
    return cov / (stdA * stdB);
  }

  for (const era of ['pre1997', '1997plus'] as const) {
    const subset = rows.filter((r) => r.era === era);
    console.log(`\n=== ${era} (n=${subset.length}) ===`);
    console.log(`Pearson (talent vs real APM): ${pearson(subset.map((r) => r.talent), subset.map((r) => r.apm)).toFixed(3)}`);
    for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
      const posSubset = subset.filter((r) => r.position === pos && r.talent >= 40);
      if (posSubset.length < 5) continue;
      const r = pearson(posSubset.map((x) => x.talent), posSubset.map((x) => x.apm));
      console.log(`  ${pos}: r = ${r.toFixed(3)} (n=${posSubset.length})`);
    }
  }

  // --- Peak-per-player (best matched span by real APM) for named players relevant to open
  // project questions - direct real numbers, not just correlation stats. ---
  const named = [
    'Charles Barkley', 'Giannis Antetokounmpo', 'Karl Malone', 'Anthony Davis', 'Pau Gasol',
    'Rasheed Wallace', 'Dirk Nowitzki', 'Kevin Garnett', 'Tim Duncan', 'Hakeem Olajuwon',
  ];
  console.log('\n=== Named players: best matched span (by real APM) ===');
  for (const name of named) {
    const matches = rows.filter((r) => normalizePlayerName(r.name) === normalizePlayerName(name));
    if (matches.length === 0) {
      console.log(name.padEnd(22), 'NO MATCH IN HISTORICAL APM DATA');
      continue;
    }
    const best = matches.reduce((a, b) => (b.apm > a.apm ? b : a));
    console.log(name.padEnd(22), best.spanLabel, 'talent', best.talent, 'realAPM', best.apm.toFixed(2), `(${matches.length} spans matched)`);
  }

  // --- Biggest divergences overall (rank-based would need peak-per-player; here just raw
  // residual off a simple linear fit, for a first look at where the formula and real APM disagree
  // most, restricted to talent >= 40 for signal robustness) ---
  function fitLinearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
    const n = points.length;
    const meanX = points.reduce((s, p) => s + p.x, 0) / n;
    const meanY = points.reduce((s, p) => s + p.y, 0) / n;
    const cov = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
    const varX = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
    return { slope: cov / varX, intercept: meanY - (cov / varX) * meanX };
  }
  const meaningful = rows.filter((r) => r.talent >= 40);
  const { slope, intercept } = fitLinearRegression(meaningful.map((r) => ({ x: r.talent, y: r.apm })));
  const withResidual = meaningful.map((r) => ({ ...r, residual: r.apm - (slope * r.talent + intercept) }));
  const sorted = [...withResidual].sort((a, b) => b.residual - a.residual);
  console.log('\n=== Biggest positive residuals (real APM exceeds what our talent predicts) ===');
  for (const r of sorted.slice(0, 15)) console.log(`${r.name.padEnd(22)} ${r.spanLabel} talent=${r.talent} realAPM=${r.apm.toFixed(2)} residual=${r.residual.toFixed(2)} era=${r.era}`);
  console.log('\n=== Biggest negative residuals (our talent exceeds what real APM shows) ===');
  for (const r of sorted.slice(-15).reverse()) console.log(`${r.name.padEnd(22)} ${r.spanLabel} talent=${r.talent} realAPM=${r.apm.toFixed(2)} residual=${r.residual.toFixed(2)} era=${r.era}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    writeFileSync(DARKO_POOL, darkoPoolBackup);
    writeFileSync(HISTAPM_POOL, histApmPoolBackup);
    writeFileSync(PIPM_POOL, pipmPoolBackup);
    writeFileSync(RAPTOR_POOL, raptorPoolBackup);
    writeFileSync(MATCHUP_POOL, matchupPoolBackup);
    console.log(
      '\nrestored darko.pool.json / historicalApm.pool.json / pipm.pool.json / raptor.pool.json / matchupDefense.pool.json to their trimmed state',
    );
  });
