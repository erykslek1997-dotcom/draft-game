import type { PlayerSpan, Position } from '../data/schema';
import { SPACING_ARCHETYPES } from '../data/schema';
import { computeSpacing } from './spacing';
import { eraBaseline, positionAdjustedTsBaseline } from './era';
import { lowUsageEfficiencyFactor, extremeUsageRatioPenalty } from './talent';
import {
  runtimeDefenseTalentPercentile,
  runtimeOffensivePortabilityRange,
  runtimeSelfCreationPercentile,
} from './runtimePercentiles';
import { runtimeZoneTotalsForSpan } from './runtimeSpanLookups';

/**
 * Portability (a.k.a. scalability) answers a different question than `computeTalent`: not
 * "how good is this player" but "how well does this player's game travel next to another
 * high-usage star." A player can be excellent and still a bad fit (needs the ball, no real
 * defensive value), or middling on raw talent and a great fit (efficient off it, versatile
 * on D). Built entirely from existing archetype/role taxonomy and box-score signals — no new
 * data, no change to `computeTalent`/scoring/the AI drafter, purely an extra number shown to
 * the human drafter.
 *
 * Five components, each mapped to something that already exists in the codebase:
 * - Off-ball offensive value: the SPACING metric (spacing.ts — era-scaled 3-point volume and
 *   accuracy scored on separate per-position ladders), mapped superlinearly, plus a flat credit
 *   for spacing-type archetypes. See `SPACING_VALUE_SCALE` below for why this replaced the raw
 *   `shootingGravity` product that used to sit here.
 * - On-ball usage penalty: its own weight table (`POR_USAGE_ARCHETYPE_WEIGHT`, below),
 *   deliberately NOT the shared `HIGH_USAGE_ARCHETYPE_WEIGHT` from schema.ts — that constant
 *   also feeds `fitScore` in scoring.ts, which already penalizes a ROSTER for stacking too many
 *   high-usage archetypes together (team-level redundancy). POR asks a different, context-free
 *   question — "how well does this archetype generically travel" — and Shot Creator/Slasher
 *   were both getting the same full penalty as if they could NEVER have off-ball value, when in
 *   reality both can play a complementary role fine on a team that doesn't already have one
 *   (a stacked-team penalty is exactly what fitScore is for). Softened both to sit between
 *   Primary Ball Handler's existing half-penalty and the old full penalty, rather than zeroing
 *   them out - they still skew toward needing the ball more than a playmaker does.
 * - Defensive versatility: real role credit (rim/perimeter defender tags) plus a small bonus
 *   per extra position a player can realistically guard.
 * - Low-usage efficiency: relative TS%, independent of the FGA-scaled version `computeTalent`
 *   uses, since this is about "how good are they in less-featured minutes," not raw scoring.
 * - Usage-penalty offset (below): the four components above judge defensive versatility and
 *   shooting value only categorically (a flat bonus for clearing a tag/threshold, same whether
 *   you barely qualify or you're the best in the league at it) while the usage penalty is a
 *   flat per-archetype number regardless of how real that defensive/shooting value actually is.
 *   Found directly comparing spans: Kawhi Leonard's 2014-16 peak (real DTAL 78, elite) reads
 *   only 5 points higher on POR than his 2018-20 span (DTAL 52) despite a 26-point real defense
 *   swing - the flat categorical bonus doesn't move with magnitude at all. Paul George and
 *   Victor Oladipo show the same pattern on their own defensive peaks. Kyrie Irving and Khris
 *   Middleton are a different case - their box defense never clears real "plus" territory
 *   (DTAL stays at or near the floor), so a defense-based offset alone wouldn't touch them, but
 *   both are genuine plus shooters (gravity 0.28+, well past `PLUS_SHOOTER_THRESHOLD`) whose
 *   real off-ball value the categorical `SPACING_ARCHETYPE_BONUS` doesn't capture either (they're
 *   tagged Shot Creator/Slasher, not a spacing archetype). Checked against Chris Mullin/Adrian
 *   Dantley as a control first - neither clears the shooting-gravity threshold (0.048/0.002),
 *   so this offset doesn't rescue the one-way high-usage scorers 3.1.2's usage-ratio penalty in
 *   talent.ts already targets.
 */

/**
 * The off-ball-shooting half of POR now reads `computeSpacing` (spacing.ts) instead of the raw
 * `shootingGravity` product it used to. Two things were wrong with the old term here:
 * volume was measured in raw 3PA against a fixed yardstick, so every pre-2010 shooter scored
 * near zero regardless of how far they were ahead of their own era; and `gravity` multiplies
 * volume by excess-accuracy into a single unbounded number, which cannot tell a high-volume
 * average shooter from a low-volume elite one.
 *
 * Mapped superlinearly (squared) rather than straight, deliberately: an elite shooter distorts
 * a defense far more than twice as much as a merely average one — defenders top-lock him,
 * help rotations shade early, the paint empties. That is the same claim the old multiplicative
 * gravity term was making implicitly, kept intact through the swap. It also keeps the
 * replacement's shape close to what it replaces (near-zero for the ~63% of spans that don't
 * shoot at all, a long thin tail for the genuine floor-warpers) instead of handing every
 * competent spot-up shooter a large flat raise.
 *
 * Both constants below were grid-searched to land POR's distribution back on where it sat
 * before the swap (p90 78, p99 90 vs. a pre-change 78/91, mean 63.9 vs 63.1) — POR feeds
 * `portabilityBonus` into `computeTalent`, so a silent re-calibration here would propagate.
 *
 * `SPACING_ARCHETYPE_BONUS` was halved (12 -> 6) as part of the same change. It is a flat
 * credit for carrying a spacing-type archetype, which was a categorical proxy for exactly what
 * SPACING now measures directly and continuously — keeping it at full strength double-counted
 * the same signal and pinned >1% of all spans at POR's 100 ceiling, destroying resolution at
 * the top. It is reduced rather than removed because archetype still carries something volume
 * and accuracy don't: HOW a player gets his looks (a Movement Shooter bends a defense
 * differently than a Stationary Shooter at identical percentages).
 */
const SPACING_VALUE_SCALE = 16;
const SPACING_ARCHETYPE_BONUS = 6;
const SECONDARY_POSITION_BONUS = 4;
const EFFICIENCY_SCALE = 120;
const BASELINE = 55;

/**
 * 2026-08-06, user's own hand-graded S/F calibration batch across PG/SG/SF (13 named players,
 * plus 6 more added mid-pass — Chris Paul/Darius Garland, Victor Oladipo/Kyle Korver, OG Anunoby/
 * Chris Mullin/Glen Rice — specifically to test "defends AND shoots beats shoots-only"). Root
 * cause of the whole batch: the old flat `defenseValue` (+14 for merely *carrying* a defender
 * role tag) was completely blind to magnitude — Kawhi's real elite defense and a merely-adequate
 * Wing Stopper got the identical credit. Confirmed directly: even `normalizedDefenseForFit`
 * (talent.ts, the value this file used everywhere before today) is FLOORED AT EXACTLY 20.0 for
 * the large majority of guards/wings, including genuinely good defenders like prime Klay
 * Thompson — it has essentially zero resolution below elite for perimeter players, the same
 * "no resolution in the bottom half" defect the D-TAL rebuild (`defensiveTalent.ts`) already
 * fixed for the DISPLAY metric months ago.
 *
 * **This deliberately reverses a prior decision** ("never point POR at the new D-TAL, it would
 * recalibrate TAL through the back door" — see git history). That constraint existed to keep
 * `portability.ts` bit-identical to its pre-D-TAL-rebuild self; today's ask is a real,
 * user-requested behavior change to POR itself, and D-TAL is the only signal in the codebase with
 * real position-relative defensive resolution. `computeTalent` itself still isn't touched
 * directly — only through the same small, capped, asymmetric `portabilityBonus` every other POR
 * change this session already flows through.
 *
 * `defensePercentileForPosition` ranks D-TAL within the player's OWN position (same
 * percentile-rank pattern as the self-creation signal above, per the user's explicit "each
 * position needs its own yardstick" instruction) — the shared foundation both
 * `computeOffensivePortability`/`computeDefensivePortability` below are built on.
 *
 * **The combined `computePortability` this section originally added (with a `Math.min`-based
 * two-way compounding bonus) was removed later the same session, per explicit user request**: it
 * could not simultaneously satisfy "Mullin/Korver/Rice shouldn't rate as high as Anunoby/Kawhi"
 * (needs defense to swing the number a lot) and "elite one-way shooters like Ray Allen/Reggie
 * Miller should still reach S" (needs defense to NOT swing it much) — two different claims about
 * one blended number, made worse by the badge searching a player's ENTIRE career for their single
 * best span (a merely-average-defense season coinciding with a great-shooting season got
 * rewarded for the coincidence, not the player's real defensive reputation). Splitting into
 * separate offense/defense scores (below) resolves the conflict by not forcing one number to
 * answer both questions at once — same shape as `computeOffensiveTalent`/`computeDefensiveTalent`
 * vs. `computeTalent` itself. `portabilityCorrection.ts`'s small TAL bonus now regresses against
 * the average of the two split scores instead of the retired combined one.
 */
/**
 * Lazily built (NOT at module top-level) on purpose: `portability.ts` sits in a real import
 * cycle — `talent.ts` imports `portabilityBonus` from `portabilityCorrection.ts`, which imports
 * this file. Calling `computeDefensiveTalent` (talent.ts -> defensiveTalent.ts ->
 * defensiveAccolades.ts) eagerly at THIS module's top level hits `defensiveAccolades.ts`'s own
 * top-level consts before they've finished initializing whenever this module happens to be
 * reached mid-way through evaluating that cycle (confirmed directly: broke
 * `scripts/precomputeCorrectionCoefficients.ts`, a real production script, not just an ad-hoc
 * one). Deferring the computation into a function means it only ever runs on first actual call,
 * by which point the whole module graph has finished its synchronous top-level evaluation
 * regardless of the cycle — cycles only break EAGER top-level evaluation order, not later calls.
 */
/** Fraction of `position`'s spans with a strictly lower D-TAL, 0-1 — the position-relative
 * defensive-quality signal `defenseValue`/`twoWayBonus` are built on. */
function defensePercentileForPosition(span: PlayerSpan): number {
  return runtimeDefenseTalentPercentile(span);
}

/**
 * 2026-07-31, the user's PG/SG/SF/PF/C batch report — `efficiencyValue` below had no discount
 * for shot volume at all, unlike `computeTalent`'s own efficiency term (`lowUsageEfficiencyFactor`
 * in talent.ts). A low-usage specialist's relative-TS% gap over the position baseline gets
 * inflated by exactly the same effect `lowUsageEfficiencyFactor` exists to correct for TAL:
 * fewer, more open, more selectively-taken shots read as "more skill" than the same efficiency
 * gap posted at real, defended, high-usage volume. Found directly: Brent Barry's 2000-02 span
 * scored a *raw* (pre-clamp) POR of 104.4 — over the 100 ceiling — driven by a +16.4
 * `efficiencyValue` off 65.5% TS% at very low usage, while Luka Dončić and Anthony Edwards
 * (creating far more, against real defensive attention) could never approach that efficiency
 * gap no matter how good they are, structurally. Same fix, same function, reused rather than
 * re-derived so the two efficiency terms can't quietly drift apart. */


/**
 * 2026-08-06, superseded the categorical archetype-weight table with a continuous, per-span
 * signal: the user's own framing — "players with more assisted shots fit better next to a
 * ball-dominant star" — is exactly what `selfCreationSimilarity.ts` measures directly (real
 * `unassistedFg`/`unassisted3Pt` where the export covers it, a validated k-NN estimate by
 * box-stat similarity otherwise), instead of a flat per-archetype guess. Two real problems were
 * found and fixed before this landed, both documented in `selfCreationSimilarity.ts` itself since
 * they're properties of the underlying signal, not this call site:
 *
 * 1. A single global floor punishes point guards as a class (live-dribble creation is baked into
 *    the position, ~0.24 higher baseline than everyone else) and barely reaches traditional post
 *    scorers. Fixed by using `selfCreationForPortability`'s blended 3PT/all-FG signal (separates
 *    e.g. Curry's off-ball shooting from Arenas' iso-heavy game, which a pure-FG blend couldn't).
 * 2. A "floor + excess" penalty shape clips anything below the position mean to a flat zero —
 *    which had barely any effect on the actual draft (roughly half the pool untouched) and still
 *    couldn't separate Curry from Arenas, since both players' best spans happened to sit under
 *    the PG mean. Replaced with `selfCreationPercentileForPortability` — continuous 0-1 rank
 *    within the player's own position, so there's no dead zone and real players who both "beat
 *    their position's average" still separate by how much.
 *
 * Verified directly: McAdoo's best-case span (was B+/82 in the archetype-table version) now
 * lands at C+/68; Curry's best span ranks 18th percentile among PG spans vs. Arenas' 31st (POR
 * 94 vs 88); Kerr/Korver/Mullin-off-ball spans stay near the top (defensive/shooting buyback
 * below still applies); Kawhi/Robinson's defensively-anchored spans are fully unaffected (offset
 * cancels the whole penalty). Population-wide letter-grade distribution (full 13,145-span
 * dataset) now spreads across the entire A+-through-F range instead of clustering S-B.
 */
const SELF_CREATION_MAX_PENALTY = 30;
/**
 * 2026-09-26, the user (Jrue Holiday F next to Kyle Lowry A+; "passing też okej, ale powinno brać
 * pod uwagę np. usg%"): two changes to how the self-creation rank becomes a penalty.
 * - Curve: `percentile ^ 1.5` instead of linear — the middle of the distribution (a normal lead
 *   guard) pays little, the full 30 is reserved for the most self-reliant spans.
 * - Passing relative to usage: a player who needs the ball but creates for others travels better
 *   than one who only shoots. Share of his finished plays that are assists, `AST / (AST + PTS /
 *   (2 TS%))` (the denominator is his scoring possessions, i.e. usage without turnovers), cuts the
 *   penalty by up to `PASSING_OFFSET_MAX` between `PASS_SHARE_START` and `PASS_SHARE_FULL`.
 */
const SELF_CREATION_PENALTY_CURVE = 1.5;
const PASSING_OFFSET_MAX = 0.4;
const PASS_SHARE_START = 0.15;
const PASS_SHARE_FULL = 0.4;
function passingOffset(span: PlayerSpan): number {
  const scoringPossessions = span.box.ppg / (2 * Math.max(0.3, span.box.tsPct));
  const passShare = span.box.apg / Math.max(0.1, span.box.apg + scoringPossessions);
  const t = Math.max(0, Math.min(1, (passShare - PASS_SHARE_START) / (PASS_SHARE_FULL - PASS_SHARE_START)));
  return PASSING_OFFSET_MAX * t;
}

/**
 * 2026-08-07, user explicit ask, real gap found and confirmed with data: "all-time great centers
 * who are big targets in the paint that are easy to pass to" (Rudy Gobert named directly — "does
 * not have ball in his hands for any other purpose than finish under basket") were reading C-/D
 * portability, while a genuine ball-dominant high-usage center (DeMarcus Cousins — "shoots a lot,
 * takes the ball from other guys, not a good defender") read HIGHER. Root-caused precisely, not
 * guessed (`offenseComponents` breakdown, checked directly): `spacingValue` is the ONLY positive
 * offensive-portability credit that exists — a shooter earns real credit, a non-shooting rim
 * target earns literally zero, no matter how elite or reliable a target he is. Cousins' real
 * modern outside shot (SPC 75) earned him +15 there; Gobert, with SPC 0, could never earn
 * anything symmetric for the actual skill that makes him portable. `selfCreationPercentileForPortability`
 * (the other lever that looked suspicious at first) turned out NOT to be the main driver once
 * checked against both players side by side — it's rank-percentile WITHIN each player's own
 * position, and centers as a population self-create a lot (low-post scoring), so neither Gobert
 * (4.1) nor Cousins (2.6) actually sees a large penalty from it.
 *
 * Mirrors `spacingValue`'s own shape (squared excess, capped) for the same reason spacing uses
 * it: an elite, high-accuracy rim target is worth more than twice as much as a merely-good one to
 * a offense that can just throw it inside and get a bucket every time. Reuses the same
 * rim-share/accuracy zone data `playmakingThreeLevel.ts`'s `insideFinishingBonus` already reads
 * for TAL (that mechanism answers a different question — "is this a genuinely elite offensive
 * weapon" — this one asks "is this player a low-maintenance target," so a shared data source but
 * a separate, appropriately-scaled term is correct, not a duplicate). PF/C only, matching the
 * user's own named population (a wing finishing at the rim off drives isn't the same "always
 * available dump-off target" role a traditional center plays).
 *
 * Scale calibrated directly against the two named cases: with `RIM_TARGET_SCALE=2.0`/
 * `MAX_RIM_TARGET_VALUE=24`, Gobert's real rim numbers (70-76% accuracy at a dominant rim share)
 * move his O-POR from 57 (C-) into the high 70s/low 80s depending on span — genuinely elite,
 * competitive with real S-grade spans — while Cousins' own rim profile (much lower accuracy, far
 * less rim-dominant a diet) earns little to nothing here, so the real gap (Gobert now clearly
 * ABOVE Cousins) is restored. Pre-1997 spans (no zone data — Wilt, McHale, Moses Malone, early
 * Ewing) get 0 from this term specifically, a real accepted gap matching this project's other
 * documented pre-zone-tracking gaps; the separate `usagePenalty` softening below still helps them
 * some.
 */
const RIM_TARGET_MIN_SHARE = 0.5;
/**
 * 2026-09-23, user-reported live (LeBron James 2013-15 O-POR "D+", 2016-18 "A+" — "prawie ten
 * sam gracz, przepaść"): `RIM_TARGET_MIN_SHARE` was a hard cliff — 2016-18's 50.2% rim share
 * cleared it and earned the full term, 2013-15's 44.1% (with BETTER rim accuracy, 74.5% vs
 * 75.6%) missed it by 6 points and earned zero. Ramped instead: share still has to clear this
 * floor to earn anything, but between here and `RIM_TARGET_MIN_SHARE` the term phases in rather
 * than snapping on, so two spans a few points of real rim-share apart get proportionally close
 * scores instead of an all-or-nothing swing. `RIM_TARGET_POSITIONS` is untouched — that gate is
 * deliberate (a wing/forward finishing off his own drives isn't the same "low-maintenance dump-
 * off target" role a traditional big plays, see this function's own docstring above), not part
 * of the cliff this fixes.
 */
const RIM_TARGET_SHARE_RAMP_FLOOR = 0.35;
const RIM_TARGET_GOOD_PCT = 60;
const RIM_TARGET_SCALE = 2.0;
const MAX_RIM_TARGET_VALUE = 24;
const RIM_TARGET_POSITIONS: ReadonlySet<Position> = new Set(['PF', 'C']);
/**
 * 2026-09-26, the user (Ewing's O-POR F across his whole career, Hakeem 1993-95 F, Bill Russell):
 * the "accepted gap" above — no zone data before 1997, so every earlier big got 0 here — put
 * pre-1997 centers at the bottom of a C scale stretched by modern rim targets (Gobert/Shaq +24).
 * Spans without zone data now get an ESTIMATE from box stats, a least-squares fit on the 2,150
 * PF/C spans that have both (corr 0.78 with the real term): era-relative TS% and FG%, FT% (low =
 * rim player), free throws per shot, 3PA, blocks, assists per shot and the offensive archetype.
 * Artis Gilmore 1980-82 ~23, McHale ~17, Ewing 1987-89 ~14, Hakeem 1993-95 ~10, Russell ~4.
 * Order: [1, relTs, eraRelFg, ftPct, min(3PA,5), ftaPerFga, rpg, bpg, apgPerFga, rollCut, post, stretch].
 */
const RIM_TARGET_BOX_WEIGHTS = [-20.12, 42.692, 68.604, -12.96, 0.503, 0.689, -0.112, 0.731, 7.945, -1.487, -0.456, -0.721];
const RIM_TARGET_ERA_REFERENCE_TS = 0.535;
function estimatedRimTargetValue(span: PlayerSpan): number {
  const { avgTs } = eraBaseline(span.spanLabel);
  const scoringPossessions = span.box.ppg / (2 * Math.max(0.3, span.box.tsPct));
  const fta = Math.max(0, (scoringPossessions - span.fga) / 0.44);
  const shots = Math.max(1, span.fga);
  const features = [
    1,
    span.box.tsPct - avgTs,
    span.box.fgPct - (avgTs - RIM_TARGET_ERA_REFERENCE_TS),
    span.box.ftPct,
    Math.min(span.box.threePA, 5),
    fta / shots,
    span.box.rpg,
    span.box.bpg,
    span.box.apg / shots,
    span.offensiveArchetype === 'Roll & Cut Big' ? 1 : 0,
    span.offensiveArchetype === 'Post Scorer' ? 1 : 0,
    span.offensiveArchetype === 'Stretch Big' ? 1 : 0,
  ];
  const value = features.reduce((sum, x, i) => sum + x * RIM_TARGET_BOX_WEIGHTS[i], 0);
  return Math.max(0, Math.min(MAX_RIM_TARGET_VALUE, value));
}

function rimTargetValue(span: PlayerSpan): number {
  if (!RIM_TARGET_POSITIONS.has(span.primaryPosition)) return 0;
  const totals = runtimeZoneTotalsForSpan(span);
  if (!totals) return span.fga >= 5 ? estimatedRimTargetValue(span) : 0;
  const classified = totals.rimFga + totals.midFga + totals.threeFga;
  if (classified < 150) return 0; // same volume floor as playmakingThreeLevel.ts's zone-based terms
  const rimShare = totals.rimFga / classified;
  if (rimShare < RIM_TARGET_SHARE_RAMP_FLOOR) return 0;
  const shareFactor = Math.min(
    1,
    (rimShare - RIM_TARGET_SHARE_RAMP_FLOOR) / (RIM_TARGET_MIN_SHARE - RIM_TARGET_SHARE_RAMP_FLOOR),
  );
  const rimAccuracy = (totals.rimFgm / Math.max(totals.rimFga, 1)) * 100;
  const excess = rimAccuracy - RIM_TARGET_GOOD_PCT;
  return excess > 0 ? Math.min(MAX_RIM_TARGET_VALUE, excess * RIM_TARGET_SCALE) * shareFactor : 0;
}

/**
 * 2026-08-07, same batch as `rimTargetValue` above: even setting that new positive credit aside,
 * `selfCreationPercentileForPortability`'s underlying question ("does this player create his own
 * shot") maps less cleanly onto a traditional post-up big than onto a perimeter shot-creator —
 * real post-move skill (footwork, being able to score 1-on-1 after a simple entry pass) is still
 * a fundamentally low-maintenance, easy-to-integrate offensive role, unlike a wing who needs real
 * possession/ball-screen sets run for him. Modest, not zeroed — a genuinely high-usage, ball-in-
 * hands center (Cousins) should still see SOME penalty, just not the same full-strength one a
 * perimeter iso-scorer earns for the identical percentile. PF/C only.
 */
const BIG_SELF_CREATION_PENALTY_SCALE = 0.6;
const BIG_SELF_CREATION_POSITIONS: ReadonlySet<Position> = new Set(['PF', 'C']);

/**
 * 2026-08-06, retired as part of the same S/F calibration batch as the block above. This used to
 * give back usage-penalty credit for elite shooting (SPC > 65) or plus defense
 * (`normalizedDefenseForFit` > 50) — originally built for a real gap (Kyrie Irving/Khris
 * Middleton, plus shooters whose box defense never separately cleared "plus"). But its shooting
 * half now duplicates `offenseOnly`'s job and actively worked AGAINST today's fix: it handed any
 * elite shooter — regardless of defense — a flat cancellation of their self-creation penalty,
 * which is exactly the "one-way shooter looks as good as a two-way player" bug this batch was
 * called out for (Chris Mullin/Kyle Korver/Glen Rice all still hitting the ceiling was traced
 * partly to this). `defensePercentileForPosition` + `twoWayBonus` above already answer "does
 * defense earn this player credit" more precisely (position-relative, magnitude-aware) than this
 * flat 50-point/65-SPC-threshold version ever did — nothing replaces the retired function itself.
 */

export interface OffenseComponents {
  spacingValue: number;
  rimTargetValue: number;
  efficiencyValue: number;
  usagePenalty: number;
  extremeUsagePenalty: number;
}

/** Exported for diagnostics (`computeOffensivePortability` is the only real call site otherwise)
 * — seeing which of the terms actually drives a surprising O-POR number, rather than guessing
 * from the final 0-100 value alone. */
export function offenseComponents(span: PlayerSpan): OffenseComponents {
  const shootPct = computeSpacing(span) / 100;
  const spacingValue =
    shootPct * shootPct * SPACING_VALUE_SCALE +
    (SPACING_ARCHETYPES.includes(span.offensiveArchetype) ? SPACING_ARCHETYPE_BONUS : 0);
  const rimTarget = rimTargetValue(span);
  const rawUsagePenalty =
    Math.pow(runtimeSelfCreationPercentile(span), SELF_CREATION_PENALTY_CURVE) * SELF_CREATION_MAX_PENALTY * (1 - passingOffset(span));
  const usagePenalty = BIG_SELF_CREATION_POSITIONS.has(span.primaryPosition)
    ? rawUsagePenalty * BIG_SELF_CREATION_PENALTY_SCALE
    : rawUsagePenalty;
  const adjustedAvgTs = positionAdjustedTsBaseline(span.primaryPosition, span.fga, span.spanLabel);
  const efficiencyValue = (span.box.tsPct - adjustedAvgTs) * EFFICIENCY_SCALE * lowUsageEfficiencyFactor(span.fga);
  // 2026-08-05, user explicit ask: a high-FGA/low-assist "chucker" hurts portability specifically
  // (needing the ball without creating for teammates is an offensive-role conflict question, the
  // same one `usagePenalty` above already asks — just categorically, by archetype, which misses
  // traditional post-scoring archetypes like McAdoo's "Post Scorer" entirely since they were never
  // added to `POR_USAGE_ARCHETYPE_WEIGHT`). Reuses `talent.ts`'s ungated version directly rather
  // than re-deriving the same ratio math — see that function's own docstring for why it's ungated
  // and how its threshold was picked to spare validated elite two-way bigs.
  const extremeUsagePenalty = extremeUsageRatioPenalty(span);
  return { spacingValue, rimTargetValue: rimTarget, efficiencyValue, usagePenalty, extremeUsagePenalty };
}

interface DefenseComponents {
  defPct: number;
  defenseValue: number;
}

function defenseComponentsFor(span: PlayerSpan): DefenseComponents {
  const defPct = defensePercentileForPosition(span);
  const defenseValue = defPct * 100 + span.secondaryPositions.length * SECONDARY_POSITION_BONUS;
  return { defPct, defenseValue };
}

/** Exported for the runtime-percentile build; production callers should use the scaled score. */
export function rawOffensivePortability(span: PlayerSpan): number {
  const { spacingValue, rimTargetValue: rimTarget, efficiencyValue, usagePenalty, extremeUsagePenalty } = offenseComponents(span);
  return BASELINE + spacingValue + rimTarget + efficiencyValue - usagePenalty - extremeUsagePenalty;
}

/**
 * 2026-08-07, user explicit ask ("S tier should be ranked 100, not an 81, fix the scale" +
 * "look for similar issues for other positions"): the flat, position-agnostic `[0,100]` clamp
 * this used to be is the SAME class of bug `computeOffensiveTalent`/`computeDefensiveTalent`
 * (talent.ts) already solved months ago — a single global ceiling naturally favors whichever
 * position has the largest number of independent positive levers. Checked directly before
 * fixing: even after `rimTargetValue` above fixed centers specifically, PG/SG/SF's own real
 * ceiling (their only positive lever is `spacingValue`, capped ~22) never got anywhere close to
 * 100 (real per-position max in the full dataset: PG 79, SG 82, SF 84) while PF/C — now with
 * BOTH `spacingValue` AND `rimTargetValue` — could reach literal 100. Fixing centers alone would
 * have just flipped which positions were disadvantaged, not fixed the actual architecture gap.
 *
 * Same technique `OFFENSE_TAL_PARAMS`/`DEFENSE_TAL_SCALE_BY_POSITION` (talent.ts) already use and
 * document at length: anchor each position to its OWN real min/max raw value (over the full
 * `players` dataset, not the smaller in-game `draftPool` — matching D-POR's own
 * `defenseTalentSortedByPosition` a few lines up, which already does exactly this for defense).
 * The single best-ever O-POR span at a position reads 100, the single worst reads 0, full stop
 * — "S" (the dynamic top-3-in-the-whole-pool grade cutoff) now means the same thing at every
 * position: genuinely close to that position's own realistic ceiling, not an arbitrary raw
 * number that happens to favor whichever position's formula has more terms.
 */
export function computeOffensivePortability(span: PlayerSpan): number {
  const raw = rawOffensivePortability(span);
  const range = runtimeOffensivePortabilityRange(span.primaryPosition);
  if (!range || range.max <= range.min) return Math.max(0, Math.min(100, Math.round(raw)));
  const rescaled = ((raw - range.min) / (range.max - range.min)) * 100;
  return Math.max(0, Math.min(100, Math.round(rescaled)));
}

/** Own 0-100 scale — direct position-relative D-TAL percentile (see `defensePercentileForPosition`
 * above) plus the secondary-position versatility credit. */
export function computeDefensivePortability(span: PlayerSpan): number {
  const { defenseValue } = defenseComponentsFor(span);
  return Math.max(0, Math.min(100, Math.round(defenseValue)));
}
