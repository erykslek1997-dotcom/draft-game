/**
 * Trains and validates the one item flagged as worth pursuing from the
 * `all_time_nba_draft_model_spec_v1.json` review (2026-08-14 chat): does a linear model built
 * on this project's own OTAL/DTAL/SPC actually predict REAL NBA team net rating, in real units
 * (points per 100 possessions) instead of the game's internal 0-100 relative scale?
 *
 * Method: MIN-weighted average `computeOffensiveTalent`/`computeDefensiveTalent`/`computeSpacing`
 * per real team-season (real roster + real minutes, matched via `scripts/lib/realTeamSeasons.ts`),
 * regressed against the real OFFRTG/DEFRTG. This reuses the exact TAL/O-TAL/D-TAL/SPC the game
 * already computes — no new box-stat pipeline, no ML library, just the same
 * `fitLinearRegression`-over-two-points-arrays pattern already used in
 * precomputeCorrectionCoefficients.ts.
 *
 * Validation follows the project's own established bar (see [[game-advanced-boxscore-exports]]
 * — "don't build a scoring correction on a noisy signal"): split-half by season parity, fit on
 * one half, report OUT-OF-SAMPLE R² on the other half. In-sample R² alone is not trusted here.
 */
import { buildRealTeamSeasons, fitLinearRegression, rSquared, pearsonR, type RealTeamSeason } from './lib/realTeamSeasons';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { computeSpacing } from '../src/engine/spacing';

interface TrainingRow {
  season: number;
  team: string;
  realOff: number;
  realDef: number;
  realNet: number;
  predOff: number;
  predDef: number;
  predSpc: number;
  coverage: number;
}

function toTrainingRow(ts: RealTeamSeason): TrainingRow {
  let matchedMin = 0;
  let sumOff = 0;
  let sumDef = 0;
  let sumSpc = 0;
  for (const { span, minutes } of ts.matchedPlayers) {
    matchedMin += minutes;
    sumOff += computeOffensiveTalent(span) * minutes;
    sumDef += computeDefensiveTalent(span) * minutes;
    sumSpc += computeSpacing(span) * minutes;
  }
  return {
    season: ts.season,
    team: ts.team,
    realOff: ts.realOff,
    realDef: ts.realDef,
    realNet: ts.realNet,
    predOff: matchedMin > 0 ? sumOff / matchedMin : 0,
    predDef: matchedMin > 0 ? sumDef / matchedMin : 0,
    predSpc: matchedMin > 0 ? sumSpc / matchedMin : 0,
    coverage: ts.coverage,
  };
}

// --- Main ---
const rows = buildRealTeamSeasons().map(toTrainingRow);
if (rows.length < 20) {
  console.error('Too few team-seasons survived to fit anything meaningful. Aborting.');
  process.exit(1);
}

const avgCoverage = rows.reduce((s, r) => s + r.coverage, 0) / rows.length;
console.log(`Average roster-minutes coverage: ${(avgCoverage * 100).toFixed(1)}%`);
console.log(`Season range: ${Math.min(...rows.map((r) => r.season))}-${Math.max(...rows.map((r) => r.season))}\n`);

function report(label: string, xKey: 'predOff' | 'predDef', yKey: 'realOff' | 'realDef', data: TrainingRow[]) {
  const points = data.map((r) => ({ x: r[xKey], y: r[yKey] }));
  const { slope, intercept } = fitLinearRegression(points);
  const r2 = rSquared(points, slope, intercept);
  const r = pearsonR(points);
  console.log(`${label}: n=${points.length}  r=${r.toFixed(3)}  R²=${r2.toFixed(3)}  ${yKey} = ${intercept.toFixed(2)} + ${slope.toFixed(4)} * ${xKey}`);
  return { slope, intercept, r2, r };
}

console.log('--- IN-SAMPLE (full dataset, fit and evaluated on the same rows) ---');
const offFit = report('Offense (predOff -> realOff)', 'predOff', 'realOff', rows);
const defFit = report('Defense (predDef -> realDef)', 'predDef', 'realDef', rows);
console.log(`Full precision: OFF_INTERCEPT=${offFit.intercept} OFF_SLOPE=${offFit.slope}`);
console.log(`Full precision: DEF_INTERCEPT=${defFit.intercept} DEF_SLOPE=${defFit.slope}`);

// Net rating: derive from the two independently-fit halves, not a separately-fit third
// regression — this is the honest end-to-end test of what a real team model would actually do
// (project offense and defense separately, then take the difference).
const netPoints = rows.map((r) => ({
  x: offFit.intercept + offFit.slope * r.predOff - (defFit.intercept + defFit.slope * r.predDef),
  y: r.realNet,
}));
const netR = pearsonR(netPoints);
const { slope: netSlope, intercept: netIntercept } = fitLinearRegression(netPoints);
const netR2 = rSquared(netPoints, netSlope, netIntercept);
console.log(`Net rating (derived off-def -> realNet): n=${netPoints.length}  r=${netR.toFixed(3)}  R²(vs y=x diagonal not fit, raw correlation matters more here)=${netR2.toFixed(3)}\n`);

console.log('--- OUT-OF-SAMPLE (split-half by season parity, the bar this project actually trusts) ---');
const odd = rows.filter((r) => r.season % 2 === 1);
const even = rows.filter((r) => r.season % 2 === 0);
console.log(`odd seasons n=${odd.length}, even seasons n=${even.length}`);

function outOfSample(train: TrainingRow[], test: TrainingRow[], xKey: 'predOff' | 'predDef', yKey: 'realOff' | 'realDef') {
  const trainPoints = train.map((r) => ({ x: r[xKey], y: r[yKey] }));
  const { slope, intercept } = fitLinearRegression(trainPoints);
  const testPoints = test.map((r) => ({ x: r[xKey], y: r[yKey] }));
  const r2 = rSquared(testPoints, slope, intercept);
  const r = pearsonR(testPoints);
  return { r, r2 };
}

for (const [trainName, train, testName, test] of [
  ['odd', odd, 'even', even],
  ['even', even, 'odd', odd],
] as const) {
  const off = outOfSample(train, test, 'predOff', 'realOff');
  const def = outOfSample(train, test, 'predDef', 'realDef');
  console.log(`fit on ${trainName} -> test on ${testName}:  offense r=${off.r.toFixed(3)} R²=${off.r2.toFixed(3)}   defense r=${def.r.toFixed(3)} R²=${def.r2.toFixed(3)}`);
}

console.log('\n--- Spacing as a covariate check (does predSpc add signal beyond predOff for real OFFRTG?) ---');
const spcCorr = pearsonR(rows.map((r) => ({ x: r.predSpc, y: r.realOff })));
console.log(`raw corr(predSpc, realOff) = ${spcCorr.toFixed(3)} (for comparison, corr(predOff, realOff) = ${offFit.r.toFixed(3)})`);

console.log('\n--- Face validity: 10 largest residuals (predicted net rating vs real, using the in-sample fit) ---');
const withResidual = rows
  .map((r) => {
    const predNet = offFit.intercept + offFit.slope * r.predOff - (defFit.intercept + defFit.slope * r.predDef);
    return { ...r, predNet, residual: predNet - r.realNet };
  })
  .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
for (const r of withResidual.slice(0, 10)) {
  console.log(
    `${r.season} ${r.team}: real net ${r.realNet.toFixed(1)}, predicted ${r.predNet.toFixed(1)} (residual ${r.residual.toFixed(1)}), coverage ${(r.coverage * 100).toFixed(0)}%`,
  );
}

console.log('\n--- Named sanity checks ---');
for (const [season, team] of [
  [2016, 'GSW'],
  [2016, 'PHI'],
  [2023, 'DEN'],
  [1998, 'CHI'],
  [2001, 'LAL'],
] as const) {
  const row = rows.find((r) => r.season === season && r.team === team);
  if (!row) {
    console.log(`${season} ${team}: not in filtered dataset (missing/low coverage).`);
    continue;
  }
  const predNet = offFit.intercept + offFit.slope * row.predOff - (defFit.intercept + defFit.slope * row.predDef);
  console.log(`${season} ${team}: real net ${row.realNet.toFixed(1)}, predicted net ${predNet.toFixed(1)}, coverage ${(row.coverage * 100).toFixed(0)}%`);
}
