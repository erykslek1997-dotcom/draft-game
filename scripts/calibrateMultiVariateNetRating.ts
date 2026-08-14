/**
 * 2026-08-14, follow-up to the user's own observation: drafted rosters' projected DRTG all
 * cluster near ~95, even though real drafted teams' underlying D-TAL genuinely varies a lot
 * (checked directly: one real 16-team auto-draft had avg roster D-TAL ranging 58.8-80.1, a real
 * 21.3-point spread, but projected DRTG only spanned 92.4-99.1 — 6.7 points). Root cause: the
 * single-predictor defense regression's slope (-0.341) is shallow because D-TAL alone only
 * explains R²=0.248 of real DEFRTG — OLS correctly shrinks the slope toward zero when the
 * correlation is weak, so genuine roster-to-roster variation gets compressed on the way to a
 * "real units" number. Artificially steepening that slope by hand would be dishonest (it would
 * claim more precision than the data supports); the honest fix is to find more REAL predictive
 * signal, not amplify a shaky one.
 *
 * Candidate second predictor for defense: rim/perimeter-defender-ROLE-SHARE, already found to
 * correlate with real DEFRTG independently of D-TAL (`scripts/calibrateArchetypeComposition.ts`,
 * r≈-0.19 to -0.31, weak-to-moderate correlation with D-TAL itself per the D1-roster redundancy
 * check, r≈0.11-0.27 — genuinely adds information, not double-counting).
 *
 * Candidate second predictor for offense: raw SPACING already correlated with real OFFRTG
 * MORE STRONGLY than O-TAL itself in the original single-predictor run (r=0.695 vs r=0.594,
 * `trainNetRatingModel.ts`'s own "Spacing as a covariate check") — a two-predictor offense model
 * combining O-TAL and SPACING should beat either alone.
 *
 * Fits both as real 2-predictor OLS regressions (normal equations, 3x3 solve) on the same
 * 865-team-season real join, validated the same out-of-sample way as every other model here.
 */
import { buildRealTeamSeasons, fitLinearRegression, rSquared, type RealTeamSeason } from './lib/realTeamSeasons';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { computeSpacing } from '../src/engine/spacing';
import { RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../src/data/schema';

interface Row {
  season: number;
  realOff: number;
  realDef: number;
  predOff: number;
  predDef: number;
  predSpc: number;
  defRoleShare: number;
}

function toRow(ts: RealTeamSeason): Row {
  let matchedMin = 0;
  let sumOff = 0;
  let sumDef = 0;
  let sumSpc = 0;
  let sumDefRoleMin = 0;
  for (const { span, minutes } of ts.matchedPlayers) {
    matchedMin += minutes;
    sumOff += computeOffensiveTalent(span) * minutes;
    sumDef += computeDefensiveTalent(span) * minutes;
    sumSpc += computeSpacing(span) * minutes;
    const hasDefRole =
      RIM_PROTECTOR_ROLES.includes(span.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number]) ||
      PERIMETER_DEFENDER_ROLES.includes(span.defensiveRole as (typeof PERIMETER_DEFENDER_ROLES)[number]);
    if (hasDefRole) sumDefRoleMin += minutes;
  }
  return {
    season: ts.season,
    realOff: ts.realOff,
    realDef: ts.realDef,
    predOff: matchedMin > 0 ? sumOff / matchedMin : 0,
    predDef: matchedMin > 0 ? sumDef / matchedMin : 0,
    predSpc: matchedMin > 0 ? sumSpc / matchedMin : 0,
    defRoleShare: matchedMin > 0 ? sumDefRoleMin / matchedMin : 0,
  };
}

// --- 2-predictor OLS via normal equations (3x3 Gaussian elimination). ---
interface Fit2 {
  intercept: number;
  b1: number;
  b2: number;
}

function fitTwoPredictor(rows: { x1: number; x2: number; y: number }[]): Fit2 {
  const n = rows.length;
  let sX1 = 0, sX2 = 0, sY = 0, sX1X1 = 0, sX2X2 = 0, sX1X2 = 0, sX1Y = 0, sX2Y = 0;
  for (const r of rows) {
    sX1 += r.x1; sX2 += r.x2; sY += r.y;
    sX1X1 += r.x1 * r.x1; sX2X2 += r.x2 * r.x2; sX1X2 += r.x1 * r.x2;
    sX1Y += r.x1 * r.y; sX2Y += r.x2 * r.y;
  }
  // Normal equations for [intercept, b1, b2]:
  // [n, sX1, sX2]   [b0]   [sY]
  // [sX1, sX1X1, sX1X2] [b1] = [sX1Y]
  // [sX2, sX1X2, sX2X2] [b2]   [sX2Y]
  const A = [
    [n, sX1, sX2, sY],
    [sX1, sX1X1, sX1X2, sX1Y],
    [sX2, sX1X2, sX2X2, sX2Y],
  ];
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    for (let row = col + 1; row < 3; row++) {
      const factor = A[row][col] / A[col][col];
      for (let c = col; c < 4; c++) A[row][c] -= factor * A[col][c];
    }
  }
  const sol = [0, 0, 0];
  for (let row = 2; row >= 0; row--) {
    let sum = A[row][3];
    for (let c = row + 1; c < 3; c++) sum -= A[row][c] * sol[c];
    sol[row] = sum / A[row][row];
  }
  return { intercept: sol[0], b1: sol[1], b2: sol[2] };
}

function predict2(fit: Fit2, x1: number, x2: number): number {
  return fit.intercept + fit.b1 * x1 + fit.b2 * x2;
}

function r2(rows: { y: number }[], preds: number[]): number {
  const meanY = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  const ssTot = rows.reduce((s, r) => s + (r.y - meanY) ** 2, 0);
  const ssRes = rows.reduce((s, r, i) => s + (r.y - preds[i]) ** 2, 0);
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

function pearsonR(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  const cov = a.reduce((s, v, i) => s + (v - meanA) * (b[i] - meanB), 0);
  const varA = a.reduce((s, v) => s + (v - meanA) ** 2, 0);
  const varB = b.reduce((s, v) => s + (v - meanB) ** 2, 0);
  return varA === 0 || varB === 0 ? 0 : cov / Math.sqrt(varA * varB);
}

// --- Main ---
const rows = buildRealTeamSeasons().map(toRow);
console.log(`n=${rows.length}\n`);

console.log('=== DEFENSE: predDef alone vs predDef+defRoleShare ===');
{
  const singlePoints = rows.map((r) => ({ x: r.predDef, y: r.realDef }));
  const single = fitLinearRegression(singlePoints);
  console.log(`single (D-TAL only): R²=${rSquared(singlePoints, single.slope, single.intercept).toFixed(3)}  slope=${single.slope.toFixed(4)}`);

  const two = fitTwoPredictor(rows.map((r) => ({ x1: r.predDef, x2: r.defRoleShare, y: r.realDef })));
  const twoPreds = rows.map((r) => predict2(two, r.predDef, r.defRoleShare));
  console.log(`two-predictor (D-TAL + defRoleShare): R²=${r2(rows.map((r) => ({ y: r.realDef })), twoPreds).toFixed(3)}  b(D-TAL)=${two.b1.toFixed(4)}  b(defRoleShare)=${two.b2.toFixed(2)}`);
  console.log(`intercept=${two.intercept.toFixed(2)}`);
  console.log(`Full precision: DEF_INTERCEPT=${two.intercept} DEF_B_DTAL=${two.b1} DEF_B_ROLESHARE=${two.b2}`);
}

console.log('\n=== OFFENSE: predOff alone vs predOff+predSpc ===');
{
  const singlePoints = rows.map((r) => ({ x: r.predOff, y: r.realOff }));
  const single = fitLinearRegression(singlePoints);
  console.log(`single (O-TAL only): R²=${rSquared(singlePoints, single.slope, single.intercept).toFixed(3)}  slope=${single.slope.toFixed(4)}`);

  const two = fitTwoPredictor(rows.map((r) => ({ x1: r.predOff, x2: r.predSpc, y: r.realOff })));
  const twoPreds = rows.map((r) => predict2(two, r.predOff, r.predSpc));
  console.log(`two-predictor (O-TAL + SPACING): R²=${r2(rows.map((r) => ({ y: r.realOff })), twoPreds).toFixed(3)}  b(O-TAL)=${two.b1.toFixed(4)}  b(SPC)=${two.b2.toFixed(4)}`);
  console.log(`intercept=${two.intercept.toFixed(2)}`);
  console.log(`Full precision: OFF_INTERCEPT=${two.intercept} OFF_B_OTAL=${two.b1} OFF_B_SPC=${two.b2}`);
}

console.log('\n=== OUT-OF-SAMPLE (season-parity split-half) ===');
const odd = rows.filter((r) => r.season % 2 === 1);
const even = rows.filter((r) => r.season % 2 === 0);

function outOfSampleDef(train: Row[], test: Row[]) {
  const fit = fitTwoPredictor(train.map((r) => ({ x1: r.predDef, x2: r.defRoleShare, y: r.realDef })));
  const preds = test.map((r) => predict2(fit, r.predDef, r.defRoleShare));
  return { r2: r2(test.map((r) => ({ y: r.realDef })), preds), r: pearsonR(preds, test.map((r) => r.realDef)) };
}
function outOfSampleOff(train: Row[], test: Row[]) {
  const fit = fitTwoPredictor(train.map((r) => ({ x1: r.predOff, x2: r.predSpc, y: r.realOff })));
  const preds = test.map((r) => predict2(fit, r.predOff, r.predSpc));
  return { r2: r2(test.map((r) => ({ y: r.realOff })), preds), r: pearsonR(preds, test.map((r) => r.realOff)) };
}

for (const [trainName, train, testName, test] of [
  ['odd', odd, 'even', even],
  ['even', even, 'odd', odd],
] as const) {
  const def = outOfSampleDef(train, test);
  const off = outOfSampleOff(train, test);
  console.log(`fit ${trainName} -> test ${testName}:  DEF R²=${def.r2.toFixed(3)} r=${def.r.toFixed(3)}   OFF R²=${off.r2.toFixed(3)} r=${off.r.toFixed(3)}`);
}

console.log('\n=== Range check: does the 2-predictor DEF model actually differentiate more? ===');
const defFitFull = fitTwoPredictor(rows.map((r) => ({ x1: r.predDef, x2: r.defRoleShare, y: r.realDef })));
const defPredsFull = rows.map((r) => predict2(defFitFull, r.predDef, r.defRoleShare));
console.log(`2-predictor DEF predictions across all 865: min=${Math.min(...defPredsFull).toFixed(1)} max=${Math.max(...defPredsFull).toFixed(1)} range=${(Math.max(...defPredsFull)-Math.min(...defPredsFull)).toFixed(1)}`);
console.log(`(real DEFRTG actual range for comparison: min=${Math.min(...rows.map(r=>r.realDef)).toFixed(1)} max=${Math.max(...rows.map(r=>r.realDef)).toFixed(1)})`);
