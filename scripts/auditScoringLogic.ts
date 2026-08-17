/**
 * Audits the active team-scoring blend against the existing blind 48-roster qualitative sample.
 * The roster dump was scored without engine numbers being shown to the judge, so it is useful as
 * an independent regression set. This script does not tune or mutate production scoring.
 *
 * Run: npx tsx scripts/auditScoringLogic.ts
 */
import { readFileSync } from 'node:fs';
import { players } from '../src/data/players';
import { autoAssignRotation } from '../src/engine/rotation';
import {
  fitScore,
  rotationScore,
  scoreTeam,
  type FitScoreComponents,
  type RotationScoreComponents,
  type ScoreBreakdown,
} from '../src/engine/scoring';
import type { PlayerSpan } from '../src/data/schema';
import type { Team } from '../src/engine/types';

const rosterText = readFileSync('reports/sample-rosters-for-claude-read.txt', 'utf8');
const judged = JSON.parse(readFileSync('reports/claude-scores-sample-rosters.json', 'utf8')) as Record<string, number>;

const playerByExactSpan = new Map(players.map((player) => [`${player.playerName}|${player.spanLabel}`, player]));
const rosters = new Map<number, PlayerSpan[]>();
let currentTeam = 0;
for (const line of rosterText.split(/\r?\n/)) {
  const teamMatch = line.match(/^=== TEAM (\d+) /);
  if (teamMatch) {
    currentTeam = Number(teamMatch[1]);
    rosters.set(currentTeam, []);
    continue;
  }
  if (!currentTeam || !line.includes('\t')) continue;
  const columns = line.split('\t');
  const playerMatch = columns[1]?.match(/^(.*) (\d{4}-\d{2})$/);
  if (!playerMatch) continue;
  const player = playerByExactSpan.get(`${playerMatch[1]}|${playerMatch[2]}`);
  if (!player) throw new Error(`Missing exact roster span: ${columns[1]}`);
  rosters.get(currentTeam)!.push(player);
}

interface AuditRow extends ScoreBreakdown {
  teamId: number;
  judged: number;
  fitComponents: FitScoreComponents;
  fitRaw: number;
  rotationComponents: RotationScoreComponents;
}

const rows: AuditRow[] = [];
for (const [teamId, roster] of rosters) {
  if (!(String(teamId) in judged)) continue;
  const team: Team = {
    id: `scoring-audit-${teamId}`,
    name: `Scoring audit ${teamId}`,
    draftSlot: ((teamId - 1) % 16) + 1,
    isHuman: false,
    roster,
    rotation: autoAssignRotation(roster),
  };
  const fit = fitScore(team);
  const rotation = rotationScore(team);
  rows.push({
    teamId,
    judged: judged[String(teamId)],
    fitComponents: fit.components,
    fitRaw: fit.raw,
    rotationComponents: rotation.components,
    ...scoreTeam(team),
  });
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function pearson(left: number[], right: number[]): number {
  const leftMean = average(left);
  const rightMean = average(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0) *
      right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0),
  );
  return denominator === 0 ? 0 : numerator / denominator;
}

function averageRanks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array<number>(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end++;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index++) ranks[sorted[index].index] = rank;
    start = end;
  }
  return ranks;
}

function spearman(left: number[], right: number[]): number {
  return pearson(averageRanks(left), averageRanks(right));
}

const judgedValues = rows.map((row) => row.judged);
const components: Array<[keyof ScoreBreakdown, number]> = [
  ['talentScore', 0.40],
  ['benchDepthScore', 0.10],
  ['offenseScore', 0.12],
  ['defenseScore', 0.12],
  ['spacingScore', 0.03],
  ['fitScore', 0.15],
  ['rotationScore', 0.08],
  ['overall', 1],
];

console.log(`Scoring audit: ${rows.length} blind-judged rosters.`);
console.log('metric\tpearson\tspearman\tmean\tstddev\tweighted_stddev');
for (const [key, weight] of components) {
  const values = rows.map((row) => row[key] as number);
  console.log([
    key,
    pearson(judgedValues, values).toFixed(3),
    spearman(judgedValues, values).toFixed(3),
    average(values).toFixed(1),
    standardDeviation(values).toFixed(1),
    (standardDeviation(values) * weight).toFixed(2),
  ].join('\t'));
}

const blendComponents = components.filter(([key]) => key !== 'overall');
console.log('\nLeave-one-component-out blend (remaining active weights renormalized):');
console.log('removed\tpearson\tspearman\tdelta_spearman');
const currentSpearman = spearman(judgedValues, rows.map((row) => row.overall));
for (const [removed] of blendComponents) {
  const remaining = blendComponents.filter(([key]) => key !== removed);
  const remainingWeight = remaining.reduce((sum, [, weight]) => sum + weight, 0);
  const values = rows.map((row) =>
    remaining.reduce((sum, [key, weight]) => sum + (row[key] as number) * weight, 0) / remainingWeight,
  );
  const candidateSpearman = spearman(judgedValues, values);
  console.log([
    removed,
    pearson(judgedValues, values).toFixed(3),
    candidateSpearman.toFixed(3),
    (candidateSpearman - currentSpearman).toFixed(3),
  ].join('\t'));
}

interface BlendWeights {
  talent: number;
  bench: number;
  offense: number;
  defense: number;
  spacing: number;
  fit: number;
  rotation: number;
}

const candidateBlends: Record<string, BlendWeights> = {
  legacy: { talent: 0.25, bench: 0.15, offense: 0.16 / 3, defense: 0.16 / 3, spacing: 0.16 / 3, fit: 0.29, rotation: 0.15 },
  current: { talent: 0.40, bench: 0.10, offense: 0.12, defense: 0.12, spacing: 0.03, fit: 0.15, rotation: 0.08 },
  balanced_35: { talent: 0.35, bench: 0.15, offense: 0.10, defense: 0.10, spacing: 0.05, fit: 0.15, rotation: 0.10 },
  talent_40: { talent: 0.40, bench: 0.10, offense: 0.10, defense: 0.10, spacing: 0.05, fit: 0.15, rotation: 0.10 },
};

function candidateBlend(row: AuditRow, weights: BlendWeights): number {
  return (
    row.talentScore * weights.talent +
    row.benchDepthScore * weights.bench +
    row.offenseScore * weights.offense +
    row.defenseScore * weights.defense +
    row.spacingScore * weights.spacing +
    row.fitScore * weights.fit +
    row.rotationScore * weights.rotation
  );
}

console.log('\nCandidate top-level blends:');
console.log('candidate\tpearson\tspearman\tmean\tstddev');
for (const [name, weights] of Object.entries(candidateBlends)) {
  const values = rows.map((row) => candidateBlend(row, weights));
  console.log([
    name,
    pearson(judgedValues, values).toFixed(3),
    spearman(judgedValues, values).toFixed(3),
    average(values).toFixed(1),
    standardDeviation(values).toFixed(1),
  ].join('\t'));
}

const lowDuplicationWeights = candidateBlends.current;
const rotationComponentKeys = Object.keys(rows[0].rotationComponents) as Array<keyof RotationScoreComponents>;
const rotationVariants: Record<string, (row: AuditRow) => number> = {
  current: (row) => row.rotationScore,
  weak_cap_25: (row) => {
    const raw = rotationComponentKeys.reduce((sum, key) =>
      sum + (key === 'weakStarterTransform' ? Math.max(-25, row.rotationComponents[key]) : row.rotationComponents[key]), 0);
    return Math.max(0, Math.min(100, Math.round(raw)));
  },
  tier_cap_12: (row) => {
    const raw = rotationComponentKeys.reduce((sum, key) =>
      sum + (key === 'tierMinutesOverage' ? Math.max(-12, row.rotationComponents[key]) : row.rotationComponents[key]), 0);
    return Math.max(0, Math.min(100, Math.round(raw)));
  },
  both_caps: (row) => {
    const raw = rotationComponentKeys.reduce((sum, key) => {
      if (key === 'weakStarterTransform') return sum + Math.max(-25, row.rotationComponents[key]);
      if (key === 'tierMinutesOverage') return sum + Math.max(-12, row.rotationComponents[key]);
      return sum + row.rotationComponents[key];
    }, 0);
    return Math.max(0, Math.min(100, Math.round(raw)));
  },
};
console.log('\nRotation variants inside low-duplication top-level blend:');
console.log('variant\tpearson\tspearman');
for (const [name, rotationFor] of Object.entries(rotationVariants)) {
  const values = rows.map((row) => candidateBlend({ ...row, rotationScore: rotationFor(row) }, lowDuplicationWeights));
  console.log(`${name}\t${pearson(judgedValues, values).toFixed(3)}\t${spearman(judgedValues, values).toFixed(3)}`);
}

console.log('\nPairwise component redundancy (absolute Spearman >= 0.65):');
for (let leftIndex = 0; leftIndex < blendComponents.length; leftIndex++) {
  for (let rightIndex = leftIndex + 1; rightIndex < blendComponents.length; rightIndex++) {
    const left = blendComponents[leftIndex][0];
    const right = blendComponents[rightIndex][0];
    const correlation = spearman(
      rows.map((row) => row[left] as number),
      rows.map((row) => row[right] as number),
    );
    if (Math.abs(correlation) >= 0.65) console.log(`${left}\t${right}\t${correlation.toFixed(3)}`);
  }
}

const fitComponentKeys = Object.keys(rows[0].fitComponents)
  .filter((key) => key !== 'base') as Array<Exclude<keyof FitScoreComponents, 'base'>>;
console.log('\nfitScore raw components:');
console.log('component\tpearson\tspearman\tmean\tstddev\tactive');
for (const key of fitComponentKeys) {
  const values = rows.map((row) => row.fitComponents[key]);
  console.log([
    key,
    pearson(judgedValues, values).toFixed(3),
    spearman(judgedValues, values).toFixed(3),
    average(values).toFixed(2),
    standardDeviation(values).toFixed(2),
    values.filter((value) => value !== 0).length,
  ].join('\t'));
}

console.log('\nrotationScore raw components:');
console.log('component\tpearson\tspearman\tmean\tstddev\tactive');
for (const key of rotationComponentKeys) {
  const values = rows.map((row) => row.rotationComponents[key]);
  console.log([
    key,
    pearson(judgedValues, values).toFixed(3),
    spearman(judgedValues, values).toFixed(3),
    average(values).toFixed(2),
    standardDeviation(values).toFixed(2),
    values.filter((value) => value !== 0).length,
  ].join('\t'));
}

const judgedRanks = averageRanks(rows.map((row) => -row.judged));
const engineRanks = averageRanks(rows.map((row) => -row.overall));
console.log('\nLargest engine-vs-judge rank disagreements:');
console.log('team\tjudge_score\tjudge_rank\toverall\tengine_rank\trank_error\tTAL\tFIT\tROT\tSPC\trot_down\trot_tier\trot_weak');
rows
  .map((row, index) => ({ row, judgeRank: judgedRanks[index], engineRank: engineRanks[index] }))
  .sort((a, b) => Math.abs(b.engineRank - b.judgeRank) - Math.abs(a.engineRank - a.judgeRank))
  .slice(0, 12)
  .forEach(({ row, judgeRank, engineRank }) => {
    console.log([
      row.teamId,
      row.judged,
      judgeRank.toFixed(1),
      row.overall,
      engineRank.toFixed(1),
      (engineRank - judgeRank).toFixed(1),
      row.talentScore,
      row.fitScore,
      row.rotationScore,
      row.spacingScore,
      row.rotationComponents.downwardPosition,
      row.rotationComponents.tierMinutesOverage,
      row.rotationComponents.weakStarterTransform,
    ].join('\t'));
  });

console.log('\nRemove one rotation component only (all top-level weights unchanged):');
console.log('removed\tpearson\tspearman\tdelta_spearman');
for (const key of rotationComponentKeys) {
  const values = rows.map((row) => {
    const rawWithout = rotationComponentKeys
      .filter((candidate) => candidate !== key)
      .reduce((sum, candidate) => sum + row.rotationComponents[candidate], 0);
    const rotationWithout = Math.max(0, Math.min(100, Math.round(rawWithout)));
    return (
      row.talentScore * 0.40 +
      row.benchDepthScore * 0.10 +
      row.offenseScore * 0.12 +
      row.defenseScore * 0.12 +
      row.spacingScore * 0.03 +
      row.fitScore * 0.15 +
      rotationWithout * 0.08
    );
  });
  const candidateSpearman = spearman(judgedValues, values);
  console.log([
    key,
    pearson(judgedValues, values).toFixed(3),
    candidateSpearman.toFixed(3),
    (candidateSpearman - currentSpearman).toFixed(3),
  ].join('\t'));
}

console.log('\nRemove one fit component only (all top-level weights unchanged):');
console.log('removed\tpearson\tspearman\tdelta_spearman');
for (const key of fitComponentKeys) {
  const values = rows.map((row) => {
    const rawWithout = row.fitRaw - row.fitComponents[key];
    const fitWithout = Math.max(0, Math.min(100, Math.round(((rawWithout + 2) / 126) * 100)));
    return (
      row.talentScore * 0.40 +
      row.benchDepthScore * 0.10 +
      row.offenseScore * 0.12 +
      row.defenseScore * 0.12 +
      row.spacingScore * 0.03 +
      fitWithout * 0.15 +
      row.rotationScore * 0.08
    );
  });
  const candidateSpearman = spearman(judgedValues, values);
  console.log([
    key,
    pearson(judgedValues, values).toFixed(3),
    candidateSpearman.toFixed(3),
    (candidateSpearman - currentSpearman).toFixed(3),
  ].join('\t'));
}
