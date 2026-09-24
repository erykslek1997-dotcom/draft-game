import type { OffensiveArchetype, PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { eraBaseline, positionAdjustedTsBaseline, LEAGUE_PACE_BASELINE, predatesThreePointLine } from './era';
import { computeDefensiveImpact } from './defense';
import { darkoDefenseBonus, darkoDefenseMalus } from './darkoCorrection';
import { rimPressureOffenseTerm } from './rimPressure';
import { hiddenValueBonus } from './historicalApmCorrection';
import { shootingGravity, PLUS_SHOOTER_SPACING } from './shooting';
import { computeSpacing } from './spacing';
import { computeDefensiveTalent } from './defensiveTalent';
import { individualDefenseRate } from './defensiveAccolades';
import { ddpmCoverageForSpan, raptorCoverageForSpan } from './blendedDefenseLookup';
import { playoffPerformanceBonus } from './playoffPerformanceLookup';
import { playmakingThreeLevelOffenseAdjustment } from './playmakingThreeLevel';
import { wasEverAllStarCaliber } from './allNbaLookup';
import { selfCreationPercentileForPortability } from './selfCreationSimilarity';
import { runtimeDefenseTalentPercentile, runtimeImpliedDefensePercentile } from './runtimePercentiles';
// 2026-08-06: moved below defensiveTalent/defensiveAccolades on purpose — `portability.ts` (which
// this import cycles back through) now imports `computeDefensiveTalent` from THIS file, closing a
// real cycle: talent.ts -> portabilityCorrection.ts -> portability.ts -> talent.ts. Importing
// portabilityCorrection.ts before defensiveTalent/defensiveAccolades below meant the cycle
// re-entered talent.ts (and from there reached into defensiveAccolades.ts's own top-level consts)
// before those modules had finished initializing — a real `ReferenceError` on `AWARD_FIRST_YEAR`,
// reproduced on every cold app boot, not just a script-ordering fluke. Import order within a
// single file is otherwise cosmetic in acyclic code; it is load-bearing here specifically because
// of this cycle, so don't reorder this block without re-testing a cold browser load.
import { portabilityBonus, roleScalabilityBonus } from './portabilityCorrection';

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
 *
 * **2026-09-01, user's PG+PF side-by-side audit — PG left at 0.972 after measurement.** "PG
 * overvalues defensive profiles" is real (41 distinct PGs reach All-NBA+ vs PF 20 / SG 18; 54
 * PG All-NBA+ spans carry the tier on defense alone, O-TAL < 75, vs 6 for SG), but this flat
 * factor can't fix it: lowering it drops borderline PGs (Curry 2009-11, Lillard 2012-14, Kyrie
 * 2013-15, Mark Price, Tim Hardaway 1997-99) *below* `ALL_STAR_TAL_FLOOR` in `positionCorrectionFor`,
 * where they pick up the full sub-gate spacing boost (~1.15) instead of the flat, and punch
 * straight through the PG-archetype cap to All-NBA — the same star-gate cliff pathology
 * `ABOVE_STAR_SPACING_*` and `SPACING_BOOST_TAPER_BAND` already exist to patch. The PG defense
 * over-credit sits in the blend (two-way synergy + `synergyGateDefense` + `darkoDefenseBonus`
 * stacking) and needs the deferred `positionCorrectionFor` star-gate untangle, not a knob here.
 * PF is lifted below the All-NBA floor only (`PF_ALLSTAR_BAND_CORRECTION`).
 */
const POSITION_TALENT_CORRECTION: Record<Position, number> = {
  PG: 0.972,
  SG: 0.952,
  SF: 1,
  PF: 0.93,
  C: 0.96,
};

/** Players whose TALENT NUMBER always reads with SF's (uncorrected) position correction — see
 * `positionCorrectionFor`. Named, deliberate, user-requested; not a general rule. */
const POSITION_CORRECTION_AS_SF: ReadonlySet<string> = new Set(
  ['Magic Johnson', 'LeBron James'].map(normalizePlayerName),
);

/**
 * 2026-08-01, explicit user request: Magic Johnson's TAL is computed using SF's position
 * correction factor (1.0, the uncorrected baseline) instead of PG's (0.972) — a small,
 * deliberate +1 to +2 TAL bump matched against the same hypothetical position-swap dry-run
 * `talent.ts`'s own PG-vs-SF gap always produced for him. `span.primaryPosition` itself is
 * left completely untouched — he still shows, filters, and drafts as PG everywhere else in the
 * game (eligibility, position badges, roster-slot logic); only the TALENT NUMBER reads as if
 * he were SF. Named-player special cases in the formula exist only because the user asked for
 * them directly (Curry's shooting-gravity cap, this, LeBron in `POSITION_CORRECTION_AS_SF`
 * above) — never because a general rule produced them; don't extend the pattern unprompted.
 * 2026-09-02: LeBron added for the same reason — the share-classifier scatters his spans across
 * PF (Miami small-ball 4) / PG (Lakers) / C, so his point-forward game eats corrections meant
 * for box-inflated bigs and light-scoring PGs. See `positionCorrectionFor`.
 */
/**
 * 2026-08-19, user's explicit ask, scoped by two follow-up refinements: (1) "apply it only below
 * All-Star guys — stars don't need to be spacers as much as role players" and (2) "make spacing
 * rules for role players stronger and apply to all positions; give center a bigger boost for
 * spacers for everyone below All-NBA but don't punish them." Real data checked before building
 * either version: PF spacing is brutally bimodal (p10/p25/p50 all 0), and named examples show the
 * old flat correction hiding real, opposite-direction misses — Dirk Nowitzki (SPC 95) read TAL 80,
 * below several zero-spacing peers (Karl Malone SPC 0 TAL 94, Kevin Garnett SPC 5 TAL 97). Center
 * spacing is even more extreme (p10-p75 all read 0, only p90=40 — three-quarters of the position
 * never had real shooting gravity at all), which is why C uses its own, lower-reach curve below
 * rather than sharing PLUS_SHOOTER_SPACING/90 with the other four positions.
 *
 * Two-pass bootstrap for the star gate, same shape `computeTalent` already uses for
 * `usageOffenseScale`'s own gate below — reads the position-flat-corrected value first (never the
 * spacing-adjusted one) so the gate can't be moved by the adjustment it's deciding whether to
 * apply. `ALL_STAR_TAL_FLOOR`/`ALL_NBA_TAL_FLOOR` duplicate `grades.ts`'s own `OVERALL_TIER_FLOORS`
 * floors as plain numbers rather than importing them — `grades.ts` already imports `computeTalent`
 * FROM this file, so importing back would be circular. Keep these in sync if that table ever moves.
 */
const ALL_STAR_TAL_FLOOR = 70;
/** Center's own, wider gate (per the user's explicit ask) — a good-but-not-yet-legendary
 * (All-Star/borderline-All-NBA, 70-79) modern center who ALSO spaces the floor is exactly the
 * "unicorn big" archetype real 2026 rosters build around, so C's boost stays live further up the
 * tier ladder than the other four positions before a player's box production alone is judged
 * enough on its own. `computeTalent(span) >= ALL_NBA_TAL_FLOOR` already implies >= ALL_STAR_TAL_FLOOR
 * too, so this one constant fully subsumes the star gate for C — no separate All-Star check needed
 * there. */
const ALL_NBA_TAL_FLOOR = 80;

/** Non-center floor (spacing 0, a true non-shooting classic role player) — a real, felt
 * punishment below every non-C position's own flat correction, reflecting that box stats miss
 * even MORE of a zero-gravity player's value than the old flat averages implied. Originally 0.85
 * (PF-only), widened to 0.80 for all non-C positions on the user's "make it stronger" ask.
 * **2026-08-31, back to 0.85** ("PF is a weak position"): PF has the most zero-spacing spans of any
 * position (p10-p50 all 0), so 0.80 was the single biggest driver of PF's median TAL reading
 * lowest of any position (46 vs 49-54) — this floor, not `POSITION_TALENT_CORRECTION.PF`, is what
 * actually sits under the ~40% of PF spans that are non-shooting bench/role bigs. A flat PF
 * correction bump was tried first and rejected: it over-promotes Kevin Garnett (the PF Taylor-top-10
 * anchor, correctly placed at 97) to 99 and drops Taylor top-10 Spearman to 0.818. Raising this
 * floor instead lifts the bench/role tail (PF +1.0 mean, PG/SG/SF +0.6) and leaves every star
 * untouched — they're above the All-star gate and read the position flat. Taylor 0.891 held, max
 * TAL move +5. */
const SPACING_CORRECTION_FLOOR = 0.85;
/** At `PLUS_SHOOTER_SPACING` (65, the existing "genuine floor-spacer" bar `isPlusShooter` uses)
 * — fully neutral, no penalty at all: a real plus-shooter's value is already largely visible in
 * their own box-score efficiency, so the "box stats miss it" rationale for any penalty no longer
 * applies once they clear this bar. Shared across PG/SG/SF/PF — each position's own real p90
 * spacing (75-88 in the pool) sits comfortably past this pivot, so it reads the same "genuine
 * shooter" bar at every one of them, not a position-relative one. */
const SPACING_CORRECTION_NEUTRAL = 1.0;
/** Non-center ceiling (spacing 90+, near the real pool's own p90 for every non-C position) — a
 * real bonus, capped well short of a second full shooting credit (TS%/3PT already feed the
 * offense component directly) since this specifically represents the UNMEASURED gravity/floor-
 * opening value for teammates, not a re-reward of the player's own shot-making. Raised from the
 * original PF-only version's 1.10 per the user's explicit "make it stronger" ask. */
const SPACING_CORRECTION_CEILING = 1.18;
const SPACING_CORRECTION_ELITE_SPACING = 90;

/**
 * 2026-08-31: above the All-star gate the spacing adjustment no longer applies in full ("stars
 * don't need to be spacers as much as role players" — the 2026-08-19 ask), but `positionCorrectionFor`
 * did it as a hard cliff — `return flat` the moment TAL crosses 70. Measured: 342 pool spans are
 * elite spacers (computeSpacing >= 95) sitting just past the gate at the flat correction — Peja
 * Stojaković (5 spans), Glen Rice (4), Rashard Lewis (3), Danny Granger, Jason Richardson, Reggie
 * Miller, Buddy Hield — exactly the movement-shooter archetype whose UNMEASURED floor-spacing this
 * correction exists to credit, getting nothing for it in the All-star band. Now an above-gate span
 * keeps `ABOVE_STAR_SPACING_RETENTION` of the sub-gate adjustment's distance from flat, hard-capped
 * at `ABOVE_STAR_SPACING_MAX_GAIN`.
 *
 * **Scoped hard**: SG/SF/PF only (PG spacing is already handled at the tier level by `grades.ts`'s
 * PG shooter/playmaker/defense archetype caps, and a correction-level gain there re-triggered the
 * archetype-cap punch-through — Kemba/Curry 2010-12 crossing `PG_ARCHETYPE_ENTRY_TAL_CEILING`, +40
 * display; C has its own branch), AND only for spans still BELOW the All-NBA floor. An MVP-tier
 * spacer (Dirk, Durant, Bird) doesn't need this and a first, wider version tipped a dozen of them
 * across MVP / Greatest-peak floors. This only lifts the All-star-band movement shooters the
 * complaint was actually about. `ABOVE_STAR_SPACING_MAX_GAIN` (0.025) is ~+2.5 raw TAL at the top
 * of the band — a nudge, not a re-tier.
 */
const ABOVE_STAR_SPACING_RETENTION = 0.3;
const ABOVE_STAR_SPACING_MAX_GAIN = 0.025;
const ABOVE_STAR_SPACING_POSITIONS: ReadonlySet<Position> = new Set(['SG', 'SF', 'PF']);

/**
 * 2026-09-01, user's PG+PF audit ("PF too weak"): a band-limited PF correction floor, applied
 * only in the All-star band (baseTal in [ALL_STAR_TAL_FLOOR, ALL_NBA_TAL_FLOOR)). PF has both
 * the harshest flat correction (0.93) AND the fewest players at the top (20 distinct All-NBA+,
 * 49 All-star+ — lowest of any position); real offensive PFs stall at All-star (Barkley 1992-94,
 * Dirk 2009-11/2012-14, Blake Griffin, Carmelo 2013-15, Siakam). A flat PF bump was rejected
 * before — it lifts Kevin Garnett's TAL-97 peak past Shaq's and breaks the Taylor top-10
 * (0.891 -> 0.818). Restricting the lift to below the All-NBA floor leaves every PF at TAL 80+
 * (KG, Duncan, Giannis, Malone's MVP years) on the flat 0.93, so that pair is untouched.
 * Measured: 4 spans promoted All-star -> All-NBA (Barkley 1992-94 — an MVP season that was
 * stuck at All-star — plus Blake Griffin 2013-15, Chris Webber 1998-00, Al Horford 2014-16),
 * 0 demotions, Taylor 0.891 / GOAT-40 0.693 both held. Kept modest (0.955, ~+1.9 raw at the
 * top of the band) on purpose: pushing toward 1.0 re-creates the same cliff one tier up, where
 * a PF just under the All-NBA floor out-reads one exactly at it.
 *
 * **2026-09-01, extended below the gate too** (user, Bosh/Aldridge audit): the hard 0.85-vs-0.955
 * jump at `ALL_STAR_TAL_FLOOR` was the same star-gate cliff. A PF on the non-shooter penalty side
 * (`spacingCorrection <= flat` — no floor-spacing) now has that penalty EASE toward this value as
 * the flat-corrected number climbs from `PF_PENALTY_TAPER_START` to the gate. A 22/10 non-shooting
 * PF (Bosh 2007-09, flat-corrected ~67) isn't the "box misses a zero-gravity role player's value"
 * case `SPACING_CORRECTION_FLOOR` exists for — the box sees the 22/10, it's the winning impact
 * that's missed, and `realValueFloor.ts` covers that separately. A genuine bench big well below
 * `PF_PENALTY_TAPER_START` keeps the full penalty.
 */
const PF_ALLSTAR_BAND_CORRECTION = 0.955;
const PF_PENALTY_TAPER_START = 66;

/** The sub-All-star spacing boost tapers linearly back to the flat correction as the FLAT-corrected
 * value climbs through the `SPACING_BOOST_TAPER_BAND` points below `ALL_STAR_TAL_FLOOR` — see
 * `positionCorrectionFor`. Without it the star gate is a hard cliff checked on the pre-boost value:
 * a span whose flat value sits at ~68 rides the full 1.18 multiplier straight to ~82 (Mike James
 * 2004-06, a one-year elite-shooting fluke reading All-NBA on C+/D grades). A genuine floor-spacing
 * role player, well below the band, keeps the full boost. */
const SPACING_BOOST_TAPER_BAND = 9;

/**
 * 2026-09-24, user-reported ("defensywni PG bez rzutu — wymarły archetyp w nowoczesnej
 * koszykówce", Buse/Twardzik/McMillan/Ward): a point guard with almost no offensive load and no
 * shot is a dead archetype by modern standards, yet the engine barely charged for it — the
 * pre-3PT-line exemption below shielded every pre-1980 span (Buse 1976-80, Twardzik) outright,
 * and the penalty vanished for good above the All-Star gate (TAL 70). User's explicit calls:
 * (1) the penalty SHOULD apply to pre-line spans too, (2) the gate should sit higher.
 *
 * Scoped to PG with `fga < NON_SHOOTING_PG_FGA_CEILING` on purpose: every pre-1980 player reads
 * spacing 0 (no 3PA existed), so lifting the exemption globally would punish Oscar Robertson /
 * Cousy / Frazier — high-usage scorers with no 3-point attempts to take — exactly the "real
 * opportunity" case the exemption was written for. Low FGA is the "no shot AND no offensive load"
 * signature the user is describing. Above the gate the penalty now FADES linearly to zero over
 * `PG_NON_SHOOTER_PENALTY_GATE`-`ALL_STAR_TAL_FLOOR` points instead of vanishing at a cliff.
 */
const NON_SHOOTING_PG_FGA_CEILING = 10;
const PG_NON_SHOOTER_PENALTY_GATE = 85;
function isNonShootingPointGuard(span: PlayerSpan): boolean {
  return span.primaryPosition === 'PG' && span.fga < NON_SHOOTING_PG_FGA_CEILING;
}

function roleSpacingAdjustedCorrection(span: PlayerSpan): number {
  const spacing = computeSpacing(span);
  const positionFlat = POSITION_TALENT_CORRECTION[span.primaryPosition];
  let raw: number;
  if (spacing >= SPACING_CORRECTION_ELITE_SPACING) {
    raw = SPACING_CORRECTION_CEILING;
  } else if (spacing >= PLUS_SHOOTER_SPACING) {
    const t = (spacing - PLUS_SHOOTER_SPACING) / (SPACING_CORRECTION_ELITE_SPACING - PLUS_SHOOTER_SPACING);
    raw = SPACING_CORRECTION_NEUTRAL + t * (SPACING_CORRECTION_CEILING - SPACING_CORRECTION_NEUTRAL);
  } else {
    const t = spacing / PLUS_SHOOTER_SPACING;
    raw = SPACING_CORRECTION_FLOOR + t * (SPACING_CORRECTION_NEUTRAL - SPACING_CORRECTION_FLOOR);
  }
  // See `predatesThreePointLine`'s own docstring (era.ts) — a true 0 recorded before the 3-point
  // line existed at all reflects no real opportunity, not a judged weakness, so it can never be
  // punished below the position's own flat correction. The boost side stays fully open (a span
  // could theoretically still clear PLUS_SHOOTER_SPACING via non-3PT gravity inputs, though in
  // practice it never will pre-1980 since 3PA is always 0 then) — this only intercepts the
  // punishment direction.
  if (raw < positionFlat && predatesThreePointLine(span.spanLabel) && !isNonShootingPointGuard(span)) return positionFlat;
  return raw;
}

/**
 * Center-only, boost-only curve — the user's explicit "give center a bigger boost for spacers...
 * but don't punish them": a rim-protecting, non-shooting center is still a real, legitimate
 * archetype (screening/rim deterrence/rebounding), unlike a non-shooting guard/wing/PF in a 2026
 * lineup-construction sense, so C never drops below its own existing flat correction
 * (`POSITION_TALENT_CORRECTION.C`, 0.96) regardless of how low spacing reads. The boost itself is
 * BIGGER than the other four positions' ceiling (1.20 vs 1.18) and reachable at a much lower real
 * spacing value (`CENTER_SPACING_FULL_CREDIT`, 55) — real C spacing is far more extreme than any
 * other position (p10 through p75 all read 0 in the pool; only p90 clears 40), so anchoring this
 * curve to the shared `PLUS_SHOOTER_SPACING`/90 pivot points (calibrated for guards/wings) would
 * make the boost nearly unreachable for the position it's specifically meant to reward.
 *
 * 2026-08-19, user's explicit ask: trimmed 1.30->1.20 (Brook Lopez's own 66->89 jump read as too
 * strong relative to the rest of the curve) — still the biggest ceiling of any position, still
 * reached at the same low real spacing bar, just less extreme at the very top.
 *
 * 2026-08-31, user-reported (batch feedback: Brad Miller/Arvydas Sabonis reading All-NBA off
 * mediocre O-TAL/D-TAL letters; measured directly, `scripts` batch — 142/952 C spans, 14.9% of
 * the position, gained >=3 TAL from this exact mechanism, several of them — Karl-Anthony Towns'
 * four different spans among them — with genuinely weak defense, 24-32 D-TAL). Two fixes:
 *
 * 1. `CENTER_SPACING_FULL_CREDIT` raised 55->75. Checked the real distribution first
 *    (`scripts/_spacingDist.ts`, deleted after use): C spacing is extremely bimodal (p50=0,
 *    p70=0, p80=5, p90=50, p95=75, p99=95) — 55 already sat around the real p90, not the "not a
 *    big number" the raw digit suggests, but the user's own framing ("55 to nie są jakieś
 *    wielkie liczby") was about the ceiling being reachable too easily for what's supposed to be
 *    a rare, genuinely elite trait. 75 (the real p95) reserves full credit for the top ~5% of
 *    centers specifically, not the top ~10%.
 * 2. The boost itself is now scoped to the offense-derived term only (see `talentScaled`'s own
 *    C-specific branch) — previously this multiplied the ENTIRE final rawSum, including the
 *    defense-derived term and every additive bonus, so a genuine shooting big with weak defense
 *    (Towns: D-TAL 24-32 across four separate spans, all in the biggest-gainer list) had that
 *    weak defense proportionally amplified by the same multiplier meant to reward his shooting —
 *    not what a "spacing gives credit box stats miss" bonus is supposed to touch at all.
 */
const CENTER_SPACING_CORRECTION_CEILING = 1.2;
const CENTER_SPACING_FULL_CREDIT = 75;

function centerSpacingBoost(span: PlayerSpan): number {
  const flat = POSITION_TALENT_CORRECTION.C;
  const spacing = computeSpacing(span);
  if (spacing <= 0) return flat;
  if (spacing >= CENTER_SPACING_FULL_CREDIT) return CENTER_SPACING_CORRECTION_CEILING;
  const t = spacing / CENTER_SPACING_FULL_CREDIT;
  return flat + t * (CENTER_SPACING_CORRECTION_CEILING - flat);
}

/**
 * `rawSumForGate`, when provided (the real computation path, `talentScaled` below), is the exact
 * pre-correction sum for THIS call's own usage scale — used only to decide whether this span is
 * already star-tier-or-above on the unadjusted flat correction, never to compute the final
 * returned number directly. When omitted (`talentBreakdown`'s display-only call, outside the
 * real computation path), falls back to the already-resolved `computeTalent(span)` — safe here
 * specifically because `talentBreakdown` never feeds back into `computeTalent` itself, unlike
 * this function's other call site.
 */
function positionCorrectionFor(span: PlayerSpan, rawSumForGate?: number): number {
  // Magic Johnson (see docstring above) + LeBron James: the TALENT NUMBER reads as if SF, no
  // matter which position the share-classifier tagged the span. `span.primaryPosition` is left
  // untouched — both still show / filter / draft as their tagged position everywhere else.
  // 2026-09-02, user: LeBron's Miami spans are classified PF (small-ball 4) and his Lakers spans
  // PG, so they eat the PF 0.93 / PG 0.972 correction — a haircut calibrated for box-inflated
  // back-to-the-basket bigs and scoring-light PGs, neither of which a point-forward is. His SF
  // spans (2003-2012, incl. the 2008-10 statistical peak) are unaffected; this only lifts the
  // non-SF spans the classifier scattered him across.
  if (POSITION_CORRECTION_AS_SF.has(normalizePlayerName(span.playerName))) {
    return POSITION_TALENT_CORRECTION.SF;
  }
  const flat = POSITION_TALENT_CORRECTION[span.primaryPosition];
  const baseTal = rawSumForGate !== undefined ? rawSumForGate * flat : computeTalent(span);
  if (span.primaryPosition === 'C') {
    if (baseTal >= ALL_NBA_TAL_FLOOR) return flat;
    return Math.max(flat, centerSpacingBoost(span));
  }
  if (baseTal >= ALL_STAR_TAL_FLOOR) {
    if (span.primaryPosition === 'PG') {
      const penalty = roleSpacingAdjustedCorrection(span);
      if (penalty < flat) {
        const t = clamp01((baseTal - ALL_STAR_TAL_FLOOR) / (PG_NON_SHOOTER_PENALTY_GATE - ALL_STAR_TAL_FLOOR));
        return penalty + t * (flat - penalty);
      }
    }
    // Above the star gate the spacing adjustment doesn't apply in full, but the old hard `return
    // flat` was a cliff for elite spacers crossing TAL 70 (see `ABOVE_STAR_SPACING_RETENTION`).
    // Keep a small, capped fraction of the sub-gate boost — SG/SF/PF only, and only in the
    // All-star band (below the All-NBA floor); the penalty side still vanishes here
    // (`Math.max(flat, ...)`), so a non-shooting star still reads flat, never below.
    if (baseTal >= ALL_NBA_TAL_FLOOR) return flat;
    // PF's All-star-band lift (see `PF_ALLSTAR_BAND_CORRECTION`) — applies whether or not the span
    // also spaces the floor, so a non-shooting All-star PF (Barkley) gets it too.
    const bandFloor = span.primaryPosition === 'PF' ? PF_ALLSTAR_BAND_CORRECTION : flat;
    if (!ABOVE_STAR_SPACING_POSITIONS.has(span.primaryPosition)) return bandFloor;
    const residual = (roleSpacingAdjustedCorrection(span) - flat) * ABOVE_STAR_SPACING_RETENTION;
    return Math.max(bandFloor, flat + Math.min(residual, ABOVE_STAR_SPACING_MAX_GAIN));
  }
  const spacingCorrection = roleSpacingAdjustedCorrection(span);
  // 2026-08-31, user-reported (Mike James 2004-06 at TAL 82 / All-NBA on C+/D grades): the star gate
  // above is a hard cliff checked on the PRE-boost value `rawSum * flat`, and the boost it applies
  // can be as large as 1.18 — a span whose flat value is ~68 (just under the gate) rides the +18%
  // straight to ~82. Taper the boost back to flat over `SPACING_BOOST_TAPER_BAND` points below the
  // gate. The display-only call (`talentBreakdown`, no `rawSumForGate`) is untouched — a real
  // floor-spacing role player well below the band keeps the full boost.
  if (rawSumForGate === undefined) return spacingCorrection;
  if (spacingCorrection <= flat) {
    // Penalty side (no floor-spacing). For PF only, ease the non-shooter penalty toward
    // `PF_ALLSTAR_BAND_CORRECTION` as the flat-corrected number climbs to the gate — see that
    // constant's docstring. Every other position, and a PF below `PF_PENALTY_TAPER_START`, keeps
    // the full penalty.
    if (span.primaryPosition !== 'PF' || spacingCorrection >= PF_ALLSTAR_BAND_CORRECTION) return spacingCorrection;
    const t = clamp01(
      (rawSumForGate * flat - PF_PENALTY_TAPER_START) / (ALL_STAR_TAL_FLOOR - PF_PENALTY_TAPER_START),
    );
    return spacingCorrection + t * (PF_ALLSTAR_BAND_CORRECTION - spacingCorrection);
  }
  // 2026-09-01, user's rule ("if they made any accolades in their career, not just this season,
  // they're validated"): the taper can't tell a fluke box line from a genuine prime span on the
  // counting stats alone. A player the league ever recognized as an All-Star / All-NBA pick is
  // exempt — Mike James (never, in any season) still falls; every player with a real selection
  // somewhere in their career keeps the full boost.
  if (wasEverAllStarCaliber(span.playerName)) return spacingCorrection;
  const flatResult = rawSumForGate * flat;
  const taper = clamp01((ALL_STAR_TAL_FLOOR - flatResult) / SPACING_BOOST_TAPER_BAND);
  return flat + (spacingCorrection - flat) * taper;
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
 * 2026-09-23, user-reported live ("spoko że Gobert ma fajne efficiency ale wszystko to
 * wykreowane przez kolegów rzuty"): `efficiency` (`relativeTs * 140`) has zero awareness of
 * assisted-vs-self-created shots — a lob dunk and a self-created stepback count identically as
 * long as both go in, so Rudy Gobert's real 70.9% TS% (2020-22), almost entirely lobs/putbacks
 * off teammates, produces the single largest efficiency credit of any span checked (8.8),
 * rivaling far more offensively versatile bigs on pure volume alone.
 *
 * `selfCreationTalentBonus` below already hit the identical data problem from the other
 * direction — its own docstring names Gobert directly among the guardrail failures ("box-score
 * 'unassisted' doesn't mean 'self-created' for a finishing big... a roll-and-dunk records as
 * unassisted") — and settled it by scoping to archetypes where the unassisted-rate signal is
 * actually trustworthy. This reuses that exact same population and threshold rather than
 * re-litigating it, just applied as a discount on `efficiency` instead of withholding a bonus.
 * `Post Scorer` is excluded for the same reason `selfCreationTalentBonus` leaves it ungated: a
 * real post move and a pass-entry bucket both read "assisted" in this dataset, so a low
 * self-creation percentile there isn't trustworthy evidence either way (Shaq, Duncan untouched).
 * `Stretch Big` is excluded too — a catch-and-shoot three being assisted doesn't diminish the
 * real shooting skill it took to make it, unlike a roll-and-dunk.
 *
 * Bounded like every other one-directional term in this file: never below `EFFICIENCY_SELF_CREATION_MIN_FACTOR`
 * (a real, verified TS% still means something even at zero self-creation), full credit restored
 * at/above the same position-median bar (`SELF_CREATION_BONUS_PERCENTILE_THRESHOLD`) the bonus
 * mechanism already uses.
 */
const EFFICIENCY_SELF_CREATION_ARCHETYPES: ReadonlySet<OffensiveArchetype> = new Set(['Roll & Cut Big']);
const EFFICIENCY_SELF_CREATION_MIN_FACTOR = 0.6;
export function assistedEfficiencyFactor(span: PlayerSpan): number {
  if (!EFFICIENCY_SELF_CREATION_ARCHETYPES.has(span.offensiveArchetype)) return 1;
  const percentile = selfCreationPercentileForPortability(span);
  if (percentile >= SELF_CREATION_BONUS_PERCENTILE_THRESHOLD) return 1;
  const shortfall = (SELF_CREATION_BONUS_PERCENTILE_THRESHOLD - percentile) / SELF_CREATION_BONUS_PERCENTILE_THRESHOLD;
  return 1 - shortfall * (1 - EFFICIENCY_SELF_CREATION_MIN_FACTOR);
}

/**
 * 2026-08-08, user's v0.2 rating batch, direct follow-up on the Nash/CP3 Greatest-Peak exemptions
 * above: the defense-side mirror of `lowUsageEfficiencyFactor` — "klasyczna kara za low FGA"
 * (the classic low-FGA penalty), applied to defense instead of offense this time. Same reasoning,
 * flipped side: Stockton's real defensive activity (steals volume, DARKO/historical-APM
 * corroboration) is genuinely real, but at his most extreme low-usage spans (FGA as low as 10.5)
 * he was also rarely the possession's primary offensive threat and correspondingly rarely tested
 * as the primary point of attack the way a higher-usage, more heavily-scouted ball-handler is —
 * the same "rarely asked to create/defend against real pressure" critique this file already
 * applies to his offense, now applied symmetrically.
 *
 * Scoped to PG only, unlike the offense-side version (which is position-agnostic) — a big or
 * wing's low FGA carries no such implication (Ben Wallace, Rudy Gobert-type rim protectors
 * legitimately take few shots and are genuinely elite defenders; extending this beyond PG would
 * be a real bug, not a feature, since it would punish exactly the wrong population). Reuses the
 * same reference FGA (12) and ramp shape as the offense-side version rather than inventing a
 * second number for the same idea. Only touches the BLENDED-TAL-facing internal defense
 * component (`rawComponents`'s own `defense`, used for `computeTalent`) — deliberately leaves
 * `defensiveTalent.ts`'s separately-calibrated DISPLAY D-TAL badge untouched, the same
 * blend-vs-display architectural split `normalizedDefenseForFit`'s own docstring already
 * documents and relies on for POR.
 */
function lowUsagePgDefenseFactor(span: PlayerSpan): number {
  if (span.primaryPosition !== 'PG') return 1;
  return lowUsageEfficiencyFactor(span.fga);
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

/**
 * 2026-09-17, audit-found: `USAGE_SCALE_MIN_TIER_TAL`'s gate was a hard on/off switch checked on
 * `baseTal` — a span at exactly 70 got the FULL usage scale (0.65-1.18x), a span at 69 got NONE
 * of it, regardless of how similar their real FGA profiles were. Same shape as this session's
 * spacing.ts findings (a hard cliff where a taper belongs) and the same fix this file's own
 * `SPACING_BOOST_TAPER_BAND` already uses for an analogous star-tier gate just above: ease the
 * scale in linearly over a band below the gate instead of switching it on all at once. Below the
 * band it's exactly 1.0 (no change to the "don't touch marginal role players" intent the gate's
 * own docstring states); at or above `USAGE_SCALE_MIN_TIER_TAL` it's exactly `usageOffenseScale`
 * (no change to the already-established population this was calibrated against). Only the
 * `USAGE_SCALE_TAPER_BAND`-point transition zone changes, and only to remove the discontinuity —
 * a span at baseTal 69.9 now reads ~90% of the real scale instead of 0%.
 */
const USAGE_SCALE_TAPER_BAND = 9;
function usageOffenseScaleTapered(span: PlayerSpan, baseTal: number): number {
  if (baseTal >= USAGE_SCALE_MIN_TIER_TAL) return usageOffenseScale(span);
  const bandFloor = USAGE_SCALE_MIN_TIER_TAL - USAGE_SCALE_TAPER_BAND;
  if (baseTal <= bandFloor) return 1.0;
  const taper = clamp01((baseTal - bandFloor) / USAGE_SCALE_TAPER_BAND);
  return 1.0 + (usageOffenseScale(span) - 1.0) * taper;
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

/**
 * 2026-08-12, G_ASSIST_EQUALS_CREATION: ppg counts an assisted catch-and-shoot three and a
 * self-created stepback identically, so a player who manufactures their own offense earns no
 * more TAL credit than one whose scoring is largely set up by a teammate — a real gap, since
 * self-creation is genuinely the harder skill (the exact reason `portabilityCorrection.ts`
 * already treats it as a "needs the ball" signal, just never as a credit toward talent itself).
 *
 * Reuses `selfCreationSimilarity.ts`'s existing measured/estimated signal rather than building a
 * second one — `selfCreationPercentileForPortability` is already a real (1997+) or k-NN-estimated
 * (pre-1997) blend of unassisted-3PT/unassisted-FG rate, expressed as a within-position
 * percentile so a center's self-created post move and a guard's self-created iso are compared
 * against their own position's real distribution rather than each other's structurally different
 * baseline (bigs' assisted-cut/putback rate is a role artifact, not a skill gap this bonus should
 * be reading).
 *
 * Additive-only, same one-directional shape as every other bonus in this file: below-median
 * self-creation costs nothing (this is a credit for a real plus, not a re-litigation of
 * `positionCorrectionFor`/usage-scale, which already handle volume separately), and the reward
 * ramps linearly from the position median (percentile 0.5) to the top of the position (1.0),
 * capped small — deliberately modest relative to `MAX_SHOOTING_GRAVITY_BONUS`/
 * `MAX_REBOUND_VERSATILITY_BONUS` (both 5) since this project's durable lesson is to start a new
 * mechanism narrow and widen only if a named-player complaint calls for it, not the reverse.
 *
 * **Archetype-gated, found necessary by a guardrail check before shipping, not assumed**: an
 * unscoped first pass gave Shaquille O'Neal, Dennis Rodman, Rudy Gobert, and Bill Russell
 * near-max bonuses (3.3-4.8 of the 5 cap) — box-score "unassisted" doesn't mean "self-created" for
 * a finishing big, since an offensive-rebound putback or a roll-and-dunk records as unassisted
 * despite requiring none of the shot-creation skill this bonus exists to reward. `spacing.ts`'s
 * own older self-creation proxy already solved exactly this by scoping to shot-creation
 * archetypes only (`ARCHETYPE_SELF_CREATION` in `scripts/calibrateSelfCreation.ts`); this bonus
 * reuses that same population rather than inventing a second list. `Post Scorer` is excluded here
 * even though the spacing proxy doesn't weight it, since this bonus's guardrail failures were
 * specifically post/finishing bigs — a genuine post-up isolation move is real shot creation, but
 * this dataset's `unassistedFg` can't distinguish it from a roll or putback the way the spacing
 * proxy's hand-set archetype weight could, so the safer call is to leave Post Scorer ungated for
 * now rather than risk crediting rebounds-as-creation again.
 */
const SELF_CREATION_BONUS_PERCENTILE_THRESHOLD = 0.5;
const SELF_CREATION_BONUS_SCALE = 10;
const MAX_SELF_CREATION_BONUS = 5;
const SELF_CREATION_BONUS_ARCHETYPES: ReadonlySet<OffensiveArchetype> = new Set([
  'Primary Ball Handler',
  'Secondary Ball Handler',
  'Shot Creator',
  'Slasher',
]);

/** Exported for `scripts/checkSelfCreationTalentBonus.ts`'s blast-radius report — same pattern
 * as `extremeUsageRatioPenalty` above. */
export function selfCreationTalentBonus(span: PlayerSpan): number {
  if (!SELF_CREATION_BONUS_ARCHETYPES.has(span.offensiveArchetype)) return 0;
  const excess = selfCreationPercentileForPortability(span) - SELF_CREATION_BONUS_PERCENTILE_THRESHOLD;
  return excess > 0 ? Math.min(MAX_SELF_CREATION_BONUS, excess * SELF_CREATION_BONUS_SCALE) : 0;
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

/**
 * 2026-08-08, user's own direct ask, after a dry-run comparison (same technique as Magic's SF
 * position-correction override): recasting Luka Dončić as SF wholesale (position for every
 * mechanism, not just this one) was tried first and made his overall rating WORSE, not better —
 * checked directly, his blended TAL dropped 91->75 on his 2023-25 peak despite O-TAL jumping to
 * S/A+, because SF's defense standard is strictly harsher than PG's in two places at once
 * (`DEFENSE_TAL_SCALE_BY_POSITION` 4.09 vs PG's 5.13, and `grades.ts`'s SF tier caps requiring
 * D-TAL >=50 just to avoid an All-star ceiling, where PG has no such floor-side cap at all) — his
 * real defensive activity, unremarkable for a lead ball-handler, reads as actively bad for a
 * small forward expected to switch across positions. A full swap doesn't get "great offense,
 * real defensive weakness, MVP-level overall" — it gets "All-star, defense-gated," the opposite
 * of what was asked.
 *
 * User's explicit follow-up request: keep him PG for defense (real weakness stays visible, D-TAL
 * still reads D-/F depending on span — nothing here changes that) but let his OFFENSE read like
 * the wing-strength engine it would if a wing-usage classifier saw the same box profile — "S
 * O-TAL... MVP level" was the literal ask. Root-caused which sub-mechanism actually drives that:
 * NOT `OFFENSE_TAL_PARAMS`'s scale/intercept (swapping only that moved O-TAL 88->89, negligible)
 * but `playmakingThreeLevelOffenseAdjustment` — his real playmaking-quality score (88.3) and 3-
 * level scoring profile are being read at LIGHT-PG strength (this file's own 2026-08-08 PG
 * reintroduction, deliberately small — see that entry's own docstring) instead of full WING
 * strength; recomputing that one sub-call as SF adds ~8 raw offense points (pmBonus 0->4.5,
 * 3lvlBonus 1.5->5.0, both hitting the wing caps), enough on its own to reach O-TAL 98 (S) on his
 * 2023-25 peak using his EXISTING PG O-TAL scale — no scale swap needed at all.
 *
 * Scoped to exactly this one sub-call, nothing else in `rawComponents` — defense, efficiency
 * baseline (`positionAdjustedTsBaseline`), the final `positionCorrectionFor` multiplier, and
 * every PG-specific tier-cap gate all keep reading his real, untouched PG span. The "MVP level"
 * result the user asked for is an emergent, not a hand-picked, outcome: `grades.ts`'s PG tier-cap
 * rule 3 (weak defense caps at All-NBA unless offense clears literal A+) stops firing once O-TAL
 * crosses A+, and no other PG cap engages once offense is this strong — his real raw TAL (already
 * ~91 before this change) becomes his displayed number for the first time, landing in the MVP
 * band (88-93) rather than being compressed down to All-NBA. Verified directly before shipping,
 * not assumed — see this file's own inline comment at the call site for the exact numbers.
 *
 * Fifth named-player exception in this file (after Curry's gravity cap, Magic's SF position
 * correction, Durant's SF-defense exclusion, and Chris Paul's two-way offense-cap exemption in
 * grades.ts) — still exceptional, not a pattern to extend to a sixth player without being asked.
 */
function lukaOffenseComputationSpan(span: PlayerSpan): PlayerSpan {
  if (normalizePlayerName(span.playerName) !== normalizePlayerName('Luka Doncic')) return span;
  return { ...span, primaryPosition: 'SF' };
}

/** Full wing strength (1.0) — see `LUKA_MVP_TIER_CAP`'s own docstring for why the "MVP level"
 * half of the ask is enforced separately, as an explicit ceiling, rather than by weakening this
 * bonus until it stops overshooting. A fractional blend was tried first and couldn't hit both
 * targets from one knob: at 0.5 his best span (2022-24) still overshot into Greatest peak while
 * his other real spans fell short of the S/A+ grade that was the whole point of the exception. */
const LUKA_WING_BLEND = 1.0;

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
  // `assistedEfficiencyFactor` only ever discounts a CREDIT (relativeTs > 0) — a genuinely
  // below-average finishing big's efficiency penalty is real regardless of who set him up, so
  // the dampening never softens that direction.
  const efficiency =
    relativeTs * 140 * lowUsageEfficiencyFactor(span.fga) * (relativeTs > 0 ? assistedEfficiencyFactor(span) : 1);
  const playmaking = effectivePlaymakingApg(box.apg) * paceFactor * 1.7;
  const centerPlaymaking = centerPlaymakingBonus(span.primaryPosition, box.apg, paceFactor);
  const isCurry = normalizePlayerName(span.playerName) === normalizePlayerName('Stephen Curry');
  const gravityCap = applyCurryException && isCurry ? CURRY_GRAVITY_CAP : MAX_SHOOTING_GRAVITY_BONUS;
  const gravity = Math.max(-gravityCap, Math.min(gravityCap, shootingGravity(span) * SHOOTING_GRAVITY_SCALE));
  // 2026-08-07, second pass (see playmakingThreeLevel.ts's own header for the full story of the
  // first pass, reverted, and this scoped-down retry) — playmaking quality + 3-level/rim-finishing
  // scoring. Was excluded entirely for PG; reintroduced 2026-08-08 at a light, position-relative
  // magnitude (see playmakingThreeLevel.ts's own 2026-08-08 header entry for why and how much).
  // Threads the same `applyCurryException` gate the gravity term above uses — Curry is PG-tagged
  // and genuinely clears the 3-level bonus's gate, which reopened the exact Jordan/LeBron-ordering
  // problem `CURRY_GRAVITY_CAP` exists to prevent (see `CURRY_MULTI_LEVEL_CAP`'s own docstring).
  //
  // 2026-08-08, Luka Dončić named exception (see `lukaOffenseComputationSpan`'s own docstring):
  // this ONE sub-call reads a position-overridden span for him specifically, blending toward
  // wing-strength instead of light-PG, everything else in this function (efficiency baseline,
  // defense, the final position-correction multiplier) keeps reading his real `span`/PG
  // untouched. Full wing strength (`LUKA_WING_BLEND = 1`) was tried first and overshot the "MVP
  // level" ask on his two biggest spans (2022-24/2023-25 both crossed into Greatest peak, 96-97)
  // — the raw offense boost feeds the BLENDED TAL too, not just the O-TAL display, so granting
  // the full wing delta pushed him past the Greatest-peak floor on exactly the spans it was
  // least intended to. `LUKA_WING_BLEND` interpolates between his real light-PG value and the
  // full-wing one; see its own constant comment for the calibrated fraction.
  const lightPgPlaymakingThreeLevel = playmakingThreeLevelOffenseAdjustment(span, applyCurryException);
  const wingPlaymakingThreeLevel = playmakingThreeLevelOffenseAdjustment(lukaOffenseComputationSpan(span), applyCurryException);
  const playmakingThreeLevel =
    lightPgPlaymakingThreeLevel + LUKA_WING_BLEND * (wingPlaymakingThreeLevel - lightPgPlaymakingThreeLevel);
  // 2026-09-04 — "rim pressure": the counterpart to the `gravity` (arc-spacing) term above. That
  // term only ever credits 3PT floor-spacing, so a dominant interior focal point who collapsed
  // defenses every possession (Shaq, Kareem, Moses, prime Ewing/Hakeem/Karl Malone) got nothing
  // for it. Selective and one-directional — 0 for guards/wings, stretch bigs, face-up PFs,
  // passing hubs, and low-usage lob threats; see rimPressure.ts. Same additive scale as `gravity`.
  const rimPressureOffense = rimPressureOffenseTerm(span);
  const offense =
    (scoringRate + efficiency + playmaking + centerPlaymaking + gravity + playmakingThreeLevel + rimPressureOffense) *
    usageScale;

  // Real DARKO plus-minus data (where it exists, 1997-98+) can reveal defensive value the
  // box score alone can't see (see darkoCorrection.ts) — Garnett and Duncan are the clearest
  // cases, both stuck at 78 from box stats alone despite historically strong real DDPM.
  const rawDefense =
    computeDefensiveImpact(span) + darkoDefenseBonus(span) - darkoDefenseMalus(span) + reboundingVersatilityBonus(span, paceFactor);
  const defense = Math.max(rawDefense * lowUsagePgDefenseFactor(span), DEFENSE_FLOOR);

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
const TWO_WAY_SYNERGY_SCALE = 1.0;
const MAX_TWO_WAY_SYNERGY_BONUS = 7;

/**
 * 2026-08-31, user-reported ("PG overvalues defensive profiles" + "PF is a very weak position" —
 * measured to be the same asymmetry): distinct players peaking at All-NBA+ run PG 47 vs SF 27 /
 * C 28 / PF 20 / SG 15. 29 of ~200 pool PGs take a synergy bonus >= 3 on their peak span, most
 * the full +7. `twoWaySynergyBonus` fires whenever BOTH position-normalized sides clear 45 — and
 * for a PG, with the steep `DEFENSE_TAL_SCALE.PG` plus `synergyGateDefense`'s +12 corroboration
 * bump, the defense side is near-automatic for anyone with steals or an All-Defense nod, while a
 * C-/C-grade PG scorer's normalized offense (~52-62) also clears 45. So Mookie Blaylock (O C-),
 * Steve Francis, Derek Harper, Fat Lever, Terrell Brandon, Eric Bledsoe all jumped a whole
 * display tier on the bonus alone.
 *
 * PG's own base threshold is raised to 55 — the two-way bonus now needs the WEAKER side genuinely
 * above-average for the position, not merely present. But raising it flat also caught the real
 * pass-first two-way PGs whose scoring-weighted O-TAL understates them (Jason Kidd fell to
 * Starter, Gary Payton / Maurice Cheeks dropped), so an **elite-playmaking exemption** puts them
 * back at 45: a genuine floor general (pace-adjusted, diminishing-returns assists >=
 * `PG_SYNERGY_ELITE_PLAYMAKING_APG`) is contributing real offense the O-TAL grade can't see, which
 * is exactly the two-way case this bonus exists for. Every other position keeps a flat 45 — this
 * over-firing is PG-specific, confirmed by the per-position distinct-player counts above.
 */
const TWO_WAY_SYNERGY_THRESHOLD_BY_POSITION: Record<Position, number> = {
  PG: 55,
  SG: 45,
  SF: 45,
  PF: 45,
  C: 45,
};
const PG_SYNERGY_ELITE_PLAYMAKING_APG = 8;

/**
 * 2026-09-17, full-engine audit follow-up: the elite-playmaking exemption above was a hard
 * cliff on `paceAdjustedApg` — Doc Rivers' 1987-89 span (paceApg 7.98, weaker-side 53.8) got
 * threshold 55 and synergy 0, while the same span nudged to paceApg 8.25 (weaker-side barely
 * different, 54.3) cleared the elite threshold of 45 and jumped straight to the max +7 bonus —
 * confirmed live with a synthetic apg sweep on his real box line, everything else held fixed.
 * A 0.27 apg difference, smaller than a normal season-to-season fluctuation, swinging the full
 * bonus range is the same shape as the other cliffs this audit already fixed elsewhere. Tapered
 * over a 1-apg band below the gate, same pattern as `usageOffenseScaleTapered`'s
 * `USAGE_SCALE_TAPER_BAND` — chosen as the smallest band that removes the literal discontinuity
 * (18 pool spans move at band=1 vs 33 at band=2, where it starts reaching players like Eric
 * Bledsoe at ~6.1 apg who were never the "genuine floor general" this exemption targets).
 */
const PG_SYNERGY_APG_TAPER_BAND = 1;

function synergyThresholdFor(span: PlayerSpan): number {
  const base = TWO_WAY_SYNERGY_THRESHOLD_BY_POSITION[span.primaryPosition];
  if (span.primaryPosition !== 'PG') return base;
  const { pace } = eraBaseline(span.spanLabel);
  const paceAdjustedApg = effectivePlaymakingApg(span.box.apg) * (LEAGUE_PACE_BASELINE / pace);
  if (paceAdjustedApg >= PG_SYNERGY_ELITE_PLAYMAKING_APG) return 45;
  const bandFloor = PG_SYNERGY_ELITE_PLAYMAKING_APG - PG_SYNERGY_APG_TAPER_BAND;
  if (paceAdjustedApg <= bandFloor) return base;
  const taper = clamp01((paceAdjustedApg - bandFloor) / PG_SYNERGY_APG_TAPER_BAND);
  return base - taper * (base - 45);
}

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

/**
 * 2026-09-17, audit-found (not user-reported from a specific span, a structural code-review
 * catch): this used to be an if/else-if cascade checked in the order corroborated -> dual-source
 * -> partial, first match wins. But the dual-source tier's own docstring above argues its bonus
 * (17) is "at least as strong a signal, arguably stronger" than the corroborated tier's (12) —
 * two independent real sources both reading positive vs. one source's excess or an accolade. A
 * PF/C span satisfying BOTH conditions got trapped in the smaller `corroborated` branch purely
 * because it was checked first, never reaching the larger bonus its stronger evidence earned —
 * the same "more corroboration scores lower" non-monotonic-branch shape as this session's
 * spacing.ts findings, just on a defense gate instead of a shooter count. Fixed by computing
 * every tier's bonus independently and taking the max that applies, so evidence strength (not
 * check order) decides the result — this also means a future fifth tier can be added without
 * having to re-derive the correct relative ordering of every existing one.
 */
function synergyGateDefense(span: PlayerSpan, normalizedDefense: number): number {
  const corroborated = darkoDefenseBonus(span) > 0 || individualDefenseRate(span) > 0;
  let bonus = 0;
  if (corroborated) bonus = Math.max(bonus, CONFIRMED_DEFENSE_GATE_BONUS);
  if (isDualSourceConfirmedBig(span)) bonus = Math.max(bonus, DUAL_SOURCE_BIG_GATE_BONUS);
  if (hasPositiveRawDefense(span)) bonus = Math.max(bonus, PARTIAL_DEFENSE_GATE_BONUS);
  if (bonus > 0) return Math.min(100, normalizedDefense + bonus);
  return Math.min(normalizedDefense, UNCORROBORATED_DEFENSE_GATE_CAP);
}

function twoWaySynergyBonus(span: PlayerSpan, normalizedOffense: number, normalizedDefense: number): number {
  const weaker = Math.min(normalizedOffense, normalizedDefense);
  return Math.min(MAX_TWO_WAY_SYNERGY_BONUS, Math.max(0, weaker - synergyThresholdFor(span)) * TWO_WAY_SYNERGY_SCALE);
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

/**
 * 2026-08-19, user-reported (Klay Thompson 2014-16, Movement Shooter, FGA/APG 6.84 -> -3.9
 * penalty, vs. CJ McCollum 2020-22, Shot Creator, FGA/APG only 3.84 -> -0.6 penalty, despite
 * McCollum's own O-TAL/D-TAL both reading clearly *worse* than Klay's on every position-scaled
 * number — confirmed directly via `talentBreakdown`, not assumed). This penalty's own docstring
 * says it exists to catch "shoots a lot without creating for others" as a proxy for an empty/
 * limited offensive game (Mullin/Dantley/English) — but a pure off-ball shooter structurally has
 * low assists BY ROLE (they're not the one bringing the ball up or initiating offense), not
 * because their game is limited the way a ball-dominant, low-vision scorer's is. The raw FGA/APG
 * ratio can't distinguish those two cases, and the existing defense gate doesn't help either
 * (Klay's defense is weak too, same as a real "empty stats" case would be). Meanwhile a genuine
 * on-ball Shot Creator — arguably the archetype this penalty is MOST meant to catch — gets
 * partially exempted anyway, since running the offense inflates assists as a side effect of
 * having the ball, independent of whether they actually set teammates up well.
 *
 * `offensiveArchetype` already gates the POSITIVE side of this exact question
 * (`SELF_CREATION_BONUS_ARCHETYPES` above restricts the self-creation bonus to on-ball
 * archetypes) — this is the same signal applied to exempt the negative side. Scoped to the three
 * off-ball-shooter archetypes plus the two back-to-the-basket ones, all off-ball BY DEFINITION (a
 * player literally cannot initiate much offense from a role built around catching passes off
 * movement/screens/spot-ups, or operating from the low post with his back to the rim).
 * `Athletic Finisher` intentionally left out — "finishes plays others create" is a different
 * claim that deserves its own look if it comes up.
 *
 * **2026-09-01, `Post Scorer` + `Roll & Cut Big` added.** Audited by position — this penalty had
 * become a frontcourt/wing tax (PF/SF/C mean -4 over 400+ spans, PG mean -2) that maxed out (-6)
 * on exactly the profile it isn't for: a post scorer generates few assists BY ROLE, not because
 * the game is empty volume the way the docstring's own targets (Mullin/Dantley/English — all
 * Slasher/Shot Creator, perimeter face-up) are. Measured: Karl Malone / Shaq / Ewing / Moses /
 * Bob Pettit / Aldridge / Bosh's Toronto peak all lifted appropriately; Bargnani / Kevin Love /
 * Carmelo / Al Harrington's chucker years keep the penalty (Versatile Big / Stretch Big / Shot
 * Creator tags). 67 tier moves, 0 down, Taylor 0.891 / GOAT-40 0.693 both held exactly.
 */
const OFF_BALL_USAGE_PENALTY_EXEMPT_ARCHETYPES: ReadonlySet<OffensiveArchetype> = new Set([
  'Off Screen Shooter',
  'Movement Shooter',
  'Stationary Shooter',
  'Post Scorer',
  'Roll & Cut Big',
]);
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
  if (OFF_BALL_USAGE_PENALTY_EXEMPT_ARCHETYPES.has(span.offensiveArchetype)) return 0;
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

/**
 * 2026-08-31, user-reported (batch feedback, Mutombo case): the fixed 60/40 offense/defense
 * blend structurally undervalues a genuinely elite ONE-WAY defensive anchor — measured directly
 * across the whole pool first (215 spans with D-TAL>=90): Ben Wallace's real peak (2002-04,
 * D-TAL 99, a real 4x DPOY like Mutombo) topped out at TAL 61; Bill Russell (D-TAL 90) at 62;
 * Mark Eaton (D-TAL 96-98) at 56-57. `twoWaySynergyBonus` above doesn't reach these spans at all
 * — it's gated on the WEAKER of offense/defense clearing a bar, which a true one-way specialist's
 * low O-TAL never will. This is the deliberately narrow, opposite-shaped complement: credit for
 * being exceptional on ONE side specifically, independent of the other. Threshold (85) and scale
 * chosen so the softcap naturally absorbs this for players who don't need it (an already-elite
 * two-way legend like Jordan/Hakeem/Duncan sits close enough to the 100 ceiling that this bonus
 * barely moves their displayed number) while genuinely lifting the low-O-TAL specialist
 * population this was reported for.
 */
const ELITE_DEFENSE_BONUS_THRESHOLD = 85;
const MAX_ELITE_DEFENSE_BONUS = 15;

function eliteDefenseTalBonus(span: PlayerSpan): number {
  const dtal = computeDefensiveTalent(span);
  return Math.min(MAX_ELITE_DEFENSE_BONUS, Math.max(0, dtal - ELITE_DEFENSE_BONUS_THRESHOLD));
}

// 2026-08-31: a one-off named TAL bonus for Klay Thompson 2015-17 (matching his D-TAL floor's
// display fix, see defensiveTalent.ts's NAMED_DTAL_FLOOR) was tried and reverted here — the
// user's own follow-up catch: it applied to only ONE of Klay's spans, so 2017-19 (real D-TAL 67,
// C+ — already genuinely higher than 2015-17's floored 60) got no equivalent credit and 2015-17
// leapfrogged it in TAL/tier despite still measuring worse defensively. A real fix needs
// `eliteDefenseTalBonus` above generalized into a smooth bridge that reacts below its current 85
// threshold for every span, not a per-player patch — that's a genuine formula change requiring
// the same pool-wide blast-radius measurement as every other formula change this project ships,
// not a same-night fix (this exact threshold already has a real, calibrated consequence built
// around it — grades.ts's elite-defense-bonus MVP-tier cap — so touching it again needs the same
// care that fix took). Tracked as a real follow-up, not shelved silently.

/**
 * 2026-08-31 (later session, dedicated pass): the D-TAL -> TAL bridge. `eliteDefenseTalBonus` above
 * is a step function (zero below D-TAL 85) and the only existing path from the calibrated D-TAL
 * ladder into TAL's blended value. Everywhere below that threshold, TAL's own internal defense term
 * (`rawComponents().defense` — box impact + DARKO, floored at 20) is a completely different,
 * lower-resolution scale than the D-TAL display ladder (per-position percentile rungs +
 * `UNCORROBORATED_CEILING` + accolade headroom credit, fitted against 46 reference ratings). So
 * Danny Granger 2009-11 (D-TAL 53) and Sean Elliott 1994-96 (D-TAL 38) both land at TAL 78 — a real
 * 15-point defensive gap the blend can't see. Three same-night attempts at closing this failed:
 *
 *   1. DCX (contextual defensive talent, DARKO-excess + decayed accolades) — bad signal, maxed out
 *      known WEAK defenders (Ryan Anderson, Dirk 2010-12).
 *   2. A triangular bonus added into `talentScaled`'s `rawSum` — moved 19.5% of the pool by up to
 *      +17-19 TAL, because any new `rawSum` term can push a span's FIRST-pass value across
 *      `USAGE_SCALE_MIN_TIER_TAL`'s gate, unlocking a much larger usage-scale multiplier on the
 *      second pass.
 *   3. The same bonus applied post-pipeline (after both passes + softcap) — per-span clean, but
 *      purely one-directional: it lifted ~20% of the whole pool at once, which showed up as
 *      systemic inflation in team-level aggregates (`benchDepthScore`, the SF position's feel).
 *
 * This version fixes all three failure modes at once:
 * - **Rank-based, so mean-zero per position by construction.** The correction is driven by the gap
 *   between two *within-position percentiles* — where D-TAL places the span vs where TAL's own
 *   internal defense read (`normalizedDefenseForFit`) places it (both precomputed,
 *   `runtimePercentiles.json`). The mean of a percentile is 0.5 for both, so the pool-wide mean
 *   correction is ~0 at every position — team aggregates don't systematically move (verified:
 *   full-pool mean correction |<=0.15| at every position).
 * - **Applied post-pipeline**, after the two-pass usage-scale gate is already resolved and before
 *   `softCapTalent` — so it can never move the gate-deciding first-pass value (failure mode 2).
 * - **Signed** — a span D-TAL rates well *below* where the blend puts it (a one-way volume scorer:
 *   Michael Redd, JJ Redick, Pete Maravich) is pulled down by the same mechanism that pulls a
 *   genuine two-way guard up, so there's no net lift (failure mode 3).
 * - **`tanh`-smoothed** so only genuinely large rank disagreements get near the cap; a small/medium
 *   disagreement barely moves.
 * - **Near-symmetric caps** — down to `DTAL_BRIDGE_DOWN_CAP` (6), up to `DTAL_BRIDGE_UP_CAP` (5).
 *   A larger/uncapped version pushed a broad perimeter population up a whole display tier at once
 *   (Anthony Edwards 2024-26 into MVP, Danny Granger 2009-11 to 90); at 5/6 with the `grades.ts`
 *   tier gates below, the pool-wide mean correction is ~-0.2 per position (measured) — the tanh's
 *   odd shape keeps it near mean-zero.
 * - **Elite-offense damping on the DOWN side only** — `computeOffensiveTalent` from
 *   `DTAL_BRIDGE_OFFENSE_DAMP_FLOOR` (75) up to `_CEIL` (95) linearly scales the down-correction
 *   toward zero, so an elite offensive engine whose defense genuinely reads near the floor (Steve
 *   Nash 2005-07, Jokić 2023-25, Durant 2011-13, Harden) isn't gutted — the same protection
 *   `grades.ts`'s tier caps and `PG_DEFENSE_CAP_ELITE_OFFENSE_EXEMPTION` already grant this exact
 *   population.
 *
 * **No damping on the UP side.** A symmetric "low-O-TAL specialist doesn't ride D-TAL alone into
 * All-star" damp was tried (floor 42-58) and reverted: measured directly, the population it damps
 * IS the bridge's target population — Danny Green, P.J. Tucker, Patrick Beverley, OG Anunoby, Luc
 * Mbah a Moute, prime Ron Artest all sit at O-TAL 30-49 by role, and the whole point of the bridge
 * is to credit exactly that "defense is most of my value" profile. It also introduced a systematic
 * ~-1 pool-wide deflation (defense-plus players skew offense-light, so the up-damp bit a larger
 * fraction of the up-population than the elite-offense damp bites of the down-population). A
 * genuine non-scorer reaching All-star on defense alone (Nate McMillan O-TAL 42, D-TAL 99) is a
 * handful of named spans best handled with a `NAMED_TIER_DOWNCAPS` entry if the user objects to a
 * specific one, not a slope that punishes every 3-and-D role player.
 *
 * `eliteDefenseTalBonus` above is deliberately kept as-is and stacks on top — it targets the
 * D-TAL >= 85 one-way-anchor tail specifically (Ben Wallace / Mutombo / Eaton), where an *additive*
 * lift is wanted rather than a rank-relative nudge, and its own MVP-tier-cap gate in `grades.ts`
 * still nets it out for players who don't need it.
 *
 * `grades.ts` additionally gates the DISPLAYED tier so the bridge alone can't be the sole reason a
 * span crosses INTO MVP+ or DOWN into the PG-archetype / Sixth-Man band (both hard TAL thresholds a
 * 5-6 point nudge would otherwise flip) — see `computeTalentWithoutBridge` and that file's
 * `talWithoutBridge` gate. The numeric value (`talentScore`/`benchDepthScore`/rotation/AI/the
 * displayed TAL number) always reflects the full correction.
 */
const DTAL_BRIDGE_GAIN = 20;
const DTAL_BRIDGE_SMOOTH = 8;
const DTAL_BRIDGE_UP_CAP = 5;
const DTAL_BRIDGE_DOWN_CAP = 6;
const DTAL_BRIDGE_OFFENSE_DAMP_FLOOR = 75;
const DTAL_BRIDGE_OFFENSE_DAMP_CEIL = 95;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Exported for `scripts/checkDtalBridge*` blast-radius reports — same pattern as
 * `selfCreationTalentBonus`/`extremeUsageRatioPenalty` above. Signed: positive = TAL pulled up
 * toward D-TAL, negative = pulled down. */
export function dtalBridgeCorrection(span: PlayerSpan): number {
  const rankGap = runtimeDefenseTalentPercentile(span) - runtimeImpliedDefensePercentile(span);
  const smoothed = DTAL_BRIDGE_SMOOTH * Math.tanh((DTAL_BRIDGE_GAIN * rankGap) / DTAL_BRIDGE_SMOOTH);
  if (smoothed >= 0) return Math.min(smoothed, DTAL_BRIDGE_UP_CAP);
  const down = Math.min(-smoothed, DTAL_BRIDGE_DOWN_CAP);
  const otal = computeOffensiveTalent(span);
  const eliteOffenseDamp =
    1 -
    clamp01(
      (otal - DTAL_BRIDGE_OFFENSE_DAMP_FLOOR) / (DTAL_BRIDGE_OFFENSE_DAMP_CEIL - DTAL_BRIDGE_OFFENSE_DAMP_FLOOR),
    );
  return -down * eliteOffenseDamp;
}

/** The shared pipeline `computeTalent` runs twice — once at `usageScale=1.0` to establish the
 * base tier for `USAGE_SCALE_MIN_TIER_TAL`'s gate, and again with the real usage scale if that
 * gate passes. Returns the uncapped, unrounded scaled value; callers clamp/round/soft-cap. */
function talentScaled(span: PlayerSpan, usageScale: number, includeEliteDefenseBonus = true): number {
  const { offense, defense } = rawComponents(span, true, usageScale);
  const raw = offense * 0.6 + defense * 0.4;
  const { normalizedOffense, normalizedDefense } = normalizedComponents(span, offense, defense);
  const gateDefense = synergyGateDefense(span, normalizedDefense);
  const synergy = twoWaySynergyBonus(span, normalizedOffense, gateDefense);
  const usagePenalty = highUsageLowPlaymakingPenalty(span, gateDefense);
  const extremeUsagePenalty = extremeUsageRatioPenalty(span);
  const hiddenValue = hiddenValueBonus(span);
  const portability = portabilityBonus(span);
  const roleScalability = roleScalabilityBonus(span);
  const playoffPerformance = playoffPerformanceBonus(span);
  const selfCreation = selfCreationTalentBonus(span);
  const eliteDefense = includeEliteDefenseBonus ? eliteDefenseTalBonus(span) : 0;

  // Squash into a 0-100 band; recalibrated (alongside the DARKO defense correction above) so
  // the true GOAT tier reaches ~97-99 instead of topping out at 91 — deep bench specialists
  // still land ~20-35, the low end wasn't touched by this pass.
  const rawSum =
    raw * 2.15 +
    6 +
    synergy -
    usagePenalty -
    extremeUsagePenalty +
    hiddenValue +
    portability +
    roleScalability +
    playoffPerformance +
    selfCreation +
    eliteDefense;
  const correction = positionCorrectionFor(span, rawSum);
  // 2026-08-31, user-reported (batch feedback: Brad Miller/Arvydas Sabonis/Karl-Anthony Towns —
  // see `CENTER_SPACING_FULL_CREDIT`'s own docstring for the full measured root cause). The
  // center spacing boost is an offense-only credit ("give centers who space the floor real
  // value box stats miss"), but multiplying it against the WHOLE `rawSum` also scaled the
  // defense-derived term and every additive bonus by the same factor — a weak-defense shooting
  // big (Towns: D-TAL 24-32) had that weakness proportionally amplified by a multiplier meant to
  // reward his shooting, not touch his defense at all. Scoped to the offense-derived term only;
  // every other position is completely unaffected (this branch only ever fires for C, and only
  // changes anything when `correction` differs from the flat correction).
  if (span.primaryPosition === 'C') {
    const flat = POSITION_TALENT_CORRECTION.C;
    const offenseTerm = offense * 0.6 * 2.15;
    const restOfRawSum = rawSum - offenseTerm;
    return offenseTerm * correction + restOfRawSum * flat;
  }
  return rawSum * correction;
}

/**
 * 2026-08-12, G_BLACK_BOX: every named additive/subtractive term in `talentScaled` above, exposed
 * as labeled numbers rather than folded into one opaque total — so `evidenceReport.ts` can build a
 * real "why this rating" breakdown from the SAME numbers `computeTalent` actually used, instead of
 * a second, drifting reimplementation of the formula. Runs the identical usage-scale gate
 * `computeTalent` itself runs (base TAL at usageScale=1.0 decides whether the real usage scale
 * applies) so a caller reading this breakdown never sees a component computed at a different scale
 * than the one that produced the player's displayed TAL.
 */
export interface TalentBreakdown {
  usageScaleApplied: number;
  synergy: number;
  usagePenalty: number;
  extremeUsagePenalty: number;
  hiddenValue: number;
  portability: number;
  roleScalability: number;
  playoffPerformance: number;
  selfCreation: number;
  darkoDefenseBonus: number;
  darkoDefenseMalus: number;
  /** Whether the defense component going into TAL is backed by real plus-minus/accolade data
   * (`synergyGateDefense`'s corroboration gate), vs. capped as unconfirmed box volume. */
  defenseCorroborated: boolean;
  normalizedOffense: number;
  /** Pre-corroboration-gate reading — compare against `normalizedDefense` to tell whether the
   * uncorroborated cap actually bound (raw > gated means real box-defense activity is being
   * held back for lack of confirming real-value/accolade data). */
  normalizedDefenseRaw: number;
  normalizedDefense: number;
  positionCorrection: number;
}

export function talentBreakdown(span: PlayerSpan): TalentBreakdown {
  const baseTal = Math.max(0, Math.min(100, Math.round(softCapTalent(talentScaled(span, 1.0)))));
  const usageScaleApplied = usageOffenseScaleTapered(span, baseTal);

  const { offense, defense } = rawComponents(span, true, usageScaleApplied);
  const { normalizedOffense, normalizedDefense } = normalizedComponents(span, offense, defense);
  const gateDefense = synergyGateDefense(span, normalizedDefense);
  const corroborated = darkoDefenseBonus(span) > 0 || individualDefenseRate(span) > 0;

  return {
    usageScaleApplied,
    synergy: twoWaySynergyBonus(span, normalizedOffense, gateDefense),
    usagePenalty: highUsageLowPlaymakingPenalty(span, gateDefense),
    extremeUsagePenalty: extremeUsageRatioPenalty(span),
    hiddenValue: hiddenValueBonus(span),
    portability: portabilityBonus(span),
    roleScalability: roleScalabilityBonus(span),
    playoffPerformance: playoffPerformanceBonus(span),
    selfCreation: selfCreationTalentBonus(span),
    darkoDefenseBonus: darkoDefenseBonus(span),
    darkoDefenseMalus: darkoDefenseMalus(span),
    defenseCorroborated: corroborated || isDualSourceConfirmedBig(span) || hasPositiveRawDefense(span),
    normalizedOffense,
    normalizedDefenseRaw: normalizedDefense,
    normalizedDefense: gateDefense,
    positionCorrection: positionCorrectionFor(span),
  };
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
 *
 * **`SOFT_CAP_FLOOR` widening tried and reverted, 2026-08-08, user's v0.2 rating batch**: the C
 * position had its own version of the same crowding (Hakeem/Robinson/Shaq/Embiid all reading TAL
 * 97 despite real raw values of 109/119/109/109 — a real 10-point spread erased). Widening the
 * floor to 92 (band 5->8) fixed that, but at real cost to the already-validated TOP of the scale:
 * Jordan dropped to #2 behind LeBron (a first — this project's own history treats "Jordan #1"
 * as load-bearing) and Taylor top-10 Spearman fell 0.867->0.806. The floor/K pair here governs
 * the ENTIRE pool's top end, not just C — a change big enough to meaningfully spread centers is
 * also big enough to reshuffle Jordan/LeBron/Bird, and this batch didn't have room for the kind
 * of dedicated grid-search validation (`scripts/_softCapGrid3.ts`, the ORIGINAL K=15->35 retune)
 * that a real fix here would need. Left at FLOOR=95/K=35. The C crowding this was meant to fix
 * is real but mild (max 4-way tie, not the 8-way ties the PG-specific ceiling fixes solved
 * earlier this batch) — a genuine follow-up, not silently dropped.
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

/**
 * 2026-08-08, user's v0.2 rating batch, named exception: Chris Paul specifically, "for being
 * two-way" — his real profile (B+-ish O-TAL paired with genuinely elite defense, several spans
 * DTAL 88-95) is exactly the shape this whole cap exists to NOT auto-admit into Greatest Peak
 * (a general "OTAL>=75 AND DTAL>=80" rule was tried first and rejected: it also caught 9 separate
 * Stockton spans and 2 LeBron PG-tagged spans with raw uncapped TAL of 111 and 113 — a real
 * re-opening of the exact Jason Kidd-style problem this cap was built to close, not a clean
 * two-way signal). A named exception is the deliberately narrow alternative — the same pattern
 * this file already uses for Curry's gravity cap, Magic's SF position correction, and Durant's
 * SF-defense-cap exclusion — scoped to exactly the one player the user asked for, not a new
 * general rule. Still gated on a real bar (both grades genuinely good, not just "not terrible")
 * so it can't fire for an off-peak CP3 span that doesn't actually deserve it.
 */
const CP3_TWO_WAY_OFFENSE_FLOOR = 80;
const CP3_TWO_WAY_DEFENSE_FLOOR = 80;

/**
 * 2026-08-19, bug found while investigating the user's "why does CP3 show 83 if his real TAL is
 * 96" report: this exemption only ever protected `computeTalent`'s own internal ceiling — the
 * SEPARATE display-tier cap in `grades.ts` (`tierCaps`'s PG case, "needs A- O-TAL grade or better
 * to display above All-NBA") had no matching exemption at all, so it independently re-capped the
 * DISPLAYED badge at All-NBA for the same seasons this exemption already uncapped internally.
 * Checked directly against all 19 real CP3 spans: seven (2009-11 through 2016-18, excluding
 * 2013-15 which was already uncapped) clear this exact bar (OTAL/DTAL both >=80) and were still
 * showing a capped All-NBA badge despite `computeTalent` already reading their real, uncapped
 * value. Exported so `grades.ts` can apply the identical check to its own display cap instead of
 * drifting out of sync with this one again.
 */
export function isCP3TwoWayExempt(playerName: string, otal: number, dtal: number): boolean {
  return (
    normalizePlayerName(playerName) === normalizePlayerName('Chris Paul') &&
    otal >= CP3_TWO_WAY_OFFENSE_FLOOR &&
    dtal >= CP3_TWO_WAY_DEFENSE_FLOOR
  );
}

function pgOffenseGradeCeiling(span: PlayerSpan): number {
  if (span.primaryPosition !== 'PG') return 100;
  const otal = computeOffensiveTalent(span);
  if (otal >= PG_OFFENSE_GRADE_A_FLOOR) return 100;
  if (isCP3TwoWayExempt(span.playerName, otal, computeDefensiveTalent(span))) return 100;
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

/**
 * 2026-08-08, user's v0.2 rating batch: "Nash za atak" — a truly elite (A+) offensive engine
 * shouldn't be capped out of Greatest Peak purely for weak defense, mirroring the exemption
 * `grades.ts`'s own `tierCaps` already grants at the display-tier level for this exact case
 * (gated on A+ there too, for the same "a relative S cutoff is fragile to pin an exemption on"
 * reason). This is the numeric-cap counterpart — without it, Nash's real uncapped peak (95, well
 * into Greatest Peak territory) was being held at 91 by this gate alone despite an OTAL of 100.
 * Checked the blast radius first (`scripts/_v02_pg_exemption_audit.ts`, deleted after use): only
 * 3 spans in the whole pool clear OTAL>=95 with DTAL<60, all three Nash himself — a genuinely
 * narrow, general rule, not something that needed a named exception the way CP3's case did.
 */
const PG_DEFENSE_CAP_ELITE_OFFENSE_EXEMPTION = 95;

function pgDefenseGradeCeiling(span: PlayerSpan): number {
  if (span.primaryPosition !== 'PG') return 100;
  if (computeOffensiveTalent(span) >= PG_DEFENSE_CAP_ELITE_OFFENSE_EXEMPTION) return 100;
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
 * grades.ts's `displayNumberForSpan` is the only caller. Kept through the 2026-08-07 partial
 * revert (the TAL/O-TAL formula experiments that session added were reverted; this one small,
 * safe export survived because GOAT tier itself was explicitly kept).
 */
export function rawUncappedTalent(span: PlayerSpan): number {
  const baseScaled = talentScaled(span, 1.0);
  const baseTal = Math.max(0, Math.min(100, Math.round(softCapTalent(baseScaled))));
  const scaled = talentScaled(span, usageOffenseScaleTapered(span, baseTal));
  // Same post-pipeline bridge `computeTalent` applies — kept here so the GOAT-tier "100+" gate
  // reads a consistent raw number. GOAT-tier spans sit at rank-gap ~0 anyway, so this is ~a no-op
  // in practice, included for consistency rather than effect.
  return Math.round(scaled + dtalBridgeCorrection(span));
}

/**
 * 2026-08-08, user's own follow-up on the PG offense/defense grade-ceiling batch above: too many
 * PGs were landing on the exact same TAL at the top of the pool. Root cause, confirmed by
 * instrumenting the pre-clip value directly (`scripts/_pgCeilingDebug.ts`, deleted after use):
 * `Math.min(finalTal, ceiling)` was a HARD clip, and several genuinely different players were all
 * clearing the 93/87 ceilings by different amounts yet all landing on the identical clipped
 * number — Oscar Robertson (real 96), Stockton (95), Chris Paul (95), Lillard (95), and Luka (94)
 * were all reading TAL 93; Jason Kidd (95), Gary Payton (92), and Isiah Thomas (88) were all
 * reading TAL 87. Same failure mode `softCapTalent` above already exists to prevent at the 95-100
 * boundary — this mechanism just never got the same treatment.
 *
 * Same fix, mirrored: values above their ceiling now approach it asymptotically instead of
 * clipping flat onto it, spread out by how far above the ceiling they actually were. Never
 * reaches (let alone exceeds) the ceiling, so the underlying rule this whole mechanism exists for
 * — weak offense/defense can't reach "Greatest peak"/"MVP" tier — still holds exactly. Band (4)
 * chosen deliberately small: this is meant to break exact ties among already-capped players, not
 * meaningfully re-open the gap the ceiling was built to close. K=2.5 spreads real single-point
 * gaps (Luka, excess 1) visibly from Stockton/Paul/Lillard's shared excess (2) and Oscar's larger
 * excess (3) — checked against this exact top-20 list before shipping, all 5 of the 93-cluster
 * and all 3 of the 87-cluster now separate.
 */
const GRADE_CEILING_BAND = 4;
const GRADE_CEILING_SOFT_K = 2.5;

/** Exported so `grades.ts`'s `displayTalentForSpan` can apply the identical soft-compression to
 * its own hard `Math.min(tal, tierCeiling)` clamp — the exact same "different players, same
 * flattened number" problem, one layer up (tier-badge display rather than the internal TAL
 * ceiling above), found the same day auditing the PG top-of-pool cluster the user reported. Same
 * band/K reused rather than re-tuned separately: no principled reason the two layers should
 * compress by different amounts, and one shared constant pair is one less thing to drift out of
 * sync. Safe for `ceiling = Infinity` (grades.ts's own `tierCeiling('Greatest peak' | 'GOAT')`) —
 * the `ceiling >= 100` guard below already short-circuits before any arithmetic touches it. */
export function applyGradeCeiling(value: number, ceiling: number): number {
  if (ceiling >= 100 || value <= ceiling) return value;
  const excess = value - ceiling;
  return ceiling - GRADE_CEILING_BAND * (1 - Math.exp(-excess / GRADE_CEILING_SOFT_K));
}

/**
 * 2026-08-08, second half of the Luka Dončić exception (see `lukaOffenseComputationSpan`'s own
 * docstring for the first half — the offense-side wing-strength boost). The user's explicit ask
 * was "S O-TAL... MVP level", two independently-specified targets — granting the full wing bonus
 * alone doesn't hit both from one knob (checked directly: 1.0 strength gets real S/A+ grades but
 * overshoots his two biggest spans into Greatest peak; dialing the bonus down to avoid that also
 * dials the O-TAL grade back below what was asked for on his other spans). Splitting the two
 * halves apart — keep the offense boost at full strength, cap the OUTCOME separately — hits both
 * targets from independent, individually-tunable knobs instead of one fragile compromise value.
 * Reuses the exact same soft-compression `applyGradeCeiling` already provides (his raw TAL
 * approaches, never hard-clips at, the MVP-tier ceiling) rather than a second capping mechanism.
 */
function lukaMvpTierCeiling(span: PlayerSpan): number {
  if (normalizePlayerName(span.playerName) !== normalizePlayerName('Luka Doncic')) return 100;
  return PG_MVP_TIER_CAP;
}

/**
 * 2026-09-02, user batch feedback: SGA 2024-26, Kawhi 2015-17/2018-20/2019-21 and Anthony Davis
 * 2017-19/2018-20/2019-21 each read "~3 TAL za dużo" — a genuine top-of-scale judgment call, not
 * a mechanism bug (measured at length, `scripts/_diagSynergy.ts`/`_diagOvershoot.ts`): they max
 * the two-way synergy bonus alongside every real GOAT, and nothing mechanical separates e.g.
 * Anthony Davis 2017-19 from Kevin Garnett 2002-04 (syn 7, darkoD ~6, O-TAL 82-83, D-TAL 96 —
 * near-identical) except the eye test the user is applying. The two tools that could otherwise
 * reach this — a `MAX_TWO_WAY_SYNERGY_BONUS` trim and a `NAMED_TIER_DOWNCAPS` entry — both fail
 * here specifically: the synergy trim costs GOAT-40 for near-zero movement (the 95-100 soft-cap
 * absorbs it), and a downcap to MVP over-corrects to ~90 (`applyGradeCeiling` compresses hard and
 * there is no tier between MVP's 93 ceiling and Greatest peak's 94 floor).
 *
 * So this is a small, flat, post-everything subtraction on exactly the named spans — the same
 * "named single-span exception, the user explicitly wants a specific outcome and no clean general
 * rule reaches it" footing as `NAMED_TIER_DOWNCAPS`/`NAMED_TIER_RAISES`/`GOAT_NAMES`, just on the
 * number rather than the badge. Applied identically in every `compute*Talent` entry point below,
 * after the soft-cap and grade ceiling, re-clamped to [0, 100]. NONE of these spans appear in
 * `TAYLOR_TOP10` or `BACKPICKS_GOAT_2022`, so the external Spearman anchors are provably
 * unaffected (both rank only the players on those lists, among themselves).
 *
 * 2026-09-02, same batch: Jalen Williams 2023-25 (-4, 87 -> 83). User: "J-Dub 87 przy Butlerze
 * 86 i Pierce 86... realnie powinien mieć 83-84." Same synergy-max root cause, made worse here
 * by an unusually large `darkoDefenseBonus` (+9, near the ceiling) stacking on the +7 synergy —
 * 16 points of two-way credit for a third-year wing, plausibly team-context-inflated (OKC's #1
 * defense). -4 puts a clean gap below the Butler/Pierce peak-All-NBA band the user cited.
 */
const NAMED_TAL_PENALTY: ReadonlyMap<string, number> = new Map(
  [
    { name: 'Shai Gilgeous-Alexander', spanLabel: '2024-26', penalty: 3 },
    { name: 'Kawhi Leonard', spanLabel: '2015-17', penalty: 3 },
    { name: 'Kawhi Leonard', spanLabel: '2018-20', penalty: 3 },
    { name: 'Kawhi Leonard', spanLabel: '2019-21', penalty: 3 },
    { name: 'Anthony Davis', spanLabel: '2017-19', penalty: 3 },
    { name: 'Anthony Davis', spanLabel: '2018-20', penalty: 3 },
    { name: 'Anthony Davis', spanLabel: '2019-21', penalty: 3 },
    { name: 'Jalen Williams', spanLabel: '2023-25', penalty: 4 },
  ].map((e) => [`${normalizePlayerName(e.name)}|${e.spanLabel}`, e.penalty]),
);

function namedTalPenalty(span: PlayerSpan): number {
  return NAMED_TAL_PENALTY.get(`${normalizePlayerName(span.playerName)}|${span.spanLabel}`) ?? 0;
}

export function computeTalent(span: PlayerSpan): number {
  const cached = talentCache.get(span.id);
  if (cached !== undefined) return cached;

  const ceiling = Math.min(
    pgOffenseGradeCeiling(span),
    pgDefenseGradeCeiling(span),
    sfOffenseGradeCeiling(span),
    sfDefenseGradeCeiling(span),
    lukaMvpTierCeiling(span)
  );
  const baseScaled = talentScaled(span, 1.0);
  const baseTal = Math.max(0, Math.min(100, Math.round(softCapTalent(baseScaled))));
  // The usage-scale gate stays keyed on the UN-bridged `baseTal` (same as `talentBreakdown`/
  // `rawUncappedTalent`) — the bridge is a post-pipeline defensive rank correction, deliberately
  // outside the two-pass gate it would otherwise be able to move (see `dtalBridgeCorrection`).
  const scaled = talentScaled(span, usageOffenseScaleTapered(span, baseTal));
  const finalTal = Math.max(0, Math.min(100, Math.round(softCapTalent(scaled + dtalBridgeCorrection(span)))));
  const result = Math.max(0, Math.round(applyGradeCeiling(finalTal, ceiling)) - namedTalPenalty(span));
  talentCache.set(span.id, result);
  return result;
}

/**
 * The same raw number `computeTalent` would produce with `eliteDefenseTalBonus` excluded — NOT
 * cached (only ever called from `grades.ts`'s tier-cap gate, never in a hot path), and
 * deliberately not itself a public "TAL without defense credit" concept — its only purpose is
 * letting that gate ask "would this span have reached MVP+ without this specific bonus," so a
 * span that gets there ONLY via this new bonus (Rudy Gobert's five affected spans, user-reported
 * 2026-08-31) can be capped at All-NBA there without touching any span whose MVP+ status was
 * already earned on other merits before this bonus existed (Hakeem/Duncan/Robinson/Kareem — all
 * unaffected, their pre-bonus number already cleared MVP on its own).
 */
export function computeTalentWithoutEliteDefenseBonus(span: PlayerSpan): number {
  const ceiling = Math.min(
    pgOffenseGradeCeiling(span),
    pgDefenseGradeCeiling(span),
    sfOffenseGradeCeiling(span),
    sfDefenseGradeCeiling(span),
    lukaMvpTierCeiling(span)
  );
  const baseScaled = talentScaled(span, 1.0, false);
  const baseTal = Math.max(0, Math.min(100, Math.round(softCapTalent(baseScaled))));
  const scaled = talentScaled(span, usageOffenseScaleTapered(span, baseTal), false);
  const finalTal = Math.max(0, Math.min(100, Math.round(softCapTalent(scaled + dtalBridgeCorrection(span)))));
  return Math.max(0, Math.round(applyGradeCeiling(finalTal, ceiling)) - namedTalPenalty(span));
}

/**
 * The same number `computeTalent` produces with the D-TAL->TAL bridge (`dtalBridgeCorrection`)
 * excluded. NOT cached (only ever called from `grades.ts`'s tier gate, never a hot path). Its only
 * purpose, exactly parallel to `computeTalentWithoutEliteDefenseBonus` above: lets that gate ask
 * "would this span sit in the same display-tier band without the bridge," so a small mean-zero
 * defensive rank nudge can't be the sole reason a badge crosses INTO MVP+ (Anthony Edwards
 * 2024-26, Durant 2009-11) or DOWN into the PG-archetype / Sixth-Man band (Trae Young, Isaiah
 * Thomas, Steve Nash) — both hard TAL thresholds a <=8-point correction would otherwise flip. The
 * numeric value everywhere else keeps the full bridged number.
 */
export function computeTalentWithoutBridge(span: PlayerSpan): number {
  const ceiling = Math.min(
    pgOffenseGradeCeiling(span),
    pgDefenseGradeCeiling(span),
    sfOffenseGradeCeiling(span),
    sfDefenseGradeCeiling(span),
    lukaMvpTierCeiling(span)
  );
  const baseScaled = talentScaled(span, 1.0);
  const baseTal = Math.max(0, Math.min(100, Math.round(softCapTalent(baseScaled))));
  const scaled = talentScaled(span, usageOffenseScaleTapered(span, baseTal));
  const finalTal = Math.max(0, Math.min(100, Math.round(softCapTalent(scaled))));
  return Math.max(0, Math.round(applyGradeCeiling(finalTal, ceiling)) - namedTalPenalty(span));
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
 * 2026-08-08, user's v0.2 rating batch: investigated a general soft-cap for O-TAL (mirroring
 * `softCapTalent`) as a fix for "too many Harden spans earn S offense" — real root cause found
 * (checked directly, script deleted after use): the hard `Math.min(100, ...)` clamp below was
 * flattening 24+ genuinely different spans (real unclamped O-TAL from Jokić's 123 down to
 * Harden's 97) onto the literal ceiling. A soft-cap version was built and tested, but reverted:
 * it broke the Nash Greatest-Peak exemption shipped earlier this same session (his real OTAL
 * dropped from 100 to below the 95 elite-offense threshold that exemption depends on) and
 * over-corrected Harden to ZERO S-grade spans rather than narrowing to his real 2017-2020 peak —
 * `computeOffensiveTalent` is load-bearing for too many other gates (PG defense-cap exemption,
 * CP3's two-way exemption, SG's two-way Greatest-Peak path, every position's tier caps) to safely
 * re-tune in the same pass without a much more thorough re-validation than this batch had time
 * for. Left as a hard clamp for now — a real, documented follow-up, not silently dropped.
 */
/**
 * 2026-08-16, user-reported ("gra działa wolno" — profiled `pickForAi`'s per-candidate scoring
 * loop at 63 of 66 total seconds for one 16-team draft, via `scripts/_profilePhases.ts`, deleted
 * after use). Root cause: unlike `computeTalent` (memoized via `talentCache` above since
 * 2026-08-01, precisely because this exact loop calls it thousands of times per pick), this
 * function and `computeDefensiveTalent`/`computeUncappedOffensiveTalent` were NEVER memoized —
 * `aiDrafter.ts`'s value formula calls `computeOffensiveTalent`/`computeDefensiveTalent` directly,
 * several separate times per candidate across its various malus/bonus functions
 * (`highVolumeNonElitePenalty`, `elitePerimeterEngineBonus`, `eliteTwoWayFrontcourtBonus`,
 * `eliteTwoWayPeakBonus`, `earlyCoreRolePenalty`, plus `grades.ts`'s `tierContextFor`), each call
 * re-running the real, non-trivial `rawComponents` computation (era baseline, shooting gravity,
 * 3-level playmaking adjustment computed TWICE internally, DARKO defense corrections, rebounding
 * versatility) completely from scratch. Same safe-to-memoize argument `computeTalent`'s own cache
 * already relies on: a span's own data never changes during a session, so this is a pure function
 * of `span.id` for the app's lifetime. Memoizing it (and its two siblings) directly addresses the
 * measured bottleneck without changing any output value — pure caching, not a formula change.
 */
const offensiveTalentCache = new Map<string, number>();

export function computeOffensiveTalent(span: PlayerSpan): number {
  const cached = offensiveTalentCache.get(span.id);
  if (cached !== undefined) return cached;
  const { offense } = rawComponents(span, false);
  const { scale, intercept } = OFFENSE_TAL_PARAMS[span.primaryPosition];
  const scaled = offense * scale + intercept;
  const result = Math.max(0, Math.min(100, Math.round(scaled)));
  offensiveTalentCache.set(span.id, result);
  return result;
}

/**
 * 2026-08-08, follow-up to the "Harden S-grade narrowing" investigation above: a narrower fix
 * than the reverted general soft-cap. Rather than changing `computeOffensiveTalent` itself (still
 * load-bearing everywhere, still untouched), this is the SAME formula minus only the `Math.min(100,
 * ...)` ceiling — used exclusively by `grades.ts`'s offense S-grade threshold/check. That's the one
 * place the hard clamp actually causes a problem: `computeSThreshold` picks the pool's 3rd-highest
 * *distinct* value, and the clamp collapses 24+ genuinely different spans (Jokić 123 down to
 * Harden 97) onto one distinct value (100), which drops the effective S-bar far lower than it
 * should be and lets far more than "3 best" spans clear it. Reading the real, unflattened spread
 * here fixes the threshold without touching any of the numeric gates (`PG_DEFENSE_CAP_ELITE_OFFENSE_EXEMPTION`,
 * CP3's two-way exemption, every position's tier caps) that depend on `computeOffensiveTalent`
 * staying bit-identical — the exact blast radius that sank the earlier attempt.
 */
/** Same 2026-08-16 memoization as `computeOffensiveTalent` above, same reason. */
const uncappedOffensiveTalentCache = new Map<string, number>();

export function computeUncappedOffensiveTalent(span: PlayerSpan): number {
  const cached = uncappedOffensiveTalentCache.get(span.id);
  if (cached !== undefined) return cached;
  const { offense } = rawComponents(span, false);
  const { scale, intercept } = OFFENSE_TAL_PARAMS[span.primaryPosition];
  const scaled = offense * scale + intercept;
  const result = Math.max(0, Math.round(scaled));
  uncappedOffensiveTalentCache.set(span.id, result);
  return result;
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
