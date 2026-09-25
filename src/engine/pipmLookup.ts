import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { resolveSourceName } from '../data/sourceNameResolver';
import { spanEndYears } from './era';
// .pool.json is pipm.json trimmed to only players who ever appear in draftPool.json, same
// pattern as darkoLookup.ts/historicalApmLookup.ts's own trims. Calibration scripts that need
// the FULL historical population import the untrimmed pipm.json directly.
import pipmData from '../data/awards/pipm.pool.json';

/**
 * Real season-level Player Impact Plus-Minus (Jacob Goldstein, basketball-index.com;
 * `scripts/extractPipm.py` from the user's "PIPM Player Finder through 2021 - Database.csv"),
 * 1973-74 through 2020-21 — an independent methodology from the Ben Taylor/backpicks source
 * behind `historicalApm.json`, not a duplicate of it.
 *
 * Added specifically because it fills the exact coverage gaps `historicalApmLookup.ts`'s own
 * docstring documents: Larry Bird/Kareem Abdul-Jabbar/Kevin McHale have ZERO historicalApm rows
 * (this source has their full careers, including primes), Magic Johnson's historicalApm coverage
 * is only his 1995-96 comeback (this source has 1979-91), and Robert Parish/Isiah Thomas/
 * Dominique Wilkins only have historicalApm rows for late-career decline seasons (this source
 * covers their primes too).
 *
 * Cross-validated before trusting it: 9,904 player-seasons overlap with historicalApm.json,
 * Pearson r = 0.736 — sane agreement between two independent real-data methodologies (not
 * suspiciously ~1.0, which would suggest they're secretly the same underlying source; not low
 * enough to distrust either). The largest disagreements are all single-season role-player
 * readings (Terry Mills, Greg Minor, Darvin Ham), exactly where any two plus-minus models are
 * expected to diverge most — no star-player sign flips that would suggest a name/season
 * mismatch bug.
 *
 * Two data-quality issues in the raw export, both handled in the extraction script rather than
 * here: 71 (player, season) groups were exact byte-identical duplicate rows (dropped to one),
 * and 4 were genuine multi-team-split seasons (averaged, weighted by minutes played).
 *
 * Mirrors darkoLookup.ts/historicalApmLookup.ts's name/season matching so
 * `blendedRealValueLookup.ts` can fold this in as a third source without a different matching
 * strategy per source.
 */
interface PipmRow {
  name: string;
  season: string; // "1996-97"
  pipm: number;
}
const pipm = pipmData as PipmRow[];

export function buildPipmYearMap(): Map<string, Map<number, number>> {
  const byNameYear = new Map<string, Map<number, number>>();
  for (const r of pipm) {
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    const key = resolveSourceName(r.name, endYear);
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r.pipm);
  }
  return byNameYear;
}

/** Averages whichever of a span's covered years the map actually has data for. Returns null
 * if there's no overlap at all. */
export function avgPipmForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
