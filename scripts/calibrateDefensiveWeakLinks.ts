/**
 * Tests whether real NBA team DEFRTG improves when the existing D-TAL + defensive-role-share
 * regression also knows how many rotation minutes belong to targetable defenders. This is the
 * real-data check required before any weak-link adjustment reaches `projectedNetRating`.
 */
import { buildRealTeamSeasons } from './lib/realTeamSeasons';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { PERIMETER_DEFENDER_ROLES, RIM_PROTECTOR_ROLES } from '../src/data/schema';

type Candidate = 'shareUnder40' | 'shareUnder50' | 'shareUnder60' | 'softBelow50' | 'softBelow60';
interface Row {
  season: number;
  realDef: number;
  predDef: number;
  roleShare: number;
  shareUnder40: number;
  shareUnder50: number;
  shareUnder60: number;
  softBelow50: number;
  softBelow60: number;
}

function buildRows(gameType: 'regular' | 'playoff'): Row[] {
  return buildRealTeamSeasons({ gameType, minGames: gameType === 'regular' ? 20 : 4 }).map((team) => {
  let minutes = 0;
  let defense = 0;
  let roleMinutes = 0;
  const shares = { shareUnder40: 0, shareUnder50: 0, shareUnder60: 0, softBelow50: 0, softBelow60: 0 };
  for (const { span, minutes: playerMinutes } of team.matchedPlayers) {
    const dTal = computeDefensiveTalent(span);
    minutes += playerMinutes;
    defense += dTal * playerMinutes;
    if (RIM_PROTECTOR_ROLES.includes(span.defensiveRole as never) || PERIMETER_DEFENDER_ROLES.includes(span.defensiveRole as never)) {
      roleMinutes += playerMinutes;
    }
    if (dTal < 40) shares.shareUnder40 += playerMinutes;
    if (dTal < 50) shares.shareUnder50 += playerMinutes;
    if (dTal < 60) shares.shareUnder60 += playerMinutes;
    shares.softBelow50 += Math.max(0, (50 - dTal) / 50) * playerMinutes;
    shares.softBelow60 += Math.max(0, (60 - dTal) / 60) * playerMinutes;
  }
    return {
    season: team.season,
    realDef: team.realDef,
    predDef: defense / minutes,
    roleShare: roleMinutes / minutes,
    shareUnder40: shares.shareUnder40 / minutes,
    shareUnder50: shares.shareUnder50 / minutes,
    shareUnder60: shares.shareUnder60 / minutes,
    softBelow50: shares.softBelow50 / minutes,
    softBelow60: shares.softBelow60 / minutes,
    };
  });
}

function fit(data: Row[], candidate: Candidate | null): number[] {
  const features = (row: Row) => candidate === null ? [1, row.predDef, row.roleShare] : [1, row.predDef, row.roleShare, row[candidate]];
  const width = candidate === null ? 3 : 4;
  const matrix = Array.from({ length: width }, () => Array(width + 1).fill(0));
  for (const row of data) {
    const x = features(row);
    for (let i = 0; i < width; i++) {
      for (let j = 0; j < width; j++) matrix[i][j] += x[i] * x[j];
      matrix[i][width] += x[i] * row.realDef;
    }
  }
  for (let col = 0; col < width; col++) {
    let pivot = col;
    for (let row = col + 1; row < width; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    for (let row = col + 1; row < width; row++) {
      const factor = matrix[row][col] / matrix[col][col];
      for (let cell = col; cell <= width; cell++) matrix[row][cell] -= factor * matrix[col][cell];
    }
  }
  const result = Array(width).fill(0);
  for (let row = width - 1; row >= 0; row--) {
    let value = matrix[row][width];
    for (let col = row + 1; col < width; col++) value -= matrix[row][col] * result[col];
    result[row] = value / matrix[row][row];
  }
  return result;
}

function predict(row: Row, coefficients: number[], candidate: Candidate | null): number {
  const x = candidate === null ? [1, row.predDef, row.roleShare] : [1, row.predDef, row.roleShare, row[candidate]];
  return x.reduce((sum, value, index) => sum + value * coefficients[index], 0);
}

function metrics(data: Row[], coefficients: number[], candidate: Candidate | null) {
  const actualMean = data.reduce((sum, row) => sum + row.realDef, 0) / data.length;
  const predicted = data.map((row) => predict(row, coefficients, candidate));
  const predictedMean = predicted.reduce((sum, value) => sum + value, 0) / predicted.length;
  const residual = data.reduce((sum, row, index) => sum + (row.realDef - predicted[index]) ** 2, 0);
  const total = data.reduce((sum, row) => sum + (row.realDef - actualMean) ** 2, 0);
  const covariance = data.reduce((sum, row, index) => sum + (row.realDef - actualMean) * (predicted[index] - predictedMean), 0);
  const actualVariance = data.reduce((sum, row) => sum + (row.realDef - actualMean) ** 2, 0);
  const predictedVariance = predicted.reduce((sum, value) => sum + (value - predictedMean) ** 2, 0);
  return { r2: 1 - residual / total, r: covariance / Math.sqrt(actualVariance * predictedVariance) };
}

for (const gameType of ['regular', 'playoff'] as const) {
  const rows = buildRows(gameType);
  const odd = rows.filter((row) => row.season % 2 === 1);
  const even = rows.filter((row) => row.season % 2 === 0);
  console.log(`\n=== ${gameType.toUpperCase()} (${rows.length} team-seasons) ===`);
  for (const candidate of [null, 'shareUnder40', 'shareUnder50', 'shareUnder60', 'softBelow50', 'softBelow60'] as const) {
    const fullFit = fit(rows, candidate);
    const full = metrics(rows, fullFit, candidate);
    const oddToEven = metrics(even, fit(odd, candidate), candidate);
    const evenToOdd = metrics(odd, fit(even, candidate), candidate);
    console.log(
      `${candidate ?? 'baseline'}\tR2=${full.r2.toFixed(3)}\tOOS=${oddToEven.r2.toFixed(3)}/${evenToOdd.r2.toFixed(3)}` +
        `\tr=${oddToEven.r.toFixed(3)}/${evenToOdd.r.toFixed(3)}\tcoef=${fullFit.map((value) => value.toFixed(6)).join(',')}`,
    );
  }
}
