// Calibration-only mirror of src/engine/raptorLookup.ts, reading the FULL (untrimmed)
// raptor.json instead of the production raptor.pool.json — same reasoning as
// fullDarkoLookup.ts. Logic copied verbatim, not re-derived.
import type { PlayerSpan } from '../../src/data/schema';
import { normalizePlayerName } from '../../src/data/schema';
import { spanEndYears } from '../../src/engine/era';
import raptorData from '../../src/data/awards/raptor.json';

interface RaptorRow {
  name: string;
  season: string;
  raptorDefense: number;
}
const raptor = raptorData as RaptorRow[];

export function buildFullRaptorYearMap(): Map<string, Map<number, number>> {
  const byNameYear = new Map<string, Map<number, number>>();
  for (const r of raptor) {
    const key = normalizePlayerName(r.name);
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r.raptorDefense);
  }
  return byNameYear;
}

export function avgFullRaptorDefenseForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
