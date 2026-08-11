import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { runtimeZoneTotalsForSpan } from './runtimeSpanLookups';

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
 * make it too stacked." That version acted on that by excluding PG from every mechanism in this
 * file entirely.
 *
 * **2026-08-08, user's explicit ask to reintroduce both mechanisms for PG "lekko" (lightly),
 * after the same-day PG archetype-classifier investigation.** Root-caused WHY the flat
 * universal-baseline version broke PG specifically before picking new constants (checked via
 * `scripts/_pgPlaymaking3lvlPreview.ts`, deleted after use): PG's own playmaking-score
 * distribution is extremely compressed and high by the nature of the position (p25=81.8,
 * median=89, p75=93, only 1.4% of spans fall below the universal `PLAYMAKING_BASELINE` of 50) —
 * so a flat baseline=50 doesn't discriminate GOOD-for-a-PG passing from GREAT-for-a-PG passing,
 * it just hands nearly every point guard in the pool a similar, large bonus simultaneously
 * (uniform lift, not differentiation) — structurally the same "boosted too much... too stacked"
 * failure regardless of what scale constant is picked on top of it. Same root-cause class this
 * project already solved once for O-TAL/D-TAL itself (see `talent.ts`'s own docstring on why a
 * single global scale "crushed every PG's defense" and had to be anchored per-position instead).
 *
 * Fix applied here: PG gets its OWN baseline, anchored to the position's own p75 (93, not the
 * universal 50) — only genuinely elite-for-a-PG passing quality (Nash/Stockton/Magic/CP3/Kidd
 * territory) earns anything; a merely-good PG passer (Kevin Johnson, score 92.1) now earns
 * nothing, which is exactly the named regression case fixed. Scale/cap both cut to roughly a
 * third of the wing version's magnitude on top of that (`MAX_PG_PLAYMAKING_BONUS` 1.5 vs wings'
 * 4.5) — genuinely "light" on two independent axes (a higher bar to clear, and a smaller reward
 * once cleared), not just one. `multiLevelScoringBonus` similarly reintroduced for PG at roughly
 * a third strength (cap 1.5 vs wings' 5) — checked its real PG qualification rate first (293 of
 * 1,121 real PG spans, 26%, clear the existing >=15%-share-in-all-three-zones gate; a real,
 * non-trivial population, not a rare edge case, which is exactly why it needs its own reduced
 * magnitude rather than reusing the wing-strength constants outright).
 *
 * **Verified against the exact two named regressions from the reverted attempt** before shipping
 * (Kevin Johnson/Stockton no longer tie Nash/Harden's O-TAL; the Stockton/Nash multi-level stack
 * specifically named as "directly responsible" for the original bug stays a modest, non-crowding
 * gap) — see this session's own before/after numbers in the project memory file. The still-open
 * "most PG spans auto-tagged Secondary Ball Handler" lead this docstring used to point to was
 * fixed separately, earlier the same day (`scripts/lib/rawPlayerData.ts`'s `classifyOffense`) —
 * not a factor in this change, since neither mechanism here reads `offensiveArchetype` at all.
 */

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
 * PG-specific, light version — see this file's own 2026-08-08 header entry for the full
 * reasoning. Anchored to the position's own p75 (93), NOT the universal `PLAYMAKING_BASELINE`
 * (50) the other positions use — a flat 50 baseline doesn't discriminate among point guards at
 * all (nearly every real PG clears it easily), so only genuinely top-quartile-for-the-position
 * passing quality earns anything here. Scale/cap both roughly a third of the wing version's.
 */
const PG_PLAYMAKING_BASELINE = 93;
/** Scale picked so the cap almost never actually engages, on purpose — checked the real excess
 * distribution first (`scripts/_pgBonusSaturation.ts`, deleted after use): PG excess above the
 * baseline runs a tight 0.6-6.4 (p90 6.2), so the first version's scale (0.3) made the cap bind
 * for the entire top quartile simultaneously — a uniform lift for "already elite," not real
 * differentiation, the exact failure this whole 2026-08-08 rework exists to avoid. At 0.22, even
 * the single highest real excess in the pool (6.4) lands at ~1.41, safely under the cap — the cap
 * is now a pure safety ceiling for a future above-pool entrant, not something real data hits. */
const PG_PLAYMAKING_SCALE = 0.22;
const MAX_PG_PLAYMAKING_BONUS = 1.5;

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

const PERIMETER_PLAYMAKING_POSITIONS: ReadonlySet<Position> = new Set(['SG', 'SF']);
const BIG_PLAYMAKING_POSITIONS: ReadonlySet<Position> = new Set(['PF', 'C']);

/** Real, quality-of-playmaking adjustment on top of the existing apg-volume term. Missing data
 * (a player the export doesn't cover — most of the pre-1996-97 pool, or anyone outside its
 * ~2,439 rows) returns 0, the same "no signal, no adjustment" default every other lookup in this
 * codebase uses — absence of data is not evidence of poor playmaking. PG uses its own
 * position-relative baseline/scale/cap (see `PG_PLAYMAKING_BASELINE`'s own docstring, 2026-08-08)
 * — additive-only there too, same as every other position here. */
export function playmakingSkillAdjustment(span: PlayerSpan): number {
  const score = playmakingScoreForPlayer(span);
  if (score === null) return 0;
  if (span.primaryPosition === 'PG') {
    const excess = score - PG_PLAYMAKING_BASELINE;
    return excess > 0 ? Math.min(MAX_PG_PLAYMAKING_BONUS, excess * PG_PLAYMAKING_SCALE) : 0;
  }
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
  const totals = runtimeZoneTotalsForSpan(span);
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
 * that isn't the two bidirectional playmaking terms above.
 *
 * **PG, 2026-08-08**: reintroduced at roughly a third strength (see this file's own header entry)
 * — this was the mechanism named as "directly responsible" for the original Stockton/Nash O-TAL
 * stacking bug, so unlike the playmaking-quality term above (which needed a fundamentally
 * different, position-relative baseline), this one keeps the exact same zone-share/efficiency-bar
 * logic and just turns the volume knob down hard. Checked the real PG qualification rate before
 * picking a magnitude: 293 of 1,121 real PG spans (26%) clear the existing >=15%-share gate — a
 * genuinely common shot profile for the position (any guard who mixes floaters/midrange with a
 * real three-ball and real rim pressure), not a rare case, which is exactly why a wing-strength
 * cap here would re-stack a real chunk of the position rather than separating a true handful of
 * outliers the way it does for wings/bigs.
 */
const MULTI_LEVEL_SCALE = 0.43;
const MAX_MULTI_LEVEL_BONUS = 5;
/** Unlike the playmaking-quality scale above, this excessSum distribution is genuinely WIDE
 * (checked, same script: p50 2.1, p75 5.9, p90 11.75, max 23.9 across the 293 qualifying PG
 * spans) — a real long tail of true outlier 3-level scorers, not a tight cluster. So the cap
 * SHOULD bind here, just further out than the first pass (which saturated at excessSum 10,
 * catching the top ~10% of qualifiers in one flat group) — 0.1/1.5 saturates at 15, past p90,
 * so only the genuine extreme tail shares the cap rather than a whole decile. */
const PG_MULTI_LEVEL_SCALE = 0.1;
const MAX_PG_MULTI_LEVEL_BONUS = 1.5;

/**
 * `ZONE_MIN_SHARE` alone isn't a volume gate, it's a SHARE gate — a career facilitator taking 8-9
 * shots a game who happens to spread them roughly evenly across rim/mid/three clears 15% share
 * in all three trivially, without being anything like a genuine high-volume 3-level scorer
 * (Dirk). Real per-game shot volume, not just the zone-share ratio, is what actually makes a
 * 3-level scoring profile hard to defend — reuses the same `LOW_USAGE_EFFICIENCY_REFERENCE_FGA`
 * (12) `talent.ts` already uses for "is this genuinely a low-usage span" elsewhere, rather than
 * inventing a second number for the same idea. Still load-bearing for PG now too (2026-08-08) —
 * same low-usage-facilitator false-positive risk applies there as much as it does for SG/SF.
 */
const MULTI_LEVEL_MIN_FGA = 12;

/**
 * 2026-08-08, found while validating the PG reintroduction above against Taylor top-10: Curry is
 * PG-tagged for every one of his spans and genuinely clears the 3-level bonus's zone-share gate
 * on several of them (real rim/mid/three volume, not a fluke) — including his own 2014-16 peak,
 * where it maxed the PG cap (+1.5) and pushed blended TAL 97->98, enough to jump him past
 * Jordan/LeBron in rank and drop the Taylor top-10 Spearman 0.891->0.782. This is the EXACT
 * failure `CURRY_GRAVITY_CAP` (talent.ts) already exists to prevent, just reached through a
 * different term that cap doesn't cover. Same fix, same asymmetry: gated OFF for blended TAL
 * (`computeTalent`'s own call passes `applyCurryException=true`) but left uncapped for the O-TAL
 * split view (`computeOffensiveTalent` passes false) — Curry's real 3-level scoring is still a
 * true, displayable fact about his offense; it just can't be what tips him past Jordan/LeBron in
 * the number that actually drafts and ranks players. Capped at 0, not just reduced, matching the
 * gravity cap's own "back to roughly its old effective level" standard — the pre-this-change
 * Taylor top-10 ordering (0.891) is the validated baseline this is restoring, not a new target.
 */
const CURRY_MULTI_LEVEL_CAP = 0;

export function multiLevelScoringBonus(span: PlayerSpan, applyCurryException: boolean = true): number {
  if (span.fga < MULTI_LEVEL_MIN_FGA) return 0;
  const shares = classifiedZoneShares(span);
  if (!shares) return 0;
  const totals = runtimeZoneTotalsForSpan(span)!;
  const zones: Array<['rim' | 'mid' | 'three', number, number]> = [
    ['rim', shares.rim, totals.rimFgm / Math.max(totals.rimFga, 1)],
    ['mid', shares.mid, totals.midFgm / Math.max(totals.midFga, 1)],
    ['three', shares.three, totals.threeFgm / Math.max(totals.threeFga, 1)],
  ];
  const qualifyingZones = zones.filter(([, share]) => share >= ZONE_MIN_SHARE);
  if (qualifyingZones.length < 3) return 0;
  const excessSum = qualifyingZones.reduce((sum, [zone, , acc]) => sum + Math.max(0, acc * 100 - ZONE_GOOD_PCT[zone]), 0);
  const isCurry = applyCurryException && normalizePlayerName(span.playerName) === normalizePlayerName('Stephen Curry');
  if (isCurry) return CURRY_MULTI_LEVEL_CAP;
  const scale = span.primaryPosition === 'PG' ? PG_MULTI_LEVEL_SCALE : MULTI_LEVEL_SCALE;
  const cap = span.primaryPosition === 'PG' ? MAX_PG_MULTI_LEVEL_BONUS : MAX_MULTI_LEVEL_BONUS;
  return Math.min(cap, excessSum * scale);
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
  const totals = runtimeZoneTotalsForSpan(span)!;
  const rimAccuracy = (totals.rimFgm / Math.max(totals.rimFga, 1)) * 100;
  const excess = rimAccuracy - RIM_FINISH_GOOD_PCT;
  return excess > 0 ? Math.min(MAX_RIM_FINISH_BONUS, excess * RIM_FINISH_SCALE) : 0;
}

/** Combined offense-side adjustment `talent.ts`'s `rawComponents` adds in alongside the
 * existing gravity/centerPlaymaking terms — kept as one call site so `rawComponents` doesn't
 * need to know about all three sub-mechanisms individually. `insideFinishingBonus` is still
 * always exactly 0 for PG (PF/C-gated by construction); the other two now contribute a small,
 * position-relative amount for PG too (2026-08-08, see this file's own header entry) — combined
 * PG max is 1.5 + 1.5 = 3 raw offense, well under wings'/bigs' own combined ceilings.
 * `applyCurryException` threads straight through to `multiLevelScoringBonus` — same parameter,
 * same meaning, as `rawComponents`'s own `applyCurryException` (talent.ts) for shooting gravity;
 * `computeTalent` passes true, the O-TAL/D-TAL split passes false. See `CURRY_MULTI_LEVEL_CAP`'s
 * own docstring for why this exists. */
export function playmakingThreeLevelOffenseAdjustment(span: PlayerSpan, applyCurryException: boolean = true): number {
  return playmakingSkillAdjustment(span) + multiLevelScoringBonus(span, applyCurryException) + insideFinishingBonus(span);
}
