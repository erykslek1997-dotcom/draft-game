import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { resolveSourceName } from '../data/sourceNameResolver';
import { spanEndYears } from './era';
// .pool.json is historicalApm.json trimmed to only players who ever appear in draftPool.json
// (scripts/trimReferenceDataToPool.ts, 2026-07-30) — pure per-span lookup at runtime, same
// reasoning as darkoLookup.ts's own trim. Calibration scripts that need the FULL historical
// population import the untrimmed historicalApm.json directly.
import historicalApmData from '../data/awards/historicalApm.pool.json';

/**
 * Real season-level Adjusted Plus-Minus, 1976-77 through 2016-17 (`scripts/extractHistoricalApm.py`
 * from the user's "Historical APM Grid.xlsx", sourced from backpicks.com/Ben Taylor — real RAPM
 * for 1997+, a regressed on-off/box "Augmented Plus-Minus" reconstruction from Harvey Pollack's
 * guides for 1977-1996). Unlike WOWYR (career-level, already found too noisy to correct against
 * in `validateAgainstWowyr.ts`), this is per-season and from the same authority the project
 * already trusts for `validateAgainstTaylorTop10.ts`/`validateAgainstBackpicksGoat.ts` — a real
 * candidate to extend past-1997 corrections back to 1977 instead of relying on WOWYR there.
 *
 * Known coverage gaps, confirmed by direct lookup before trusting this data for anything:
 * Larry Bird, Kareem Abdul-Jabbar, and Kevin McHale have ZERO rows in the source file; Magic
 * Johnson only has his 1995-96 comeback season; Robert Parish/Isiah Thomas/Dominique Wilkins
 * only have late-career decline seasons, not their primes. The 1992-93 season is missing
 * entirely (no player has a row for it) — the source sheet skips straight from 1991-92 to
 * 1993-94. Treat absence as "no data," never as "real value is zero."
 *
 * Mirrors darkoLookup.ts's name/season matching so any correction or informational display
 * built on this reuses the same normalized-name + spanEndYears averaging logic.
 */
interface HistoricalApmRow {
  name: string;
  season: string; // "1996-97"
  apm: number;
}
const historicalApm = historicalApmData as HistoricalApmRow[];

export function buildHistoricalApmYearMap(): Map<string, Map<number, number>> {
  const byNameYear = new Map<string, Map<number, number>>();
  for (const r of historicalApm) {
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    const key = resolveSourceName(r.name, endYear);
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r.apm);
  }
  return byNameYear;
}

/** Averages whichever of a span's covered years the map actually has data for. Returns null
 * if there's no overlap at all (players/seasons this source never tracked). */
export function avgHistoricalApmForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
