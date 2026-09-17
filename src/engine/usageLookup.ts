import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import usageData from '../data/awards/usage.json';
import { spanEndYears } from './era';

interface UsageRow {
  name: string;
  season: string;
  games: number;
  mpg: number;
  usgPct: number | null;
  assistedFgPct: number | null;
}

export interface UsageSpanValue {
  /** 0-1 real usage rate, minutes-weighted across the span's covered seasons. */
  usgPct: number;
  /** 0-1 share of made field goals that were assisted — low means real self-creation. */
  assistedFgPct: number;
  games: number;
  seasons: number;
}

const rows = usageData as UsageRow[];
const byNameYear = new Map<string, Map<number, UsageRow>>();

for (const row of rows) {
  const name = normalizePlayerName(row.name);
  // row.season is "YYYY-YY" in START-year form (e.g. "2005-06"); spanEndYears works in END-year
  // form (e.g. spanLabel "2005-07" -> [2006, 2007]) — convert once here so lookups below are a
  // plain year-keyed map, matching playoffBpm2Lookup.ts's own convention.
  const startYear = Number(row.season.slice(0, 4));
  if (!Number.isFinite(startYear)) continue;
  const endYear = startYear + 1;
  const yearMap = byNameYear.get(name) ?? new Map<number, UsageRow>();
  yearMap.set(endYear, row);
  byNameYear.set(name, yearMap);
}

/**
 * Real minutes-weighted usage% and assisted-FG% for a draft span, from
 * `PlayerStatisticsExtended.csv` (1996-2026 coverage only — see [[usg_possession_cap_plan]]).
 * Returns null for any span with no covered season (all pre-1996 spans, and any post-1996 span
 * this source's ~97% usagePercentage fill rate happened to miss) — callers must fall back to a
 * proxy signal for those.
 */
export function usageForSpan(span: PlayerSpan): UsageSpanValue | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const matched = spanEndYears(span.spanLabel)
    .map((year) => yearMap.get(year))
    .filter((row): row is UsageRow => row !== undefined);
  if (matched.length === 0) return null;

  const usgRows = matched.filter((row) => row.usgPct !== null);
  const totalUsgMinutes = usgRows.reduce((sum, row) => sum + row.mpg * row.games, 0);
  if (totalUsgMinutes <= 0) return null;
  const usgPct = usgRows.reduce((sum, row) => sum + row.usgPct! * row.mpg * row.games, 0) / totalUsgMinutes;

  const assistedRows = matched.filter((row) => row.assistedFgPct !== null);
  const totalAssistedGames = assistedRows.reduce((sum, row) => sum + row.games, 0);
  const assistedFgPct =
    totalAssistedGames > 0
      ? assistedRows.reduce((sum, row) => sum + row.assistedFgPct! * row.games, 0) / totalAssistedGames
      : 0.5; // neutral fallback if a matched season somehow has usage but no assisted-FG data

  return {
    usgPct,
    assistedFgPct,
    games: matched.reduce((sum, row) => sum + row.games, 0),
    seasons: matched.length,
  };
}
