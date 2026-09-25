import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { resolveSourceName } from '../data/sourceNameResolver';
import { spanEndYears } from './era';
// .pool.json is bpm2.json trimmed to only players who ever appear in draftPool.json, same
// pattern as darkoLookup.ts/raptorLookup.ts/matchupDefenseLookup.ts's own trims.
import bpm2Data from '../data/awards/bpm2.pool.json';

/**
 * The user's own "BPM 2.0" model (`scripts/extractBpm2.ts`, 2026-08-05) — the first real source
 * in this project with near-full historical coverage (1951-52 through 2025-26), vs. DARKO/RAPTOR
 * (both effectively 1997-98+ in this codebase — RAPTOR's source data nominally reaches 1977, but
 * `raptor.json` was deliberately restricted to `season >= 1998`, see darkoCorrection.ts's own Bug
 * 1 note) and matchup defense (2017-18+).
 *
 * **Deliberately used ONLY as a last-resort fallback, never blended with the three existing
 * sources** — per the user's own explicit call ("użyjmy BPM tam gdzie nie mamy żadnych statystyk,
 * a obecny model niech zostanie tam gdzie jest"). Validated first (see alltime-draft-game-project
 * memory): population-wide, BPM2's `dbpm` reads systematically LOWER than both RAPTOR and DARKO
 * for rim-protecting bigs (mean delta vs RAPTOR: PG +0.17 ... C -0.91, a clean position gradient)
 * and slightly higher for guards — a real, confirmed property of BPM2's own model, not noise.
 * Blending it in wherever DARKO/RAPTOR/matchup already have coverage would quietly re-introduce
 * exactly the kind of single-uncorroborated-source risk the RAPTOR/matchup additions were built
 * to protect against. Restricting it to spans NONE of the other three cover (in practice, the
 * pre-1997-98 population plus scattered post-1998 spans a specific player's own DARKO/RAPTOR rows
 * don't reach) means it can only ever ADD a real number where today there is none at all — see `blendedExcess` in
 * `darkoCorrection.ts` for the actual gate.
 *
 * Confidence/data_status are retained in the extracted rows rather than filtered out. Total BPM
 * is separately validated against independent PIPM/APM (`scripts/validateBpm2Total.ts`) and is
 * fallback-only in `blendedRealValueLookup.ts`, just as DBPM is fallback-only for defense.
 */
interface Bpm2Row {
  name: string;
  season: string; // "2003-04"
  dbpm: number;
  bpm: number;
}
const bpm2 = bpm2Data as Bpm2Row[];

export function buildBpm2YearMap(field: 'dbpm' | 'bpm' = 'dbpm'): Map<string, Map<number, number>> {
  const byNameYear = new Map<string, Map<number, number>>();
  for (const r of bpm2) {
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    const key = resolveSourceName(r.name, endYear);
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r[field]);
  }
  return byNameYear;
}

/** Averages whichever of a span's covered years the map actually has data for. Returns null if
 * there's no overlap at all. */
export function avgBpm2DefenseForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Same span-average operation for a map built with `buildBpm2YearMap('bpm')`. */
export function avgBpm2TotalForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  return avgBpm2DefenseForSpan(span, byNameYear);
}
