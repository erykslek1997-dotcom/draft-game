import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import playoffBpm2Data from '../data/awards/bpm2Playoffs.pool.json';
import { spanEndYears } from './era';

interface PlayoffBpm2Row {
  name: string;
  season: string;
  games: number;
  minutes: number;
  bpm: number;
  obpm: number;
  dbpm: number;
  bpmDeltaVsRs: number;
  confidence: string;
  dataStatus: string;
}

export interface PlayoffBpm2SpanValue {
  bpm: number;
  obpm: number;
  dbpm: number;
  bpmDeltaVsRs: number;
  games: number;
  minutes: number;
  seasons: number;
  /** Sample-size reliability (minutes) multiplied by disclosed source quality, 0..1. */
  reliability: number;
  dataStatuses: string[];
}

const rows = playoffBpm2Data as PlayoffBpm2Row[];
const byNameYear = new Map<string, Map<number, PlayoffBpm2Row>>();

for (const row of rows) {
  const name = normalizePlayerName(row.name);
  const endYear = Number(row.season.slice(0, 4)) + 1;
  const yearMap = byNameYear.get(name) ?? new Map<number, PlayoffBpm2Row>();
  yearMap.set(endYear, row);
  byNameYear.set(name, yearMap);
}

function confidenceWeight(confidence: string): number {
  if (confidence === 'high') return 1;
  if (confidence === 'medium') return 0.7;
  return 0.4;
}

function statusWeight(status: string): number {
  if (status === 'observed') return 1;
  if (status === 'observed_with_source_reconstruction') return 0.85;
  if (status === 'estimated_tov_only') return 0.65;
  return 0.4;
}

/**
 * Minutes-weighted postseason BPM for a real draft span. The source already enforces 5 games and
 * 100 minutes per player-season. Estimated historical rows are retained but contribute less to
 * both the aggregate and the disclosed reliability than observed rows.
 */
export function playoffBpm2ForSpan(span: PlayerSpan): PlayoffBpm2SpanValue | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const matched = spanEndYears(span.spanLabel)
    .map((year) => yearMap.get(year))
    .filter((row): row is PlayoffBpm2Row => row !== undefined);
  if (matched.length === 0) return null;

  const weightedRows = matched.map((row) => ({
    row,
    quality: confidenceWeight(row.confidence) * statusWeight(row.dataStatus),
  }));
  const effectiveMinutes = weightedRows.reduce((sum, entry) => sum + entry.row.minutes * entry.quality, 0);
  if (effectiveMinutes <= 0) return null;
  const average = (field: 'bpm' | 'obpm' | 'dbpm' | 'bpmDeltaVsRs') =>
    weightedRows.reduce((sum, entry) => sum + entry.row[field] * entry.row.minutes * entry.quality, 0) /
    effectiveMinutes;
  const minutes = matched.reduce((sum, row) => sum + row.minutes, 0);
  const games = matched.reduce((sum, row) => sum + row.games, 0);
  const sourceQuality = effectiveMinutes / Math.max(1, minutes);
  const sampleReliability = minutes / (minutes + 500);

  return {
    bpm: average('bpm'),
    obpm: average('obpm'),
    dbpm: average('dbpm'),
    bpmDeltaVsRs: average('bpmDeltaVsRs'),
    games,
    minutes,
    seasons: matched.length,
    reliability: Math.max(0, Math.min(1, sampleReliability * sourceQuality)),
    dataStatuses: [...new Set(matched.map((row) => row.dataStatus))].sort(),
  };
}

export function playoffBpm2CoverageRows(): readonly PlayoffBpm2Row[] {
  return rows;
}
