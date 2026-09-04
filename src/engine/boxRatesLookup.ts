import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import boxRatesData from '../data/awards/boxRates.json';

/**
 * Name/season matching against the per-game box export (`scripts/buildBoxRates.ts`,
 * `PlayerStatistics.csv` — user-supplied 2026-09-04), same shape as `zoneEfficiencyLookup.ts` /
 * `darkoLookup.ts`. Surfaces the two box fields the curated `BoxLine` never carried:
 *
 *  - **free-throw rate** (`ftRate = FTA / FGA`) — a foul-drawing / rim-pressure signal, reliable
 *    for the whole 1946-present history.
 *  - **offensive-rebounding rate** (`orebPerGame`) — reliable only from 1983-84 (the split is
 *    12-33% complete 1974-1982 in this source, absent before). `orebReliable` gates it; callers
 *    fall back to neutral otherwise, same contract as every other pre-tracking gap here.
 *
 * Feeds `fit.ts`'s team rim-pressure component. Does NOT feed `computeTalent` — `rimPressure.ts`'s
 * own span term is deliberately left on its existing box proxy so the Taylor/GOAT calibration is
 * untouched by this change.
 */
interface BoxRateRow {
  name: string;
  season: string; // "1999-00"
  g: number;
  fta: number;
  ftm: number;
  fga: number;
  fgm: number;
  threePA: number;
  pts: number;
  oreb: number;
  dreb: number;
  rebTot: number;
  orebOk: 0 | 1;
  tov: number;
}
const boxRates = boxRatesData as BoxRateRow[];

export function buildBoxRatesYearMap(): Map<string, Map<number, BoxRateRow>> {
  const byNameYear = new Map<string, Map<number, BoxRateRow>>();
  for (const r of boxRates) {
    const key = normalizePlayerName(r.name);
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    let yearMap = byNameYear.get(key);
    if (!yearMap) {
      yearMap = new Map();
      byNameYear.set(key, yearMap);
    }
    yearMap.set(endYear, r);
  }
  return byNameYear;
}

export interface SpanBoxRates {
  games: number;
  /** FTA / FGA across the span's covered years — how hard this player makes the defense foul. */
  ftRate: number;
  ftaPerGame: number;
  /** Only meaningful when `orebReliable`. */
  orebPerGame: number;
  drebPerGame: number;
  orebReliable: boolean;
}

/**
 * Sums raw counts across whichever of a span's covered years the export has (same makes-weighting
 * reasoning as `zoneTotalsForSpan`), then derives rates. Returns null when the export never
 * covered the player or none of the span's years overlap.
 */
export function boxRatesForSpan(
  span: PlayerSpan,
  byNameYear: Map<string, Map<number, BoxRateRow>> = SHARED_MAP,
): SpanBoxRates | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const rows = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((r): r is BoxRateRow => r !== undefined);
  if (rows.length === 0) return null;
  const sum = rows.reduce(
    (acc, r) => ({
      g: acc.g + r.g,
      fta: acc.fta + r.fta,
      fga: acc.fga + r.fga,
      oreb: acc.oreb + r.oreb,
      dreb: acc.dreb + r.dreb,
    }),
    { g: 0, fta: 0, fga: 0, oreb: 0, dreb: 0 },
  );
  if (sum.g === 0) return null;
  return {
    games: sum.g,
    ftRate: sum.fta / Math.max(1, sum.fga),
    ftaPerGame: sum.fta / sum.g,
    orebPerGame: sum.oreb / sum.g,
    drebPerGame: sum.dreb / sum.g,
    orebReliable: rows.every((r) => r.orebOk === 1),
  };
}

const SHARED_MAP = buildBoxRatesYearMap();
