import type { PlayerSpan, Position } from '../data/schema';
import { computeDefensiveImpact, reboundingTerm } from './defense';
import { darkoDefenseBonus, darkoDefenseShortfall } from './darkoCorrection';
import { individualDefenseRate } from './defensiveAccolades';

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

/** The raw defensive value D-TAL's ladder reads: the shared box-score defensive impact, with
 * rebounding's tail trimmed, corrected by real DARKO plus-minus in both directions. */
export function displayDefenseRaw(span: PlayerSpan): number {
  return (
    computeDefensiveImpact(span) -
    reboundTrim(span) +
    darkoDefenseBonus(span) -
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

export function computeDefensiveTalent(span: PlayerSpan): number {
  const accoladeRate = individualDefenseRate(span);
  const uncorroborated = accoladeRate === 0 && darkoDefenseBonus(span) === 0;
  const base = Math.min(
    ladderPoints(span.primaryPosition, displayDefenseRaw(span)),
    uncorroborated ? UNCORROBORATED_CEILING : 100,
  );
  const credited = base + (100 - base) * accoladeRate * INDIVIDUAL_DEFENSE_HEADROOM_SHARE;
  return Math.max(0, Math.min(100, Math.round(credited)));
}
