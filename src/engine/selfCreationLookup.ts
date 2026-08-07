import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import selfCreationData from '../data/awards/selfCreation.json';

/**
 * Measured self-creation, from the user's 2026-07-30 full-history export
 * (`PlayerStatisticsExtended.csv` -> `scripts/`-external python build). The share of a player's
 * MADE shots that were unassisted, per season, play-by-play era only (1996-97+).
 *
 * This is the measurement `spacing.ts`'s `selfCreationRate` currently proxies with
 * `archetype weight x usage ramp`. The proxy correlates with it at only r=0.57, so most of this
 * signal is information the archetype tag doesn't carry. Split-half reliability by season parity
 * is r=0.933 for the 3-point rate and r=0.962 for all field goals (n=798), which is why it's
 * safe to build on at all — the same test that got WOWYR rejected as a correction source.
 *
 * Rates are makes-weighted, never minutes-weighted: these are rates *over made baskets*, so a
 * 40-game season with 90 makes should outweigh a 40-game season with 30.
 */
interface SelfCreationRow {
  name: string;
  season: string; // "2015-16"
  unassisted3Pt: number | null;
  unassisted2Pt: number | null;
  unassistedFg: number | null;
  threePointersMade: number;
  fieldGoalsMade: number;
}
const rows = selfCreationData as SelfCreationRow[];

/**
 * A rate over a handful of makes is noise, not a shot profile — one unassisted three in a season
 * reads as 1.000 self-created. Spans below the floor are treated as uncovered and fall back to
 * the archetype proxy rather than being scored on a fabricated rate.
 */
export const MIN_THREES_MADE_FOR_RATE = 25;
export const MIN_FIELD_GOALS_MADE_FOR_RATE = 100;

export type SelfCreationField = 'unassisted3Pt' | 'unassisted2Pt' | 'unassistedFg';

interface YearEntry {
  rate: number;
  weight: number;
}

/** name -> season end year -> {rate, makes} for one field. */
export function buildSelfCreationYearMap(field: SelfCreationField): Map<string, Map<number, YearEntry>> {
  const minMakes = field === 'unassisted3Pt' ? MIN_THREES_MADE_FOR_RATE : MIN_FIELD_GOALS_MADE_FOR_RATE;
  const byNameYear = new Map<string, Map<number, YearEntry>>();
  for (const r of rows) {
    const rate = r[field];
    if (rate === null) continue;
    const weight = field === 'unassisted3Pt' ? r.threePointersMade : r.fieldGoalsMade;
    if (weight < minMakes) continue;
    const key = normalizePlayerName(r.name);
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, { rate, weight });
  }
  return byNameYear;
}

/**
 * Makes-weighted average over whichever of a span's seasons the export actually covers. Returns
 * null when there's no overlap — a pre-1997 span, a player never tracked, or one who never made
 * enough shots for the rate to mean anything. Same contract as `avgDarkoFieldForSpan`.
 */
export function measuredSelfCreationForSpan(
  span: PlayerSpan,
  byNameYear: Map<string, Map<number, YearEntry>>,
): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const entries = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((e): e is YearEntry => e !== undefined);
  if (entries.length === 0) return null;
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight <= 0) return null;
  return entries.reduce((sum, e) => sum + e.rate * e.weight, 0) / totalWeight;
}
