/**
 * A2 / "mini-RAPTOR" — the documented finding. Analysis only, writes nothing, wired into nothing.
 *
 * The question (2026-09-04, pool audit vs `peakRapm.json`): `darkoCorrection.ts`'s `blendedExcess`
 * asks, per real source, "given the box, what real defensive plus-minus would we expect?" and
 * answers with a single-feature line, `slope * computeDefensiveImpact + intercept`. Because the
 * box formula weights `(spg + bpg)` identically at `* 4.5`, a steal-heavy guard and a rim-
 * protecting big with the same `defImpact` get the same expectation. Would fitting that
 * expectation on the SEPARATED box features (steals apart from blocks, rebounding, defensive
 * role, position, size) predict real defense better?
 *
 * FINDING 1 — yes, clearly. A per-source ridge on the separated features beats the shipped scalar
 * OUT OF SAMPLE (split-half by season parity, the bar `trainNetRatingModel.ts` set) by +0.11 to
 * +0.18 R² on every source. The model learns exactly what the audit predicted: for defended-FG%
 * matchup data, block activity carries a coefficient ~4x the steal coefficient, and steals go
 * slightly NEGATIVE.
 *
 * FINDING 2 — but it cannot be wired into `blendedExcess`. That mechanism measures value as the
 * RESIDUAL of real data over a deliberately-weak box expectation; the correction IS the residual.
 * Replace the weak expectation with a good one and the residual collapses for exactly the
 * defenders the correction exists to protect. Simulated on full TAL: Maurice Cheeks -26, Gary
 * Payton -20, Alvin Robertson across six spans, all cratered — the model "explains" their box
 * profile and leaves nothing for the bonus to credit. A bounded nudge (model as a capped
 * adjustment, not a replacement) still reshuffled ~50 pre-tracking spans by ±8-20 because the
 * pre-1998 population routes entirely through the one BPM2 fallback path.
 *
 * What shipped instead (see `darkoCorrection.ts` `AGREEMENT_BONUS_CAP`): a targeted cap raise for
 * spans where ≥2 independent real sources agree the box under-credits — which is the audit's
 * "Chuck Hayes / Splitter class pinned at +9" case and nothing else. The pre-1998 steal-gambling
 * over-rating is left as a known problem for a narrower instrument in a dedicated session.
 *
 * Run: `npx tsx scripts/trainDefenseModel.ts`
 */
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import type { PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { computeDefensiveImpact, defensiveBoxParts } from '../src/engine/defense';
import { individualDefenseRate } from '../src/engine/defensiveAccolades';
import { buildFullDarkoYearMap, avgFullDarkoFieldForSpan } from './lib/fullDarkoLookup';
import { buildFullRaptorYearMap, avgFullRaptorDefenseForSpan } from './lib/fullRaptorLookup';
import { buildFullMatchupDefenseYearMap, avgFullMatchupDefenseForSpan } from './lib/fullMatchupDefenseLookup';
import { buildFullBpm2YearMap, avgFullBpm2DefenseForSpan } from './lib/fullBpm2Lookup';
import heightData from '../src/data/awards/height.json';
import weightData from '../src/data/awards/weight.json';
import coefficients from '../src/data/awards/correctionCoefficients.json';

const heights = heightData as Record<string, number>;
const weights = weightData as Record<string, number>;
const FIRST_OFFICIAL_STOCKS_END_YEAR = 1974;

const FEATURE_NAMES = [
  'intercept', 'steal', 'block', 'rebound', 'roleWeight',
  'posPG', 'posSG', 'posSF', 'posPF', 'heightC', 'weightC', 'preStocks', 'allDefRate',
];

/** The separated box features — the whole point of the experiment. */
function featureRow(span: PlayerSpan): number[] {
  const { stealActivity, blockActivity, rebounding, roleWeight } = defensiveBoxParts(span);
  const key = normalizePlayerName(span.playerName);
  const h = heights[key];
  const w = weights[key];
  const years = spanEndYears(span.spanLabel);
  const preStocks = years.length === 0 ? 0 : years.filter((y) => y < FIRST_OFFICIAL_STOCKS_END_YEAR).length / years.length;
  const pos = span.primaryPosition;
  return [
    1, stealActivity, blockActivity, rebounding, roleWeight,
    pos === 'PG' ? 1 : 0, pos === 'SG' ? 1 : 0, pos === 'SF' ? 1 : 0, pos === 'PF' ? 1 : 0,
    h === undefined ? 0 : (h - 79) / 10,
    w === undefined ? 0 : (w - 215) / 30,
    preStocks,
    individualDefenseRate(span),
  ];
}

// --- ridge via normal equations, Gauss-Jordan solve ---
function solveRidge(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0].length;
  const A: number[][] = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < p; i++) {
      A[i][p] += X[r][i] * y[r];
      for (let j = 0; j < p; j++) A[i][j] += X[r][i] * X[r][j];
    }
  }
  for (let i = 1; i < p; i++) A[i][i] += lambda;
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    if (Math.abs(d) < 1e-12) continue;
    for (let k = col; k <= p; k++) A[col][k] /= d;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let k = col; k <= p; k++) A[r][k] -= f * A[col][k];
    }
  }
  return A.map((row) => row[p]);
}
const dot = (b: number[], x: number[]) => x.reduce((s, xi, i) => s + xi * b[i], 0);
function r2(actual: number[], pred: number[]): number {
  const m = actual.reduce((s, v) => s + v, 0) / actual.length;
  let ssr = 0, sst = 0;
  for (let i = 0; i < actual.length; i++) { ssr += (actual[i] - pred[i]) ** 2; sst += (actual[i] - m) ** 2; }
  return 1 - ssr / sst;
}

const ddpm = buildFullDarkoYearMap('ddpm');
const raptor = buildFullRaptorYearMap();
const matchup = buildFullMatchupDefenseYearMap();
const bpm2 = buildFullBpm2YearMap();
const SOURCES = {
  darko: { real: (s: PlayerSpan) => avgFullDarkoFieldForSpan(s, ddpm), scalar: coefficients.darkoDefense },
  raptor: { real: (s: PlayerSpan) => avgFullRaptorDefenseForSpan(s, raptor), scalar: coefficients.raptorDefense },
  matchup: { real: (s: PlayerSpan) => avgFullMatchupDefenseForSpan(s, matchup), scalar: coefficients.matchupDefense },
  bpm2: { real: (s: PlayerSpan) => avgFullBpm2DefenseForSpan(s, bpm2), scalar: coefficients.bpm2Defense },
};

const LAMBDA = 2;
const rows = players.map((span) => ({ span, x: featureRow(span), defImpact: computeDefensiveImpact(span), endYear: Math.max(...spanEndYears(span.spanLabel), 0) }));

console.log('mini-RAPTOR — per-source multi-feature expectation vs shipped scalar');
console.log(`ridge λ=${LAMBDA}   features: ${FEATURE_NAMES.join(' ')}\n`);
console.log('source   n      OOS R² model   OOS R² scalar   Δ        key coefficients');
for (const [name, src] of Object.entries(SOURCES)) {
  const data = rows.map((r) => ({ ...r, y: src.real(r.span) })).filter((r): r is typeof r & { y: number } => r.y !== null);
  const full = solveRidge(data.map((r) => r.x), data.map((r) => r.y), LAMBDA);
  const oos = (['odd', 'even'] as const).map((par) => {
    const tr = data.filter((r) => (par === 'odd' ? r.endYear % 2 === 1 : r.endYear % 2 === 0));
    const te = data.filter((r) => (par === 'odd' ? r.endYear % 2 === 0 : r.endYear % 2 === 1));
    const b = solveRidge(tr.map((r) => r.x), tr.map((r) => r.y), LAMBDA);
    return {
      model: r2(te.map((r) => r.y), te.map((r) => dot(b, r.x))),
      scalar: r2(te.map((r) => r.y), te.map((r) => src.scalar.slope * r.defImpact + src.scalar.intercept)),
    };
  });
  const mOOS = (oos[0].model + oos[1].model) / 2;
  const sOOS = (oos[0].scalar + oos[1].scalar) / 2;
  console.log(
    `${name.padEnd(8)} ${String(data.length).padEnd(6)} ${mOOS.toFixed(4).padEnd(14)} ${sOOS.toFixed(4).padEnd(15)} ` +
    `${(mOOS - sOOS >= 0 ? '+' : '') + (mOOS - sOOS).toFixed(4).padEnd(8)} steal ${full[1].toFixed(2)}  block ${full[2].toFixed(2)}  allDef ${full[12].toFixed(2)}`,
  );
}
console.log('\nSee the file header for why this is not wired in.');
