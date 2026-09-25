import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { resolveSourceName } from '../data/sourceNameResolver';
import { spanEndYears } from './era';
// .pool.json is raptor.json trimmed to only players who ever appear in draftPool.json, same
// pattern as darkoLookup.ts/historicalApmLookup.ts/pipmLookup.ts's own trims. Calibration scripts
// that need the FULL historical population import the untrimmed raptor.json directly.
import raptorData from '../data/awards/raptor.pool.json';

/**
 * Real season-level RAPTOR defense (FiveThirtyEight; `scripts/extractRaptor.py` from the user's
 * "historical_RAPTOR_by_player.csv" export), 1976-77 through 2021-22 — a second, independent
 * real defensive plus-minus estimate from a different methodology than DARKO's, added 2026-07-31
 * specifically to blend with DARKO's ddpm (see `blendedDefenseLookup.ts`) rather than relying on
 * DARKO alone for the defense correction.
 *
 * Filtered at extraction time to `mp >= 500` — unfiltered single-season RAPTOR readings for tiny
 * samples are wild (confirmed: -43 to +62 raw, vs a sane -6 to +8 once filtered), so a row for a
 * partial/garbage-time season isn't trustworthy on its own even where it technically exists.
 *
 * Mirrors darkoLookup.ts/historicalApmLookup.ts/pipmLookup.ts's name/season matching so
 * `blendedDefenseLookup.ts` can fold this in without a different matching strategy per source.
 */
interface RaptorRow {
  name: string;
  season: string; // "1996-97"
  raptorDefense: number;
}
const raptor = raptorData as RaptorRow[];

export function buildRaptorYearMap(): Map<string, Map<number, number>> {
  const byNameYear = new Map<string, Map<number, number>>();
  for (const r of raptor) {
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    const key = resolveSourceName(r.name, endYear);
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r.raptorDefense);
  }
  return byNameYear;
}

/** Averages whichever of a span's covered years the map actually has data for. Returns null
 * if there's no overlap at all. */
export function avgRaptorDefenseForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
