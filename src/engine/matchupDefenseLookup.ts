import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
// .pool.json is matchupDefense.json trimmed to only players who ever appear in draftPool.json,
// same pattern as darkoLookup.ts/raptorLookup.ts/pipmLookup.ts's own trims.
import matchupDefenseData from '../data/awards/matchupDefense.pool.json';

/**
 * Real season-level defensive matchup data (`scripts/extractMatchupDefense.py`, from the user's
 * "a lot of data" NBA tracking export's `matchups_YYYY.csv` files), 2017-18 through 2024-25 —
 * a THIRD, structurally different real defensive signal alongside DARKO's ddpm and RAPTOR's
 * plus-minus estimates: this one is direct player-vs-player matchup shooting data (who guarded
 * whom, and what FG% did the offensive player shoot against that specific defender), not a
 * team-level plus-minus regression. Added 2026-08-03.
 *
 * `matchupDefense` value is (league-average matchup FG% that season - the player's own matchup
 * FG% allowed as defender) * 100, so positive means real, direct evidence of suppressing
 * opponent shooting below league average — same sign convention as ddpm/raptorDefense (positive
 * = good). Gated at >=150 matchup FGA faced in a season at extraction time, so every row here
 * already cleared a real-sample floor.
 *
 * Coverage is modern-only (2017-18+) — RAPTOR and DARKO both reach back further, so this source
 * will simply have no data for older spans, same as RAPTOR has none pre-1997-98.
 *
 * Mirrors darkoLookup.ts/raptorLookup.ts/pipmLookup.ts's name/season matching exactly, so
 * `blendedDefenseLookup.ts` folds this in with the same matching strategy per source.
 */
interface MatchupDefenseRow {
  name: string;
  season: string; // "2017-18"
  matchupDefense: number;
}
const matchupDefense = matchupDefenseData as MatchupDefenseRow[];

export function buildMatchupDefenseYearMap(): Map<string, Map<number, number>> {
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

/** Averages whichever of a span's covered years the map actually has data for. Returns null
 * if there's no overlap at all. */
export function avgMatchupDefenseForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
