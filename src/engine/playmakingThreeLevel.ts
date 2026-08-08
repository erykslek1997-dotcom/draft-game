import type { PlayerSpan, Position } from '../data/schema';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { buildZoneYearMap, zoneTotalsForSpan } from './zoneEfficiencyLookup';

/**
 * 2026-08-07, user explicit ask, reopening a previous session's deliberate decision
 * (`offensiveProfile.ts`'s own docstring: "na ten moment niech nie wpływa na TAL, bo za dużo
 * nam namiesza" — for now don't let it touch TAL). This file wires the SAME two 2026-08-07 CSV
 * exports (box-creation/passer-rating "playmaking" + zone-efficiency) into `computeTalent`
 * directly, as a genuinely new, separate mechanism — it does NOT read `offensiveProfile.ts`
 * (that file's "never reaches computeTalent" guarantee stays true; this reads the two
 * underlying lookups on its own).
 *
 * **2026-08-07, second pass, after the first version was fully shipped, cascaded into a PG
 * O-TAL crowding mess (Kevin Johnson/Stockton tying Nash/Harden on offense), triggered a chain
 * of O-TAL formula patches that each fixed PG but broke SF/PF/C tier gates, and was ultimately
 * reverted entirely the same session.** User's own verdict on the reverted attempt, verbatim:
 * "Playmaking + 3LVL was rather for calibration purposes, it boosted too much ratings. Worked
 * well for SG, SF, PF and C (could be slightly less impactful). But it broke PG position and
 * make it too stacked." This version acts on that directly: **PG is excluded from every
 * mechanism in this file** (not just tempered — the user's own PG-specific data finding from the
 * reverted session, that most PG spans are auto-tagged "Secondary Ball Handler" rather than
 * "Primary" and inherit that tag from whichever curated anchor is nearest by year, is a separate,
 * still-open, more promising lead for PG specifically — see the project memory file). Every
 * other position keeps the mechanism, magnitudes trimmed modestly (~13-15%) per "could be
 * slightly less impactful." Constants are still first-pass, not grid-searched — report real
 * before/after movement on the same named cases (Butler/Draymond/Gasol/Dirk/Shaq) rather than
 * assuming these are final.
 */

const zoneMap = buildZoneYearMap();

/** `playmakingScoreForPlayer` reads 0-100, name-keyed to a player's single best/selected
 * season (not per-span) — see playmakingLookup.ts's own docstring on why that coarseness is
 * acceptable for a synergy signal. Real scores in the export run roughly 15-99; 50 is picked as
 * a "no particular playmaking signal either way" baseline, not a measured league-average (no
 * such average exists in a one-row-per-player, best-season export). */
const PLAYMAKING_BASELINE = 50;

/**
 * Wings (SG/SF only — PG excluded, see this file's own header): additive-only, matching this
 * project's general "bonuses only ever help" philosophy for these positions — a wing who ISN'T a
 * good passer already reads correctly from apg/usage alone, there's no separate "bad playmaking"
 * complaint to fix here the way there is for bigs below. Rewards playmaking GRAVITY/quality
 * (box-creation, not just raw assist count) on top of what `effectivePlaymakingApg`'s apg-volume
 * term already captures — a genuinely distinct signal, not a re-derivation of it (Jimmy Butler's
 * own apg is modest, 4-6.5, but he creates real advantage as an on-ball threat the assist column
 * alone undersells).
 */
const PERIMETER_PLAYMAKING_SCALE = 0.085;
const MAX_PERIMETER_PLAYMAKING_BONUS = 4.5;

/**
 * Bigs (PF/C): the user's explicit ask — real playmaking should raise a big's TAL (Draymond
 * Green, Pau Gasol) exactly as it does for wings, AND weak playmaking should genuinely lower it
 * — a real, two-directional exception to this project's usual "additive-only" rule, scoped
 * narrowly to exactly the population the user named (PF/C), not a general reopening of that
 * rule elsewhere. `centerPlaymakingBonus` in talent.ts (apg-volume-based, additive-only,
 * capped 12) already exists for centers and is untouched by this — this is a separate,
 * quality-not-volume signal that also reaches PF (which had no playmaking-specific credit at
 * all before this). Malus capped lower than the bonus, matching this project's standing
 * convention that a subtractive correction should be more conservative than an additive one
 * (see darkoCorrection.ts's own bonus/malus asymmetry).
 */
const BIG_PLAYMAKING_SCALE = 0.13;
const MAX_BIG_PLAYMAKING_BONUS = 5;
const MAX_BIG_PLAYMAKING_MALUS = 4.5;

/** PG deliberately excluded — see this file's own header docstring. */
const PERIMETER_PLAYMAKING_POSITIONS: ReadonlySet<Position> = new Set(['SG', 'SF']);
const BIG_PLAYMAKING_POSITIONS: ReadonlySet<Position> = new Set(['PF', 'C']);

/** Real, quality-of-playmaking adjustment on top of the existing apg-volume term. Missing data
 * (a player the export doesn't cover — most of the pre-1996-97 pool, or anyone outside its
 * ~2,439 rows) returns 0, the same "no signal, no adjustment" default every other lookup in this
 * codebase uses — absence of data is not evidence of poor playmaking. Returns 0 unconditionally
 * for PG (see header docstring) and for any position outside the two sets above (C already
 * covered, so in practice this only means PG). */
export function playmakingSkillAdjustment(span: PlayerSpan): number {
  if (span.primaryPosition === 'PG') return 0;
  const score = playmakingScoreForPlayer(span);
  if (score === null) return 0;
  const excess = score - PLAYMAKING_BASELINE;
  if (PERIMETER_PLAYMAKING_POSITIONS.has(span.primaryPosition)) {
    return excess > 0 ? Math.min(MAX_PERIMETER_PLAYMAKING_BONUS, excess * PERIMETER_PLAYMAKING_SCALE) : 0;
  }
  if (BIG_PLAYMAKING_POSITIONS.has(span.primaryPosition)) {
    if (excess >= 0) return Math.min(MAX_BIG_PLAYMAKING_BONUS, excess * BIG_PLAYMAKING_SCALE);
    return Math.max(-MAX_BIG_PLAYMAKING_MALUS, excess * BIG_PLAYMAKING_SCALE);
  }
  return 0;
}

/** Half-court shot volume needed (summed across the span's covered years) before per-zone
 * shares/accuracy mean anything — same threshold and reasoning as `offensiveProfile.ts`'s own
 * `MIN_CLASSIFIED_FGA_FOR_PROFILE`. Zone data only exists 1996-97+; spans before that (or a
 * player the export never covered) return 0 from both bonuses below — a real, accepted
 * "pre-1997 3-level/finishing credit isn't computable" gap, same class as this project's other
 * documented pre-DARKO/pre-zone-tracking gaps. */
const MIN_CLASSIFIED_FGA = 150;
/** A zone only counts as a real "level" a player actually scores from — not a token handful of
 * shots — at this share of the span's classified attempts. */
const ZONE_MIN_SHARE = 0.15;
/** Rough, era-agnostic "good for this zone" efficiency bars — a real simplification (unlike
 * `positionAdjustedTsBaseline`'s decade-level TS% baselines, no equivalent per-zone-per-era
 * table exists yet in this codebase), documented here rather than silently assumed exact. Rim
 * finishing varies far less across eras than 3PT volume does (shot difficulty, not defended
 * space, drives it), so a flat bar is a smaller approximation than era-scaling volume would be. */
const ZONE_GOOD_PCT: Record<'rim' | 'mid' | 'three', number> = { rim: 60, mid: 42, three: 36 };

function classifiedZoneShares(span: PlayerSpan): { rim: number; mid: number; three: number; classified: number } | null {
  const totals = zoneTotalsForSpan(span, zoneMap);
  if (!totals) return null;
  const classified = totals.rimFga + totals.midFga + totals.threeFga;
  if (classified < MIN_CLASSIFIED_FGA) return null;
  return {
    rim: totals.rimFga / classified,
    mid: totals.midFga / classified,
    three: totals.threeFga / classified,
    classified,
  };
}

/**
 * The user's "3LVL scoring" ask (Dirk Nowitzki, checked directly against real zone data: huge
 * midrange volume at 43-50% and real three-point volume at 36-41%, on top of decent rim
 * finishing — a genuine three-level scorer whose signature skill, elite MIDRANGE volume, isn't
 * separately rewarded anywhere else in this formula the way rim/three volume already are via
 * TS%/shooting-gravity). Requires REAL volume in all three zones (>=15% share each) — this is
 * what keeps the bonus scoped to genuine three-level threats instead of firing on a token
 * midrange jumper or an incidental corner three. Additive-only, matching every other TAL bonus
 * that isn't the two bidirectional playmaking terms above. PG excluded (see header docstring) —
 * this was the mechanism directly responsible for the original Stockton/Nash O-TAL stacking bug
 * (below), so it's excluded there entirely now rather than re-gated a third time.
 */
const MULTI_LEVEL_SCALE = 0.43;
const MAX_MULTI_LEVEL_BONUS = 5;

/**
 * `ZONE_MIN_SHARE` alone isn't a volume gate, it's a SHARE gate — a career facilitator taking 8-9
 * shots a game who happens to spread them roughly evenly across rim/mid/three clears 15% share
 * in all three trivially, without being anything like a genuine high-volume 3-level scorer
 * (Dirk). Real per-game shot volume, not just the zone-share ratio, is what actually makes a
 * 3-level scoring profile hard to defend — reuses the same `LOW_USAGE_EFFICIENCY_REFERENCE_FGA`
 * (12) `talent.ts` already uses for "is this genuinely a low-usage span" elsewhere, rather than
 * inventing a second number for the same idea. Kept even though PG is now excluded outright
 * (redundant for PG specifically, but still load-bearing for other low-FGA facilitator-type
 * SG/SF spans this mechanism could otherwise over-credit the same way).
 */
const MULTI_LEVEL_MIN_FGA = 12;

export function multiLevelScoringBonus(span: PlayerSpan): number {
  if (span.primaryPosition === 'PG') return 0;
  if (span.fga < MULTI_LEVEL_MIN_FGA) return 0;
  const shares = classifiedZoneShares(span);
  if (!shares) return 0;
  const totals = zoneTotalsForSpan(span, zoneMap)!;
  const zones: Array<['rim' | 'mid' | 'three', number, number]> = [
    ['rim', shares.rim, totals.rimFgm / Math.max(totals.rimFga, 1)],
    ['mid', shares.mid, totals.midFgm / Math.max(totals.midFga, 1)],
    ['three', shares.three, totals.threeFgm / Math.max(totals.threeFga, 1)],
  ];
  const qualifyingZones = zones.filter(([, share]) => share >= ZONE_MIN_SHARE);
  if (qualifyingZones.length < 3) return 0;
  const excessSum = qualifyingZones.reduce((sum, [zone, , acc]) => sum + Math.max(0, acc * 100 - ZONE_GOOD_PCT[zone]), 0);
  return Math.min(MAX_MULTI_LEVEL_BONUS, excessSum * MULTI_LEVEL_SCALE);
}

/**
 * The user's "finishing inside" ask, specifically about Shaquille O'Neal: real, elite rim
 * volume+accuracy for a player whose shot diet is genuinely dominated by the rim (checked
 * directly: Shaq's rim share runs 78-90% of his classified attempts most seasons, at 70-76%
 * accuracy — both far above a typical big's), scoped to PF/C so it reads as "elite finisher for
 * a big," not a generic rim-accuracy credit that would also fire for a low-volume garbage-man
 * center. Additive-only. Distinct from `multiLevelScoringBonus` above (that one needs volume
 * spread across all three zones; this one specifically rewards rim DOMINANCE, the opposite shot
 * diet) — a span could in principle clear one and not the other, by design. Never touches PG by
 * construction (position-gated to PF/C already).
 */
const RIM_FINISH_MIN_SHARE = 0.5;
const RIM_FINISH_GOOD_PCT = 62;
const RIM_FINISH_SCALE = 0.26;
const MAX_RIM_FINISH_BONUS = 4.5;
const RIM_FINISH_POSITIONS: ReadonlySet<Position> = new Set(['PF', 'C']);

export function insideFinishingBonus(span: PlayerSpan): number {
  if (!RIM_FINISH_POSITIONS.has(span.primaryPosition)) return 0;
  const shares = classifiedZoneShares(span);
  if (!shares) return 0;
  if (shares.rim < RIM_FINISH_MIN_SHARE) return 0;
  const totals = zoneTotalsForSpan(span, zoneMap)!;
  const rimAccuracy = (totals.rimFgm / Math.max(totals.rimFga, 1)) * 100;
  const excess = rimAccuracy - RIM_FINISH_GOOD_PCT;
  return excess > 0 ? Math.min(MAX_RIM_FINISH_BONUS, excess * RIM_FINISH_SCALE) : 0;
}

/** Combined offense-side adjustment `talent.ts`'s `rawComponents` adds in alongside the
 * existing gravity/centerPlaymaking terms — kept as one call site so `rawComponents` doesn't
 * need to know about all three sub-mechanisms individually. Always exactly 0 for PG, by
 * construction of all three functions above, not a fourth position check here. */
export function playmakingThreeLevelOffenseAdjustment(span: PlayerSpan): number {
  return playmakingSkillAdjustment(span) + multiLevelScoringBonus(span) + insideFinishingBonus(span);
}
