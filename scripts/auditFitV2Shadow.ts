/**
 * Runs the same 30 deterministic AI-draft seeds used by the average-pick calibration family,
 * then compares production FIT v1 with FIT v2 shadow on the exact same finished rosters.
 * Writes diagnostics only; neither drafter nor Overall imports FIT v2.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import aiTestPoolNamesJson from '../src/data/aiTestPoolNames.json';
import { normalizePlayerName } from '../src/data/schema';
import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { DRAFT_EXPERIMENT } from '../src/engine/draftExperiment';
import { fitV2ShadowScore } from '../src/engine/fitV2Shadow';
import { autoAssignRotation } from '../src/engine/rotation';
import { fitScore } from '../src/engine/scoring';

const DRAFTS = 30;
const aiTestPoolNames = new Set((aiTestPoolNamesJson as string[]).map(normalizePlayerName));
const experimentPool = DRAFT_EXPERIMENT.pruneToObservedAiPool
  ? activeDraftPool.filter((span) => aiTestPoolNames.has(normalizePlayerName(span.playerName)))
  : activeDraftPool;

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Row {
  draft: number;
  team: string;
  fitV1: number;
  fitV2: number;
  creation: number;
  spacingCompatibility: number;
  defensiveRoles: number;
  rebounding: number;
  size: number;
  v1Rank: number;
  v2Rank: number;
}

const rows: Row[] = [];
const originalRandom = Math.random;
try {
  for (let draft = 1; draft <= DRAFTS; draft++) {
    Math.random = seededRandom(40_000 + draft);
    const state = autoFinishDraft(createDraft(false, experimentPool));
    if (!state.complete) throw new Error(`FIT v2 audit draft ${draft} did not complete.`);
    const draftRows = state.teams.map((team) => {
      const rotated = { ...team, rotation: autoAssignRotation(team.roster) };
      const v1 = fitScore(rotated).score;
      const v2 = fitV2ShadowScore(rotated);
      return {
        draft,
        team: team.id,
        fitV1: v1,
        fitV2: v2.score,
        creation: v2.components.creationStructure,
        spacingCompatibility: v2.components.spacingCompatibility,
        defensiveRoles: v2.components.defensiveRoleCoverage,
        rebounding: v2.components.reboundingBalance,
        size: v2.components.sizeCoverage,
        v1Rank: 0,
        v2Rank: 0,
      };
    });
    [...draftRows]
      .sort((a, b) => b.fitV1 - a.fitV1)
      .forEach((row, index) => { row.v1Rank = index + 1; });
    [...draftRows]
      .sort((a, b) => b.fitV2 - a.fitV2)
      .forEach((row, index) => { row.v2Rank = index + 1; });
    rows.push(...draftRows);
  }
} finally {
  Math.random = originalRandom;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const stddev = (values: number[]) => {
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
};
function pearson(left: number[], right: number[]): number {
  const leftMean = mean(left);
  const rightMean = mean(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0) *
      right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0),
  );
  return denominator === 0 ? 0 : numerator / denominator;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

mkdirSync('reports', { recursive: true });
const headers = ['draft', 'team', 'fit_v1', 'fit_v2_shadow', 'creation', 'spacing_compatibility', 'defensive_roles', 'rebounding', 'size', 'v1_rank', 'v2_rank', 'rank_delta'];
writeFileSync(
  'reports/fit-v2-shadow-30-seeds.csv',
  [headers, ...rows.map((row) => [
    row.draft,
    row.team,
    row.fitV1,
    row.fitV2,
    row.creation,
    row.spacingCompatibility,
    row.defensiveRoles,
    row.rebounding,
    row.size,
    row.v1Rank,
    row.v2Rank,
    row.v2Rank - row.v1Rank,
  ])].map((row) => row.map(csvCell).join(',')).join('\n') + '\n',
);

console.log(`FIT shadow audit: ${DRAFTS} drafts / ${rows.length} identical seeded rosters.`);
console.log('metric\tmean\tstddev\tmin\tmax');
for (const [name, values] of [
  ['fit_v1', rows.map((row) => row.fitV1)],
  ['fit_v2_shadow', rows.map((row) => row.fitV2)],
  ['creation', rows.map((row) => row.creation)],
  ['spacing_compatibility', rows.map((row) => row.spacingCompatibility)],
  ['defensive_roles', rows.map((row) => row.defensiveRoles)],
  ['rebounding', rows.map((row) => row.rebounding)],
  ['size', rows.map((row) => row.size)],
] as const) {
  console.log(`${name}\t${mean(values).toFixed(1)}\t${stddev(values).toFixed(1)}\t${Math.min(...values)}\t${Math.max(...values)}`);
}
console.log(`v1_v2_pearson\t${pearson(rows.map((row) => row.fitV1), rows.map((row) => row.fitV2)).toFixed(3)}`);
console.log(`mean_absolute_rank_delta\t${mean(rows.map((row) => Math.abs(row.v2Rank - row.v1Rank))).toFixed(2)}`);
console.log('Wrote reports/fit-v2-shadow-30-seeds.csv');
