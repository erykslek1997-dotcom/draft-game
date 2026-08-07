/**
 * Precompute for the 2026-07-30 load-time fix: five engine files (darkoCorrection/
 * historicalApmCorrection/portabilityCorrection/impact/wowyrLookup) each imported the full
 * ~13,145-span `players` dataset just to fit a fixed {slope, intercept} regression (or, for
 * wowyrLookup, build a fixed name-matching map) at first use — cheap to COMPUTE, but the eager
 * `import { players }` pulled ~10MB of JSON into the production bundle to get there. None of
 * these outputs change session to session; they're a fixed function of the static dataset + the
 * static DARKO/historical-APM/WOWYR sources.
 *
 * This script recomputes all of it using the EXACT same logic each file already had (copied
 * verbatim, not re-derived) and writes the results to two small files the production code reads
 * instead of `players`. Re-run this after any change to the underlying data (new DARKO/APM/WOWYR
 * export, dataset regeneration) or after touching `rawTalentBlend`/`computeTalent`/
 * `computeDefensiveImpact`/`computePortability` — the production files no longer recompute these
 * automatically.
 *
 * **Also handles a second trim** (same day, separate request): `darko.pool.json`/
 * `historicalApm.pool.json`/`pipm.pool.json`/`raptor.pool.json` are `darko.json`/
 * `historicalApm.json`/`pipm.json`/`raptor.json` cut down to draft-pool players only
 * (`scripts/trimReferenceDataToPool.ts`). Production reads the trimmed files. But
 * `rawComponents` (talent.ts) — which BOTH `rawTalentBlend` and `computeTalent` are built on —
 * bakes `darkoDefenseBonus`/`darkoDefenseMalus` directly into the "defense" component, so THREE
 * of these four regression groups (hiddenValue, portability, impact — everything except the
 * darkoDefense regression itself) have an X-axis that's contaminated by the trim for any
 * non-pool span: `computeTalent`/`rawTalentBlend` would read up to 13 points low for them
 * (missing the defense-correction bonus the trimmed lookup can't see). Found this empirically —
 * an early version of this script re-run showed the `portability` slope drift 0.9716 -> 0.9597
 * even though NEITHER `rawTalentBlend` nor `computePortability` touch this data directly.
 * `pipm.json` feeds the same `blendedRealValueLookup.ts` as historicalApm, and `raptor.json`
 * (added 2026-07-31, see raptorLookup.ts/blendedDefenseLookup.ts) feeds the same
 * `blendedDefenseLookup.ts` as darko's ddpm — both need the identical swap-and-restore
 * treatment for the same reason.
 *
 * The fix: this script temporarily restores the FULL darko/historicalApm/pipm/raptor data over
 * the `.pool.json` files, runs entirely via DYNAMIC imports (so `talent.ts`'s module graph — and
 * its baked-in `import darkoData from '../data/awards/darko.pool.json'` — only loads AFTER the
 * swap; a static top-of-file import would already be parsed into Node's module cache before any
 * runtime file swap could take effect), computes every regression against the true full
 * population, then restores the original trimmed files in a `finally` block — so an interrupted
 * run can't leave production shipping the full (un-trimmed) reference data by accident.
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
const BPM2_POOL = 'src/data/awards/bpm2.pool.json';
const BPM2_FULL = 'src/data/awards/bpm2.json';

const darkoPoolBackup = readFileSync(DARKO_POOL, 'utf8');
const histApmPoolBackup = readFileSync(HISTAPM_POOL, 'utf8');
const pipmPoolBackup = readFileSync(PIPM_POOL, 'utf8');
const raptorPoolBackup = readFileSync(RAPTOR_POOL, 'utf8');
const matchupPoolBackup = readFileSync(MATCHUP_POOL, 'utf8');
const bpm2PoolBackup = readFileSync(BPM2_POOL, 'utf8');

async function main() {
  copyFileSync(DARKO_FULL, DARKO_POOL);
  copyFileSync(HISTAPM_FULL, HISTAPM_POOL);
  copyFileSync(PIPM_FULL, PIPM_POOL);
  copyFileSync(RAPTOR_FULL, RAPTOR_POOL);
  copyFileSync(MATCHUP_FULL, MATCHUP_POOL);
  copyFileSync(BPM2_FULL, BPM2_POOL);

  // Everything below is a dynamic import specifically so it happens AFTER the swap above. Split
  // into an "early" batch (imported first, safe to use before `correctionCoefficients.json` has
  // its new raptorDefense key on disk) and a "late" batch (talent.ts and anything that transitively
  // reads `coefficients.raptorDefense` via `darkoDefenseBonus`) — importing `talent.ts` early would
  // permanently cache the OLD json contents for the rest of this run (the same static-import-
  // caching trap the swap technique itself exists to dodge), since a JSON module import is a
  // snapshot at import time and rewriting the file afterward doesn't change what's already loaded.
  const { players } = await import('../src/data/players');
  const { normalizePlayerName } = await import('../src/data/schema');
  const { computeDefensiveImpact } = await import('../src/engine/defense');
  const { ddpmCoverageForSpan, raptorCoverageForSpan, matchupCoverageForSpan, bpm2CoverageForSpan } = await import('../src/engine/blendedDefenseLookup');

  function fitLinearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
    const n = points.length;
    const meanX = points.reduce((s, p) => s + p.x, 0) / n;
    const meanY = points.reduce((s, p) => s + p.y, 0) / n;
    const cov = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
    const varX = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
    const slope = varX === 0 ? 0 : cov / varX;
    const intercept = meanY - slope * meanX;
    return { slope, intercept };
  }

  // Sanity check the swap actually took: darko.pool.json (currently holding a full-data copy)
  // must now cover far more than the ~328-name draft pool, or something above went wrong.
  let sanityCoverage = 0;
  for (const span of players)
    if (
      ddpmCoverageForSpan(span) !== null ||
      raptorCoverageForSpan(span) !== null ||
      matchupCoverageForSpan(span) !== null ||
      bpm2CoverageForSpan(span) !== null
    )
      sanityCoverage++;
  console.log(`DARKO/RAPTOR/matchup/BPM2 defense lookup now covers ${sanityCoverage} spans (a trimmed-pool-only swap would read far lower)`);

  // --- 1. darkoCorrection.ts's four regressions (box defImpact -> real DARKO ddpm / real
  // RAPTOR raptor_defense / real matchup-defense excess / real BPM2 dbpm) — fit SEPARATELY, same
  // reasoning as RAPTOR's own addition (2026-07-31): each real source has its own relationship
  // with box defense, confirmed by fitting them independently rather than assuming one shared
  // line. BPM2's regression is fit against its FULL coverage (same as the other three, all the
  // way back to 1951-52) even though `blendedExcess` only ever APPLIES it to spans none of the
  // other three cover — the regression wants the best-fit line over all available data; the
  // fallback-only gating happens at blend time, not at fit time. ---
  const darkoPoints: { x: number; y: number }[] = [];
  const raptorPoints: { x: number; y: number }[] = [];
  const matchupPoints: { x: number; y: number }[] = [];
  const bpm2Points: { x: number; y: number }[] = [];
  for (const span of players) {
    const defImpact = computeDefensiveImpact(span);
    const ddpmCov = ddpmCoverageForSpan(span);
    if (ddpmCov) darkoPoints.push({ x: defImpact, y: ddpmCov.avg });
    const raptorCov = raptorCoverageForSpan(span);
    if (raptorCov) raptorPoints.push({ x: defImpact, y: raptorCov.avg });
    const matchupCov = matchupCoverageForSpan(span);
    if (matchupCov) matchupPoints.push({ x: defImpact, y: matchupCov.avg });
    const bpm2Cov = bpm2CoverageForSpan(span);
    if (bpm2Cov) bpm2Points.push({ x: defImpact, y: bpm2Cov.avg });
  }
  const darkoDefenseRegression = fitLinearRegression(darkoPoints);
  const raptorDefenseRegression = fitLinearRegression(raptorPoints);
  const matchupDefenseRegression = fitLinearRegression(matchupPoints);
  const bpm2DefenseRegression = fitLinearRegression(bpm2Points);

  // Intermediate write: everything below this point (hiddenValue/portability/impact) calls
  // `rawTalentBlend`/`computeTalent`, which read `darkoDefenseBonus`, which reads
  // `coefficients.raptorDefense`/`matchupDefense`/`bpm2Defense` off DISK (the static JSON import,
  // not this in-memory value) — so all of them have to actually be on disk before those
  // regressions can run at all, not just computed in this script's memory. Overwritten again
  // with the complete set at the end.
  const existingCoefficients = JSON.parse(readFileSync('src/data/awards/correctionCoefficients.json', 'utf8'));
  writeFileSync(
    'src/data/awards/correctionCoefficients.json',
    JSON.stringify(
      {
        ...existingCoefficients,
        darkoDefense: darkoDefenseRegression,
        raptorDefense: raptorDefenseRegression,
        matchupDefense: matchupDefenseRegression,
        bpm2Defense: bpm2DefenseRegression,
      },
      null,
      1,
    ),
  );

  // "Late" imports — only now, with the new raptorDefense/matchupDefense/bpm2Defense
  // coefficients already on disk, is it safe to import talent.ts (and anything that transitively
  // reads `darkoDefenseBonus`).
  const { computeTalent, rawTalentBlend } = await import('../src/engine/talent');
  const { computeOffensivePortability, computeDefensivePortability } = await import('../src/engine/portability');
  const { blendedRealValueForSpan } = await import('../src/engine/blendedRealValueLookup');
  const primeCareerModule = await import('../src/data/raw/wowyrPrimeCareer.json');
  const primeCareerData = primeCareerModule.default;

  // --- 2. historicalApmCorrection.ts's two regressions (rawTalentBlend -> blended real value) ---
  const hvModernPoints: { x: number; y: number }[] = [];
  const hvPre1997Points: { x: number; y: number }[] = [];
  for (const span of players) {
    const r = blendedRealValueForSpan(span);
    if (!r) continue;
    (r.isModernEra ? hvModernPoints : hvPre1997Points).push({ x: rawTalentBlend(span), y: r.value });
  }
  const hiddenValueModernRegression = fitLinearRegression(hvModernPoints);
  const hiddenValuePre1997Regression = fitLinearRegression(hvPre1997Points);

  // --- 3. portabilityCorrection.ts's single regression (rawTalentBlend -> avg(O-POR, D-POR)) ---
  // 2026-08-06: "overall" computePortability was removed; portabilityCorrection.ts's own
  // combinedPortabilityForCorrection (average of the two split scores) mirrored here so this
  // script's fit matches exactly what production actually regresses against.
  const porPoints = players.map((p) => ({
    x: rawTalentBlend(p),
    y: (computeOffensivePortability(p) + computeDefensivePortability(p)) / 2,
  }));
  const portabilityRegression = fitLinearRegression(porPoints);

  // --- 4. impact.ts's three regressions (computeTalent -> real value / WOWYR) ---
  const impModernPoints: { x: number; y: number }[] = [];
  const impPre1997Points: { x: number; y: number }[] = [];
  for (const span of players) {
    const r = blendedRealValueForSpan(span);
    if (!r) continue;
    (r.isModernEra ? impModernPoints : impPre1997Points).push({ x: computeTalent(span), y: r.value });
  }
  const impactModernRegression = fitLinearRegression(impModernPoints);
  const impactPre1997Regression = fitLinearRegression(impPre1997Points);

  // wowyrLookup.ts's own name-matching (duplicated here so this script has no dependency on the
  // file being refactored) —
  function fuzzyKey(name: string): string {
    return normalizePlayerName(name).replace(/[^a-z0-9]+/g, ' ').trim();
  }
  const realNamesByFuzzy = new Map<string, string>();
  const surnameOnlyIndex = new Map<string, string[]>();
  for (const p of players) {
    const fk = fuzzyKey(p.playerName);
    realNamesByFuzzy.set(fk, p.playerName);
    const parts = p.playerName.split(' ');
    const surname = fuzzyKey(parts[parts.length - 1]);
    const arr = surnameOnlyIndex.get(surname) ?? [];
    if (!arr.includes(p.playerName)) arr.push(p.playerName);
    surnameOnlyIndex.set(surname, arr);
  }
  function matchRealName(key: string): string | null {
    const fk = fuzzyKey(key.replace(/\./g, ' '));
    const direct = realNamesByFuzzy.get(fk);
    if (direct) return direct;
    const words = fk.split(' ').filter(Boolean);
    if (words.length === 2) {
      const rev = realNamesByFuzzy.get(`${words[1]} ${words[0]}`);
      if (rev) return rev;
    }
    const bySurname = surnameOnlyIndex.get(words[words.length - 1]);
    if (bySurname && bySurname.length === 1) return bySurname[0];
    return null;
  }
  const wowyrByName = new Map<string, number>();
  const rows = (primeCareerData.rows as string[][]).filter((r) => !r[0].startsWith('np'));
  for (const row of rows) {
    const realName = matchRealName(row[0]);
    if (!realName) continue;
    wowyrByName.set(realName, parseFloat(row[1]));
  }

  const wowyrPoints: { x: number; y: number }[] = [];
  for (const span of players) {
    const wowyr = wowyrByName.get(span.playerName);
    if (wowyr === undefined) continue;
    wowyrPoints.push({ x: computeTalent(span), y: wowyr });
  }
  const impactWowyrRegression = fitLinearRegression(wowyrPoints);

  // --- write outputs ---
  const coefficients = {
    darkoDefense: darkoDefenseRegression,
    raptorDefense: raptorDefenseRegression,
    matchupDefense: matchupDefenseRegression,
    bpm2Defense: bpm2DefenseRegression,
    hiddenValueModern: hiddenValueModernRegression,
    hiddenValuePre1997: hiddenValuePre1997Regression,
    portability: portabilityRegression,
    impactModern: impactModernRegression,
    impactPre1997: impactPre1997Regression,
    impactWowyr: impactWowyrRegression,
  };
  writeFileSync('src/data/awards/correctionCoefficients.json', JSON.stringify(coefficients, null, 1));

  const wowyrEntries = Object.fromEntries(wowyrByName);
  writeFileSync('src/data/awards/wowyrPrimeByName.json', JSON.stringify(wowyrEntries));

  console.log('=== coefficients (computed against the FULL historical population) ===');
  console.log(JSON.stringify(coefficients, null, 1));
  console.log('\nwowyr matched names:', wowyrByName.size);
  console.log('wrote src/data/awards/correctionCoefficients.json and wowyrPrimeByName.json');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Guaranteed restoration of the trimmed pool files, even on error — production must never
    // accidentally ship the full (un-trimmed) reference data.
    writeFileSync(DARKO_POOL, darkoPoolBackup);
    writeFileSync(HISTAPM_POOL, histApmPoolBackup);
    writeFileSync(PIPM_POOL, pipmPoolBackup);
    writeFileSync(RAPTOR_POOL, raptorPoolBackup);
    writeFileSync(MATCHUP_POOL, matchupPoolBackup);
    writeFileSync(BPM2_POOL, bpm2PoolBackup);
    console.log(
      '\nrestored darko.pool.json / historicalApm.pool.json / pipm.pool.json / raptor.pool.json / matchupDefense.pool.json / bpm2.pool.json to their trimmed state',
    );
  });
