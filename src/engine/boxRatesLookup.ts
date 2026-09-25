import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import { applySourceNameAliases } from '../data/sourceNameAliases';
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
  applySourceNameAliases(byNameYear);
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
 * 2026-09-25, found auditing pre-1997 rim pressure: the export's FGA column is corrupt in much of
 * its early data — about 90% of 1950-54 rows, a third of 1960-64, ~6% of 1965-69, near-none after
 * (Oscar Robertson 1960-61 reads 1194 FGA for a real ~1600, Jerry West 791 for 1264, Bailey Howell
 * 1959-60 fewer attempts than makes). FTA, FGM and points are right. A row whose implied FG% is
 * impossible (over 60%, or more makes than attempts) — or too small to judge — isn't trusted for
 * FGA. The 60% bar spares every real season in the export after 1980 but for a handful of centers.
 */
function hasPlausibleFga(r: BoxRateRow): boolean {
  if (r.fga <= 0) return r.fgm <= 0;
  return r.fgm / r.fga <= 0.6;
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
  // A corrupt FGA (see `hasPlausibleFga`) would inflate FTA/FGA — fall back to the pool's own
  // verified per-game FGA for the span (Oscar 1960-62: 22.7, matching the real record).
  const ftaPerGame = sum.fta / sum.g;
  const ftRate = rows.every(hasPlausibleFga) ? sum.fta / Math.max(1, sum.fga) : ftaPerGame / Math.max(1, span.fga);
  return {
    games: sum.g,
    ftRate,
    ftaPerGame,
    orebPerGame: sum.oreb / sum.g,
    drebPerGame: sum.dreb / sum.g,
    orebReliable: rows.every((r) => r.orebOk === 1),
  };
}

const SHARED_MAP = buildBoxRatesYearMap();

/**
 * 2026-09-25: league free-throw environment per season (FTA/FGA), for comparing free-throw volume
 * across eras — the early 1960s drew ~0.39 free throws per shot, the 1990s ~0.32, today ~0.25.
 * Built only from rows with a plausible FGA (`hasPlausibleFga`) and at least 50 attempts; a season
 * with fewer than 20 such rows (everything before ~1956) borrows the nearest season that has them.
 * Checked against the real league record: 1961-62 reads 0.379 (real 0.39), 1964-65 0.377.
 */
const LEAGUE_FT_RATE_BY_END_YEAR = (() => {
  const totals = new Map<number, { fta: number; fga: number; rows: number }>();
  for (const r of boxRates) {
    if (r.fga < 50 || !hasPlausibleFga(r)) continue;
    const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
    const t = totals.get(endYear) ?? { fta: 0, fga: 0, rows: 0 };
    t.fta += r.fta;
    t.fga += r.fga;
    t.rows++;
    totals.set(endYear, t);
  }
  const reliable = [...totals].filter(([, t]) => t.rows >= 20).sort((a, b) => a[0] - b[0]);
  const rateOf = (t: { fta: number; fga: number }) => t.fta / t.fga;
  const out = new Map<number, number>();
  const last = reliable[reliable.length - 1][0];
  for (let y = 1946; y <= last; y++) {
    const own = totals.get(y);
    if (own && own.rows >= 20) out.set(y, rateOf(own));
    else {
      const nearest = reliable.reduce((best, cur) => (Math.abs(cur[0] - y) < Math.abs(best[0] - y) ? cur : best));
      out.set(y, rateOf(nearest[1]));
    }
  }
  return out;
})();

/** Average league FTA/FGA over a span's seasons (0.29, the 1997+ norm, where a season is missing). */
export function leagueFtRateForSpan(span: PlayerSpan): number {
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) return 0.29;
  return years.reduce((sum, y) => sum + (LEAGUE_FT_RATE_BY_END_YEAR.get(y) ?? 0.29), 0) / years.length;
}
