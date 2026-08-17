/**
 * Diagnostic only: evaluates a candidate postseason projection before any production wiring.
 * Unlike the regular-season projection, defense includes the real playoff-minutes share carried
 * by D-TAL<60 defenders — the weak-link signal that survived the real playoff team-season
 * comparison. Its sample is thinner/noisier, so the printed coefficients are not automatically
 * copied into BO7 matchup simulation.
 */
import { buildRealTeamSeasons } from './lib/realTeamSeasons';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { computeSpacing } from '../src/engine/spacing';
import { PERIMETER_DEFENDER_ROLES, RIM_PROTECTOR_ROLES } from '../src/data/schema';

interface Row {
  season: number;
  realOff: number;
  realDef: number;
  realNet: number;
  predOff: number;
  predSpc: number;
  predDef: number;
  roleShare: number;
  weakShare: number;
}

const rows: Row[] = buildRealTeamSeasons({ gameType: 'playoff', minGames: 4 }).map((team) => {
  let minutes = 0;
  let offense = 0;
  let spacing = 0;
  let defense = 0;
  let roleMinutes = 0;
  let weakMinutes = 0;
  for (const { span, minutes: playerMinutes } of team.matchedPlayers) {
    const dTal = computeDefensiveTalent(span);
    minutes += playerMinutes;
    offense += computeOffensiveTalent(span) * playerMinutes;
    spacing += computeSpacing(span) * playerMinutes;
    defense += dTal * playerMinutes;
    if (RIM_PROTECTOR_ROLES.includes(span.defensiveRole as never) || PERIMETER_DEFENDER_ROLES.includes(span.defensiveRole as never)) {
      roleMinutes += playerMinutes;
    }
    if (dTal < 60) weakMinutes += playerMinutes;
  }
  return {
    season: team.season,
    realOff: team.realOff,
    realDef: team.realDef,
    realNet: team.realNet,
    predOff: offense / minutes,
    predSpc: spacing / minutes,
    predDef: defense / minutes,
    roleShare: roleMinutes / minutes,
    weakShare: weakMinutes / minutes,
  };
});

function fit(data: Row[], features: (row: Row) => number[], target: (row: Row) => number): number[] {
  const width = features(data[0]).length;
  const matrix = Array.from({ length: width }, () => Array(width + 1).fill(0));
  for (const row of data) {
    const x = features(row);
    for (let i = 0; i < width; i++) {
      for (let j = 0; j < width; j++) matrix[i][j] += x[i] * x[j];
      matrix[i][width] += x[i] * target(row);
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

const offFeatures = (row: Row) => [1, row.predOff, row.predSpc];
const defFeatures = (row: Row) => [1, row.predDef, row.roleShare, row.weakShare];
const predict = (row: Row, coefficients: number[], features: (row: Row) => number[]) =>
  features(row).reduce((sum, value, index) => sum + value * coefficients[index], 0);

function metrics(data: Row[], off: number[], def: number[]) {
  const predictions = data.map((row) => predict(row, off, offFeatures) - predict(row, def, defFeatures));
  const actual = data.map((row) => row.realNet);
  const actualMean = actual.reduce((sum, value) => sum + value, 0) / actual.length;
  const predictedMean = predictions.reduce((sum, value) => sum + value, 0) / predictions.length;
  const covariance = actual.reduce((sum, value, index) => sum + (value - actualMean) * (predictions[index] - predictedMean), 0);
  const actualVariance = actual.reduce((sum, value) => sum + (value - actualMean) ** 2, 0);
  const predictedVariance = predictions.reduce((sum, value) => sum + (value - predictedMean) ** 2, 0);
  const residual = actual.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0);
  return { r: covariance / Math.sqrt(actualVariance * predictedVariance), r2: 1 - residual / actualVariance };
}

const off = fit(rows, offFeatures, (row) => row.realOff);
const def = fit(rows, defFeatures, (row) => row.realDef);
console.log(`OFF=${off.join(',')}`);
console.log(`DEF=${def.join(',')}`);
console.log('full', metrics(rows, off, def));
for (const [train, test, label] of [
  [rows.filter((row) => row.season % 2 === 1), rows.filter((row) => row.season % 2 === 0), 'odd->even'],
  [rows.filter((row) => row.season % 2 === 0), rows.filter((row) => row.season % 2 === 1), 'even->odd'],
] as const) {
  console.log(label, metrics(test, fit(train, offFeatures, (row) => row.realOff), fit(train, defFeatures, (row) => row.realDef)));
}
