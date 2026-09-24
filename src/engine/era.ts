import type { Position } from '../data/schema';
import seasonBaselinesData from '../data/awards/seasonBaselines.json';
import leagueThreeVolumeData from '../data/awards/leagueThreeVolume.json';
import leagueStealsData from '../data/awards/leagueSteals.json';

/**
 * Era-adjustment baselines, used to compare a player's raw box stats against what was
 * actually typical when they played (rules and pace have shifted a lot since the 1940s —
 * see Basketball-Reference's Pace Factor glossary entry, and 3-point volume/efficiency have
 * climbed steadily since the line was added in 1979-80).
 *
 * TS% and 3P% come from real per-season league averages (derived from actual team box
 * scores, scripts/extractNbaSqlite.py against the NBA stats database), covering every
 * season from 1946-47 onward — not an approximation. Pace's real coverage only starts in
 * 1981-82, though — turnovers (needed to estimate possessions) weren't tracked as a
 * separate stat until later in the 1970s, so the source has no possessions estimate at all
 * before then. Two fallback tiers below that: 1970-1981 bridges via linear interpolation
 * between the 1960s estimate and the first real data point (see `bridgePace`), since pace
 * was gradually declining through that decade and a flat clamp would overstate it; pre-1970
 * falls back further to hand-estimated decade figures, since the 1950s-60s were a genuinely
 * faster, pre-shot-clock-maturity era a straight clamp would understate.
 */
export interface EraBaseline {
  avgTs: number;
  avgThreePct: number;
  pace: number; // estimated possessions per 48 minutes
}

export const LEAGUE_PACE_BASELINE = 100;

interface SeasonBaseline {
  season: string; // "1946-47"
  avgTs: number | null;
  avgThreePct: number | null;
  pace: number | null;
}
const seasonBaselines = seasonBaselinesData as SeasonBaseline[];

/** Hand-estimated pace for the pre-1970-71 seasons the real data can't cover (see header
 * comment) — decade-granularity approximations only, not exact season-by-season figures. */
const PRE_1970_PACE_BY_DECADE: Record<number, number> = {
  1940: 90,
  1950: 115,
  1960: 125,
};
const KNOWN_PRE_1970_DECADES = Object.keys(PRE_1970_PACE_BY_DECADE)
  .map(Number)
  .sort((a, b) => a - b);

function pre1970Pace(seasonEndYear: number): number {
  const decade = Math.floor((seasonEndYear - 1) / 10) * 10;
  if (PRE_1970_PACE_BY_DECADE[decade]) return PRE_1970_PACE_BY_DECADE[decade];
  const clamped =
    decade < KNOWN_PRE_1970_DECADES[0]
      ? KNOWN_PRE_1970_DECADES[0]
      : KNOWN_PRE_1970_DECADES[KNOWN_PRE_1970_DECADES.length - 1];
  return PRE_1970_PACE_BY_DECADE[clamped];
}

const tsByEndYear = new Map<number, number>();
// avgThreePct is tracked separately from avgTs: 1981-82 through 1984-85's source data has
// avgTs values consistent with their neighbors, but corrupted avgThreePct (three seasons show
// a mathematically impossible >100% league average, and 1981-82's 47.4% is implausibly high
// right next to them before the data snaps back to a sane 28.2% in 1985-86 - almost certainly
// one shared extraction bug specific to the 3-point line's first few, extremely-low-volume
// seasons). Rather than fabricate a "corrected" percentage with no reliable source to check it
// against, those four seasons' avgThreePct is null in the source data and falls back here to
// the nearest season with a trustworthy value (1985-86) - same "flat estimate over fabricated
// precision" philosophy as the pre-1970 pace fallback below, just for one field instead of a
// whole season entry, so real avgTs/pace data for 1981-85 is still used normally.
const threePctByEndYear = new Map<number, number>();
const paceByEndYear = new Map<number, number>();
for (const s of seasonBaselines) {
  const startYear = parseInt(s.season.slice(0, 4), 10);
  const endYear = startYear + 1;
  if (s.avgTs != null) tsByEndYear.set(endYear, s.avgTs);
  // Also require avgTs != null here: seasons with no real data extracted at all (avgTs: null)
  // use avgThreePct: 0 as a generic "no data" placeholder too, not necessarily a true zero -
  // real pre-1979-80 seasons (no 3-point line yet) legitimately have avgThreePct 0 AND a real
  // avgTs, so those stay included; a placeholder like 1980-81 (avgTs: null, avgThreePct: 0,
  // despite the 3-point line already existing by then) does not.
  if (s.avgTs != null && s.avgThreePct != null) threePctByEndYear.set(endYear, s.avgThreePct);
  if (s.pace != null) paceByEndYear.set(endYear, s.pace);
}
const KNOWN_TS_YEARS = [...tsByEndYear.keys()].sort((a, b) => a - b);
const KNOWN_THREE_PCT_YEARS = [...threePctByEndYear.keys()].sort((a, b) => a - b);
const KNOWN_PACE_YEARS = [...paceByEndYear.keys()].sort((a, b) => a - b);

function clampToKnown(year: number, known: number[]): number {
  if (known.includes(year)) return year;
  return known.reduce((best, cur) => (Math.abs(cur - year) < Math.abs(best - year) ? cur : best), known[0]);
}

/** Bridges the 1970-1981 gap (real pace data starts at KNOWN_PACE_YEARS[0], 1981-82) by
 * linearly interpolating between the 1960s decade estimate (anchored at 1970) and the first
 * real data point, rather than clamping the whole decade to the faster 1960s figure — that
 * clamp previously scored every 1970s span (Kareem, Walton, West, Oscar, ~460 other players)
 * against a pace ~20% too fast, deflating every pace-scaled stat. */
function bridgePace(seasonEndYear: number): number {
  const anchorYear = 1970;
  const anchorPace = PRE_1970_PACE_BY_DECADE[1960];
  const firstRealYear = KNOWN_PACE_YEARS[0];
  const firstRealPace = paceByEndYear.get(firstRealYear)!;
  if (firstRealYear <= anchorYear) return firstRealPace;
  const t = Math.max(0, Math.min(1, (seasonEndYear - anchorYear) / (firstRealYear - anchorYear)));
  return anchorPace + (firstRealPace - anchorPace) * t;
}

/** A PlayerSpan's `spanLabel` ("1971-73") covers more than one season — expands it to the
 * individual season end-years it spans ([1972, 1973]), the same convention the data
 * generation scripts use. Exported so other modules (darkoCorrection.ts) can match a span
 * against real per-season external data using the same year convention. */
export function spanEndYears(spanLabel: string): number[] {
  // 2026-09-24, load-time profile: this and `eraBaseline` below ran hundreds of thousands of times
  // while the engine modules precompute their per-span tables — ~5s of the ~11s "Loading player
  // data" wait on a desktop. Both are pure functions of the label, so each label is parsed once;
  // a copy is returned so no caller can mutate the cached array.
  let cached = spanEndYearsCache.get(spanLabel);
  if (!cached) {
    cached = spanEndYearsUncached(spanLabel);
    spanEndYearsCache.set(spanLabel, cached);
  }
  return cached.slice();
}
const spanEndYearsCache = new Map<string, number[]>();

function spanEndYearsUncached(spanLabel: string): number[] {
  const m = spanLabel.match(/^(\d{4})-(\d{2})$/);
  if (!m) return [];
  const startCalendarYear = parseInt(m[1], 10);
  const endSuffix = m[2];
  const startSeasonEnd = startCalendarYear + 1;
  for (let candidate = startSeasonEnd; candidate <= startSeasonEnd + 5; candidate++) {
    if (String(candidate).slice(-2) === endSuffix) {
      const years: number[] = [];
      for (let y = startSeasonEnd; y <= candidate; y++) years.push(y);
      return years;
    }
  }
  return [startSeasonEnd];
}

const eraBaselineCache = new Map<string, EraBaseline>();

/** Memoized per label (see `spanEndYears`); every caller only destructures the result. */
export function eraBaseline(spanLabel: string): EraBaseline {
  let cached = eraBaselineCache.get(spanLabel);
  if (!cached) {
    cached = eraBaselineUncached(spanLabel);
    eraBaselineCache.set(spanLabel, cached);
  }
  return cached;
}

function eraBaselineUncached(spanLabel: string): EraBaseline {
  const years = spanEndYears(spanLabel).length > 0 ? spanEndYears(spanLabel) : [new Date().getFullYear()];

  const avgTsValues = years.map((y) => tsByEndYear.get(clampToKnown(y, KNOWN_TS_YEARS))!);
  const avgTs = avgTsValues.reduce((sum, v) => sum + v, 0) / avgTsValues.length;
  const avgThreePctValues = years.map((y) => threePctByEndYear.get(clampToKnown(y, KNOWN_THREE_PCT_YEARS))!);
  const avgThreePct = avgThreePctValues.reduce((sum, v) => sum + v, 0) / avgThreePctValues.length;

  const paceEntries = years.map((y) => {
    if (KNOWN_PACE_YEARS.length > 0 && y >= KNOWN_PACE_YEARS[0]) {
      return paceByEndYear.get(clampToKnown(y, KNOWN_PACE_YEARS))!;
    }
    if (y >= 1970) return bridgePace(y);
    return pre1970Pace(y);
  });
  const pace = paceEntries.reduce((sum, p) => sum + p, 0) / paceEntries.length;

  return { avgTs, avgThreePct, pace };
}

interface LeagueThreeVolume {
  seasonEndYear: number;
  avgThreePA: number;
  spanCount: number;
}
const threeVolumeByEndYear = new Map<number, number>();
for (const row of leagueThreeVolumeData as LeagueThreeVolume[]) {
  // Pre-1979-80 seasons have a true 0 (no 3-point line yet), which is not a scalable
  // denominator — left out of the map so those years fall through to the neutral scale of 1.
  if (row.avgThreePA > 0) threeVolumeByEndYear.set(row.seasonEndYear, row.avgThreePA);
}
const KNOWN_THREE_VOLUME_YEARS = [...threeVolumeByEndYear.keys()].sort((a, b) => a - b);

/** The era all 3-point VOLUME judging is expressed in: current-day (2024-2026) attempt rates.
 * Averaged over three seasons rather than pinned to one so a single quirky year can't shift
 * every historical player's rating. */
const THREE_VOLUME_REFERENCE_YEARS = [2024, 2025, 2026];
const modernThreeVolumeSamples = THREE_VOLUME_REFERENCE_YEARS.map((y) =>
  threeVolumeByEndYear.get(clampToKnown(y, KNOWN_THREE_VOLUME_YEARS))!,
);
export const MODERN_THREE_VOLUME_BASELINE =
  modernThreeVolumeSamples.reduce((sum, v) => sum + v, 0) / modernThreeVolumeSamples.length;

/**
 * Caps how far back the volume scale is allowed to reach. Uncapped, the ratio hits ~20x for
 * 1980-84 (league average was ~0.20 3PA/game per player vs ~4.10 now), which would read a
 * 1981 player taking 1 three a game as a modern 20-attempt bomber. That over-credits the
 * novelty years specifically: teams took barely two threes a GAME then, so being a volume
 * outlier relative to those peers did not distort a defense the way modern volume does —
 * the shot wasn't yet a thing defenses game-planned around at all.
 *
 * 8 is the ratio for ~1987-88, the point where 3-point attempts became a real, defended part
 * of offenses rather than an oddity. Beyond that the scale flattens, so pre-1988 shooters are
 * still measured against their own peers (a genuine era outlier like Bird or Dale Ellis still
 * maxes the volume score) without a low-sample season inflating a marginal shooter into one.
 */
export const MAX_THREE_VOLUME_SCALE = 8;

/**
 * 2026-08-19, user's explicit ask (real diagnostic: David Thompson's 1976-78 span, SPC 0,
 * dropped out of the pool entirely under talent.ts's new spacing-conditional TAL correction —
 * not because he was a bad shooter, but because the NBA had no 3-point line at all until 1979-80,
 * so his true 0 3PA reflects "had no shot to take," not "chose not to shoot"). First season-end-
 * year WITH a 3-point line. A span whose every real season predates this had zero opportunity to
 * record real 3PT volume, so `computeSpacing` reading exactly 0 for it is not evidence about the
 * player — used to exempt such spans from any correction that would otherwise punish that true 0
 * as if it were a real, judged shooting weakness.
 */
export const FIRST_THREE_POINT_LINE_END_YEAR = 1980;

export function predatesThreePointLine(spanLabel: string): boolean {
  const years = spanEndYears(spanLabel);
  if (years.length === 0) return false;
  return years.every((y) => y < FIRST_THREE_POINT_LINE_END_YEAR);
}

/**
 * Multiplier putting a span's raw 3PA/game onto the modern (2024-26) volume scale, so
 * "how much did this player shoot from three, relative to what was normal at the time" is
 * comparable across eras. Returns 1 (no adjustment) for spans with no usable league data,
 * which is every pre-1979-80 season — those players have 0 3PA anyway, so the scale is moot.
 */
export function threeVolumeEraScale(spanLabel: string): number {
  const years = spanEndYears(spanLabel);
  if (years.length === 0 || KNOWN_THREE_VOLUME_YEARS.length === 0) return 1;

  const covered = years.filter((y) => y >= KNOWN_THREE_VOLUME_YEARS[0]);
  if (covered.length === 0) return 1;

  const samples = covered.map((y) => threeVolumeByEndYear.get(clampToKnown(y, KNOWN_THREE_VOLUME_YEARS))!);
  const eraAvg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  if (eraAvg <= 0) return 1;

  return Math.min(MAX_THREE_VOLUME_SCALE, MODERN_THREE_VOLUME_BASELINE / eraAvg);
}

/** A span's 3PA/game restated as the equivalent modern-era attempt rate. */
export function eraScaledThreePA(spanLabel: string, threePA: number): number {
  return threePA * threeVolumeEraScale(spanLabel);
}

interface LeagueSteals {
  seasonEndYear: number;
  avgSpg: number;
  spanCount: number;
}
const stealsByEndYear = new Map<number, number>();
for (const row of leagueStealsData as LeagueSteals[]) {
  if (row.avgSpg > 0) stealsByEndYear.set(row.seasonEndYear, row.avgSpg);
}
const KNOWN_STEAL_YEARS = [...stealsByEndYear.keys()].sort((a, b) => a - b);

/** The era steal RATE judging is expressed in: current-day (2024-2026), same 3-season-average
 * convention as `MODERN_THREE_VOLUME_BASELINE`. */
const STEAL_REFERENCE_YEARS = [2024, 2025, 2026];
const modernStealSamples = STEAL_REFERENCE_YEARS.map((y) => stealsByEndYear.get(clampToKnown(y, KNOWN_STEAL_YEARS))!);
export const MODERN_STEAL_BASELINE = modernStealSamples.reduce((sum, v) => sum + v, 0) / modernStealSamples.length;

/**
 * 2026-08-05, user explicit ask (Clyde Drexler, Julius Erving): unlike 3-point volume, steal
 * RATE hasn't shifted anywhere near as dramatically across eras — checked directly first
 * (scripts/checkLeagueStealsBySeasonRaw.ts) before building this, since `defense.ts` already
 * pace-adjusts steals+blocks together and a second, redundant correction on top would
 * double-count. Real finding: pace alone already explains most of the historical trend, leaving
 * a real but modest ~7-11% residual (e.g. Drexler's own 1988-90 era reads ~0.89-0.93 residual —
 * meaning pace-only adjustment is still ~7-12% *too generous* to that era's raw steal numbers).
 * Capped narrowly (0.85-1.0) for exactly that reason: this is a small top-up correction on
 * TOP of the existing pace factor, not a replacement for it, so it should never need to move
 * scores by more than that modest residual amount in either direction, and never reads as a
 * bonus (capped at 1.0 — modern-era steal rates are the reference, they don't get a discount
 * applied to them, only older eras get the residual correction removed from their pace-adjusted
 * read).
 *
 * Re-validated (2026-08-05): initially suspected of breaking `checkDefensiveGradeTargets.ts`'s
 * calibration (9/46 out of band vs the documented 6/46 baseline) — confirmed directly by
 * reverting just this mechanism and re-running the same check: **still 9/46**, identical. The
 * drift predates this change (most likely `extremeUsageRatioPenalty`/`centerPlaymakingBonus`
 * from earlier the same session, though neither touches `computeDefensiveImpact` directly, so
 * that's not fully explained either — flagged to the user as its own open item rather than
 * silently absorbed into this one's blame). Taylor Top-10 unchanged (0.879); Backpicks GOAT-40
 * *improved* (0.643 -> 0.658, back above the pre-session baseline) with this change active, and
 * Drexler's own divergence closed 5 ranks (goatRank diff -22 -> -17) — kept on that evidence.
 */
const STEAL_RATE_RESIDUAL_FLOOR = 0.85;

const stealRateEraResidualCache = new Map<string, number>();

/** Memoized per label, same reasoning as `spanEndYears`/`eraBaseline` above. */
export function stealRateEraResidual(spanLabel: string): number {
  let cached = stealRateEraResidualCache.get(spanLabel);
  if (cached === undefined) {
    cached = stealRateEraResidualUncached(spanLabel);
    stealRateEraResidualCache.set(spanLabel, cached);
  }
  return cached;
}

function stealRateEraResidualUncached(spanLabel: string): number {
  const years = spanEndYears(spanLabel);
  if (years.length === 0 || KNOWN_STEAL_YEARS.length === 0) return 1;
  const covered = years.filter((y) => y >= KNOWN_STEAL_YEARS[0]);
  if (covered.length === 0) return 1;
  const samples = covered.map((y) => stealsByEndYear.get(clampToKnown(y, KNOWN_STEAL_YEARS))!);
  const eraAvg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  if (eraAvg <= 0) return 1;
  const rawScale = MODERN_STEAL_BASELINE / eraAvg;
  // Same-shape pace-only comparison as the diagnostic script, so this reads only the RESIDUAL
  // beyond what defense.ts's paceFactor already corrects for, never the whole gap twice.
  const { pace } = eraBaseline(spanLabel);
  const paceOnlyScale = LEAGUE_PACE_BASELINE / pace;
  const residual = paceOnlyScale > 0 ? rawScale / paceOnlyScale : 1;
  return Math.max(STEAL_RATE_RESIDUAL_FLOOR, Math.min(1, residual));
}

/**
 * Bigs shoot closer to the basket, so comparing everyone against one flat league-average TS%
 * understates how good a center's percentage "should" be — confirmed in-dataset: centers run
 * ~3 points higher mean TS% than wings/guards (scripts/checkTsByPosition.ts). Small,
 * position-specific offsets on top of the era baseline.
 */
const POSITION_TS_OFFSET: Record<Position, number> = {
  PG: -0.007,
  SG: -0.001,
  SF: 0,
  PF: 0.002,
  C: 0.03,
};

/**
 * Within bigs/forwards specifically, TS% drops noticeably as usage rises — deep-bench bigs
 * live on putbacks and lobs, high-usage bigs face real post/contested defense (confirmed
 * in-dataset: ~7-point swing for centers across the usage spectrum, milder for PF/SF). Guards'
 * TS% doesn't meaningfully move with usage in the data, so they get no slope at all — applying
 * one anyway would wrongly discount a high-usage guard who doesn't show this pattern.
 */
const USAGE_TS_SLOPE: Partial<Record<Position, number>> = {
  SF: 0.0013,
  PF: 0.0017,
  C: 0.0035,
};
const USAGE_REFERENCE_FGA = 12;

/** The TS% a player at this position/usage level is expected to clear, given the era. */
export function positionAdjustedTsBaseline(position: Position, fga: number, spanLabel: string): number {
  const { avgTs } = eraBaseline(spanLabel);
  const slope = USAGE_TS_SLOPE[position] ?? 0;
  return avgTs + POSITION_TS_OFFSET[position] - slope * (fga - USAGE_REFERENCE_FGA);
}
