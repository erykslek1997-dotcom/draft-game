/**
 * Trims DARKO, historical APM, PIPM, RAPTOR, matchup-defense, and BPM2 data to players who
 * ever appear in draftPool.json — the user's ask, after the load-time-fix session. All four are
 * pure per-span lookups at runtime (avgDdpmForSpan / avgHistoricalApmForSpan / avgPipmForSpan /
 * avgRaptorDefenseForSpan, matched by normalized name),
 * with no population-level statistic built from them anymore — the regressions that used to
 * need the FULL dataset were already precomputed into fixed coefficients in the previous step
 * (`correctionCoefficients.json`), so a row for a player nobody can ever draft is genuinely dead
 * weight in the shipped bundle.
 *
 * Deliberately does NOT touch availability.json — durability.ts builds its era-cohort percentile
 * ladder from the FULL, unbiased population of every real availability row for that era; the
 * draft pool is a curated subset (star talent + cap-glue-by-efficiency), not a representative
 * sample, so trimming it there would silently bias DUR for every player, not just drop unused
 * rows. That one stays full-size.
 *
 * Calibration scripts (`scripts/lib/matchedDarkoDefensePoints.ts`,
 * `scripts/validateAgainstHistoricalApm.ts`, `scripts/precomputeCorrectionCoefficients.ts`) must
 * keep reading the FULL, untrimmed files — they fit against the whole historical population on
 * purpose. This script writes NEW `*.pool.json` files for the production lookups to switch to;
 * it does not overwrite the originals.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { resolveSourceName, seasonEndYearOf } from '../src/data/sourceNameResolver';

const poolNames = new Set(draftPool.map((p) => normalizePlayerName(p.playerName)));
// 2026-09-25: rows are matched through `resolveSourceName` (src/data/sourceNameResolver.ts), the
// same resolver the runtime lookups use — so "Metta World Peace", "Jimmy Butler III", "Enes Kanter",
// "Larry Nance Sr." etc. survive the trim under the pool player they belong to.
console.log('draft pool: unique normalized names:', poolNames.size);

function trim(srcPath: string, outPath: string, nameField: string, retainedFields?: string[], compact = false) {
  const keyOf = (r: Record<string, unknown>) => resolveSourceName(String(r[nameField]), seasonEndYearOf(String(r.season)));
  const raw = JSON.parse(readFileSync(srcPath, 'utf8')) as Record<string, unknown>[];
  const before = raw.length;
  const beforeNames = new Set(raw.map(keyOf));

  const matched = raw.filter((r) => poolNames.has(keyOf(r)));
  const trimmed = retainedFields
    ? matched.map((row) => Object.fromEntries(retainedFields.map((field) => [field, row[field]])))
    : matched;
  const afterNames = new Set(matched.map(keyOf));

  // Coverage-preservation check: every pool player who had ANY row in the source must still
  // have their full set of rows after trimming — this only drops rows for players who can
  // never be drafted, never reduces coverage for anyone who can.
  let coverageOk = true;
  for (const name of poolNames) {
    if (beforeNames.has(name) && !afterNames.has(name)) {
      console.log('  COVERAGE LOSS:', name);
      coverageOk = false;
    }
  }
  for (const name of afterNames) {
    const beforeCount = raw.filter((r) => keyOf(r) === name).length;
    const afterCount = matched.filter((r) => keyOf(r) === name).length;
    if (beforeCount !== afterCount) {
      console.log(`  ROW COUNT MISMATCH for ${name}: before=${beforeCount} after=${afterCount}`);
      coverageOk = false;
    }
  }

  writeFileSync(outPath, compact ? `${JSON.stringify(trimmed)}\n` : JSON.stringify(trimmed, null, 1));
  const beforeBytes = statSync(srcPath).size;
  const afterBytes = statSync(outPath).size;
  console.log(
    `${srcPath}: ${before} -> ${trimmed.length} rows, ${beforeNames.size} -> ${afterNames.size} names, ` +
      `${beforeBytes} -> ${afterBytes} bytes (${((1 - afterBytes / beforeBytes) * 100).toFixed(1)}% smaller)`,
  );
  console.log(coverageOk ? '  coverage preserved for every pool player' : '  *** COVERAGE PROBLEM, DO NOT SHIP ***');
  return coverageOk;
}

const ok1 = trim('src/data/awards/darko.json', 'src/data/awards/darko.pool.json', 'name');
const ok2 = trim('src/data/awards/historicalApm.json', 'src/data/awards/historicalApm.pool.json', 'name');
const ok3 = trim('src/data/awards/pipm.json', 'src/data/awards/pipm.pool.json', 'name');
const ok4 = trim('src/data/awards/raptor.json', 'src/data/awards/raptor.pool.json', 'name');
const ok5 = trim('src/data/awards/matchupDefense.json', 'src/data/awards/matchupDefense.pool.json', 'name');
// Confidence/status remain in the full source used by audits; the browser only needs lookup keys
// and the two numeric values, avoiding repeated provenance strings in the production bundle.
const ok6 = trim(
  'src/data/awards/bpm2.json',
  'src/data/awards/bpm2.pool.json',
  'name',
  ['name', 'season', 'dbpm', 'bpm'],
);

// Compact, like extractPlayoffBpm2.ts writes it (that script needs the external master CSV).
const ok7 = trim('src/data/awards/bpm2Playoffs.json', 'src/data/awards/bpm2Playoffs.pool.json', 'name', undefined, true);

if (!ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6 || !ok7) {
  console.log('\nFAIL — do not point the lookup files at the .pool.json outputs');
  process.exit(1);
}
console.log('\nPASS — safe to switch darkoLookup.ts / historicalApmLookup.ts / pipmLookup.ts / raptorLookup.ts / matchupDefenseLookup.ts / bpm2Lookup.ts to the .pool.json files');
