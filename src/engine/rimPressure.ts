import type { OffensiveArchetype, PlayerSpan } from '../data/schema';
import { eraBaseline, LEAGUE_PACE_BASELINE } from './era';
import { computeOffensiveProfile } from './offensiveProfile';
import { boxRatesForSpan } from './boxRatesLookup';

/**
 * "Rim pressure" — how much a player forces the defense to send help at the rim / build its game
 * plan around a double every possession. A parallel to floor spacing (arc gravity), which the
 * engine already models via `spacing.ts` / the `gravity` term in `talent.ts`'s `rawComponents`.
 *
 * The gap this closes: `rawComponents.offense`'s `gravity` term only ever credits ARC gravity.
 * Embiid 2023-25 gets +5 (the cap) from 3.4 3PA/game; Shaq 1999-01 gets 0 from his 0.78 rimShare
 * that collapsed defenses every trip. Scoring rate and efficiency are near-equal between the two
 * (Shaq's TS was genuinely dragged by 52% FT shooting), so the whole ~11-point O-TAL gap was the
 * floor-spacing term. A post-centric offense (Twin Towers, Hakeem + A. Davis, peak Shaq/Kareem/
 * Moses) generates real offensive value — rim gravity opens the same kickout/cut geometry arc
 * gravity opens, just initiated from the block — that the engine could not see.
 *
 * Deliberately selective. `rimPressure(span)` is 0 for guards/wings unless they are Slashers /
 * Athletic Finishers, 0 for stretch bigs, 0 for face-up PFs (Garnett), damped for passing hubs
 * (Jokić / Sabonis — a big who draws help via the pass, not raw rim gravity, and is already
 * credited by `centerPlaymakingBonus`), and damped for efficient low-usage lob threats (Capela /
 * Zubac — nobody game-plans a double for them). ~200 spans, all PF/C, read a non-zero term.
 *
 * Ladder rungs are percentiles of the real span distribution (mirrors `spacing.ts`'s
 * `VOLUME_LADDERS`). Regenerate with `scripts/simulateRimPressure.ts` (it prints them) after any
 * pool regeneration or change to `computeOffensiveProfile`.
 */

const paceFactor = (s: PlayerSpan) => LEAGUE_PACE_BASELINE / eraBaseline(s.spanLabel).pace;

// archetype eligibility for rim-pressure credit (0 = never)
const ARCH_ELIGIBILITY: Partial<Record<OffensiveArchetype, number>> = {
  'Post Scorer': 1.0,
  'Roll & Cut Big': 1.0,
  'Versatile Big': 0.85,
  Slasher: 0.5,
  'Athletic Finisher': 0.5,
};
const PROXY_ARCHETYPES = new Set<OffensiveArchetype>(['Post Scorer', 'Roll & Cut Big', 'Versatile Big', 'Slasher']);

// --- baked percentile ladders (see docstring) --- 2026-09-04
const RUNG_Q = [0, 10, 20, 30, 40, 50, 60, 70, 78, 85, 90, 95, 99];
const RIM_VOL_RUNGS = [0.128, 1.564, 2.163, 2.668, 3.154, 3.682, 4.328, 5.002, 5.71, 6.557, 7.402, 8.683, 10.73];
const BIG_PPG_RUNGS = [1.066, 4.764, 5.938, 7.06, 8.261, 9.542, 11.09, 12.905, 14.783, 16.938, 19.163, 22, 27.305];
const BIG_FGPCT_RUNGS = [0.279, 0.418, 0.44, 0.456, 0.469, 0.482, 0.494, 0.507, 0.522, 0.539, 0.557, 0.589, 0.655];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Interpolated percentile (0-100) of `v` against baked rungs. */
function pctileOf(rungs: number[], v: number): number {
  if (v <= rungs[0]) return 0;
  for (let i = 1; i < rungs.length; i++) {
    if (v <= rungs[i]) {
      const w = rungs[i] - rungs[i - 1];
      const f = w === 0 ? 1 : (v - rungs[i - 1]) / w;
      return RUNG_Q[i - 1] + f * (RUNG_Q[i] - RUNG_Q[i - 1]);
    }
  }
  return 100;
}
/** Only the top ~15% of rim volume gets real credit. */
const steep = (p: number) => clamp((p - 78) / 22, 0, 1) * 100;

/** A big who draws help via the pass, not raw rim gravity — already credited by
 * `centerPlaymakingBonus`, so don't double count. Jokić apg~10 -> 0.68 ; A. Davis apg~3 -> 1.0. */
const passingHubDampener = (s: PlayerSpan) => clamp(1.3 - s.box.apg / 16, 0.55, 1.0);

/** A defense only game-plans a double for a real scoring-volume threat, not an efficient
 * low-usage lob threat (Capela ~12 ppg -> 0.4 ; Dwight ~22 -> 0.7 ; Shaq ~29 -> 1.05). */
const scoringVolumeFactor = (s: PlayerSpan) => clamp((s.box.ppg * paceFactor(s) - 12) / 16, 0.4, 1.1);

/**
 * A real, independent foul-drawing signal from the 2026-09-04 box-rates export
 * (`boxRatesLookup.ts`, full 1946+ coverage) the ppg/fgPct/rim-accuracy reads can't see on their
 * own — Bob McAdoo (69 proxy rimPressure) and Charles Barkley (78) both drew fouls at a genuine
 * focal-point rate (FTr 0.43 / 0.49) the volume/efficiency read alone doesn't fully credit.
 * Deliberately gentle (±20%, not the ±40% a naive read of Shaq's 0.58 would suggest) — FTr is
 * noisy at this remove (Dolph Schayes reads 0.64 off a small, different-era shot diet) and this is
 * a multiplier on an already-computed base, not a new independent term. Returns 1.0 (no-op) when
 * the export has no coverage for this span.
 *
 * Originally the pre-1996-97 proxy branch's own signal only; 2026-09-16, user's own follow-up
 * ask, extended to `rimPressureForFit`'s zone-data (1997+) branch too — same real signal, no
 * reason it should only apply pre-1997. Not extended to `rimPressure()`'s own zone-data branch
 * (which feeds `computeTalent`/TAL, Taylor/GOAT-validated) — that stays untouched, same scoping
 * rule every `rimPressureForFit`-only change in this file already follows.
 */
const FTR_BASELINE = 0.32;
const FTR_SLOPE = 0.9;
function freeThrowRateFactor(span: PlayerSpan): number {
  const rates = boxRatesForSpan(span);
  if (!rates) return 1.0;
  return clamp(1.0 + (rates.ftRate - FTR_BASELINE) * FTR_SLOPE, 0.85, 1.2);
}

/**
 * 0-100: how much this player collapses the defense at the rim. Selective — most spans read 0.
 */
export function rimPressure(span: PlayerSpan): number {
  const elig = ARCH_ELIGIBILITY[span.offensiveArchetype];
  if (!elig) return 0;

  const prof = computeOffensiveProfile(span);
  if (prof.hasZoneData) {
    const shareRamp = clamp((prof.rimShare - 0.3) / 0.2, 0, 1); // sags off <0.30, doubles >0.50
    if (shareRamp <= 0) return 0;
    const accFactor = clamp((prof.rimAccuracy - 52) / 20, 0.35, 1.2); // 52% floor, 72%+ = full
    const shareFactor = clamp(0.7 + prof.rimShare * 0.6, 0.7, 1.25);
    const volScore = steep(pctileOf(RIM_VOL_RUNGS, prof.rimShare * span.fga * paceFactor(span)));
    return clamp(
      elig * volScore * accFactor * shareFactor * shareRamp * passingHubDampener(span) * scoringVolumeFactor(span),
      0,
      100,
    );
  }

  // pre-1996-97 box proxy — no zone data. Always a big here (gated to C/PF).
  if (span.primaryPosition !== 'C' && span.primaryPosition !== 'PF') return 0;
  if (!PROXY_ARCHETYPES.has(span.offensiveArchetype)) return 0;
  if (span.box.threePA / Math.max(1, span.fga) > 0.15) return 0; // a stretch four fails
  const proxyElig = span.offensiveArchetype === 'Slasher' ? 0.75 : elig; // a slashing big IS rim gravity
  const volScore = steep(pctileOf(BIG_PPG_RUNGS, span.box.ppg * paceFactor(span)));
  const fgFactor = clamp((pctileOf(BIG_FGPCT_RUNGS, span.box.fgPct) - 30) / 50, 0.4, 1.15);
  return clamp(proxyElig * volScore * fgFactor * freeThrowRateFactor(span) * passingHubDampener(span), 0, 100);
}

/**
 * Team-fit-only variant, read solely by `rimPressureTeam` below — never by `rimPressureOffenseTerm`
 * (TAL), so Taylor/GOAT are untouched by any of this. Three differences from `rimPressure()`,
 * from the 2026-09-04 fitScore rim-pressure review:
 *
 *  1. No archetype pre-gate on the zone-data (1997+) path. `rimPressure()`'s `elig` check zeroes
 *     a "Primary Ball Handler" (LeBron) or "Stretch Big" (Dirk) tag before real shot-location data
 *     is even read. Here the real data speaks for itself: LeBron 2012-14's actual rimShare (0.47)
 *     and volume clear the bar on their own; Dirk's genuinely low rimShare (0.18 — his game was
 *     mid-range/floater, not restricted-area) still fails `shareRamp` regardless of archetype.
 *  2. The volume-percentile curve is a smooth ramp from the 35th percentile
 *     (`fitVolScore`), not `steep()`'s hard cliff at 78. A real but moderate rim-attacker
 *     (Embiid's volume sits just below the old cliff) is genuinely different from a player with
 *     zero rim presence, and the cliff couldn't tell them apart — both read exactly 0.
 *  3. A positional credit for every real PF/C (`bigPositionalFloor`), independent of the computed
 *     value. A legitimate big has positional size/interior capability a pure shot-chart read
 *     undersells (Dirk's offense is genuinely mid-range-heavy, not rim-share-heavy, but a
 *     7-footer still isn't a lesser interior threat than a wing shooter with a similar or even
 *     higher raw rim share — Klay Thompson's more frequent basket cuts otherwise out-scored him).
 *     Originally a flat `Math.max(base, 15)` floor, user-set 2026-09-04 after comparing floors of
 *     10/15 against Dirk/Porzingis/Klay/Curry.
 */
const FIT_SHARE_FLOOR = 0.15;
const BIG_RIM_PRESSURE_FLOOR = 15;
function fitVolScore(percentile: number): number {
  return clamp((percentile - 35) / 65, 0, 1) * 100;
}

/**
 * 2026-09-16, user-reported live: the original flat `Math.max(base, 15)` floor created a
 * discontinuity right at its own threshold — any real base of 0-15 collapsed to the identical 15,
 * so a genuine non-threat (base 0) and a player with real, computed low-level rim presence (base
 * 16) read almost identically (15 vs 16), a 1-point gap for a 16-point real difference. But the
 * floor's own rationale ("a legitimate big still has SOME positional interior threat a pure
 * shot-chart read undersells") applies just as much to that base-16 player as it does to base-0 —
 * there's no reason the credit should vanish exactly at 15 rather than taper out gradually.
 *
 * Replaced with a diminishing bonus, `BIG_RIM_PRESSURE_FLOOR` (15) at base=0, fading linearly to 0
 * by base=`BIG_RIM_PRESSURE_FLOOR_TAPER` (30) — beyond that point this is byte-identical to the old
 * hard floor (already-substantial computed values are untouched). Verified (`scripts/
 * _softFloorDiag.ts`, measured, deleted after use): Horry 1999-01 stays exactly 15 (base 0, no
 * change), Garnett 2002-04 / Chris Bosh 2007-09 (base 40.7 / 42.0, well past the taper) stay exactly
 * unchanged — only the low end (base < 30) smooths out: Dirk 2005-07 15->21.9, Al Horford 2015-17
 * 15->20.2, Ben Wallace 2003-05 20.6->25.3.
 */
const BIG_RIM_PRESSURE_FLOOR_TAPER = 30;
function bigPositionalFloor(base: number): number {
  const bonus = BIG_RIM_PRESSURE_FLOOR * clamp(1 - base / BIG_RIM_PRESSURE_FLOOR_TAPER, 0, 1);
  return clamp(base + bonus, 0, 100);
}

/**
 * 2026-09-16, user-reported live (a real drafted Kevin Garnett 2002-04 span, then broadened to a
 * pool scan after the user pushed back that this looked systemic, not a one-off): `accFactor`'s
 * old 52-72% window was never checked against the real distribution — it turns out real rim
 * accuracy for a genuine, meaningful-volume PF/C (FGA >= 10) runs p10=57.3 / p50=64.7 / p90=71.9 /
 * p99=76.5 (min 49.7, max 78.6 — `scripts/_accDistDiag.ts`, measured, deleted after use). The old
 * floor (52%) was set BELOW the real 10th percentile, meaning it never actually bound anyone —
 * the effective floor was really the CLAMP'S OWN 0.35 minimum, which every real player under ~59%
 * hit identically regardless of how far under. That's roughly the bottom 15% of the real
 * population reading the exact same value, Hall-of-Famer or not: Hakeem Olajuwon (1995-97, 58%
 * rim accuracy on a 96th-percentile rim-shot volume) landed at the same 0.35 as Dirk Nowitzki
 * (2005-07, a genuinely low-rim-share jump-shooter who is SUPPOSED to read low here) — the
 * multiplicative accFactor term simply couldn't tell an elite-but-not-explosive finisher from a
 * non-threat.
 *
 * Re-anchored to the real min (50, rounded from 49.7) and real p99 (77, rounded from 76.5) instead
 * of the old guessed 52/72 — same 0.35-1.2 output range (the ceiling behavior for genuine elite
 * finishers like LeBron 2012-14 at 77% was already correct and is unchanged), just stretched to
 * actually differentiate across the real populated range instead of clustering the bottom ~15% at
 * one flat number. Verified against the project's usual reference cases before shipping
 * (`scripts/_fixTestDiag.ts`, measured, deleted after use): Hakeem 1995-97 24->40, Karl Malone
 * 1995-97 66->76, Chris Bosh 2007-09 16->26, Anthony Davis 2015-17 44->50 — all real, meaningful
 * moves for real scorers. Dirk 2005-07 stays exactly 15 (his shareRamp, not accuracy, is what
 * correctly floors him — a low rim SHARE, not just moderate accuracy), Robert Horry 1999-01 stays
 * exactly 15 (genuinely low volume/accuracy both) — the validated "should stay low" cases are
 * unaffected. Scoped to `rimPressureForFit` only, same as `FIT_SHARE_FLOOR`/`BIG_RIM_PRESSURE_FLOOR`
 * above — `rimPressure()` (which feeds `computeTalent`/TAL, Taylor/GOAT-validated) keeps its own
 * original 52/72 window untouched.
 */
const FIT_ACC_FACTOR_FLOOR_PCT = 50;
const FIT_ACC_FACTOR_CEILING_PCT = 77;
function fitAccFactor(rimAccuracy: number): number {
  return clamp(
    0.35 + ((rimAccuracy - FIT_ACC_FACTOR_FLOOR_PCT) * (1.2 - 0.35)) / (FIT_ACC_FACTOR_CEILING_PCT - FIT_ACC_FACTOR_FLOOR_PCT),
    0.35,
    1.2,
  );
}

/**
 * 2026-09-16, same investigation as `fitAccFactor` above (user: "KG na poziomie 18 a Horry na 15
 * sugeruje że wychodzimy z wadliwych założeń... chociażby 40 byłoby bardziej realistyczne" — KG at
 * 18 vs Horry at 15 suggests a flawed premise, ~40 would be more realistic): the old formula
 * multiplied TWO separate curves off the exact same `rimShare` value — a hard 0->1 gate from 15%
 * to 50% (the old inline `shareRamp`) and a gentle 0.7->1.25 bonus over the full 0-92%+ range (the
 * old inline `shareFactor`) — double-penalizing anyone whose share sits in the ambiguous middle
 * band. Confirmed this wasn't a "should stay low" case being inflated: Garnett 2002-04's other five
 * factors (volScore 68.6, accFactor 0.94, passingHub 0.96, scoringVol 0.83, ftr 0.99) were already
 * well-calibrated after the accFactor/ftr fixes above — the residual ~18 on a real 23ppg/50%FG
 * season was purely the compounded 0.40 (old shareRamp) x 0.87 (old shareFactor) = 0.35 share term.
 *
 * Replaced with ONE curve, same anchors as the old two (0 at the 15% floor, full 0.7-1.25 credit at
 * >=50% share, unchanged there), but concave (exponent 0.25) inside the 15-50% band instead of the
 * old product's effectively-linear shape, so a moderate share isn't punished twice for the same
 * fact. Broadly verified against ~25 reference cases across archetypes (`scripts/
 * _shareConsolidateDiag.ts` / `_shareExp025Diag.ts`, measured, deleted after use): every floor case
 * unaffected (Horry/Haslem/Dirk/Draymond/Al Horford stay exactly 15 — their real share sits at or
 * below the 15% gate, outside the touched band) and every >=50%-share ceiling case unaffected (Shaq
 * 100, Dwight Howard 80, Gobert 54, Tyson Chandler 41, Ben Wallace 21, Andre Drummond 40 — all
 * unchanged). Only the ambiguous middle band moves: Garnett 2002-04 18->41, Anthony Davis 2015-17
 * 54->74, Chris Bosh 2007-09 30->42, Hakeem 1995-97 41->50.
 */
const FIT_SHARE_CREDIT_EXPONENT = 0.25;
function fitShareCredit(rimShare: number): number {
  if (rimShare <= FIT_SHARE_FLOOR) return 0;
  if (rimShare >= 0.5) return clamp(0.7 + rimShare * 0.6, 1.0, 1.25);
  const t = (rimShare - FIT_SHARE_FLOOR) / (0.5 - FIT_SHARE_FLOOR);
  return Math.pow(t, FIT_SHARE_CREDIT_EXPONENT);
}

/**
 * Fit-only (called solely from `rimPressureForFit`'s pre-1997 branch — never `rimPressure()` /
 * `rimPressureOffenseTerm()`, so TAL / Taylor / GOAT are untouched).
 *
 * `rimPressure`'s pre-1997 proxy pace-adjusts scoring volume through the `steep()` cliff AND
 * applies `passingHubDampener`. For a genuine 1960s-70s interior monster those compound into a
 * bad read: Wilt 1966-68 (24 ppg on 68% FG while leading the league in assists, 8.2 apg) lands
 * at 52, where Kevin McHale 1985-87 — near-identical FG% (95th pctile) and raw volume (96th),
 * but 2.6 apg and a slower era — reads 100. Wilt 66-68's efficiency+volume combo is the 2nd
 * highest of any pre-1997 big in the pool.
 *
 * A pre-1997 big with top-decile FG% AND top-decile raw (un-pace-adjusted) scoring volume AND
 * real shot volume, who is not a stretch big, was an interior focal point regardless of pace or
 * how much he also passed. Floor him at 82 — deliberately below the 90-100 the comparable
 * McHale/Kareem/Barkley spans read, because Wilt's FGA (~15.5) is short of their 16-24.
 */
const DOMINANT_SCORER_FG_PCTILE = 90;
const DOMINANT_SCORER_PPG_PCTILE = 90;
const DOMINANT_SCORER_MIN_FGA = 15;
const DOMINANT_SCORER_FLOOR = 82;
function dominantInteriorScorerFloor(span: PlayerSpan): number {
  if (span.primaryPosition !== 'C' && span.primaryPosition !== 'PF') return 0;
  if (span.box.threePA / Math.max(1, span.fga) > 0.15) return 0;
  if (span.fga < DOMINANT_SCORER_MIN_FGA) return 0;
  if (pctileOf(BIG_FGPCT_RUNGS, span.box.fgPct) < DOMINANT_SCORER_FG_PCTILE) return 0;
  if (pctileOf(BIG_PPG_RUNGS, span.box.ppg) < DOMINANT_SCORER_PPG_PCTILE) return 0;
  return DOMINANT_SCORER_FLOOR;
}

export function rimPressureForFit(span: PlayerSpan): number {
  const prof = computeOffensiveProfile(span);
  let base: number;
  if (prof.hasZoneData) {
    const shareCredit = fitShareCredit(prof.rimShare);
    if (shareCredit <= 0) {
      base = 0;
    } else {
      const accFactor = fitAccFactor(prof.rimAccuracy);
      const volScore = fitVolScore(pctileOf(RIM_VOL_RUNGS, prof.rimShare * span.fga * paceFactor(span)));
      // 2026-09-16, user's own follow-up after the accFactor recalibration above ("możemy też
      // wziąć pod uwagę... liczbę wymuszonych osobistych?" — can we also factor in forced fouls):
      // a real, independent foul-drawing signal, same shape `freeThrowRateFactor` already applies
      // in the pre-1997 proxy branch just below — extended here to the zone-data (1997+) branch
      // for the same reason it exists there: drawing real contact at the rim is itself evidence of
      // defensive pressure the shot-make% alone doesn't fully capture (Barkley/McAdoo's own
      // motivating cases for that function). Same gentle ±20% multiplier, not a new mechanism.
      base = clamp(
        volScore * accFactor * shareCredit * passingHubDampener(span) * scoringVolumeFactor(span) * freeThrowRateFactor(span),
        0,
        100,
      );
    }
  } else {
    // pre-1997: no shot-location data to improve on — fall back to the existing archetype-gated
    // proxy, which already gates to C/PF, then apply the dominant-interior-scorer floor.
    base = Math.max(rimPressure(span), dominantInteriorScorerFloor(span));
  }
  const isBig = span.primaryPosition === 'C' || span.primaryPosition === 'PF';
  return isBig ? bigPositionalFloor(base) : base;
}

/**
 * Extra `rawComponents.offense` points for rim pressure, on the same additive scale as the
 * `gravity` (arc-spacing) term next to it. Cap 5; baseline 60 so an above-average interior
 * finisher who is not a genuine focal point contributes nothing.
 *
 * The zone-data path (1997+, real rim volume/accuracy/share) uses `K = 8`, so the Shaq/Giannis
 * tier (`rimPressure` ~100) hits the ceiling. The pre-1996-97 box PROXY path is coarser — no zone
 * data, so it can't tell a devastating low-volume finisher (McHale, a #3 option shooting 60% on
 * 15 FGA) from a true 20-FGA focal point — so it gets a gentler `K = 12`: Kareem / Karl Malone /
 * Moses / Ewing land ~+3-4 instead of maxing the cap.
 */
const RIM_PRESSURE_BASELINE = 60;
const RIM_PRESSURE_K_ZONE = 8;
const RIM_PRESSURE_K_PROXY = 12;
const RIM_PRESSURE_CAP = 5;

export function rimPressureOffenseTerm(span: PlayerSpan): number {
  const rp = rimPressure(span);
  if (rp <= 0) return 0;
  const k = computeOffensiveProfile(span).hasZoneData ? RIM_PRESSURE_K_ZONE : RIM_PRESSURE_K_PROXY;
  return clamp((rp - RIM_PRESSURE_BASELINE) / k, 0, RIM_PRESSURE_CAP);
}

/**
 * Team-level rim pressure, 0-100 — how much a starting five collapses the defense in the paint,
 * the offensive-geometry complement to `spacing.ts` (arc gravity). The `scoreTeam` refactor's
 * `fitScore` reads this: a post-centric build (Twin Towers, Hakeem + A. Davis, Shaq-and-shooters)
 * generates real offensive value — forced help, drawn fouls, second-chance possessions — that a
 * spacing-only geometry model reads as pure negative.
 *
 * Three signals, starters-mean `rimPressureForFit(span)` the anchor (not `rimPressure()` — the
 * team-fit variant above, so a wing slasher and a below-the-cliff big both register here even
 * though neither moves TAL) and the two box rates additive on top (both from `boxRatesLookup.ts`,
 * the user-supplied per-game export):
 *  - starters-mean `rimPressureForFit(span)`
 *  - the frontcourt's best free-throw rate (FTA/FGA) — Shaq/Embiid/Barkley/Moses ~0.5-0.6 force
 *    the defense to foul; a stretch big ~0.2 does not. Full 1946-present coverage.
 *  - team offensive rebounds per game across starters, but only where the export's OREB split is
 *    reliable (1983-84+); pre-1983 spans get the neutral midpoint rather than a halved count.
 */
const RIM_TEAM_BASE_ANCHOR = 45; // starters-mean rimPressureForFit that reads as a full interior five (re-derived 2026-09-04 for the smoothed/floored fit variant — a hypothetical Shaq+Duncan+D.Robinson five reads ~49)
const RIM_TEAM_FT_BONUS_MAX = 16;
const RIM_TEAM_OREB_BONUS_MAX = 12;

export function rimPressureTeam(starters: PlayerSpan[]): number {
  if (starters.length === 0) return 0;
  const base = starters.reduce((sum, p) => sum + rimPressureForFit(p), 0) / starters.length;
  const baseComponent = clamp((base / RIM_TEAM_BASE_ANCHOR) * 100, 0, 100);

  const frontcourt = starters.filter((p) => p.primaryPosition === 'C' || p.primaryPosition === 'PF');
  const maxFtRate = frontcourt.reduce((best, p) => {
    const r = boxRatesForSpan(p);
    return r ? Math.max(best, r.ftRate) : best;
  }, 0);
  // 0.28 FTA/FGA is a middling interior rate; 0.55+ is a genuine foul magnet.
  const ftBonus = clamp((maxFtRate - 0.28) / 0.27, 0, 1) * RIM_TEAM_FT_BONUS_MAX;

  const reliableOreb = starters
    .map((p) => boxRatesForSpan(p))
    .filter((r): r is NonNullable<typeof r> => r !== null && r.orebReliable);
  let orebBonus = RIM_TEAM_OREB_BONUS_MAX * 0.5; // neutral when the era's split isn't trustworthy
  if (reliableOreb.length >= 3) {
    const teamOreb = reliableOreb.reduce((sum, r) => sum + r.orebPerGame, 0);
    // a weak offensive-rebounding five totals ~4-5 OREB/g, a dominant one (Rodman/Barkley/Oakley
    // era, or Shaq + role bigs) ~11-13.
    orebBonus = clamp((teamOreb - 5) / 7, 0, 1) * RIM_TEAM_OREB_BONUS_MAX;
  }

  return clamp(baseComponent + ftBonus + orebBonus, 0, 100);
}
