/** Runs seeded drafts against the REAL, full draft pool (`activeDraftPool` — the same pool actual
 * gameplay, Commissioner Mode included, always drafts from) and exports average pick order for
 * every player. Unlike `analyzeAiAveragePick.ts`, this does NOT gate on
 * `DRAFT_EXPERIMENT.pruneToObservedAiPool` — that script's 216-name allowlist exists for a
 * narrower A/B calibration; this one is meant to answer "who does the AI actually draft, and
 * when, in a real game" for the whole ~573-player pool.
 *
 * 2026-08-13, user's own ask: "do as many drafts in the background as you think is right, I need
 * a list of who's picked when." One full-pool draft measured at ~30s (vs the pruned pool's much
 * faster runs — the larger candidate pool costs more per pick), so this is a genuinely
 * long-running background job. Checkpoints every 10 drafts (overwrites the same output files) so
 * a partial run is still inspectable, and so a crash mid-run doesn't lose everything.
 *
 * DRAFTS defaults to 100 — with 144 picks/draft against ~573 players (~25% of the pool drafted
 * per run), that gives most of the pool multiple appearances without the ~50-minute-plus runtime
 * of going much higher; override with `DRAFTS=N tsx scripts/analyzeFullPoolAveragePick.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import { players } from '../src/data/players';

const DRAFTS = Number(process.env.DRAFTS ?? 100);
const SEED_BASE = Number(process.env.SEED_BASE ?? 90_000);

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
  round: number;
  teamId: string;
  player: string;
  normalizedName: string;
  span: string;
  position: string;
  talent: number;
  fga: number;
}

const byId = new Map(activeDraftPool.map((span) => [span.id, span]));
const picks: PickRow[] = [];
const originalRandom = Math.random;

// Every distinct player name in the pool, so a never-drafted player still gets a row (0
// selections) instead of silently vanishing from the report.
const allPlayerNames = [...new Set(players.map((span) => span.playerName))].sort((a, b) => a.localeCompare(b));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function writeReports(draftsCompleted: number) {
  const ranking = allPlayerNames.map((displayName) => {
    const normalizedName = normalizePlayerName(displayName);
    const rows = picks.filter((pick) => pick.normalizedName === normalizedName);
    const spanCounts = new Map<string, number>();
    for (const row of rows) spanCounts.set(row.span, (spanCounts.get(row.span) ?? 0) + 1);
    const mostCommonSpan = [...spanCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    const pickNumbers = rows.map((row) => row.pick);
    return {
      player: displayName,
      normalizedName,
      averagePick: rows.length ? sum(pickNumbers) / rows.length : null,
      medianPick: rows.length ? median(pickNumbers) : null,
      selections: rows.length,
      draftRate: draftsCompleted ? rows.length / draftsCompleted : 0,
      earliestPick: rows.length ? Math.min(...pickNumbers) : null,
      latestPick: rows.length ? Math.max(...pickNumbers) : null,
      mostCommonSpan,
      averageTalent: rows.length ? sum(rows.map((row) => row.talent)) / rows.length : null,
      averageFga: rows.length ? sum(rows.map((row) => row.fga)) / rows.length : null,
      position: rows[0]?.position ?? '',
    };
  });

  ranking.sort((a, b) => {
    if (a.averagePick === null && b.averagePick === null) return a.player.localeCompare(b.player);
    if (a.averagePick === null) return 1;
    if (b.averagePick === null) return -1;
    return a.averagePick - b.averagePick || b.selections - a.selections || a.player.localeCompare(b.player);
  });

  function csvCell(value: string | number | null): string {
    if (value === null) return '';
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  const csvHeaders = [
    'rank', 'player', 'position', 'average_pick', 'median_pick', 'selections', 'draft_rate',
    'earliest_pick', 'latest_pick', 'most_common_span', 'average_talent', 'average_fga',
  ];
  const csvRows = ranking.map((row, index) => [
    row.averagePick === null ? null : index + 1,
    row.player,
    row.position,
    row.averagePick === null ? null : row.averagePick.toFixed(2),
    row.medianPick === null ? null : row.medianPick.toFixed(1),
    row.selections,
    row.draftRate.toFixed(4),
    row.earliestPick,
    row.latestPick,
    row.mostCommonSpan,
    row.averageTalent === null ? null : row.averageTalent.toFixed(2),
    row.averageFga === null ? null : row.averageFga.toFixed(2),
  ]);

  mkdirSync('reports', { recursive: true });
  writeFileSync(
    'reports/full-pool-average-pick.csv',
    [csvHeaders, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n',
  );
  writeFileSync(
    'reports/full-pool-average-pick.json',
    JSON.stringify(
      {
        draftsRequested: DRAFTS,
        draftsCompleted,
        totalPicks: picks.length,
        totalPlayers: allPlayerNames.length,
        selectedPlayers: ranking.filter((row) => row.selections > 0).length,
        neverSelected: ranking.filter((row) => row.selections === 0).map((row) => row.player),
        ranking,
      },
      null,
      2,
    ) + '\n',
  );
}

try {
  for (let draftNumber = 1; draftNumber <= DRAFTS; draftNumber++) {
    const t0 = Date.now();
    Math.random = seededRandom(SEED_BASE + draftNumber);
    const state = autoFinishDraft(createDraft(false, activeDraftPool));
    if (!state.complete) throw new Error(`Draft ${draftNumber} did not complete.`);
    for (const entry of state.history) {
      const span = byId.get(entry.playerId);
      if (!span) throw new Error(`Missing active-pool span ${entry.playerId}.`);
      picks.push({
        draft: draftNumber,
        pick: entry.pickNumber,
        round: Math.ceil(entry.pickNumber / 16),
        teamId: entry.teamId,
        player: span.playerName,
        normalizedName: normalizePlayerName(span.playerName),
        span: span.spanLabel,
        position: span.primaryPosition,
        talent: computeTalent(span),
        fga: span.fga,
      });
    }
    console.log(`draft ${draftNumber}/${DRAFTS} done in ${Date.now() - t0}ms`);
    if (draftNumber % 10 === 0 || draftNumber === DRAFTS) {
      writeReports(draftNumber);
      console.log(`checkpoint written after ${draftNumber} drafts`);
    }
  }
} finally {
  Math.random = originalRandom;
}

console.log(`Done: ${DRAFTS} drafts, ${picks.length} total picks.`);
