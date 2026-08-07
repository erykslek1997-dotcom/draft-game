// Calibration-only mirror of src/engine/darkoLookup.ts, reading the FULL (untrimmed) darko.json
// instead of the production darko.pool.json — scripts that need to regress/validate against the
// whole historical DARKO population (not just the current draft pool) must use this, not the
// production lookup. See darko.pool.json's own comment in darkoLookup.ts for why the split
// exists. Logic copied verbatim from darkoLookup.ts, not re-derived.
import type { PlayerSpan } from '../../src/data/schema';
import { normalizePlayerName } from '../../src/data/schema';
import { spanEndYears } from '../../src/engine/era';
import darkoData from '../../src/data/awards/darko.json';

interface DarkoRow {
  name: string;
  season: string;
  dpm: number;
  ddpm: number;
}
const darko = darkoData as DarkoRow[];

export function buildFullDarkoYearMap(field: 'dpm' | 'ddpm'): Map<string, Map<number, number>> {
  const byNameYear = new Map<string, Map<number, number>>();
  for (const r of darko) {
    const key = normalizePlayerName(r.name);
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r[field]);
  }
  return byNameYear;
}

export function avgFullDarkoFieldForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
