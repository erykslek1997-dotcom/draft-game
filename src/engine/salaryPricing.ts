/**
 * SALARY-CAP MODE — per-span contract pricing.
 *
 * Every draftable span gets a **roster charge** in 2025-26 dollars: what it costs against a
 * $200M / 9-player roster budget. The idea is to price a season as if it happened today —
 * take the player's real salary, work out what share of that year's cap it was, and apply the
 * same share to the current $154,647,000 cap.
 *
 *   chargeForSeason(realSalary, year) = min( (realSalary / cap[year]) * 154_647_000 ,  max[YOS] )
 *
 * The clamp matters: in the flat-cap era (2003-2016) a long max contract with 8% raises grew to
 * ~48% of the frozen cap by year six, which * 154.6M would read as more than any real max
 * exists — so it's capped at the 2025-26 max for the player's years of service.
 *
 * Three cases:
 *   - **rookie**   first-round pick drafted 1995 or later (the rookie WAGE SCALE is a 1995-CBA
 *                  mechanism; it didn't exist before), first 4 seasons -> the 2025-26 rookie
 *                  scale for their slot, regardless of how good they were (this is where the
 *                  arbitrage lives). A pre-1995 top pick could sign a real, uncapped,
 *                  individually-negotiated rookie deal instead (Glenn Robinson, #1 in 1994,
 *                  10-yr/$68M) -- those fall through to **real** below like anyone else's.
 *   - **real**     otherwise, the scaled-and-clamped real salary.
 *   - **estimate** pre-1985 / a few name-alias misses -> a tier-based fallback.
 *
 * A span's charge is the mean of its seasons. Roster is legal at 9 players totalling <= $200M
 * with at most one `rookie`-method span.
 *
 * WORKING DRAFT — `salaries.json`'s `capByYear` is approximate before 2016, and years-of-service
 * is estimated from draft year where known, else from the player's own earliest span in the pool
 * (real but incomplete for a career that started before the pool's own coverage — see
 * earliestSpanStartYearByName's docstring). Not a shipped ruleset. See the project memory
 * `usg_possession_cap_plan.md` for the fuller design + the full list of caveats.
 */
import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { resolveSourceName } from '../data/sourceNameResolver';
import salaries from '../data/awards/salaries.json';
import draftHistory from '../data/awards/draftHistory.json';
import { draftPool } from '../data/draftPool';
import { overallTierForSpan, type OverallTier } from './grades';
import { tierContextWithSixthMan } from './sixthMan';

export const CAP_BASELINE = 154_647_000;
export const ROSTER_BUDGET = 200_000_000;
export const MAX_ROOKIE_CONTRACTS = 1;

const salaryByPlayerId = salaries.byPlayerId as Record<string, Record<string, number>>;
const salaryByName = salaries.byName as Record<string, Record<string, number>>;
const capByYear = salaries.capByYear as Record<string, number>;

/** 2025-26 max first-year salary by years of service (cbaguide.com/resources/amounts). */
function maxSalaryForYos(yos: number): number {
  if (yos >= 10) return 57_740_000;
  if (yos >= 7) return 49_490_000;
  return 41_240_000;
}

/** 2025-26 rookie-scale first-year salary (~120% of scale) by draft pick, interpolated. */
const ROOKIE_SCALE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [1, 13_800_000],
  [5, 9_000_000],
  [10, 5_900_000],
  [14, 4_600_000],
  [20, 3_300_000],
  [30, 2_500_000],
];
function rookieScaleSalary(pick: number): number {
  if (pick <= 1) return ROOKIE_SCALE_POINTS[0][1];
  if (pick >= 30) return ROOKIE_SCALE_POINTS[ROOKIE_SCALE_POINTS.length - 1][1];
  for (let i = 1; i < ROOKIE_SCALE_POINTS.length; i++) {
    if (pick <= ROOKIE_SCALE_POINTS[i][0]) {
      const [x0, y0] = ROOKIE_SCALE_POINTS[i - 1];
      const [x1, y1] = ROOKIE_SCALE_POINTS[i];
      return y0 + ((y1 - y0) * (pick - x0)) / (x1 - x0);
    }
  }
  return 2_500_000;
}

/**
 * Tier -> a market-rate dollar figure. Used two ways: (1) the `estimate` fallback charge for a
 * season with no real salary, (2) `tierMarketUsd` on every span, so the UI can show a value gap
 * (what the tier is worth vs. what it charges).
 */
const TIER_MARKET_USD: Record<OverallTier, number> = {
  GOAT: 57_740_000,
  'Greatest peak': 57_740_000,
  MVP: 57_740_000,
  'All-NBA': 49_490_000,
  'All-star': 35_000_000,
  Starter: 18_000_000,
  'Sixth Man': 14_000_000,
  'Role Player': 9_000_000,
  'Bench Warmer': 5_000_000,
  'Cigarette Butt': 2_500_000,
};

/** normalized player name -> { pick, draftYear } from the committed draft-history table. */
const draftInfoByName = new Map<string, { pick: number; year: number }>();
for (const row of draftHistory as { name: string; season: string; overallPick: number }[]) {
  const key = resolveSourceName(row.name);
  if (!key || draftInfoByName.has(key)) continue;
  const year = parseInt(row.season, 10);
  if (row.overallPick > 0 && Number.isFinite(year)) {
    draftInfoByName.set(key, { pick: row.overallPick, year });
  }
}

/**
 * 2026-09-07, user-reported (Moses Malone's post-1985 real-salary seasons all clamping to the
 * lowest, <7-years-of-service max, $41.24M, when he should be well past 10): players with no
 * `draftInfoByName` entry (ABA-to-NBA converts like Malone, who jumped straight from high school
 * to the ABA in 1974 and so were never drafted by an NBA team through a route this table covers;
 * undrafted entries) fell back to counting years-of-service from the first year THIS PROJECT
 * happens to have a real salary on file — which floors at 1985 for literally every player,
 * regardless of when their real career started, so Malone (11 real pro seasons in by then) was
 * priced as a rookie. Rather than special-case Malone by name, use a real, already-available,
 * player-specific signal instead: the earliest span this same real person has anywhere in the
 * full (non-active-filtered) draftPool, which for a long-career player routinely reaches back
 * well before 1985 (Malone's own earliest curated span is 1976-78). Still not their true real
 * debut (Malone's is 1974; the pool's own earliest curated span for him is 1976-78, 2 years
 * later — a real, acknowledged residual gap for players whose career started before the pool's
 * own coverage), but a measured, order-of-magnitude improvement over "assume rookie in 1985"
 * for every player this affects, not just this one name.
 */
const earliestSpanStartYearByName = new Map<string, number>();
for (const p of draftPool) {
  const m = p.spanLabel.match(/^(\d{4})-/);
  if (!m) continue;
  const startYear = parseInt(m[1], 10);
  const key = normalizePlayerName(p.playerName);
  const existing = earliestSpanStartYearByName.get(key);
  if (existing === undefined || startYear < existing) earliestSpanStartYearByName.set(key, startYear);
}

/** "1990-92" -> [1991, 1992] (the season-END years the span covers). */
function spanEndYears(label: string): number[] {
  const m = label.match(/(\d{4})-(\d{2})/);
  if (!m) return [];
  const start = parseInt(m[1], 10);
  const suffix = parseInt(m[2], 10);
  const end = suffix < 50 ? 2000 + suffix : 1900 + suffix;
  const years: number[] = [];
  for (let y = start + 1; y <= end; y++) years.push(y);
  return years;
}

function salaryHistoryFor(span: PlayerSpan): Record<string, number> | undefined {
  const idPrefix = span.id.match(/^([a-z]+[0-9]{2})-/)?.[1];
  return (idPrefix && salaryByPlayerId[idPrefix]) || salaryByName[normalizePlayerName(span.playerName)];
}

export type ChargeSource = 'real' | 'rookie' | 'estimate';
export interface SeasonCharge {
  year: number;
  realSalaryUsd: number | null;
  chargeUsd: number;
  source: ChargeSource;
}
export interface SpanPricing {
  /** Mean of the season charges, USD. This is what the span costs against the $200M budget. */
  rosterChargeUsd: number;
  /** Mean of the seasons that have a real salary on file, USD. Null if none. */
  realSalaryUsd: number | null;
  /** Market rate for the span's tier, USD — for the value gap. */
  tierMarketUsd: number;
  /** tierMarketUsd - rosterChargeUsd. Positive = charged less than the tier is worth (a steal). */
  valueGapUsd: number;
  method: 'real' | 'rookie' | 'synthetic' | 'mixed';
  draftPick: number | null;
  seasons: SeasonCharge[];
}

const cache = new Map<string, SpanPricing>();

export function priceSpan(span: PlayerSpan): SpanPricing {
  const cached = cache.get(span.id);
  if (cached) return cached;

  const tier = overallTierForSpan(tierContextWithSixthMan(span));
  const tierMarketUsd = TIER_MARKET_USD[tier] ?? 9_000_000;
  const history = salaryHistoryFor(span);
  const draft = draftInfoByName.get(normalizePlayerName(span.playerName));
  const earliestSpanYear = earliestSpanStartYearByName.get(normalizePlayerName(span.playerName));

  const seasons: SeasonCharge[] = spanEndYears(span.spanLabel).map((year) => {
    // Same "years since the season before their first tracked one" shape as the `draft` branch,
    // just anchored on the earliest span this real person has in the pool instead of a draft
    // year — see earliestSpanStartYearByName's own docstring for why this replaced falling back
    // to "first year we happen to have a real salary on file" (floors at 1985 for everyone).
    const yos =
      draft ? year - 1 - draft.year
      : earliestSpanYear != null ? year - 1 - earliestSpanYear
      : 8;
    const real = history?.[String(year)] ?? null;
    // 2026-09-09, user-reported: the rookie-scale WAGE SCALE this branch flattens a player's
    // early seasons to is a specific mechanism the 1995 CBA introduced (first applied to the
    // 1995 draft class onward) -- it didn't exist before that. A pre-1995 top pick (Glenn
    // Robinson, #1 in 1994, signed an uncapped 10-year/$68M deal as an unproven rookie) had a
    // real, individually-negotiated contract, often a blockbuster one, not a rookie-scale
    // number -- gating this on draft.year lets those seasons fall through to the normal
    // real/estimate pricing below instead of being anachronistically flattened to a 2025-26
    // rookie-scale figure that has nothing to do with how their era actually paid rookies.
    const isRookieYear =
      draft != null && draft.year >= 1995 && draft.pick <= 30 && year >= draft.year + 1 && year <= draft.year + 4;

    if (isRookieYear) {
      return { year, realSalaryUsd: real, chargeUsd: rookieScaleSalary(draft.pick), source: 'rookie' };
    }
    const cap = capByYear[String(year)];
    if (real && cap && year >= 1985) {
      const scaled = (real / cap) * CAP_BASELINE;
      return { year, realSalaryUsd: real, chargeUsd: Math.min(scaled, maxSalaryForYos(yos)), source: 'real' };
    }
    return { year, realSalaryUsd: null, chargeUsd: tierMarketUsd, source: 'estimate' };
  });

  const realSeasons = seasons.filter((s) => s.realSalaryUsd != null && s.source !== 'estimate');
  const realSalaryUsd = realSeasons.length
    ? realSeasons.reduce((a, b) => a + (b.realSalaryUsd as number), 0) / realSeasons.length
    : null;
  const rosterChargeUsd = seasons.reduce((a, b) => a + b.chargeUsd, 0) / Math.max(1, seasons.length);
  const method: SpanPricing['method'] = seasons.every((s) => s.source === 'estimate')
    ? 'synthetic'
    : seasons.some((s) => s.source === 'rookie')
      ? 'rookie'
      : seasons.some((s) => s.source === 'estimate')
        ? 'mixed'
        : 'real';

  const pricing: SpanPricing = {
    rosterChargeUsd,
    realSalaryUsd,
    tierMarketUsd,
    valueGapUsd: tierMarketUsd - rosterChargeUsd,
    method,
    draftPick: draft?.pick ?? null,
    seasons,
  };
  cache.set(span.id, pricing);
  return pricing;
}

/** "$41.2M" / "$3.8M" / "—" */
export function formatUsdM(usd: number | null): string {
  if (usd == null) return '—';
  const m = usd / 1e6;
  return '$' + (m >= 10 ? Math.round(m) : m.toFixed(1)) + 'M';
}
