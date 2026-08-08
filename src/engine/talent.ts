import type { OffensiveArchetype, PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { eraBaseline, positionAdjustedTsBaseline, LEAGUE_PACE_BASELINE } from './era';
import { computeDefensiveImpact } from './defense';
import { darkoDefenseBonus, darkoDefenseMalus } from './darkoCorrection';
import { hiddenValueBonus } from './historicalApmCorrection';
import { shootingGravity } from './shooting';
import { computeDefensiveTalent } from './defensiveTalent';
import { individualDefenseRate } from './defensiveAccolades';
import { ddpmCoverageForSpan, raptorCoverageForSpan } from './blendedDefenseLookup';
import { playoffPerformanceBonus } from './playoffPerformanceLookup';
import { playmakingThreeLevelOffenseAdjustment } from './playmakingThreeLevel';
// 2026-08-06: moved below defensiveTalent/defensiveAccolades on purpose — `portability.ts` (which
// this import cycles back through) now imports `computeDefensiveTalent` from THIS file, closing a
// real cycle: talent.ts -> portabilityCorrection.ts -> portability.ts -> talent.ts. Importing
// portabilityCorrection.ts before defensiveTalent/defensiveAccolades below meant the cycle
// re-entered talent.ts (and from there reached into defensiveAccolades.ts's own top-level consts)
// before those modules had finished initializing — a real `ReferenceError` on `AWARD_FIRST_YEAR`,
// reproduced on every cold app boot, not just a script-ordering fluke. Import order within a
// single file is otherwise cosmetic in acyclic code; it is load-bearing here specifically because
// of this cycle, so don't reorder this block without re-testing a cold browser load.
import { portabilityBonus } from './portabilityCorrection';

export { computeDefensiveImpact };
// D-TAL lives in its own file now (it has its own calibration — see defensiveTalent.ts), but
// stays re-exported here so every caller keeps importing the three judge metrics from one place.
export { computeDefensiveTalent };

/**
 * Talent is computed from box-score inputs rather than hand-typed per player,
 * so the whole rubric stays inspectable and tunable in one place instead of
 * baking ~120 arbitrary numbers into the dataset.
 *
 * This is a deliberately transparent stand-in for the proprietary models behind
 * Ben Taylor's tiered "value" grades and Basketball-Index's Offensive Talent /
 * O-LEBRON (their model weights and underlying data aren't public) — it borrows
 * the *shape* of those ideas (scoring rate, efficiency relative to a baseline,
 * creation, defensive activity + role) without pretending to reproduce them exactly.
 *
 * Two era-normalization adjustments, per historical NBA trends (rules/pace changed
 * a lot across decades — see Basketball-Reference's Pace Factor glossary entry):
 * - Relative TS% (player TS% - that decade's league-average TS%) replaces a flat
 *   efficiency baseline, since "average" scoring efficiency itself has shifted a lot.
 * - A decade-level pace factor scales counting rates (ppg/rpg/apg/stocks) toward a
 *   common ~100-possession basis, since 1960s teams played ~125 poss/48 vs ~95-100
 *   today and would otherwise look inflated purely from more possessions, not more skill.
 * These are decade-granularity approximations, not exact season-by-season figures.
 */

/**
 * Modest position-specific correction, calibrated against real RAPM data
 * (scripts/validateAgainstRapm.ts): restricted to meaningfully-talented modern-era players
 * (talent >= 40, career starting 1994+, to dodge both bench-tier rank noise and the data-
 * coverage gap for pre-lineup-tracking careers), our box-score-only talent consistently
 * ranked players ahead of where their real plus-minus impact (RAPM) placed them — expected,
 * since box stats miss screening, spacing gravity, and defensive deterrence — but by very
 * different amounts per position. Median rank-divergence: PF -104, SG -80, C -71, PG -57,
 * SF -26. SF was the best-calibrated position, so it's the zero-correction baseline; the
 * others scale down from there, capped at a 7% reduction for the worst offender (PF) — a
 * deliberately modest first pass, not a full rebalance, revisit as more RAPM data arrives.
 */
const POSITION_TALENT_CORRECTION: Record<Position, number> = {
  PG: 0.972,
  SG: 0.952,
  SF: 1,
  PF: 0.93,
  C: 0.96,
};

/**
 * 2026-08-01, explicit user request: Magic Johnson's TAL is computed using SF's position
 * correction factor (1.0, the uncorrected baseline) instead of PG's (0.972) — a small,
 * deliberate +1 to +2 TAL bump matched against the same hypothetical position-swap dry-run
 * `talent.ts`'s own PG-vs-SF gap always produced for him. `span.primaryPosition` itself is
 * left completely untouched — he still shows, filters, and drafts as PG everywhere else in the
 * game (eligibility, position badges, roster-slot logic); only the TALENT NUMBER reads as if
 * he were SF. This is the SECOND named-player special case in the whole formula, after Curry's
 * shooting-gravity cap — both exist because the user asked for them directly, not because a
 * general rule produced them; don't extend this pattern to a third player without being asked.
 */
function positionCorrectionFor(span: PlayerSpan): number {
  if (normalizePlayerName(span.playerName) === normalizePlayerName('Magic Johnson')) {
    return POSITION_TALENT_CORRECTION.SF;
  }
  return POSITION_TALENT_CORRECTION[span.primaryPosition];
}

/** Assist rate above which marginal playmaking value tapers off, and the rate it tapers to.
 * John Stockton (13.7 apg peak) was landing as our highest-scored PG largely on the strength
 * of a linear playmaking term rewarding historically extreme assist volume at full value —
 * real, but inflated further than truly elite-but-more-moderate facilitators (Magic ~12.1-12.8,
 * Chris Paul ~11.3, Nash ~11.0). Threshold raised a third time (10 → 11.5) after direct
 * comparison against Magic's best span showed the previous threshold (10) was catching Magic's
 * own legitimately-elite 12.1 apg too — discounting the exact players this curve was supposed
 * to protect, not just Stockton's true outlier peaks (13.6-14.1). 11.5 sits just above
 * Magic/CP3/Nash's real range but well below Stockton's actual extremes, so it still tempers
 * what it was built for without collateral damage. Confirmed against real DARKO data first each
 * time: Stockton's real DDPM is a legitimately good +2 (not a "reputation exceeds reality"
 * case like Kobe/Billups), so this tempers the assist-volume inflation specifically, without
 * discounting his real defensive value. */
const PLAYMAKING_DIMINISHING_THRESHOLD = 11.5;
const PLAYMAKING_DIMINISHING_RATE = 0.15;

/**
 * 2026-08-05, user explicit ask: centers who genuinely create for others (Jokić, Domantas
 * Sabonis, prime Bill Walton) should separate further from traditional non-passing finishers
 * (McAdoo, Ewing, Dwight Howard) than the flat 1.7x playmaking term above credits them — checked
 * the real apg split first before picking a threshold: every span of McAdoo/Ewing/Howard in the
 * pool sits at apg <= 3.5 (mostly 1-2.5), while genuine playmaking bigs clear 4+ (Jokić 3.6-10.5,
 * Sabonis 2.5-7.7, Walton's real passing peak 4.0-4.4) — a clean gap, not an arbitrary cut.
 * Deliberately **additive-only** (a bonus, not a reweighting of the existing term): tried a true
 * reweighting first (raise the flat 1.7x multiplier for centers generally, or re-anchor around
 * the position's median apg so below-average passers lose credit) and rejected both — the real
 * median center apg (1.9, scripts/checkCenterApgDistribution.ts) sits almost exactly where
 * McAdoo/Ewing already are, so a median-relative penalty would be punishing "ordinary for the
 * position," not "empty stats," and this project's own durable lesson (blend-reweighting doesn't
 * work, only scoped additive bonuses do) already argued against the general-reweighting path
 * before this specific case reconfirmed it. This bonus can only ever raise a genuine passer,
 * never lower a non-passer's own number — McAdoo/Ewing/Howard fall in relative standing because
 * passers now separate further above them, not because their own TAL drops.
 */
const CENTER_PLAYMAKING_BONUS_APG_THRESHOLD = 4;
const CENTER_PLAYMAKING_BONUS_SCALE = 2.5;
const MAX_CENTER_PLAYMAKING_BONUS = 12;

function centerPlaymakingBonus(position: Position, apg: number, paceFactor: number): number {
  if (position !== 'C') return 0;
  const excess = effectivePlaymakingApg(apg) - CENTER_PLAYMAKING_BONUS_APG_THRESHOLD;
  if (excess <= 0) return 0;
  return Math.min(MAX_CENTER_PLAYMAKING_BONUS, excess * CENTER_PLAYMAKING_BONUS_SCALE) * paceFactor;
}

/** Below this FGA, the `efficiency` term (relativeTs * 140) gets scaled down — direct
 * comparison of Magic (1988-90: 14.6 FGA, 62.3% TS%) vs Stockton (1996-98: 8.7 FGA, 64.6% TS%)
 * found Stockton's efficiency term (17.3) actually BEATS Magic's (13.0), despite Magic's real
 * offensive engine being ~3x more valuable by Taylor's own numbers (Peak O 23.4 vs 8.1) — the
 * `positionAdjustedTsBaseline` usage slope only exists for SF/PF/C ("guards' TS% doesn't
 * meaningfully move with usage in the data" - confirmed in-dataset on average), so PG/SG get
 * zero discount for how much easier it is to convert efficiently at very low volume, no matter
 * how extreme. This doesn't touch that broader, separately-validated guard slope decision —
 * it's a narrower, asymmetric discount specifically for the extreme low-usage tail (never
 * boosts anyone, only ever reduces credit below the reference volume), matching Taylor's own
 * central critique of Stockton: he was rarely asked to create against real defensive pressure. */
const LOW_USAGE_EFFICIENCY_REFERENCE_FGA = 12;

/** Exported so `portability.ts` can apply the same discount to its own efficiency term — see
 * that file's 2026-07-31 note on why POR needed it too. */
export function lowUsageEfficiencyFactor(fga: number): number {
  return Math.min(1, fga / LOW_USAGE_EFFICIENCY_REFERENCE_FGA);
}

/**
 * 2026-08-01, user's follow-up after the whole defense-gate batch: Westbrook's real MVP
 * triple-double season (2016-17) reads a middling O-TAL, and Stockton's extreme assist volume
 * at genuinely low shot volume (11.7 FGA) still reads at the very top of the scale even after
 * `PLAYMAKING_DIMINISHING_THRESHOLD` already tempered it once. User's own diagnosis: shot volume
 * itself should scale how much offensive credit counts — carrying a real, high-FGA offensive
 * workload should count for more, and a very low shot-volume season should count for less,
 * because the box-score inputs (ppg/efficiency/apg) are being taken at face value regardless of
 * how much offense the player actually had to create against real defensive attention.
 *
 * Piecewise-linear over FGA, calibrated live against the pool rather than guessed: <9 FGA a big
 * discount, 9-12 a smaller one, 12-15 untouched, 15-18 a small bonus, 18+ a bigger one — the
 * user's own five-band spec, smoothed into a continuous ramp to avoid a hard cliff at any single
 * FGA value (same reasoning every other tiered mechanic in this project uses).
 *
 * Two scoping decisions, both added after the first unscoped version's dry-run blast radius came
 * back too broad:
 * - The BELOW-1.0 half only applies to `PLAYMAKER_ARCHETYPES` (Primary/Secondary Ball Handler).
 *   Unscoped, it hit every low-usage specialist regardless of role — Shane Battier, Danny Green,
 *   Alex Caruso, Kyle Korver all dropped 6-7 points on offense alone, despite this project's own
 *   POR/defensive-role mechanisms already crediting exactly that archetype fairly for what it
 *   actually contributes. Low shot volume only signals "this player deferred offensive load,"
 *   the thing Stockton's case is actually about, when the player was a real ball-handler to
 *   begin with.
 * - The WHOLE mechanism only applies once a span already reads All-star tier (70+) WITHOUT it —
 *   `USAGE_SCALE_MIN_TIER_TAL`. Keeps it from being what pushes a marginal role player's rating
 *   up or down; it only reshapes the ordering among players already established as good. Checked
 *   via `computeTalent`'s own gate below, not a separately-maintained threshold, so it can never
 *   drift out of sync with what "All-star tier" actually means.
 */
const USAGE_SCALE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [6, 0.65],
  [9, 0.8],
  [12, 0.96],
  [15, 1.0],
  [18, 1.08],
  [22, 1.18],
];
const PLAYMAKER_ARCHETYPES: ReadonlySet<OffensiveArchetype> = new Set(['Primary Ball Handler', 'Secondary Ball Handler']);
const USAGE_SCALE_MIN_TIER_TAL = 70;

function usageOffenseScale(span: PlayerSpan): number {
  const fga = span.fga;
  let scale = USAGE_SCALE_POINTS[USAGE_SCALE_POINTS.length - 1][1];
  if (fga <= USAGE_SCALE_POINTS[0][0]) {
    scale = USAGE_SCALE_POINTS[0][1];
  } else {
    for (let i = 1; i < USAGE_SCALE_POINTS.length; i++) {
      const [x1, y1] = USAGE_SCALE_POINTS[i - 1];
      const [x2, y2] = USAGE_SCALE_POINTS[i];
      if (fga <= x2) {
        scale = y1 + ((fga - x1) / (x2 - x1)) * (y2 - y1);
        break;
      }
    }
  }
  if (scale < 1.0 && !PLAYMAKER_ARCHETYPES.has(span.offensiveArchetype)) return 1.0;
  return scale;
}

function effectivePlaymakingApg(apg: number): number {
  if (apg <= PLAYMAKING_DIMINISHING_THRESHOLD) return apg;
  return PLAYMAKING_DIMINISHING_THRESHOLD + (apg - PLAYMAKING_DIMINISHING_THRESHOLD) * PLAYMAKING_DIMINISHING_RATE;
}

/** Position-relative thresholds (90th percentile of pace-adjusted rpg within that position,
 * from the full dataset) above which a player's rebounding is genuinely exceptional FOR THEIR
 * POSITION. Motivated by Magic Johnson: his 7.2 rpg (elite for a 6'9" guard — Ben Taylor's own
 * Backpicks GOAT #10 writeup puts it at the 92nd+ percentile, this project's own data
 * independently places it between the 97th-99th percentile for PGs) was already fully counted
 * at its flat per-position-agnostic weight inside `computeDefensiveImpact`, but that raw total
 * (15.6) still landed below `DEFENSE_FLOOR` (20) with zero possible DARKO bonus (no real
 * plus-minus data exists pre-1997) — so his genuinely rare rebounding skill was reading no
 * differently than a guard with no rebounding value at all. This is a second, separate,
 * one-directional bonus (never subtracts) for exceeding your OWN position's realistic range.
 *
 * Deliberately restricted to guards (PG/SG) only — tried it for all five positions first and
 * it also meaningfully boosted forwards (Bird, LeBron), whose Wing-Stopper-tier role weight and
 * normal rebounding credit already reward them plenty; "well above the 90th percentile for
 * rebounding at your position" is a common, already-well-served trait for forwards/bigs, but a
 * genuinely rare, currently-invisible one for guards — which is specifically what Magic's case
 * was about. Restricting scope to where the real gap actually is avoided double-crediting
 * players the existing mechanisms already handle well. */
const REBOUND_VERSATILITY_THRESHOLD: Partial<Record<Position, number>> = {
  PG: 4.4,
  SG: 4.9,
};
const REBOUND_VERSATILITY_SCALE = 2;
const MAX_REBOUND_VERSATILITY_BONUS = 5;

function reboundingVersatilityBonus(span: PlayerSpan, paceFactor: number): number {
  const threshold = REBOUND_VERSATILITY_THRESHOLD[span.primaryPosition];
  if (threshold === undefined) return 0;
  const adjustedRpg = span.box.rpg * paceFactor;
  const excess = adjustedRpg - threshold;
  return excess > 0 ? Math.min(MAX_REBOUND_VERSATILITY_BONUS, excess * REBOUND_VERSATILITY_SCALE) : 0;
}

/** Floor under the defense component's downside — asymmetric, same one-directional philosophy
 * as the DARKO bonus (only ever helps, never hurts). Steve Nash, Luka Dončić, and Damian
 * Lillard are all genuinely elite offensive engines whose box-score defense reads as close to
 * zero (Nash: 0.8 spg/0.1 bpg) — real, not a bug, but the fixed 0.6/0.4 offense/defense blend
 * was punishing that harder than their real overall value warranted (Nash's own offense score
 * is actually *higher* than Stockton's, yet he landed 15 points lower overall pre-fix). A flat
 * floor barely touches bigs (rebounding alone usually clears it) and doesn't reward genuinely
 * elite defenders any less — it only lifts the true "defensive non-factor" tail. */
const DEFENSE_FLOOR = 20;

/** Extra offense credit for real shooting gravity (volume x era-relative 3PT efficiency,
 * `shootingGravity()` in shooting.ts — the same signal already driving `isPlusShooter` and
 * `portability.ts`), on top of whatever TS% alone captures. TS% rewards an efficient 3PT
 * shooter some, but doesn't separately value the floor-spacing/movement-shooter skill the way
 * a dedicated bonus does — Klay Thompson's 2015-16 peak (61) undersold a real, elite shooting
 * specialist relative to how the community actually values that skill. Non-shooters (Duncan,
 * Hakeem, Garnett — near-zero gravity) are essentially untouched, while genuine shooting
 * specialists (Klay, Reggie Miller, Ray Allen, Korver) all move meaningfully. Capped: an
 * uncapped version pushed Curry (already near the ceiling) past Jordan/LeBron to #1 overall,
 * directly contradicting Taylor's own list (Curry at #7) and dropping the top-10 Spearman
 * from 0.842 to 0.661 — the cap keeps the bonus useful for the mid-tier specialists it's
 * actually meant for without letting it distort the already-correct top of the scale.
 *
 * A second, explicit exception for Curry specifically: raising the general cap to help real
 * specialists (Klay, Miller, Allen, Korver) more reopens the exact #1-overall problem above,
 * since Curry's own shooting gravity is the highest in the dataset and would ride the same
 * higher cap right past Jordan/LeBron again. Rather than hold the whole specialist tier's
 * bonus hostage to Curry's one outlier case, his own bonus is clamped back down to roughly its
 * old effective level while everyone else gets the new, higher cap — a deliberate, one-off
 * named-player exception (every other fix in this file is a general rule or a documented data
 * correction; this is the first case where no general rule fit without either overcorrecting
 * Curry or undercorrecting everyone else). */
const SHOOTING_GRAVITY_SCALE = 12;
const MAX_SHOOTING_GRAVITY_BONUS = 5;
const CURRY_GRAVITY_CAP = 3;

/** Shared by computeTalent and the O-TAL/D-TAL split below, so both read off the exact same
 * underlying offense/defense numbers instead of two formulas drifting apart over time.
 *
 * `applyCurryException` gates the named Curry gravity-cap exception (see
 * `CURRY_GRAVITY_CAP` above) — it exists solely to keep blended TAL from putting Curry
 * past Jordan/LeBron, and was never validated against the O-TAL/D-TAL split views. Left
 * on, it was suppressing Curry's own O-TAL below Steve Nash's (96 vs 97) — the opposite of
 * "best-in-position." `computeTalent` passes true; the split metrics pass false so every
 * player's split reads off the same uncapped gravity term. */
function rawComponents(
  span: PlayerSpan,
  applyCurryException: boolean,
  usageScale: number = 1.0,
): { offense: number; defense: number } {
  const { box } = span;
  const { pace } = eraBaseline(span.spanLabel);
  const paceFactor = LEAGUE_PACE_BASELINE / pace;
  const adjustedAvgTs = positionAdjustedTsBaseline(span.primaryPosition, span.fga, span.spanLabel);

  const scoringRate = box.ppg * paceFactor * 0.9;
  const relativeTs = box.tsPct - adjustedAvgTs;
  const efficiency = relativeTs * 140 * lowUsageEfficiencyFactor(span.fga);
  const playmaking = effectivePlaymakingApg(box.apg) * paceFactor * 1.7;
  const centerPlaymaking = centerPlaymakingBonus(span.primaryPosition, box.apg, paceFactor);
  const isCurry = normalizePlayerName(span.playerName) === normalizePlayerName('Stephen Curry');
  const gravityCap = applyCurryException && isCurry ? CURRY_GRAVITY_CAP : MAX_SHOOTING_GRAVITY_BONUS;
  const gravity = Math.max(-gravityCap, Math.min(gravityCap, shootingGravity(span) * SHOOTING_GRAVITY_SCALE));
  // 2026-08-07, user explicit ask: playmaking quality (beyond apg volume) and real 3-level/
  // rim-finishing scoring efficiency, from the same 2026-08-07 CSV batch `offensiveProfile.ts`
  // already reads for fit/synergy — see playmakingThreeLevel.ts for the full reasoning per
  // mechanism. Framed as an open-direction experiment, not a finished calibration.
  const playmakingThreeLevel = playmakingThreeLevelOffenseAdjustment(span);
  const offense = (scoringRate + efficiency + playmaking + centerPlaymaking + gravity + playmakingThreeLevel) * usageScale;

  // Real DARKO plus-minus data (where it exists, 1997-98+) can reveal defensive value the
  // box score alone can't see (see darkoCorrection.ts) — Garnett and Duncan are the clearest
  // cases, both stuck at 78 from box stats alone despite historically strong real DDPM.
  const defense = Math.max(
    computeDefensiveImpact(span) + darkoDefenseBonus(span) - darkoDefenseMalus(span) + reboundingVersatilityBonus(span, paceFactor),
    DEFENSE_FLOOR,
  );

  return { offense, defense };
}

/** The same offense/defense blend `computeTalent` scores against, exposed so
 * `historicalApmCorrection.ts` can regress real value against it without importing
 * `computeTalent` itself — the same circular-import concern `defense.ts`'s own header comment
 * documents for `darkoCorrection.ts`. */
export function rawTalentBlend(span: PlayerSpan): number {
  const { offense, defense } = rawComponents(span, true);
  return offense * 0.6 + defense * 0.4;
}

/**
 * Two-way synergy bonus: the fixed 0.6/0.4 offense/defense blend rewards a strongly
 * one-sided profile over a genuinely balanced two-way one at a similar blended level — found
 * directly comparing Chris Mullin (TAL 84, OTAL 83 / DTAL 39, one-way scorer) against Scottie
 * Pippen / Kawhi Leonard / Paul George (81/80/78 pre-fix, each strong on BOTH ends but never
 * as one-sidedly dominant as Mullin's offense). Additive, capped, and scaled off the WEAKER of
 * the two position-normalized components (the same anchoring O-TAL/D-TAL use), so it only ever
 * rewards a genuinely balanced profile and can't fire for a one-way player no matter how
 * dominant that one side is. Checked against Jayson Tatum first, who looked like it should
 * qualify too — his DTAL sits at the floor, but that's corroborated by his own real DARKO DDPM
 * (`darkoDefenseBonus` returns ~0 for nearly every span), not a data gap like Duncan/Garnett's
 * was — so the bonus correctly does NOT fire for him, matching what the real data says rather
 * than the pre-fix assumption.
 */
const TWO_WAY_SYNERGY_THRESHOLD = 45;
const TWO_WAY_SYNERGY_SCALE = 1.0;
const MAX_TWO_WAY_SYNERGY_BONUS = 7;

/** Position-normalized 0-100 read of the same offense/defense components used by O-TAL/D-TAL
 * (see the split functions below) — shared by the two-way synergy bonus and the high-usage
 * penalty so both judge "real defensive value" the same way. */
function normalizedComponents(span: PlayerSpan, offense: number, defense: number): { normalizedOffense: number; normalizedDefense: number } {
  const { scale: offScale, intercept: offIntercept } = OFFENSE_TAL_PARAMS[span.primaryPosition];
  const normalizedOffense = Math.max(0, Math.min(100, offense * offScale + offIntercept));
  const defScale = DEFENSE_TAL_SCALE_BY_POSITION[span.primaryPosition];
  const normalizedDefense = Math.max(0, Math.min(100, DEFENSE_FLOOR + (defense - DEFENSE_FLOOR) * defScale));
  return { normalizedOffense, normalizedDefense };
}

/**
 * Corroboration gate for the synergy bonus and usage penalty below — 2026-07-31, the user's
 * PG/SG/SF/PF/C batch report. Both mechanisms key off `normalizedDefense`, which reads real
 * DARKO plus-minus where it exists (1997-98+) but is otherwise pure box volume (rebounds/
 * steals/blocks) scaled per position by `DEFENSE_TAL_SCALE_BY_POSITION` — the same scale
 * `defensiveTalent.ts` diagnosed as needing an `UNCORROBORATED_CEILING` for its own DISPLAY
 * metric (Charles Barkley graded A-, Chris Mullin B+ off pure uncorroborated volume, both
 * confirmed weak defenders — Barkley by Ben Taylor's own writing, Mullin by this project's own
 * two-way-synergy docstring calling him "a one-way scorer") — but that fix was only ever
 * applied to the D-TAL badge, never to this gate. Direct evidence it was still live here:
 * Barkley's 1989-91 span (normalizedDefense 66.2, fully uncorroborated — pre-1997, no DARKO
 * possible, never made an All-Defense team) was earning the full +7 synergy MAX off box volume
 * alone, and Mullin's 1990-92 span (48.7, same story) was earning a real +3.73 — the exact
 * failure mode the display fix already solved, just never ported to the number that actually
 * computes TAL.
 *
 * The inverse problem sat right next to it: real, DARKO-corroborated modern defenders were
 * landing just under the flat 45 synergy threshold and getting nothing — Dwyane Wade (44.2,
 * missing by 0.8 despite Taylor calling him "perhaps the best rim protector for a guard in NBA
 * history," new-ladder D-TAL 86), Jimmy Butler (39.8, D-TAL 82), OG Anunoby (37.6, D-TAL 81),
 * Evan Mobley (39.1, D-TAL 67), Pau Gasol (37.5, D-TAL 56) all missed the gate on box-only
 * volume despite having a real, confirmed defensive signal the gate wasn't reading at all.
 *
 * One mechanism fixes both directions: corroborated defense (a real positive DARKO bonus, OR
 * an individual defense accolade — same "corroborated" definition `defensiveTalent.ts` already
 * uses and already validated there) gets a flat lift into the gate's range; uncorroborated
 * defense gets capped below the synergy threshold entirely, so pure pre-1997 box volume can no
 * longer buy a two-way bonus for a player nothing confirms is actually a plus defender. Applied
 * ONLY to the `twoWaySynergyBonus`/`highUsageLowPlaymakingPenalty` gate — NOT to
 * `normalizedDefenseForFit`, which POR's `usagePenaltyOffset` depends on and must stay
 * bit-identical to the pre-change formula on purpose (see that function's own docstring).
 */
const CONFIRMED_DEFENSE_GATE_BONUS = 12;
const PARTIAL_DEFENSE_GATE_BONUS = 9;
const DUAL_SOURCE_BIG_GATE_BONUS = 17;
const UNCORROBORATED_DEFENSE_GATE_CAP = 40;

/**
 * 2026-07-31, same-day follow-up: user pointed at Dirk Nowitzki specifically ("still
 * underrated") after the corroboration gate above already shipped. Checked his real data
 * directly rather than assume — his raw defense is real and POSITIVE in both sources (DARKO
 * +1.00, RAPTOR +1.09), just short of what his specific box-score profile predicts (excess
 * -0.18/-0.59), so `darkoDefenseBonus` correctly reads 0 for him — that's not "no data," and
 * it's not "real data says he's bad," it's "real data confirms he's a genuine plus defender,
 * just not one whose real value exceeds his own box-score expectation." The binary gate above
 * couldn't tell that apart from Magic Johnson (zero coverage from either source) or Russell
 * Westbrook/Anthony Edwards/Pau Gasol's specific spans (real coverage that reads NEGATIVE) —
 * all three read identically as "uncorroborated" even though only Dirk's case has an actual
 * positive real reading behind it.
 *
 * This third tier is deliberately smaller than the full corroboration bonus (9 vs 12) — a
 * positive-but-not-exceeding-expectation reading is real signal, but weaker signal than a
 * confirmed excess or an All-Defense selection, so it shouldn't buy the same credit. Checked
 * against the full draft pool before shipping, not just Dirk: Duncan/Garnett/Ben Wallace/
 * Barkley/Mullin/Magic/Westbrook/Edwards/Gasol's specific spans are all exactly unchanged (the
 * first three still hit the confirmed tier and were never at risk; the last six have zero or
 * negative raw coverage, so this tier structurally can't reach them) — 61 pool spans move in
 * total, all real defenders with a positive-but-modest real reading (Dwyane Wade's 2005-07 span,
 * Elton Brand across several spans, Shawn Marion, Doug Christie, Marc Gasol's 2009-11, Dwight
 * Howard's 2005-07), none of them a reopening of either bug the confirmed/uncorroborated tiers
 * were built to fix.
 *
 * **Fourth tier, same day, Pau Gasol specifically**: even the +9 partial tier wasn't enough for
 * him — checked directly why. His real defense is confirmed positive by BOTH sources
 * independently (DARKO +1.00, RAPTOR +1.16 on his 2009-11 span), not just a coverage-weighted
 * average, but he's tagged C, and `DEFENSE_TAL_SCALE_BY_POSITION.C` (2.04) is the lowest of any
 * position — the same confirmed real defense counts for less than half what it would for a PG
 * (5.13). +9 only brought his raw ~35 up to ~44, still short of the 45 needed for ANY synergy
 * credit. Two real, independent sources BOTH reading positive is at least as strong a signal as
 * a single source's excess (arguably stronger — it's agreement across methodologies, not just
 * one regression threshold), so a bigger bonus for spans with *both* sources independently
 * positive is defensible on its own terms, not just "make the number bigger until it moves."
 *
 * Scoped to PF/C only, at the user's explicit direction — dry-run testing at this bonus size
 * showed real, unrelated movement for non-bigs (Paul Pierce +6/+5, Kyle Lowry +4, neither part
 * of any complaint this session), while every C/PF beneficiary (Bogut, Bosh, Cousins, both
 * Gasols, Gortat, DeAndre Jordan, Turner, Whiteside, Kemp, Shaq, Dirk) is a plausible real
 * defender. Restricting to PF/C removes the off-target movement entirely without giving up the
 * bonus size bigs specifically needed. Verified again against the same anchor set (Duncan/
 * Garnett/Wallace/Barkley/Mullin/Magic/Westbrook/Edwards) before shipping — all exactly
 * unchanged, since the first three were already in the confirmed tier and the rest have zero or
 * negative raw coverage.
 */
function hasPositiveRawDefense(span: PlayerSpan): boolean {
  const ddpm = ddpmCoverageForSpan(span);
  const raptor = raptorCoverageForSpan(span);
  const parts = [ddpm, raptor].filter((c): c is { avg: number; count: number } => c !== null);
  if (parts.length === 0) return false;
  const totalWeight = parts.reduce((sum, p) => sum + p.count, 0);
  const avg = parts.reduce((sum, p) => sum + p.avg * p.count, 0) / totalWeight;
  return avg > 0;
}

function isDualSourceConfirmedBig(span: PlayerSpan): boolean {
  if (span.primaryPosition !== 'PF' && span.primaryPosition !== 'C') return false;
  const ddpm = ddpmCoverageForSpan(span);
  const raptor = raptorCoverageForSpan(span);
  return !!ddpm && !!raptor && ddpm.avg > 0 && raptor.avg > 0;
}

function synergyGateDefense(span: PlayerSpan, normalizedDefense: number): number {
  const corroborated = darkoDefenseBonus(span) > 0 || individualDefenseRate(span) > 0;
  if (corroborated) return Math.min(100, normalizedDefense + CONFIRMED_DEFENSE_GATE_BONUS);
  if (isDualSourceConfirmedBig(span)) return Math.min(100, normalizedDefense + DUAL_SOURCE_BIG_GATE_BONUS);
  if (hasPositiveRawDefense(span)) return Math.min(100, normalizedDefense + PARTIAL_DEFENSE_GATE_BONUS);
  return Math.min(normalizedDefense, UNCORROBORATED_DEFENSE_GATE_CAP);
}

function twoWaySynergyBonus(normalizedOffense: number, normalizedDefense: number): number {
  const weaker = Math.min(normalizedOffense, normalizedDefense);
  return Math.min(MAX_TWO_WAY_SYNERGY_BONUS, Math.max(0, weaker - TWO_WAY_SYNERGY_THRESHOLD) * TWO_WAY_SYNERGY_SCALE);
}

/**
 * High-usage/low-playmaking discount: a player who shoots a lot without creating much for
 * teammates reads as more offensively valuable than a comparable shot-creator who also sets
 * others up — Chris Mullin/Adrian Dantley/Alex English (high FGA, ~2-5 apg) currently rate
 * alongside genuine two-way wings despite a narrower offensive game.
 *
 * Deliberately gated on weak defense (same normalized DTAL as the synergy bonus above), NOT a
 * flat FGA/APG ratio — checked directly first and a flat ratio penalty would have hit Paul
 * George (4.80 FGA/APG) and Jayson Tatum HARDER than it hits Mullin (4.15) or English (4.08),
 * since high-usage wing scorers who create relatively little for others aren't unique to
 * one-way players. The gate means this only fires for players a flat ratio check would wrongly
 * catch alongside Mullin/Dantley/English — real two-way wings (Pippen, Kawhi, PG) clear the
 * defense gate and the two-way bonus already rewards them instead.
 */
const HIGH_USAGE_FGA_THRESHOLD = 14;
const USAGE_RATIO_REFERENCE = 3.3;
const USAGE_RATIO_SCALE = 1.1;
const MAX_USAGE_RATIO_PENALTY = 6;
/** Below this, the penalty applies at full strength; at/above `USAGE_PENALTY_DEFENSE_GATE_END`
 * it's fully phased out. A hard cliff at a single value (45) let a big whose box defense reads
 * as merely decent-for-a-big (rebounding + role weight, not real plus defense) dodge the
 * penalty entirely just by clearing 45 by a point or two — Bob McAdoo (11.05 FGA/APG, the most
 * extreme ratio in the dataset, historically a defensive non-factor) landed at exactly this
 * kind of borderline defense reading and paid zero penalty despite being precisely the
 * "shoots a ton, creates for nobody" case this discount exists for. A linear phase-out over a
 * band still fully protects real two-way wings (Pippen/Kawhi/PG clear 53+ comfortably, past
 * the top of the band) while no longer giving borderline-defense bigs a free pass at the
 * cliff's edge. */
const USAGE_PENALTY_DEFENSE_GATE_START = 45;
const USAGE_PENALTY_DEFENSE_GATE_END = 60;

function usagePenaltyDefenseFactor(normalizedDefense: number): number {
  if (normalizedDefense <= USAGE_PENALTY_DEFENSE_GATE_START) return 1;
  if (normalizedDefense >= USAGE_PENALTY_DEFENSE_GATE_END) return 0;
  return 1 - (normalizedDefense - USAGE_PENALTY_DEFENSE_GATE_START) / (USAGE_PENALTY_DEFENSE_GATE_END - USAGE_PENALTY_DEFENSE_GATE_START);
}

function highUsageLowPlaymakingPenalty(span: PlayerSpan, normalizedDefense: number): number {
  if (span.fga < HIGH_USAGE_FGA_THRESHOLD) return 0;
  const gateFactor = usagePenaltyDefenseFactor(normalizedDefense);
  if (gateFactor <= 0) return 0;
  const ratio = span.fga / Math.max(span.box.apg, 0.5);
  const excess = ratio - USAGE_RATIO_REFERENCE;
  return excess > 0 ? Math.min(MAX_USAGE_RATIO_PENALTY, excess * USAGE_RATIO_SCALE) * gateFactor : 0;
}

/**
 * 2026-08-05, user explicit ask, direct follow-up on the McAdoo investigation: the gated penalty
 * above genuinely cannot reach him — checked empirically (not theorized), raising its cap did
 * nothing to his TAL — because his box defense (14.6 rpg, 2.7 bpg on his 1973-75 peak) is
 * corroborated by BPM2 (the only real-data source that covers a pre-DARKO/pre-RAPTOR span at
 * all), closing the defense gate entirely and even buying him two-way synergy credit on top. This
 * is a second, **ungated** version of the same "shoots a lot, creates little" idea, requested
 * specifically to work regardless of defense — a real GM does discount empty high-volume scoring
 * somewhat even from a good defender, this project just hadn't modeled that half of it yet.
 *
 * Reference (10.0) deliberately set well above `USAGE_RATIO_REFERENCE` (3.3, the wing/perimeter
 * threshold) — bigs structurally post much higher FGA/APG ratios than wings just by playing a
 * post-up role. Checked every validated elite two-way big's own ratio directly before picking the
 * threshold: Hakeem's highest span 9.63 (1987-89), Ewing's highest 9.95 (1991-93), Anthony
 * Davis's highest 9.8 (2015-17), Mourning's highest 9.06 (1998-00) — all comfortably under 10, so
 * none of them pick up any penalty here. McAdoo's 1973-75 span (11.05, the named motivating case)
 * clears it by only ~1, so the scale (3, vs. the gated penalty's 1.1) is set higher specifically
 * so a real outlier still moves TAL meaningfully instead of by a fraction of a point — capped low
 * (4) so it nudges rather than dominates. Wilt Chamberlain (14-16.8) and Moses Malone (up to
 * 14.29) clear the cap outright and land at the full -4 — both have real, independently
 * documented "empty stats" critiques in actual basketball analysis, not just a side effect of
 * this specific fix. Full validation (Taylor Top-10 / Backpicks GOAT-40) re-run after shipping.
 */
const EXTREME_USAGE_RATIO_REFERENCE = 10;
const EXTREME_USAGE_RATIO_SCALE = 3;
const MAX_EXTREME_USAGE_PENALTY = 4;

export function extremeUsageRatioPenalty(span: PlayerSpan): number {
  if (span.fga < HIGH_USAGE_FGA_THRESHOLD) return 0;
  const ratio = span.fga / Math.max(span.box.apg, 0.5);
  const excess = ratio - EXTREME_USAGE_RATIO_REFERENCE;
  return excess > 0 ? Math.min(MAX_EXTREME_USAGE_PENALTY, excess * EXTREME_USAGE_RATIO_SCALE) : 0;
}

/** The shared pipeline `computeTalent` runs twice — once at `usageScale=1.0` to establish the
 * base tier for `USAGE_SCALE_MIN_TIER_TAL`'s gate, and again with the real usage scale if that
 * gate passes. Returns the uncapped, unrounded scaled value; callers clamp/round/soft-cap. */
function talentScaled(span: PlayerSpan, usageScale: number): number {
  const { offense, defense } = rawComponents(span, true, usageScale);
  const raw = offense * 0.6 + defense * 0.4;
  const { normalizedOffense, normalizedDefense } = normalizedComponents(span, offense, defense);
  const gateDefense = synergyGateDefense(span, normalizedDefense);
  const synergy = twoWaySynergyBonus(normalizedOffense, gateDefense);
  const usagePenalty = highUsageLowPlaymakingPenalty(span, gateDefense);
  const extremeUsagePenalty = extremeUsageRatioPenalty(span);
  const hiddenValue = hiddenValueBonus(span);
  const portability = portabilityBonus(span);
  const playoffPerformance = playoffPerformanceBonus(span);

  // Squash into a 0-100 band; recalibrated (alongside the DARKO defense correction above) so
  // the true GOAT tier reaches ~97-99 instead of topping out at 91 — deep bench specialists
  // still land ~20-35, the low end wasn't touched by this pass.
  return (
    (raw * 2.15 + 6 + synergy - usagePenalty - extremeUsagePenalty + hiddenValue + portability + playoffPerformance) *
    positionCorrectionFor(span)
  );
}

/**
 * 2026-08-01, same day as the usage-scale addition above: with real FGA-based swings now
 * reaching several extra points at the very top of the scale, many genuinely different players
 * started landing on the exact same hard-clipped 100 — checked directly before shipping either
 * change: 15 spans clipped to 100 with UNCAPPED internal values ranging from 99.6 (Chris Paul)
 * to 120.7 (Jordan), a real 21-point spread being erased into one indistinguishable number. A
 * hard clip can't tell those apart; only spans whose true value already exceeds `SOFT_CAP_FLOOR`
 * are touched at all — anyone below it passes through completely unchanged, so this doesn't
 * reshape the scale generally, only the small handful of spans the clip was already flattening.
 * Values above the floor approach (never reach) `SOFT_CAP_CEILING` via an exponential decay
 * instead of clipping outright, so Jordan's 120.7 and Chris Paul's 99.6 now land at genuinely
 * different displayed numbers (99 vs 96) instead of both reading 100. `SOFT_CAP_K` controls how
 * quickly the approach saturates — larger spreads the tail out more, smaller snaps toward the
 * ceiling faster; 15 was chosen empirically to keep the four most extreme peak seasons on record
 * (Jordan/Jokić/LeBron/Curry) close together near 99 while still separating out spans that were
 * only reaching the old hard cap by a smaller margin (Chris Paul, Kevin Garnett, Giannis).
 *
 * **`SOFT_CAP_K` re-tuned 15 -> 35, 2026-08-05, user's explicit ask ("soft-cap u góry
 * rankingów") after the BPM2 fallback (see darkoCorrection.ts) pushed several pre-1998 legends
 * (Bird, Kareem, Magic) into real defensive credit for the first time, widening the pre-softcap
 * raw spread at the top from ~21 points (the original 2026-08-01 finding) to ~32 points (Jordan
 * 126.6 vs Chris Paul-tier 95-99) — K=15 was compressing 5-6 genuinely different raw values
 * (Jordan 126.6 down to Kareem 114.1) into the identical rounded 99, which is exactly the
 * "different players, same displayed number" problem this whole mechanism exists to prevent.
 * Grid-searched (`scripts/_softCapGrid3.ts`, deleted after use) against Taylor top-10 Spearman
 * holding `SOFT_CAP_FLOOR` fixed at 95 (raising the floor instead was also tried — floor=97/k=15
 * scores comparably but lets Jordan's raw 126.6 round to a literal 100, reopening the exact
 * hard-cap collision this mechanism was built to avoid; widening K keeps the "approaches, never
 * reaches 100" property intact for every value tested). **K=34-42 is a stable plateau** (Taylor
 * 0.879, GOAT-40 0.658-0.663 throughout), not a fragile single-point optimum — 35 sits in the
 * middle of it. Confirmed no span reaches literal TAL=100 in this region (0 ceiling crowding,
 * same invariant the mechanism has held since 2026-08-01).
 *
 * **What this does and doesn't fix, reported honestly**: recovers the *rounding-crowding* half of
 * the BPM2-caused Taylor top-10 drop (0.806 true pre-BPM2 baseline -> 0.685 with BPM2 at the old
 * K=15 -> 0.879 with BPM2 at K=35, actually clearing the pre-BPM2 baseline). It can NOT fix a
 * separate, real disagreement already present in the RAW (pre-softcap) values: Shaquille O'Neal
 * (raw ~101.9) and Hakeem Olajuwon (raw ~111.2) sit below Larry Bird (~118.4) and Kareem
 * (~114.1) even before any capping, because BPM2 gave Bird/Kareem/Magic new real defensive
 * credit while Shaq/Hakeem/Duncan/Garnett already had full DARKO-era coverage and gained nothing
 * new — no softcap retune can reorder values that are already in the "wrong" order pre-cap; that
 * would need a raw-value-level fix (e.g. tempering the BPM2 bonus itself), not this mechanism.
 */
const SOFT_CAP_FLOOR = 95;
const SOFT_CAP_CEILING = 100;
const SOFT_CAP_K = 35;

function softCapTalent(scaled: number): number {
  if (scaled <= SOFT_CAP_FLOOR) return scaled;
  return SOFT_CAP_FLOOR + (SOFT_CAP_CEILING - SOFT_CAP_FLOOR) * (1 - Math.exp(-(scaled - SOFT_CAP_FLOOR) / SOFT_CAP_K));
}

/**
 * 2026-08-01, explicit user request: a PG whose O-TAL doesn't clear a real letter-grade bar
 * shouldn't be able to reach TAL's very top tiers purely off a corroborated-defense +
 * two-way-synergy stack — that combination is legitimate for a genuine two-way wing (Kawhi,
 * Duncan), but for a playmaking-only PG whose scoring/shot-creation reads as merely good (not
 * elite), it was producing Jason Kidd's 2001-03 peak (OTAL 69, a 'C+') at TAL 95, on par with
 * genuinely elite two-way peaks. Two tiers, using O-TAL's own letter-grade floors (`grades.ts`
 * — NOT imported directly, to avoid a circular module dependency, since grades.ts itself
 * imports `computeOffensiveTalent` from this file; the two numeric floors below are kept
 * in sync with `letterForValue`'s A/B cutoffs by hand):
 * - O-TAL grade A or better (>=90): uncapped, same as before.
 * - O-TAL grade B through A- (75-89): capped at 93, the top of the "MVP" overall tier — can't
 *   reach "Greatest peak" (94+) on offense alone being merely good-not-elite.
 * - O-TAL grade below B, i.e. B- or worse (<75): capped at 87, the top of "All-NBA" — can't
 *   reach "MVP" tier at all without at least a real B offensive letter grade. (The user's own
 *   spec was "below B", not "below B-" — an early draft of this comment/dry-run mismatched the
 *   two, caught and fixed before this landed for real.)
 * Checked the full blast radius before shipping: 14 PG spans move. Most are exactly the target
 * (Kidd 95->87, Gary Payton 91->87, Oscar Robertson 95/94->93) but real collateral hits real
 * players who happen to be PG-tagged for these specific spans by the position-share classifier
 * — LeBron's 2018-20/2019-21 Lakers point-guard stretches (97->93 each), Chris Paul (94-96->93
 * across four spans), Luka Dončić (94-96->93 across three spans), SGA 2023-25 (95->93) — user
 * explicitly reviewed this exact list and confirmed "looking good" before shipping.
 */
const PG_OFFENSE_GRADE_A_FLOOR = 90;
const PG_OFFENSE_GRADE_B_FLOOR = 75;
const PG_MVP_TIER_CAP = 93;
const PG_ALL_NBA_TIER_CAP = 87;

function pgOffenseGradeCeiling(span: PlayerSpan): number {
  if (span.primaryPosition !== 'PG') return 100;
  const otal = computeOffensiveTalent(span);
  if (otal >= PG_OFFENSE_GRADE_A_FLOOR) return 100;
  if (otal >= PG_OFFENSE_GRADE_B_FLOOR) return PG_MVP_TIER_CAP;
  return PG_ALL_NBA_TIER_CAP;
}

/**
 * 2026-08-01, same batch: the mirror-image case the O-TAL cap above can't reach — a PG whose
 * SCORING/creation grades A (Harden, Lillard) doesn't get touched by `pgOffenseGradeCeiling`,
 * but real defense grading below a 'C' (<60) is just as disqualifying from "Greatest peak" as
 * weak offense is. Single tier, not two — the user's ask was specifically "below C ... max in
 * MVP tier", no second All-NBA-tier band requested here. Checked the blast radius before
 * shipping: only 4 spans move, cleanly hitting the two names the O-TAL cap missed (Harden
 * 2018-20 97->93, Lillard 2019-21 96->93) plus two 1-point trims (Curry 2017-19, Harden
 * 2016-18, both 94->93) — no collateral on Jordan/LeBron/Duncan/Magic/etc., all comfortably
 * clear 60 on defense.
 */
const PG_DEFENSE_GRADE_C_FLOOR = 60;

function pgDefenseGradeCeiling(span: PlayerSpan): number {
  if (span.primaryPosition !== 'PG') return 100;
  return computeDefensiveTalent(span) >= PG_DEFENSE_GRADE_C_FLOOR ? 100 : PG_MVP_TIER_CAP;
}

/**
 * 2026-08-01, same batch, mirrored onto SF: O-TAL below a 'B+' letter grade (<80) caps at the
 * MVP tier top (93) — can't reach "Greatest peak" on offense that isn't at least borderline-
 * elite. Single tier, matching the user's exact spec. Checked before shipping: 6 spans move
 * (Bird's two non-peak spans, LeBron 2006-08, both Kawhi spans, Paul George 2018-20) — none of
 * them are these players' own peak span used in Taylor top-10 validation.
 */
const SF_OFFENSE_GRADE_B_PLUS_FLOOR = 80;

function sfOffenseGradeCeiling(span: PlayerSpan): number {
  if (span.primaryPosition !== 'SF') return 100;
  return computeOffensiveTalent(span) >= SF_OFFENSE_GRADE_B_PLUS_FLOOR ? 100 : PG_MVP_TIER_CAP;
}

/**
 * 2026-08-01, same batch: SF's defense mirror, two tiers this time (user's exact spec) — below
 * a 'C' D-TAL grade (<60) caps at All-NBA top (87), below 'D+' (<50) caps at All-star top (79).
 * **Kevin Durant is explicitly excluded** — his 2010-14/2016-19 spans would otherwise take the
 * single largest single-mechanism hit in the whole formula (2012-14 peak: 97->87, a 10-point
 * drop), and the user's explicit call, after seeing that exact number, was to leave his real
 * rating standing rather than ship it. This is the THIRD named-player special case in the whole
 * formula, after Curry's shooting-gravity cap and Magic's SF position-correction override —
 * still exceptional, not a pattern to extend to a fourth player without being asked again.
 */
const SF_DEFENSE_GRADE_C_FLOOR = 60;
const SF_DEFENSE_GRADE_D_PLUS_FLOOR = 50;
const SF_ALL_NBA_TIER_CAP = 87;
const SF_ALL_STAR_TIER_CAP = 79;

function sfDefenseGradeCeiling(span: PlayerSpan): number {
  if (span.primaryPosition !== 'SF') return 100;
  if (normalizePlayerName(span.playerName) === normalizePlayerName('Kevin Durant')) return 100;
  const dtal = computeDefensiveTalent(span);
  if (dtal >= SF_DEFENSE_GRADE_C_FLOOR) return 100;
  if (dtal >= SF_DEFENSE_GRADE_D_PLUS_FLOOR) return SF_ALL_NBA_TIER_CAP;
  return SF_ALL_STAR_TIER_CAP;
}

/**
 * 2026-08-01, found while investigating an 18-second `autoFinishDraft` hang: `computeTalent`
 * now internally calls `computeOffensiveTalent`/`computeDefensiveTalent` a second time (for the
 * PG/SF grade-ceiling checks above), on top of its own two-pass usage-scale computation — a
 * real cost per call. `pickForAi`'s candidate-scoring loop calls `computeTalent` fresh for
 * every one of ~2,800 remaining players on EVERY one of 144 picks, with no caching, so that
 * extra cost compounds badly (profiled: ~17s of an 17.3s auto-finish was inside `pickForAi`
 * alone, and removing the newest durability multiplier changed nothing — this cost already
 * existed). A span's own data never changes during a session, so `computeTalent(span)` is a
 * pure function of `span.id` for the lifetime of the app — safe to memoize globally, unlike
 * `bestPrimaryAssignment`'s own per-call cache (rotation.ts), which is scoped narrower because
 * it also depends on which SLOT a player is being valued for.
 */
const talentCache = new Map<string, number>();

/**
 * 2026-08-07, user explicit ask (the "GOAT" display tier, grades.ts): what `computeTalent` would
 * read WITHOUT the final `[0,100]` clamp or the soft-cap's asymptotic approach-to-100 — exposing
 * the real internal spread the soft-cap exists to compress (Jordan's own peak spans run well
 * past 100 raw; see `SOFT_CAP_K`'s own docstring for the concrete numbers from the session that
 * built it). Mirrors `computeTalent`'s own two-pass usage-scale logic exactly (same gate on the
 * SAME clamped/rounded `baseTal`, so which pass "wins" never disagrees between the two
 * functions), just skips `softCapTalent`/the clamp/the PG-SF grade-ceiling `Math.min` at the very
 * end. Display-only — nothing in the engine reads this for talent, draft value, or sorting;
 * grades.ts's `displayNumberForSpan` is the only caller.
 */
export function rawUncappedTalent(span: PlayerSpan): number {
  const baseScaled = talentScaled(span, 1.0);
  const baseTal = Math.max(0, Math.min(100, Math.round(softCapTalent(baseScaled))));
  const scaled = baseTal < USAGE_SCALE_MIN_TIER_TAL ? baseScaled : talentScaled(span, usageOffenseScale(span));
  return Math.round(scaled);
}

export function computeTalent(span: PlayerSpan): number {
  const cached = talentCache.get(span.id);
  if (cached !== undefined) return cached;

  const ceiling = Math.min(
    pgOffenseGradeCeiling(span),
    pgDefenseGradeCeiling(span),
    sfOffenseGradeCeiling(span),
    sfDefenseGradeCeiling(span)
  );
  const baseScaled = talentScaled(span, 1.0);
  const baseTal = Math.max(0, Math.min(100, Math.round(softCapTalent(baseScaled))));
  if (baseTal < USAGE_SCALE_MIN_TIER_TAL) {
    const result = Math.min(baseTal, ceiling);
    talentCache.set(span.id, result);
    return result;
  }

  const scaledWithUsage = talentScaled(span, usageOffenseScale(span));
  const finalTal = Math.max(0, Math.min(100, Math.round(softCapTalent(scaledWithUsage))));
  const result = Math.min(finalTal, ceiling);
  talentCache.set(span.id, result);
  return result;
}

/**
 * O-TAL / D-TAL: the same two components above, shown as their own independent 0-100 numbers
 * instead of pre-blended into one TAL score — "how good is this player offensively" and
 * "...defensively" as separate questions, e.g. Nash reads high O-TAL / low D-TAL rather than a
 * single 79 TAL that hides the split. These reuse rawComponents() but need their own scale
 * constants — TAL's own (raw*2.15+6) is calibrated for the *blended* raw (offense*0.6+defense
 * *0.4), so running pure offense through it alone blows past 100 well before the intercept even
 * applies.
 *
 * Scaled **per position**, not against the whole pool. A single global scale was tried first
 * and anchored against whoever's most extreme across all five positions — Ben Wallace/Hakeem
 * for defense, Curry/Nash for offense — which are all centers/guards. That crushed every PG's
 * D-TAL near the floor (compared to shot-blocking centers, nearly every PG reads as a
 * non-defender) and every big's O-TAL toward the bottom (compared to elite offensive guards,
 * nearly every center reads as offensively limited) — real box-score differences by role, but
 * it made "who's the best defensive PG" or "who's a genuinely good offensive center" unreadable
 * from the number. Each position's scale is instead anchored to its own 1st/99th raw-component
 * percentile (via scripts/tmpPositionComponents.ts, ~2,500-2,700 spans per position from the
 * full dataset) — a plus PG defender (Gary Payton-tier) and a plus C defender (Ben Wallace-tier)
 * can both land in the 80s-90s on D-TAL, judged against their own position's realistic range
 * rather than the single global extreme. The defense floor (DEFENSE_FLOOR, applied before this
 * split) still reads as a plain ~20 at every position — "no real box-score defensive activity"
 * means the same thing regardless of position.
 *
 * The high anchor for each position is its own *max* raw value, not the 99th percentile — the
 * dataset has many overlapping 3-year career windows per curated star, so a p99 cutoff let
 * several windows of the same handful of all-time defenders (Duncan, Garnett, Hakeem, Wallace,
 * Jordan) all clear the threshold and flatten together at 100, erasing exactly the "who's the
 * best of the best" separation this split is supposed to show. Anchoring on the single max span
 * instead means only the literal best-ever span at that position hits 100, and everyone else is
 * read on a continuous scale below it.
 *
 * Deliberately NOT multiplied by `POSITION_TALENT_CORRECTION` — that factor was calibrated
 * against blended-TAL RAPM divergence, not these components individually, and applying it here
 * fought the anchoring above: it silently capped each position's ceiling at a different value
 * (PF ~93, C ~96, PG ~97, SF 100) instead of the intended "best-ever span at this position reads
 * 99-100, full stop." Found via Curry/Hakeem/Garnett/Duncan all reading well below where a
 * "best in position" split metric should put them.
 */
const OFFENSE_TAL_PARAMS: Record<Position, { scale: number; intercept: number }> = {
  PG: { scale: 1.346, intercept: 21.06 },
  SG: { scale: 1.451, intercept: 24.0 },
  SF: { scale: 1.296, intercept: 25.5 },
  PF: { scale: 1.261, intercept: 28.37 },
  C: { scale: 1.16, intercept: 34.84 },
};

const DEFENSE_TAL_SCALE_BY_POSITION: Record<Position, number> = {
  PG: 5.13,
  SG: 4.11,
  SF: 4.09,
  PF: 2.62,
  C: 2.04,
};

/**
 * 2026-08-07, user-caught real bug (playtest report: "Nash, Harden i Luka mają ten sam O-TAL co
 * Kevin Johnson" — Stockton reading A+): O-TAL had no soft-cap, unlike TAL's own (`SOFT_CAP_K`
 * above) — a straight `Math.min(100, ...)` clip. Once the new playmaking/3-level bonuses (see
 * `playmakingThreeLevel.ts`) pushed several different PGs' raw pre-clamp offense scores past 100,
 * they all flattened into the identical displayed 100, erasing real separation the same way
 * TAL's own hard clip did before the 2026-08-01 fix — this is the exact same class of bug,
 * recurring in a sibling metric that never got the same treatment. User's own explicit
 * confirmation of the correct direction: "Nash, Harden i Luka powinni zostać w S a reszta
 * powinna pójść w dół" (Nash/Harden/Luka should stay S, the rest should drop) — i.e. this needs
 * to PRESERVE real separation at the top, not just uniformly shrink everyone's bonus (which would
 * have pulled the genuinely-elite three down too). `OTAL_SOFT_CAP_FLOOR` set lower than TAL's own
 * (90 vs 95) since O-TAL's ceiling-crowding here starts well below the very top (multiple players
 * clip at exactly 100, not just approach it) — engaging earlier is what actually restores
 * resolution among them. Same exponential-approach shape as TAL's `softCapTalent`, deliberately
 * reusing a proven mechanism rather than inventing a new one for the same underlying problem.
 */
const OTAL_SOFT_CAP_FLOOR = 90;
const OTAL_SOFT_CAP_CEILING = 100;
const OTAL_SOFT_CAP_K = 14;

function softCapOffense(scaled: number): number {
  if (scaled <= OTAL_SOFT_CAP_FLOOR) return scaled;
  return OTAL_SOFT_CAP_FLOOR + (OTAL_SOFT_CAP_CEILING - OTAL_SOFT_CAP_FLOOR) * (1 - Math.exp(-(scaled - OTAL_SOFT_CAP_FLOOR) / OTAL_SOFT_CAP_K));
}

/**
 * 2026-08-07, user's own precise diagnosis, real bug found: `computeTalent` already discounts
 * low-volume offense via `usageOffenseScale` (the FGA<12 half, gated to `PLAYMAKER_ARCHETYPES` so
 * it only touches real ball-handlers, not off-ball specialists) — but `computeOffensiveTalent`
 * never applied it at all, computing offense at a flat 1.0 scale regardless of usage. That's
 * exactly why Kevin Johnson (FGA 12.4, "Secondary Ball Handler") and especially John Stockton
 * (FGA 9.8, same archetype) were reading competitively with Nash (FGA 13.1) despite a real,
 * already-modeled difference in how much offense they actually had to create — Stockton's own FGA
 * sits deep in the discount band (~0.84 scale, a real ~16% cut) while Nash's barely dips below 1.0
 * (~0.975) and Harden/Luka/Oscar's high-FGA spans actually gain a BONUS (>15 FGA is the ramp's
 * high-usage-credit half, ungated by archetype) — the exact separation the user asked for
 * ("penalize KJ/Stockton for low FGA without knocking Nash down too much"), for free, by finally
 * applying a mechanism that already existed for TAL to its sibling metric.
 */
export function computeOffensiveTalent(span: PlayerSpan): number {
  const { offense } = rawComponents(span, false, usageOffenseScale(span));
  const { scale, intercept } = OFFENSE_TAL_PARAMS[span.primaryPosition];
  const scaled = offense * scale + intercept;
  return Math.max(0, Math.min(100, Math.round(softCapOffense(scaled))));
}

/** Debug-only, unclamped/uncapped O-TAL raw scaled value — used solely by calibration scripts to
 * see the real pre-softcap spread. Not imported anywhere in the engine itself. */
export function rawOffenseScaledForDebug(span: PlayerSpan): number {
  const { offense } = rawComponents(span, false, usageOffenseScale(span));
  const { scale, intercept } = OFFENSE_TAL_PARAMS[span.primaryPosition];
  return offense * scale + intercept;
}

/**
 * The pre-2026-07-30 D-TAL formula, kept **only** for `portability.ts`'s
 * `usagePenaltyOffset` — which feeds POR, which feeds `portabilityBonus`, which feeds
 * `computeTalent`. D-TAL itself was recalibrated as a display metric (`defensiveTalent.ts`,
 * re-exported below); pointing POR at the new numbers instead would silently re-calibrate TAL
 * through the back door, exactly the propagation the SPACING/POR swap had to grid-search around.
 * Bit-identical on purpose, rounding included — `USAGE_OFFSET_DEFENSE_THRESHOLD` is a hard
 * threshold, so an unrounded value would move players across it.
 */
export function normalizedDefenseForFit(span: PlayerSpan): number {
  const { defense } = rawComponents(span, false);
  const scale = DEFENSE_TAL_SCALE_BY_POSITION[span.primaryPosition];
  const scaled = DEFENSE_FLOOR + (defense - DEFENSE_FLOOR) * scale;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}
