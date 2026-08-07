import type { PlayerSpan } from '../data/schema';
import { availabilityForSpan } from './availabilityLookup';

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
  /** This IS the raw availability (rounded), not a percentile — see file header. */
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
  const entry = availabilityForSpan(span);
  if (!entry) {
    return {
      availability: null, games: null, possibleGames: null,
      points: UNRATED_FALLBACK, tier: tierFor(UNRATED_FALLBACK), rated: false,
    };
  }
  const availability = Math.min(MAX_AVAILABILITY, entry.availability);
  const points = Math.round(availability);
  return {
    availability,
    games: entry.games,
    possibleGames: entry.possibleGames,
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
