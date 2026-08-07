// Calibration-only mirror of src/engine/bpm2Lookup.ts, reading the FULL (untrimmed) bpm2.json
// instead of the production bpm2.pool.json — same reasoning as fullDarkoLookup.ts/
// fullRaptorLookup.ts/fullMatchupDefenseLookup.ts. Logic copied verbatim, not re-derived.
import type { PlayerSpan } from '../../src/data/schema';
import { normalizePlayerName } from '../../src/data/schema';
import { spanEndYears } from '../../src/engine/era';
import bpm2Data from '../../src/data/awards/bpm2.json';

interface Bpm2Row {
  name: string;
  season: string;
  dbpm: number;
}
const bpm2 = bpm2Data as Bpm2Row[];

export function buildFullBpm2YearMap(): Map<string, Map<number, number>> {
  const byNameYear = new Map<string, Map<number, number>>();
  for (const r of bpm2) {
    const key = normalizePlayerName(r.name);
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r.dbpm);
  }
  return byNameYear;
}

export function avgFullBpm2DefenseForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
