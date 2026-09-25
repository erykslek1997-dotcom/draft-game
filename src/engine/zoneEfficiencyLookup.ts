import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import { applySourceNameAliases } from '../data/sourceNameAliases';
import zoneData from '../data/awards/zoneEfficiency.json';

/**
 * Shared name/season matching against the zone-efficiency export (`scripts/buildZoneEfficiency.ts`),
 * same shape as `darkoLookup.ts`. Feeds `offensiveProfile.ts` only — this file has no opinion
 * about talent, portability, or anything else that reaches `computeTalent`.
 */
interface ZoneRow {
  name: string;
  season: string; // "2013-14"
  rimFgm: number;
  rimFga: number;
  midFgm: number;
  midFga: number;
  threeFgm: number;
  threeFga: number;
}
const zone = zoneData as ZoneRow[];

export function buildZoneYearMap(): Map<string, Map<number, ZoneRow>> {
  const byNameYear = new Map<string, Map<number, ZoneRow>>();
  for (const r of zone) {
    const key = normalizePlayerName(r.name);
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r);
  }
  applySourceNameAliases(byNameYear);
  return byNameYear;
}

export interface ZoneTotals {
  rimFgm: number;
  rimFga: number;
  midFgm: number;
  midFga: number;
  threeFgm: number;
  threeFga: number;
}

/**
 * Sums raw makes/attempts across whichever of a span's covered years the export has, rather than
 * averaging per-year rates — a span mixing a 79-game season with a 12-game one shouldn't weight
 * them equally, and summing counts before deriving any rate/share handles that for free (same
 * reasoning as `measuredSelfCreationForSpan`'s makes-weighting, one step simpler since the raw
 * counts are already additive). Returns null if there's no overlap at all (pre-1996-97 spans,
 * the large majority of the pool, or a player the export never covered).
 */
export function zoneTotalsForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, ZoneRow>>): ZoneTotals | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const rows = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((r): r is ZoneRow => r !== undefined);
  if (rows.length === 0) return null;
  return rows.reduce(
    (sum, r) => ({
      rimFgm: sum.rimFgm + r.rimFgm,
      rimFga: sum.rimFga + r.rimFga,
      midFgm: sum.midFgm + r.midFgm,
      midFga: sum.midFga + r.midFga,
      threeFgm: sum.threeFgm + r.threeFgm,
      threeFga: sum.threeFga + r.threeFga,
    }),
    { rimFgm: 0, rimFga: 0, midFgm: 0, midFga: 0, threeFgm: 0, threeFga: 0 },
  );
}
