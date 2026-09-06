import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { computeDefensiveImpact, reboundingTerm } from './defense';
import { darkoDefenseBonus, darkoDefenseShortfall, realDefenseExcessDetail } from './darkoCorrection';
import { individualDefenseRate } from './defensiveAccolades';
import { getBodyWeightLbs } from '../data/heightLookup';

/**
 * D-TAL — "how good is this player defensively," 0-100, per position.
 *
 * Split out of talent.ts because it is now a **display metric with its own calibration**, no
 * longer just TAL's defense component rescaled. The old version was `DEFENSE_FLOOR + (defense -
 * DEFENSE_FLOOR) * scalePerPosition`, and it had three diagnosed problems, all of which the
 * user's own player-by-player ratings pointed at:
 *
 * 1. **No resolution in the bottom half.** It inherited TAL's `DEFENSE_FLOOR` (20) — a floor
 *    that exists so a Nash-type offensive engine isn't over-punished in the *blend* — and then
 *    scaled linearly off it. The floor sat at or above the median at PG/SG/SF, so 72% of pool
 *    spans (2,257 of 3,113) graded F, and "bad defender," "indifferent defender" and
 *    "replacement-level bench guy" were literally the same grade. Reggie Miller, Kyrie Irving,
 *    Damian Lillard, Anthony Edwards and Kevin Durant all read F.
 * 2. **Anchored to the single best-ever span at each position**, which piles the whole
 *    distribution into the bottom of the scale: Rudy Gobert graded C+ and Victor Wembanyama C
 *    because centers are measured against Ben Wallace's 2001-03.
 * 3. **Rebounding oversold, on-ball defense invisible.** See the two mechanisms below.
 *
 * Replaced with a per-position **percentile ladder** — the same shape `spacing.ts` uses, and for
 * the same reason: a linear min/max scale against an outlier anchor is unreadable, while rungs
 * at real percentiles of the span dataset spread the population across the grade bands. Nothing
 * here feeds `computeTalent`: TAL still uses its own `normalizedComponents`, and
 * `portability.ts` reads `normalizedDefenseForFit` (the pre-change formula, kept bit-identical
 * on purpose) so POR — which does feed TAL via `portabilityBonus` — is untouched.
 */

/**
 * Rebounding gets **diminishing returns above each position's 70th percentile**, rather than the
 * flat `rpg * paceFactor * 0.9` the box formula uses throughout.
 *
 * Rebounding is real defensive value (it ends possessions) but it's the most *available* number
 * in a box score, and it was crowding out everything else: it makes up ~32-38% of the median
 * big's raw defense, and the top of the range is pure volume — Bill Russell 17.3, Wilt 18.5,
 * Dennis Rodman 14.1, all larger than most players' entire defensive score. Trimming the tail
 * is what correctly separates rebound-heavy but weak on-ball bigs (Karl-Anthony Towns) from
 * event-generating rim protectors (Gobert, Wembanyama, Jaren Jackson Jr.) at the same rpg.
 *
 * Diminishing rather than capped, so a historic rebounder still gets credited for being one —
 * a hard cap read Russell and Rodman as ordinary, which is worse than the problem being fixed.
 *
 * `talent.ts`'s guards-only `reboundingVersatilityBonus` is deliberately **not** applied here.
 * It exists to stop TAL under-rating Magic Johnson and is calibrated for that; in this view it
 * simply re-credits the rebounding volume that was just trimmed, and it read Luka Dončić's 8 rpg
 * as defensive value (D-TAL 71, B-, for one of the league's weaker defenders) when tested.
 */
/** 2026-08-03: threshold moved from p70 to p90 of each position's rebounding-term distribution,
 * and the diminishing rate loosened 0.35 -> 0.6 (i.e. rebounding above the threshold still
 * counts for more of its old value) — recalibrated by `calibrateDefensiveTalent.ts` after
 * matchup-defense data was added as a third real defensive source, which shifted what ladder
 * shape actually fits the user's 46 reference ratings best. */
const REBOUND_DIMINISHING_THRESHOLD: Record<Position, number> = {
  PG: 3.98,
  SG: 4.38,
  SF: 6.26,
  PF: 9.05,
  C: 10.08,
};
const REBOUND_DIMINISHING_RATE = 0.6;

/** Display-only cap on the DARKO defensive malus, well above TAL's own conservative 5 (see
 * `darkoDefenseShortfall`). The point isn't to punish harder, it's to stop the cap saturating:
 * at 5, everyone from a -1.0 DDPM defender to a -2.5 one gets the same subtraction, which is
 * how Billups (-1.0) ended up reading as a *worse* defender than Lillard (-2.0). The bonus side
 * keeps TAL's cap of 9 — raising that instead would have lifted Stephen Curry, whose bonus is
 * already saturated off Golden State's team defense, which is the opposite of the goal here. */
const MAX_DISPLAY_DARKO_MALUS = 14;

/**
 * How much of the distance to 100 a fully-recognized individual defender earns on top of the
 * ladder (see `defensiveAccolades.ts` for why accolades are used at all, and only here).
 *
 * Proportional to remaining headroom rather than a flat number of points, for two reasons: it
 * can't push anyone past 100, and it tapers automatically at the top, so All-Defense credit
 * moves an invisible-in-the-box-score stopper a long way (Bruce Bowen: box-score defensive
 * impact 15.6, below the SF median, ladder 68 -> 87) while barely nudging players the box score
 * and DARKO already rate correctly (Ben Wallace 100 either way).
 */
const INDIVIDUAL_DEFENSE_HEADROOM_SHARE = 0.6;

/**
 * Ladder rungs: the raw-defense value at each percentile of that position's spans across the
 * full ~13,000-span dataset, paired with the D-TAL points it maps to. Linearly interpolated
 * between rungs. Regenerate with `scripts/calibrateDefensiveTalent.ts` (its `report` mode prints
 * these paste-ready) after **any** change to `computeDefensiveImpact`, the DARKO correction, or
 * the two constants above — the rung positions are percentiles of the raw formula, so they go
 * stale silently if that formula moves.
 *
 * The points column is deliberately steep at the top and shallow in the middle. Fitted, not
 * guessed: `calibrateDefensiveTalent.ts` grid-searches the ladder shape, the rebounding
 * threshold/rate, the malus cap, and the accolade weights against the user's own ratings for 27
 * players plus guardrail bands for 19 more (established all-time defenders that must stay high,
 * known non-defenders that must stay low). This shape lands 38 of those 46 in band (see the
 * 2026-08-03 recalibration note on `LADDER_RAW_BY_POSITION` below for the most recent re-fit).
 */
/**
 * Ceiling for a span whose elite box-score defensive production is **corroborated by nothing**:
 * no All-Defense/DPOY selection overlapping it, and no positive DARKO residual either.
 *
 * The ladder converts "percentile of defensive box production" into a grade, and for a span
 * with a corrective signal that's fine — but pre-1997 players have no DARKO at all, so if they
 * also never made an All-Defense team the box score is the *only* input and volume alone can
 * carry them into the top decile. The old compressed scale hid this by grading nearly everyone
 * low; the ladder exposed it, and the first run graded Charles Barkley A-, Chris Mullin B+ and
 * George Gervin B+ — Barkley in particular is a player this project has already checked against
 * Ben Taylor's own writing ("never a positive on D," 9 below-average defenses in 10 seasons).
 *
 * Asymmetric and scoped, per the project's durable lesson: it only ever subtracts, only from
 * spans with zero corroborating evidence, and it sits at the top of the B band rather than
 * pushing anyone down to F — "productive, unconfirmed" is a real and fair reading of Barkley's
 * rebounding-and-steals profile. Spans with a real DARKO bonus (Shawn Marion, Andre Iguodala,
 * Lonzo Ball) are exempt because the data does corroborate them, and pre-1969 spans predate
 * All-Defense entirely but sit far below this ceiling anyway (no steals/blocks were recorded
 * before 1973-74, so their raw is rebounding-only) — the ceiling never binds there.
 */
const UNCORROBORATED_CEILING = 78;

/** 2026-08-03: both the ladder's point values (this array) and the raw rungs below it
 * regenerated by `calibrateDefensiveTalent.ts report` after matchup-defense data was added as a
 * third real defensive source (see darkoCorrection.ts's blendedExcess) — the calibration harness
 * itself had drifted out of sync with the shipped formula (it was still fitting a DARKO-only
 * proxy regression even after RAPTOR was added 2026-07-31), fixed alongside this recalibration.
 * Brought the reference-rating miss count from 11/46 back down to 8/46 (established baseline
 * before today was 7/46) — caught one real transcription bug in the process (this array is the
 * ladder's POINTS output at each rung, not the percentile positions used to derive the raw rungs
 * below; pasting the percentiles here instead gave the wrong shape entirely, 16/46 missed, until
 * cross-checked against `checkDefensiveGradeTargets.ts` directly and traced to this line). Re-run
 * after any future change to `computeDefensiveImpact`, the DARKO/RAPTOR/matchup-defense
 * correction, or the dataset itself. */
const LADDER_PERCENTILE_POINTS = [5, 20, 32, 45, 54, 66, 75, 84, 92, 99];
const LADDER_RAW_BY_POSITION: Record<Position, number[]> = {
  PG: [-10.97, 4.02, 10.45, 13.87, 16.87, 21.02, 24.45, 27.67, 30.07, 34.52],
  SG: [-10.65, 4.15, 9.94, 13.4, 15.63, 19.37, 23.03, 27.3, 30.41, 39.1],
  SF: [-8.11, 6.15, 12.18, 16.59, 19.33, 23.21, 26.34, 30.64, 34.72, 42.17],
  PF: [-8.06, 8.79, 14.29, 19.65, 22.81, 28.01, 31.93, 35.97, 43.42, 48.89],
  C: [-9.1, 11.45, 18.48, 24.28, 27.57, 32.86, 37.35, 43.62, 50.03, 60.42],
};

function reboundTrim(span: PlayerSpan): number {
  const excess = reboundingTerm(span) - REBOUND_DIMINISHING_THRESHOLD[span.primaryPosition];
  return excess > 0 ? excess * (1 - REBOUND_DIMINISHING_RATE) : 0;
}

const DISPLAY_EXTRA_MIN_SOURCES = 2;
const DISPLAY_EXTRA_SCALE = 9;
const DISPLAY_EXTRA_CAP = 26;

/**
 * Display-only extra credit for a corroborated low-event plus defender the additive
 * `darkoDefenseBonus` can't reach. 2026-09-05, user-reported ("the defense counts solid defenders
 * as weak"): a pool audit vs DARKO/RAPTOR/matchup found ~264 spans — almost all C/PF rebounding
 * anchors who don't block (Kevon Looney real +3.2 reading D-TAL 42; Tiago Splitter, Chuck Hayes,
 * Nick Collison, Nenê, Kendrick Perkins) — where >=2 tracking sources agree the player is a real
 * plus, but `computeDefensiveImpact` is near-zero without blocks and `darkoDefenseBonus`'s +16
 * agreement cap (times `EXCESS_TO_BONUS_SCALE` 6) leaves the box+bonus sum in the 30s-40s. The
 * audit also found ZERO over-crediting (real <= -1 while D-TAL >= 65: n=0), so a one-directional
 * release of the clipped real signal is safe.
 *
 * This is display-only on purpose: `computeDefensiveTalent` feeds `defenseScore` / huntability /
 * matchup DRTG projections (so team defense moves with it — the user's explicit ask), but NOT
 * `computeTalent`'s `rawDefense` blend, which reads the still-capped `darkoDefenseBonus` directly
 * in `talent.ts`. Gated on (a) no All-Defensive accolade — the accolade headroom credit already
 * lifts those — and (b) >=2 tracking sources each clearing +1.0 excess, the same corroboration
 * bar that governs the additive agreement cap. Never subtracts.
 */
function displayExtraDefenseBonus(span: PlayerSpan): number {
  if (individualDefenseRate(span) > 0) return 0;
  const detail = realDefenseExcessDetail(span);
  if (!detail || !detail.hasTrackingCoverage) return 0;
  if (detail.blendedExcess <= 0 || detail.strongPositiveSourceCount < DISPLAY_EXTRA_MIN_SOURCES) return 0;
  const target = Math.min(DISPLAY_EXTRA_CAP, detail.blendedExcess * DISPLAY_EXTRA_SCALE);
  return Math.max(0, target - darkoDefenseBonus(span));
}

/** The raw defensive value D-TAL's ladder reads: the shared box-score defensive impact, with
 * rebounding's tail trimmed, corrected by real DARKO plus-minus in both directions, plus a
 * display-only release of corroborated real signal the additive cap clips (`displayExtraDefenseBonus`). */
export function displayDefenseRaw(span: PlayerSpan): number {
  return (
    computeDefensiveImpact(span) -
    reboundTrim(span) +
    darkoDefenseBonus(span) +
    displayExtraDefenseBonus(span) -
    Math.min(MAX_DISPLAY_DARKO_MALUS, darkoDefenseShortfall(span))
  );
}

function ladderPoints(position: Position, raw: number): number {
  const rawRungs = LADDER_RAW_BY_POSITION[position];
  if (raw <= rawRungs[0]) return LADDER_PERCENTILE_POINTS[0];
  for (let i = 1; i < rawRungs.length; i++) {
    if (raw <= rawRungs[i]) {
      const width = rawRungs[i] - rawRungs[i - 1];
      const fraction = width === 0 ? 1 : (raw - rawRungs[i - 1]) / width;
      return LADDER_PERCENTILE_POINTS[i - 1] + fraction * (LADDER_PERCENTILE_POINTS[i] - LADDER_PERCENTILE_POINTS[i - 1]);
    }
  }
  return LADDER_PERCENTILE_POINTS[LADDER_PERCENTILE_POINTS.length - 1];
}

/**
 * A real-data floor for a specific (player, span) whose box+DARKO-only D-TAL lands in bottom-
 * decile (D-/F) territory despite real evidence that rules out "genuine defensive liability."
 *
 * 2026-08-31, Klay Thompson 2015-17 (D-TAL 44, graded D-): the box score has no signal for his
 * real, curated Wing Stopper assignment (career-wide 2Y-DPOY-adjacent reputation, corroborated
 * by neither a DARKO excess nor an All-Defense selection in this specific window), so the ladder
 * alone reads him as a near-worst defender. Checked directly against Databallr's real WOWY split
 * for his 2013-2019 window (23,285 min on / 10,391 off, regular season + playoffs): team DEF
 * rating is EXACTLY flat on vs off (105.3 both), not the clearly *positive* on-off gap a real
 * bottom-decile liability should produce if his individual defense were actually dragging the
 * unit down. A flat large-sample on/off doesn't prove he's a plus defender on its own, but a
 * secondary component of the same split does lean modestly positive: opponent TS% is 0.9 points
 * lower with him on court (real shooting-defense signal, not just noise), while opponent ORB%
 * being higher with him on reads more as a non-rebounding wing's normal profile than an
 * individual-defense minus. Combined — flat team DEF, plus a real shot-quality edge — the honest
 * read is "solid, slightly better than ordinary," not merely average, and clearly not the D-/F a
 * true liability should produce. Floored to 60 (roughly the 60th percentile of his own real peer
 * group — SG Wing Stopper/Chaser spans, measured directly: median 52, p60 58, p75 72 — so this
 * lands as "moderately above that group's median," not a claim of being an elite/plus outlier).
 * on/off is still too confounded by teammates to support a stronger claim than that — see this
 * project's own Posey investigation the same night, which found genuinely contradictory single-
 * season reads for a similar case. Scoped to this one (player, span) only, same shape as
 * `NAMED_TIER_DOWNCAPS`/`NAMED_DAMPENING_EXCEPTIONS` elsewhere in this project — his other spans
 * (all C-/D+ or better already) and his post-injury spans (37/38/25, correctly low — a different
 * evidence question entirely) are untouched.
 */
// 2026-09-04, D2 calibration: Toumani Camara 2023-25/2024-26 (All-Defensive 2nd Team 2024-25).
// The pool-inclusion fix that self-corrected the rest of the modern-perimeter-stopper class
// (Herbert Jones -> 85, Lu Dort -> 82, Dyson Daniels -> 84, McDaniels -> 80) does NOT reach him:
// his real defended-FG% matchup data reads clearly negative (-2.05 / -2.16), and the blend
// leans on it. But that's a known bias of the matchup metric for a power forward who takes the
// hardest frontcourt assignments (guarding Giannis/Tatum-type scorers, whose shooting stays high
// against anyone) — and the two individual signals it doesn't confound both say plus: real
// defensive RAPM peakDef +2.3 (defRank 170 / 2894) and the All-Defense vote. Floored to 74 —
// solidly above the SF/PF Wing Stopper median, matching the RAPM read, without claiming the
// A-grade the eye test alone might. Same one-(player, span) shape as the Klay entry above.
const NAMED_DTAL_FLOOR: ReadonlyMap<string, number> = new Map(
  [
    { name: 'Klay Thompson', spanLabel: '2015-17', floor: 60 },
    { name: 'Toumani Camara', spanLabel: '2023-25', floor: 74 },
    { name: 'Toumani Camara', spanLabel: '2024-26', floor: 74 },
  ].map((e) => [
    `${normalizePlayerName(e.name)}|${e.spanLabel}`,
    e.floor,
  ]),
);

/** Same 2026-08-16 memoization as `talent.ts`'s `computeOffensiveTalent` (see that function's own
 * docstring for the full profiling story) — this was the other uncached half of the same
 * bottleneck: `aiDrafter.ts`'s per-candidate value formula calls `computeDefensiveTalent` several
 * separate times per candidate, each re-running accolade-rate/DARKO/ladder lookups from scratch. A
 * span's own data never changes during a session, so this is a pure function of `span.id`. */
const defensiveTalentCache = new Map<string, number>();

const ON_OFF_FLOOR_MIN_DDPM = 1.5;
const ON_OFF_FLOOR_RAPTOR_VETO = -1.0;
const ON_OFF_FLOOR_AT_MIN = 48;
const ON_OFF_FLOOR_AT_CAP = 58;
const ON_OFF_FLOOR_DDPM_CAP = 3.0;

/**
 * 2026-09-06, user, on Pau Gasol / Steven Adams: "the engine undervalues players who are STRONG
 * at the rim but don't block." Confirmed structural — `computeDefensiveImpact`'s `roleWeight` term
 * is scaled by the player's own steal+block activity, so a 250+lb interior wall who holds
 * position, boxes out and forces tough shots WITHOUT swatting them gets the Anchor Big role
 * bonus cut roughly in half. The on/off audit for `onOffDefenseFloor` above showed the class:
 * ~320 heavy C/PF spans with real DARKO +2 to +2.5 (a genuine top-30 defensive on/off) whose
 * D-TAL sat at exactly the 51-55 the standard floor curve produces — Adams every span, Capela,
 * DeAndre Jordan, Nurkić, Brad Miller, Dampier, Haywood, Dale Davis, Zaza, Robin/Brook Lopez.
 * A physically large true big (weight >= `PHYSICAL_ANCHOR_WEIGHT_LBS`, position C/PF) whose real
 * on/off is strongly positive gets a steeper, higher floor: the box specifically cannot see
 * wall-defense, so strong on/off deserves more benefit of the doubt for a heavy interior body
 * than it does for a guard riding a good team defense. Guards and stretch fours never clear the
 * weight gate. Still display-only, still bounded (never a claim of elite).
 */
const PHYSICAL_ANCHOR_WEIGHT_LBS = 248;
const PHYSICAL_ANCHOR_FLOOR_AT_MIN = 52;
const PHYSICAL_ANCHOR_FLOOR_AT_CAP = 66;

/**
 * Display-only D-TAL floor from real on/off data. 2026-09-05, user: "a center affects TEAM
 * defense, not individual matchups — does D-TAL count that?" It barely does: `computeDefensiveImpact`
 * is pure individual box, and the real-data correction blends DARKO (on/off — the team-anchoring
 * signal) and RAPTOR against `matchupDefense` (individual defended FG%) at roughly EQUAL weight,
 * so a rim protector's real team value gets outvoted by the individual metric. The audit found
 * 108 spans with DARKO on/off >= +1.5 (a genuinely strong team-defense signal) reading D-TAL < 50
 * because matchup drags the blend down — Nikola Jokic 2016-25 (D-TAL 26-43, DARKO +1.5..+2.5,
 * matchup -1.8..-5.3 — the classic "bad on tape, elite on/off" case), Capela, Poeltl, Turner,
 * Jarrett Allen, Zubac, Robin Lopez, Bruce Bowen, CP3 2020-22.
 *
 * When DARKO on/off clears +1.5 and RAPTOR does not strongly disagree (>= -1.0, or no RAPTOR
 * coverage), floor D-TAL on a curve: +1.5 -> 48, +3.0 -> 58. Bounded, never a claim of elite
 * defense — "a real rotation defender the team defends well with, not an F-tier turnstile."
 * Display-only: like `displayExtraDefenseBonus`, this feeds `defenseScore` / huntability / matchup
 * DRTG but NOT `computeTalent`'s raw blend (which reads the capped `darkoDefenseBonus` directly).
 */
function onOffDefenseFloor(span: PlayerSpan): number {
  const detail = realDefenseExcessDetail(span);
  if (!detail || detail.onOffDdpm === null || detail.onOffDdpm < ON_OFF_FLOOR_MIN_DDPM) return 0;
  if (detail.raptorDefense !== null && detail.raptorDefense < ON_OFF_FLOOR_RAPTOR_VETO) return 0;
  const ddpm = Math.min(ON_OFF_FLOOR_DDPM_CAP, detail.onOffDdpm);
  const frac = (ddpm - ON_OFF_FLOOR_MIN_DDPM) / (ON_OFF_FLOOR_DDPM_CAP - ON_OFF_FLOOR_MIN_DDPM);
  const weight = getBodyWeightLbs(span.playerName);
  const isPhysicalAnchor =
    (span.primaryPosition === 'C' || span.primaryPosition === 'PF') &&
    weight !== undefined &&
    weight >= PHYSICAL_ANCHOR_WEIGHT_LBS;
  const atMin = isPhysicalAnchor ? PHYSICAL_ANCHOR_FLOOR_AT_MIN : ON_OFF_FLOOR_AT_MIN;
  const atCap = isPhysicalAnchor ? PHYSICAL_ANCHOR_FLOOR_AT_CAP : ON_OFF_FLOOR_AT_CAP;
  return atMin + frac * (atCap - atMin);
}

export function computeDefensiveTalent(span: PlayerSpan): number {
  const cached = defensiveTalentCache.get(span.id);
  if (cached !== undefined) return cached;
  const accoladeRate = individualDefenseRate(span);
  const uncorroborated = accoladeRate === 0 && darkoDefenseBonus(span) === 0;
  const base = Math.min(
    ladderPoints(span.primaryPosition, displayDefenseRaw(span)),
    uncorroborated ? UNCORROBORATED_CEILING : 100,
  );
  const credited = base + (100 - base) * accoladeRate * INDIVIDUAL_DEFENSE_HEADROOM_SHARE;
  const namedFloor = NAMED_DTAL_FLOOR.get(`${normalizePlayerName(span.playerName)}|${span.spanLabel}`) ?? 0;
  const result = Math.max(
    0,
    Math.min(100, Math.round(Math.max(credited, namedFloor, onOffDefenseFloor(span)))),
  );
  defensiveTalentCache.set(span.id, result);
  return result;
}
