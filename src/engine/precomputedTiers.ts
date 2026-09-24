import type { PlayerSpan, Position } from '../data/schema';
import type { OverallTier, TierGateContext } from './grades';

/**
 * 2026-09-24, load-time work ("co z tym możemy zrobić" — the ~14s "Preparing players" wait on a
 * slow phone): the single most expensive thing the engine did at start-up was build every span's
 * `TierGateContext` (talent, O/D-TAL, spacing, playoff signal, real-value floor…) and its
 * `effectiveTalent`, for all ~9.5k spans, because `peakDraftPool`, `defensiveHuntability` and the
 * Draft tab's list each need them for the whole pool before anything can be shown.
 *
 * Production builds now compute those once, at build time (`scripts/buildPrecomputedTiers.ts`,
 * run by `npm run build` right before `vite build`, from the very same engine code), and ship the
 * results as `src/data/precomputedTiers.json`. `grades.effectiveTalent` and
 * `sixthMan.tierContextWithSixthMan` read from here first.
 *
 * Deliberately PRODUCTION-ONLY: the dev server, tests and every `scripts/` run always compute
 * live, so a stale file can never hide an engine change while working on it — and a production
 * build always regenerates the file first. The JSON is generated, not committed (see .gitignore).
 * A span missing from the table (not in `draftPool`) simply falls back to the live computation.
 */

/** Column order of each row in the generated JSON — keep in sync with the build script. */
export type PrecomputedTierRow = [
  id: string,
  position: Position,
  tal: number,
  otal: number,
  otalUncapped: number,
  dtal: number,
  playoffCollapse: number,
  spacing: number,
  apg: number,
  talWithoutEliteDefenseBonus: number,
  talWithoutBridge: number,
  realValueFloor: OverallTier | null,
  playoffValidatedAllNba: 0 | 1,
  isSixthMan: 0 | 1,
  effectiveTalent: number,
];

export function toPrecomputedRow(span: PlayerSpan, ctx: TierGateContext, effective: number): PrecomputedTierRow {
  return [
    span.id,
    ctx.position,
    ctx.tal,
    ctx.otal,
    ctx.otalUncapped ?? ctx.otal,
    ctx.dtal,
    ctx.playoffCollapse ?? 0,
    ctx.spacing ?? 0,
    ctx.apg ?? span.box.apg,
    ctx.talWithoutEliteDefenseBonus ?? ctx.tal,
    ctx.talWithoutBridge ?? ctx.tal,
    ctx.realValueFloor ?? null,
    ctx.playoffValidatedAllNba ? 1 : 0,
    ctx.isSixthMan ? 1 : 0,
    effective,
  ];
}

/** The whole generated file: per-span rows plus the two pool-wide S-grade cutoffs
 * (`grades.ts`'s `offensiveGrade`/`defensiveGrade`), which otherwise need O/D talent for every
 * span in the pool the first time any grade is shown. */
export interface PrecomputedTiersFile {
  rows: PrecomputedTierRow[];
  sThresholds: { offense: number; defense: number };
}

let rowsById: Map<string, PrecomputedTierRow> | null = null;
let sThresholds: PrecomputedTiersFile['sThresholds'] | null = null;

function loadRows(): Map<string, PrecomputedTierRow> {
  if (rowsById) return rowsById;
  rowsById = new Map();
  // `import.meta.env` is undefined under tsx (tests/scripts) — always live there.
  if (!import.meta.env?.PROD) return rowsById;
  let modules: Record<string, { default: PrecomputedTiersFile }> = {};
  try {
    // Vite replaces this call at build time with the file's contents (or `{}` if it's missing).
    modules = import.meta.glob<{ default: PrecomputedTiersFile }>('../data/precomputedTiers.json', { eager: true });
  } catch {
    modules = {};
  }
  for (const mod of Object.values(modules)) {
    for (const row of mod.default.rows) rowsById.set(row[0], row);
    sThresholds = mod.default.sThresholds;
  }
  return rowsById;
}

export function precomputedSThreshold(kind: 'offense' | 'defense'): number | null {
  loadRows();
  return sThresholds?.[kind] ?? null;
}

/** The build-time `TierGateContext` (sixth-man flag included) for this span, if there is one. */
export function precomputedTierContext(span: PlayerSpan): TierGateContext | null {
  const row = loadRows().get(span.id);
  return row ? contextFromRow(span, row) : null;
}

/** Row -> context. Exported so the build script can check the round trip against the live value. */
export function contextFromRow(span: PlayerSpan, row: PrecomputedTierRow): TierGateContext {
  return {
    position: row[1],
    tal: row[2],
    otal: row[3],
    otalUncapped: row[4],
    dtal: row[5],
    fga: span.fga,
    playerName: span.playerName,
    spanLabel: span.spanLabel,
    playoffCollapse: row[6],
    spacing: row[7],
    apg: row[8],
    talWithoutEliteDefenseBonus: row[9],
    talWithoutBridge: row[10],
    realValueFloor: row[11] ?? undefined,
    playoffValidatedAllNba: row[12] === 1,
    isSixthMan: row[13] === 1,
  };
}

export function precomputedEffectiveTalent(spanId: string): number | undefined {
  return loadRows().get(spanId)?.[14];
}
