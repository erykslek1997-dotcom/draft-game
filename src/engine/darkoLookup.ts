import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { resolveSourceName } from '../data/sourceNameResolver';
import { spanEndYears } from './era';
// .pool.json is darko.json trimmed to only players who ever appear in draftPool.json
// (scripts/trimReferenceDataToPool.ts, 2026-07-30) — this is a pure per-span lookup at runtime
// (no population-level statistic built from it), so a row for a player nobody can ever draft is
// dead weight. Calibration scripts that need the FULL historical population (e.g.
// scripts/lib/matchedDarkoDefensePoints.ts) import the untrimmed darko.json directly instead of
// going through this file. Re-run the trim script after `buildDraftPool.ts` changes the pool.
import darkoData from '../data/awards/darko.pool.json';

/**
 * Shared name/season matching against the real DARKO dataset (1997-98+), factored out so
 * `darkoCorrection.ts` (defense-only, feeds computeTalent) and `impact.ts` (total plus-minus,
 * purely informational) don't each reimplement the same normalized-name + spanEndYears
 * averaging logic.
 */
interface DarkoRow {
  name: string;
  season: string; // "2003-04"
  dpm: number;
  ddpm: number;
}
const darko = darkoData as DarkoRow[];

export function buildDarkoYearMap(field: 'dpm' | 'ddpm'): Map<string, Map<number, number>> {
  const byNameYear = new Map<string, Map<number, number>>();
  for (const r of darko) {
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

/** Averages whichever of a span's covered years the map actually has data for. Returns null
 * if there's no overlap at all (pre-1997-98 spans, or players DARKO never tracked). */
export function avgDarkoFieldForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
