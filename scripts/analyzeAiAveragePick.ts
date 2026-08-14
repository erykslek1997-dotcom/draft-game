/** Runs seeded drafts under the active experiment profile and exports average pick order.
 *
 * `activeDraftPool` is the full real player database -- real gameplay (Commissioner Mode
 * included) always drafts from it. This script is the one place that still restricts drafts to
 * the 216-name AI-calibration allowlist, gated by `DRAFT_EXPERIMENT.pruneToObservedAiPool` so the
 * flag keeps its original meaning without shrinking the pool everywhere else. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { DRAFT_EXPERIMENT } from '../src/engine/draftExperiment';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import aiTestPoolNamesJson from '../src/data/aiTestPoolNames.json';

const DRAFTS = 30;
const GLUE_FGA_CEILING = 2;
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

interface PickRow {
  draft: number;
  pick: number;
  teamId: string;
  player: string;
  normalizedName: string;
  span: string;
  position: string;
  talent: number;
  fga: number;
}

const byId = new Map(experimentPool.map((span) => [span.id, span]));
const picks: PickRow[] = [];
const originalRandom = Math.random;

try {
  for (let draftNumber = 1; draftNumber <= DRAFTS; draftNumber++) {
    Math.random = seededRandom(40_000 + draftNumber);
    const state = autoFinishDraft(createDraft(false, experimentPool));
    if (!state.complete) throw new Error(`Draft ${draftNumber} did not complete.`);
    for (const entry of state.history) {
      const span = byId.get(entry.playerId);
      if (!span) throw new Error(`Missing active-pool span ${entry.playerId}.`);
      picks.push({
        draft: draftNumber,
        pick: entry.pickNumber,
        teamId: entry.teamId,
        player: span.playerName,
        normalizedName: normalizePlayerName(span.playerName),
        span: span.spanLabel,
        position: span.primaryPosition,
        talent: computeTalent(span),
        fga: span.fga,
      });
    }
  }
} finally {
  Math.random = originalRandom;
}

const activeNames = aiTestPoolNamesJson as string[];
const glueNames = new Set(
  experimentPool
    .filter((span) => span.fga < GLUE_FGA_CEILING)
    .map((span) => normalizePlayerName(span.playerName)),
);

const ranking = activeNames.map((normalizedName) => {
  const rows = picks.filter((pick) => pick.normalizedName === normalizedName);
  const displayName = rows[0]?.player ?? activeDraftPool.find((span) => normalizePlayerName(span.playerName) === normalizedName)?.playerName ?? normalizedName;
  const spanCounts = new Map<string, number>();
  for (const row of rows) spanCounts.set(row.span, (spanCounts.get(row.span) ?? 0) + 1);
  const mostCommonSpan = [...spanCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  return {
    player: displayName,
    normalizedName,
    averagePick: rows.length ? sum(rows.map((row) => row.pick)) / rows.length : null,
    selections: rows.length,
    draftRate: rows.length / DRAFTS,
    earliestPick: rows.length ? Math.min(...rows.map((row) => row.pick)) : null,
    latestPick: rows.length ? Math.max(...rows.map((row) => row.pick)) : null,
    mostCommonSpan,
    averageTalent: rows.length ? sum(rows.map((row) => row.talent)) / rows.length : null,
    averageFga: rows.length ? sum(rows.map((row) => row.fga)) / rows.length : null,
    retainedAsGlue: glueNames.has(normalizedName),
  };
});

ranking.sort((a, b) => {
  if (a.averagePick === null && b.averagePick === null) return a.player.localeCompare(b.player);
  if (a.averagePick === null) return 1;
  if (b.averagePick === null) return -1;
  return a.averagePick - b.averagePick || b.selections - a.selections || a.player.localeCompare(b.player);
});

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvHeaders = [
  'rank',
  'player',
  'average_pick',
  'selections',
  'draft_rate',
  'earliest_pick',
  'latest_pick',
  'most_common_span',
  'average_talent',
  'average_fga',
  'retained_as_fga_under_2_glue',
];
const csvRows = ranking.map((row, index) => [
  row.averagePick === null ? null : index + 1,
  row.player,
  row.averagePick === null ? null : row.averagePick.toFixed(2),
  row.selections,
  row.draftRate.toFixed(4),
  row.earliestPick,
  row.latestPick,
  row.mostCommonSpan,
  row.averageTalent === null ? null : row.averageTalent.toFixed(2),
  row.averageFga === null ? null : row.averageFga.toFixed(2),
  row.retainedAsGlue,
]);

mkdirSync('reports', { recursive: true });
writeFileSync(
  'reports/ai-average-pick.csv',
  [csvHeaders, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n',
);
writeFileSync(
  'reports/ai-average-pick.json',
  JSON.stringify(
    {
      drafts: DRAFTS,
      totalPicks: picks.length,
      activePlayers: activeNames.length,
      selectedPlayers: ranking.filter((row) => row.selections > 0).length,
      unselectedPlayers: ranking.filter((row) => row.selections === 0).length,
      glueFgaBelow: GLUE_FGA_CEILING,
      ranking,
      picks,
    },
    null,
    2,
  ) + '\n',
);

console.log(
  `Analyzed ${DRAFTS} drafts / ${picks.length} picks: ` +
    `${ranking.filter((row) => row.selections > 0).length} selected players, ` +
    `${ranking.filter((row) => row.selections === 0).length} never selected.`,
);
console.log('Top 20 by average pick:');
for (const [index, row] of ranking.slice(0, 20).entries()) {
  console.log(
    `${String(index + 1).padStart(2)}. ${row.player.padEnd(26)} avg=${row.averagePick?.toFixed(1)} ` +
      `selected=${row.selections}/${DRAFTS}`,
  );
}
