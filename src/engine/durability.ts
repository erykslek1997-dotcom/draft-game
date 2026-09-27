import type { PlayerSpan } from '../data/schema';
import { runtimeAvailabilityForSpan } from './runtimeSpanLookups';
import { spanEndYears } from './era';
import { playoffLoadForSpan } from './playoffImpact';

/**
 * DURABILITY (DUR) — "how much of his team's schedule did this player actually play," on the same
 * 0-100 display scale as TAL/O-TAL/D-TAL/POR/IMP/SPC.
 *
 * The underlying number is availability: games played / games the player's teams played across
 * the span. It has been sitting unused in the player-data source since the first export, on
 * 13,131 of the game's 13,145 spans (99.9%), every era — the only physical dimension available
 * with complete historical coverage.
 *
 * 2026-08-01, redesigned per explicit user spec: **DUR is now a direct, raw percentage** —
 * `100 * games / possibleGames`, clamped to [0, 100] — not the era-relative percentile the
 * original design used. `possibleGames` is verified real per-team, per-season game counts (not
 * a hardcoded 82): spot-checked directly against the source JSON for the 1998-99 lockout (132
 * across a 1997-99 two-season window, i.e. 82+50), 2011-12 lockout (148, i.e. 82+66), the
 * 2019-20 bubble (a real 130-154 spread reflecting teams that played different numbers of games
 * before the season was halted), and the 1947-49 BAA seasons (108-109, i.e. 48+60) — all match
 * real NBA history exactly, so the raw percentage is trustworthy across the whole dataset.
 *
 * **This reopens a real era-bias tradeoff the original design deliberately avoided**: raw
 * availability medians fall from 97.2 (1950s) to 81.9 (2020s) — a 15-point era drift from
 * deeper modern rosters and deliberate load management, not frailer play. A raw scale hands
 * every pre-1990 span a structural advantage the era-relative percentile used to remove. Kept
 * anyway, per explicit user direction after being shown this exact tradeoff — the new tag
 * thresholds below (94+/85+/etc.) are specified against a raw percentage, and only mean what
 * they're supposed to mean on this scale, not on a ~50-centered era-relative one.
 */

/**
 * 2026-09-27, the user picked the half era correction (option 2 of three shown): raw availability
 * still decides the tiers, but half of each era's gap to the whole pool's median is added back.
 * Median availability of all pool spans, and per season (centre of the window) the median of the
 * spans within three years of it; seasons outside the table use its nearest end. Among players
 * of TAL 70+, Ironman was 70% of 1960s windows and 9% of 2020s ones on the raw scale; with half
 * the gap added back it is 35-60% for every decade through the 2010s and 18% in the 2020s, whose
 * load management is partly real.
 */
const POOL_MEDIAN_AVAILABILITY = 89.6;
const ERA_CORRECTION_SHARE = 0.5;
const ERA_MEDIAN_AVAILABILITY: ReadonlyArray<readonly [number, number]> = [
  [1953, 98.6], [1954, 98.9], [1955, 98.6], [1956, 98.6], [1957, 98.3], [1958, 97.9], [1959, 97.2],
  [1960, 96.9], [1961, 96.9], [1962, 96.8], [1963, 96.2], [1964, 96.2], [1965, 96.2], [1966, 95.7],
  [1967, 95.7], [1968, 95.7], [1969, 95.7], [1970, 95.7], [1971, 95.7], [1972, 95.1], [1973, 95.1],
  [1974, 94.5], [1975, 94.5], [1976, 94.5], [1977, 94.5], [1978, 94.5], [1979, 94.5], [1980, 94.5],
  [1981, 95.1], [1982, 94.5], [1983, 94.5], [1984, 94.5], [1985, 93.9], [1986, 93.3], [1987, 93.3],
  [1988, 93.3], [1989, 93.3], [1990, 93.3], [1991, 92.7], [1992, 92.7], [1993, 92.1], [1994, 91.5],
  [1995, 90.9], [1996, 90.2], [1997, 90.2], [1998, 90.2], [1999, 90.2], [2000, 89.6], [2001, 89.6],
  [2002, 89.4], [2003, 89.0], [2004, 88.4], [2005, 88.4], [2006, 88.1], [2007, 87.8], [2008, 88.4],
  [2009, 88.4], [2010, 88.4], [2011, 88.4], [2012, 88.4], [2013, 87.8], [2014, 87.8], [2015, 87.2],
  [2016, 86.6], [2017, 86.6], [2018, 85.7], [2019, 84.8], [2020, 84.1], [2021, 83.5], [2022, 83.0],
  [2023, 82.5], [2024, 81.8], [2025, 81.7], [2026, 82.3],
];
const eraMedianByYear = new Map(ERA_MEDIAN_AVAILABILITY);

function eraCorrection(spanLabel: string): number {
  const years = spanEndYears(spanLabel);
  if (years.length === 0) return 0;
  const first = ERA_MEDIAN_AVAILABILITY[0][0];
  const last = ERA_MEDIAN_AVAILABILITY[ERA_MEDIAN_AVAILABILITY.length - 1][0];
  const centre = Math.round(years.reduce((sum, y) => sum + y, 0) / years.length);
  const median = eraMedianByYear.get(Math.max(first, Math.min(last, centre)))!;
  return ERA_CORRECTION_SHARE * (POOL_MEDIAN_AVAILABILITY - median);
}

/**
 * 2026-09-27, the user: players who carried heavy playoff minutes get a durability boost. Up to
 * this many availability points for a window whose every season was a full deep-run workload
 * (`playoffLoadForSpan`, measured against each year's own heaviest playoff minutes). A boost
 * only: missing the playoffs says nothing about the player's body.
 */
const MAX_PLAYOFF_LOAD_BOOST = 4;

export type DurabilityTier = 'DNP' | 'Walking Glass' | 'Street Clothes' | 'Load Management' | 'Reliable' | 'Unbreakable' | 'Ironman';

/** Availability can exceed 100 when a mid-season trade means a player's two teams played more
 * combined games than either alone (38 spans in the source). Clamped so those don't read as
 * better-than-perfect attendance. */
const MAX_AVAILABILITY = 100;

/**
 * An unrated span (no source match, ~14 of 13,145) gets no penalty at all — lands at the top
 * tier (Ironman, uncapped minutes) rather than a middling or low default. Same "don't penalize
 * what we don't know" principle the original era-relative design used (its neutral fallback of
 * 50 landed exactly on the no-penalty threshold for that scale; this is the raw-scale
 * equivalent — the threshold where `maxSustainableMinutes` stops reducing the cap at all).
 */
const UNRATED_FALLBACK = 94;

/** User's exact spec, 2026-08-01. Floors checked ascending, highest satisfied wins — same tie
 * resolution pattern as `spacing.ts`/`grades.ts`'s other tier ladders. */
const TIER_FLOORS: ReadonlyArray<readonly [number, DurabilityTier]> = [
  [0, 'DNP'],
  [50, 'Walking Glass'],
  [57, 'Street Clothes'],
  [65, 'Load Management'],
  [75, 'Reliable'],
  [85, 'Unbreakable'],
  [94, 'Ironman'],
];

/** User's exact spec — DNP means literally unplayable, not just a low cap. */
const TIER_MINUTES_CAP: Record<DurabilityTier, number> = {
  DNP: 0,
  'Walking Glass': 22,
  'Street Clothes': 26,
  'Load Management': 30,
  Reliable: 34,
  Unbreakable: 38,
  Ironman: 42,
};

export interface DurabilityBreakdown {
  /** Raw availability across the span, clamped to 100. Null when the span is unmatched. */
  availability: number | null;
  games: number | null;
  possibleGames: number | null;
  /** Availability points added or removed for the era (`eraCorrection`). */
  eraShift: number;
  /** Availability points added for playoff workload (`MAX_PLAYOFF_LOAD_BOOST`). */
  playoffBoost: number;
  /** Raw availability plus the era correction and playoff boost, rounded and held to 0-100. */
  points: number;
  tier: DurabilityTier;
  /** False when no source span matched, in which case DUR falls back to `UNRATED_FALLBACK`
   * (Ironman, uncapped) — callers that must not treat unrated as durable should check this. */
  rated: boolean;
}

function tierFor(points: number): DurabilityTier {
  let tier: DurabilityTier = 'DNP';
  for (const [floor, named] of TIER_FLOORS) {
    if (points >= floor) tier = named;
  }
  return tier;
}

export function durabilityBreakdown(span: PlayerSpan): DurabilityBreakdown {
  const entry = runtimeAvailabilityForSpan(span);
  if (!entry) {
    return {
      availability: null, games: null, possibleGames: null, eraShift: 0, playoffBoost: 0,
      points: UNRATED_FALLBACK, tier: tierFor(UNRATED_FALLBACK), rated: false,
    };
  }
  const availability = Math.min(MAX_AVAILABILITY, entry.availability);
  const eraShift = eraCorrection(span.spanLabel);
  const playoffBoost = MAX_PLAYOFF_LOAD_BOOST * playoffLoadForSpan(span);
  const points = Math.round(Math.max(0, Math.min(MAX_AVAILABILITY, availability + eraShift + playoffBoost)));
  return {
    availability,
    games: entry.games,
    possibleGames: entry.possibleGames,
    eraShift,
    playoffBoost,
    points,
    tier: tierFor(points),
    rated: true,
  };
}

/** DURABILITY on the 0-100 scale the other judge metrics use. */
export function computeDurability(span: PlayerSpan): number {
  return durabilityBreakdown(span).points;
}

export function durabilityTier(span: PlayerSpan): DurabilityTier {
  return durabilityBreakdown(span).tier;
}

/**
 * Flat per-tier minutes cap (`TIER_MINUTES_CAP`), not the old linear ramp — a step function per
 * the user's exact tag spec. `ceiling` (rotation.ts's `MAX_MINUTES_PER_PLAYER`) is passed in
 * rather than imported so `durability.ts` doesn't need to know about the rotation engine, and
 * is still respected as the upper bound (a tier's cap can only ever pull the ordinary ceiling
 * DOWN, never above it, in case `MAX_MINUTES_PER_PLAYER` is ever lowered below 42 for some
 * other reason).
 */
export function maxSustainableMinutes(span: PlayerSpan, ceiling: number): number {
  const tier = durabilityBreakdown(span).tier;
  return Math.min(ceiling, TIER_MINUTES_CAP[tier]);
}

/**
 * 2026-08-01, explicit user request: durability shouldn't sit next to TAL as a separate,
 * decorative stat — it needs to actually change how much a player is WORTH during the draft
 * and in team-value scoring. `durabilityScale` is the multiplier (`cap / ceiling`) a caller
 * applies to a player's talent for that purpose. Matches the user's own worked example exactly:
 * TAL 90 at a 40-minute cap (90 * 40/40 = 90) outvalues TAL 100 at a 32-minute cap
 * (100 * 32/40 = 80). `ceiling` is passed in (not imported) so a caller elsewhere in the engine
 * doesn't need to import `MAX_MINUTES_PER_PLAYER` back from `rotation.ts`, which already
 * imports FROM this file (would be circular).
 *
 * **2026-08-05: `aiDrafter.ts`'s `pickForAi` — this function's one real caller — stopped
 * multiplying by it**, per explicit user request, after it was diagnosed as the mechanism
 * dragging genuinely elite peaks (Jokić, Anthony Davis, Paul George — durabilityScale 0.85-0.95
 * vs. several classic bigs' full 1.0) several picks below their raw-talent rank in playtest
 * feedback. `pickForAi` still hard-excludes DNP-tier spans (`maxSustainableMinutes <= 0`) from
 * its candidate pool entirely — a separate, harder "is this specific span even playable" gate,
 * not a value discount, and untouched by this. `durabilityScale` currently has **no caller left
 * in the engine** (kept as the sanctioned multiplier if a future caller needs "value scaled by
 * durability" again — don't recreate an equivalent helper elsewhere). See
 * `alltime_draft_game_project.md` memory for the full diagnosis and before/after pick numbers.
 */
export function durabilityScale(span: PlayerSpan, ceiling: number): number {
  return maxSustainableMinutes(span, ceiling) / ceiling;
}
