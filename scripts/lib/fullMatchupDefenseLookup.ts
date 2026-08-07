// Calibration-only mirror of src/engine/matchupDefenseLookup.ts, reading the FULL (untrimmed)
// matchupDefense.json instead of the production matchupDefense.pool.json — same reasoning as
// fullDarkoLookup.ts/fullRaptorLookup.ts. Logic copied verbatim, not re-derived.
import type { PlayerSpan } from '../../src/data/schema';
import { normalizePlayerName } from '../../src/data/schema';
import { spanEndYears } from '../../src/engine/era';
import matchupDefenseData from '../../src/data/awards/matchupDefense.json';

interface MatchupDefenseRow {
  name: string;
  season: string;
  matchupDefense: number;
}
const matchupDefense = matchupDefenseData as MatchupDefenseRow[];

export function buildFullMatchupDefenseYearMap(): Map<string, Map<number, number>> {
  const byNameYear = new Map<string, Map<number, number>>();
  for (const r of matchupDefense) {
    const key = normalizePlayerName(r.name);
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r.matchupDefense);
  }
  return byNameYear;
}

export function avgFullMatchupDefenseForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
