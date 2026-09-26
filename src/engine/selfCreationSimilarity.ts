import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { players } from '../data/players';
import { eraBaseline, LEAGUE_PACE_BASELINE } from './era';
import { buildSelfCreationYearMap, measuredSelfCreationForSpan, type SelfCreationField } from './selfCreationLookup';

/**
 * 2026-08-06, user's own ask: portability's "needs the ball" signal should read how much of a
 * player's own scoring is self-created (unassisted) vs. set up by a teammate — assisted shots
 * are exactly the shots that travel next to a ball-dominant star, unassisted ones are exactly
 * the shots that don't. `selfCreationLookup.ts`'s real measurements are the right number for
 * this, but only cover 1997+ with enough makes (the binding constraint for grading David
 * Robinson/Kareem/McAdoo-era players).
 *
 * This module fills the gap with a k-NN estimate in box-stat feature space, built ONLY from the
 * measured (1997+) population and validated by PLAYER-level holdout (no player split across
 * train/test) before ever touching an unmeasured span. Two separate estimators, same machinery:
 *
 * - `unassistedFg` (all made field goals) — corr(prediction, real) = 0.80 on held-out players
 *   (k=15), vs. 0.67 for archetype-prior alone and 0.31 for `spacing.ts`'s existing proxy.
 * - `unassisted3Pt` (made threes only) — the one that actually matters for a *shooting*-fit
 *   question. **Found only after shipping the all-FG version first**: it reads Gilbert Arenas
 *   and Stephen Curry as near-identical (both ~0.55-0.65 all-FG unassisted, since Curry's real
 *   2-point shot creation off the dribble is substantial) even though Curry's defining trait —
 *   the thing that actually makes him travel next to a ball-dominant star — is his *3-point*
 *   shot-making, largely off movement/screens, not isolation. Blending 2PT and 3PT into one rate
 *   hides exactly the split this project already knew to keep separate (see `spacing.ts`'s own
 *   note that Dirk is .053 unassisted on threes but .430 on twos). `portability.ts` uses the 3PT
 *   estimator for anyone with real shooting volume and falls back to the all-FG one otherwise
 *   (traditional bigs who barely attempt threes — the question for them really is "how much of
 *   their offense in general is self-created," which the all-FG number answers fine).
 *
 * Features (all available for any era, unlike the target itself): the measured population's own
 * mean unassisted rate per archetype (folds in the categorical signal without one-hot encoding),
 * era-pace-adjusted FGA and APG, and TS% relative to the era baseline. Weighted Euclidean
 * distance, inverse-distance-weighted k=15 neighbors.
 *
 * Precomputed once at module load for every span in the full dataset (measured spans use their
 * real value directly, never the estimate) and cached in a name+label map, so callers get an O(1)
 * lookup rather than paying the O(pool size) k-NN search per call. The k-NN search itself uses
 * flat Float64Arrays and bounded top-K insertion rather than an array-of-objects + full sort —
 * the first version of this took ~10.7s to precompute (unacceptable for a client-side module
 * load); this version runs the same workload in well under a second per estimator.
 */

interface Features {
  archPrior: number;
  fgaPace: number;
  apgPace: number;
  relTs: number;
}

const W_ARCH = 2.5;
const W_FGA = 1.0;
const W_APG = 1.0;
const W_TS = 0.8;
const K_NEIGHBORS = 15;
const FEATURE_DIM = 4;
/** Fallback for an archetype with zero measured coverage at all (shouldn't happen with the
 * current 12 archetypes, but a safe default beats a crash if a new one is ever added). */
const DEFAULT_ARCHETYPE_PRIOR = 0.4;

function buildEstimator(field: SelfCreationField) {
  const fieldMap = buildSelfCreationYearMap(field);

  interface MeasuredRow {
    span: PlayerSpan;
    value: number;
  }
  const measuredRows: MeasuredRow[] = [];
  for (const span of players) {
    const m = measuredSelfCreationForSpan(span, fieldMap);
    if (m !== null) measuredRows.push({ span, value: m });
  }

  const archetypeSums = new Map<string, { sum: number; n: number }>();
  for (const r of measuredRows) {
    const e = archetypeSums.get(r.span.offensiveArchetype) ?? { sum: 0, n: 0 };
    e.sum += r.value;
    e.n += 1;
    archetypeSums.set(r.span.offensiveArchetype, e);
  }
  const archetypePrior = new Map<string, number>();
  for (const [archetype, { sum, n }] of archetypeSums) archetypePrior.set(archetype, sum / n);

  function featuresOf(span: PlayerSpan): Features {
    const { avgTs, pace } = eraBaseline(span.spanLabel);
    const paceFactor = LEAGUE_PACE_BASELINE / pace;
    return {
      archPrior: archetypePrior.get(span.offensiveArchetype) ?? DEFAULT_ARCHETYPE_PRIOR,
      fgaPace: span.fga * paceFactor,
      apgPace: span.box.apg * paceFactor,
      relTs: span.box.tsPct - avgTs,
    };
  }

  function stats(vals: number[]): { mean: number; sd: number } {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    return { mean, sd: sd || 1 };
  }
  const fgaStats = stats(measuredRows.map((r) => featuresOf(r.span).fgaPace));
  const apgStats = stats(measuredRows.map((r) => featuresOf(r.span).apgPace));
  const tsStats = stats(measuredRows.map((r) => featuresOf(r.span).relTs));

  function vec(f: Features): number[] {
    return [
      W_ARCH * f.archPrior * 5,
      (W_FGA * (f.fgaPace - fgaStats.mean)) / fgaStats.sd,
      (W_APG * (f.apgPace - apgStats.mean)) / apgStats.sd,
      (W_TS * (f.relTs - tsStats.mean)) / tsStats.sd,
    ];
  }

  const poolSize = measuredRows.length;
  const poolVectors = new Float64Array(poolSize * FEATURE_DIM);
  const poolValues = new Float64Array(poolSize);
  measuredRows.forEach((r, i) => {
    const v = vec(featuresOf(r.span));
    for (let d = 0; d < FEATURE_DIM; d++) poolVectors[i * FEATURE_DIM + d] = v[d];
    poolValues[i] = r.value;
  });

  const topD = new Float64Array(K_NEIGHBORS);
  const topY = new Float64Array(K_NEIGHBORS);

  function knnPredict(f: Features): number {
    const tv = vec(f);
    let count = 0;
    let maxIdx = -1;
    let maxVal = -Infinity;
    for (let i = 0; i < poolSize; i++) {
      const base = i * FEATURE_DIM;
      let d2 = 0;
      for (let d = 0; d < FEATURE_DIM; d++) {
        const diff = tv[d] - poolVectors[base + d];
        d2 += diff * diff;
      }
      if (count < K_NEIGHBORS) {
        topD[count] = d2;
        topY[count] = poolValues[i];
        count++;
        if (count === K_NEIGHBORS) {
          maxVal = -Infinity;
          for (let k = 0; k < K_NEIGHBORS; k++) {
            if (topD[k] > maxVal) { maxVal = topD[k]; maxIdx = k; }
          }
        }
      } else if (d2 < maxVal) {
        topD[maxIdx] = d2;
        topY[maxIdx] = poolValues[i];
        maxVal = -Infinity;
        for (let k = 0; k < K_NEIGHBORS; k++) {
          if (topD[k] > maxVal) { maxVal = topD[k]; maxIdx = k; }
        }
      }
    }
    let wsum = 0;
    let ysum = 0;
    for (let k = 0; k < count; k++) {
      const w = 1 / (topD[k] + 0.05);
      wsum += w;
      ysum += w * topY[k];
    }
    return ysum / wsum;
  }

  function spanKey(span: PlayerSpan): string {
    return `${normalizePlayerName(span.playerName)}|${span.spanLabel}`;
  }

  const cache = new Map<string, { value: number; isMeasured: boolean }>();
  for (const span of players) {
    const measured = measuredSelfCreationForSpan(span, fieldMap);
    if (measured !== null) {
      cache.set(spanKey(span), { value: measured, isMeasured: true });
    } else {
      cache.set(spanKey(span), { value: knnPredict(featuresOf(span)), isMeasured: false });
    }
  }

  function estimate(span: PlayerSpan): number {
    const cached = cache.get(spanKey(span));
    if (cached) return cached.value;
    const measured = measuredSelfCreationForSpan(span, fieldMap);
    return measured ?? knnPredict(featuresOf(span));
  }

  function isMeasured(span: PlayerSpan): boolean {
    return cache.get(spanKey(span))?.isMeasured ?? measuredSelfCreationForSpan(span, fieldMap) !== null;
  }

  return { estimate, isMeasured };
}

// 2026-09-24: built on first use instead of at module load — the kNN fill over every span was
// ~0.8s of start-up on a desktop (several seconds on a phone) before the menu could hand over to
// the game, and production builds rarely need it at all now (tier contexts are precomputed, see
// precomputedTiers.ts). Same estimators, same values, just lazily.
let fgEstimatorInstance: ReturnType<typeof buildEstimator> | null = null;
let threePtEstimatorInstance: ReturnType<typeof buildEstimator> | null = null;
const fgEstimator = {
  estimate: (span: PlayerSpan) => (fgEstimatorInstance ??= buildEstimator('unassistedFg')).estimate(span),
  isMeasured: (span: PlayerSpan) => (fgEstimatorInstance ??= buildEstimator('unassistedFg')).isMeasured(span),
};
const threePtEstimator = {
  estimate: (span: PlayerSpan) => (threePtEstimatorInstance ??= buildEstimator('unassisted3Pt')).estimate(span),
  isMeasured: (span: PlayerSpan) => (threePtEstimatorInstance ??= buildEstimator('unassisted3Pt')).isMeasured(span),
};

/** Share of a span's made FIELD GOALS (all of them) estimated unassisted/self-created, 0-1. */
export function selfCreationEstimate(span: PlayerSpan): number {
  return fgEstimator.estimate(span);
}
export function selfCreationIsMeasured(span: PlayerSpan): boolean {
  return fgEstimator.isMeasured(span);
}

/** Share of a span's made THREES estimated unassisted/self-created, 0-1. */
export function selfCreation3PtEstimate(span: PlayerSpan): number {
  return threePtEstimator.estimate(span);
}
export function selfCreation3PtIsMeasured(span: PlayerSpan): boolean {
  return threePtEstimator.isMeasured(span);
}

/**
 * The volume gate below which a player isn't a real enough shooter for the 3PT-specific
 * estimate to carry any weight (matches the spirit of `MIN_THREES_MADE_FOR_RATE`, but on real
 * per-game attempts since this also has to gate pre-1997/estimated spans that never had a make
 * count to begin with). 2 real 3PA/game is a light bar — Kareem/McAdoo/Moses Malone-era players
 * are nowhere near it.
 */
export const MEANINGFUL_3PA_GATE = 2;

/**
 * **An either/or gate (pure 3PT for shooters, pure all-FG for everyone else) was tried first and
 * rejected**: it made Gilbert Arenas and Stephen Curry's BEST spans read as equally "great fit"
 * (both ~0.30 on 3PT alone), because Arenas' actual "needs the ball" behavior shows up in his
 * 2-point shot creation (isolation, drives) — which the pure-3PT number throws away entirely for
 * anyone who clears the volume gate. A guard who creates a lot of his own 2s is still a worse
 * off-ball fit than one who doesn't, even if both shoot plenty of threes.
 *
 * Weighted blend instead: 3PT self-creation weighted more heavily (0.65) since it's the direct
 * "does his shooting travel off-ball" question portability actually cares about, all-FG self-
 * creation folded in at 0.35 so real 2-point shot-creation still counts for something. Checked
 * directly: this correctly separates the two — Curry's most team-generated stretch (2010-12,
 * blend 0.330) reads meaningfully lower than Arenas' most team-generated stretch (2003-05, blend
 * 0.402), where the pure-3PT gate had them both bottoming out around 0.30.
 */
const THREE_PT_BLEND_WEIGHT = 0.65;

export function selfCreationForPortability(span: PlayerSpan): number {
  if (span.box.threePA < MEANINGFUL_3PA_GATE) return selfCreationEstimate(span);
  return THREE_PT_BLEND_WEIGHT * selfCreation3PtEstimate(span) + (1 - THREE_PT_BLEND_WEIGHT) * selfCreationEstimate(span);
}

/**
 * 2026-08-06, replaced a "floor + excess" penalty shape with this percentile rank, same session,
 * after the user flagged two real problems with the floor version in a row: (1) it had no visible
 * effect on the actual draft — anyone below their position's mean got a flat zero, so roughly half
 * the pool was untouched regardless of how much separation existed within that lower half; (2) it
 * couldn't tell Gilbert Arenas from Stephen Curry, because both players' best (most team-generated)
 * spans happened to sit under the PG mean, so both hit the same zero floor despite Curry's actual
 * value (0.327-0.329) sitting well below Arenas' (0.402) — real separation the floor discarded.
 *
 * A percentile rank uses the FULL position distribution instead of clipping half of it at a hard
 * cutoff: 0 for the single most team-generated span at the position, 1.0 for the single most
 * self-created, smoothly continuous in between. Verified this fixes both complaints directly —
 * Curry's best span now ranks at the 18th percentile among all PG spans vs. Arenas' 31st, a real
 * gap the floor version couldn't express — and the population-wide grade distribution (letterFor
 * bands, full 13,145-span dataset) spreads across the whole A+-through-F range rather than
 * clustering S-B, which was the user's second complaint.
 */
/**
 * 2026-09-26, the user ("gradientowe rozwiązanie bez dużych skoków, sąsiednie sezony reagują na
 * siebie"): the raw per-span estimate could swing hard between overlapping three-season windows
 * (Jrue Holiday 0.88 -> 0.48 -> 0.10 percentile across adjacent spans), and the usage penalty read
 * it rank-linearly, so O-POR jumped F -> B- -> A+. Adjacent windows share two of their three
 * seasons, so each span now reads 50% itself and 25% each overlapping neighbour (same player,
 * start year +-1), renormalised at the ends of a career. The percentile below is taken over the
 * smoothed values for the whole population, so the scale itself is unchanged.
 */
const SMOOTH_SELF_WEIGHT = 0.5;
const SMOOTH_NEIGHBOUR_WEIGHT = 0.25;
let spansByPlayerStart: Map<string, Map<number, PlayerSpan>> | null = null;
function neighbourSpan(span: PlayerSpan, offset: number): PlayerSpan | undefined {
  if (!spansByPlayerStart) {
    spansByPlayerStart = new Map();
    for (const candidate of players) {
      const key = normalizePlayerName(candidate.playerName);
      const byStart = spansByPlayerStart.get(key) ?? new Map<number, PlayerSpan>();
      byStart.set(Number.parseInt(candidate.spanLabel.slice(0, 4), 10), candidate);
      spansByPlayerStart.set(key, byStart);
    }
  }
  const start = Number.parseInt(span.spanLabel.slice(0, 4), 10);
  return spansByPlayerStart.get(normalizePlayerName(span.playerName))?.get(start + offset);
}
const smoothedCache = new Map<string, number>();
export function smoothedSelfCreationForPortability(span: PlayerSpan): number {
  const key = `${normalizePlayerName(span.playerName)}|${span.spanLabel}`;
  const hit = smoothedCache.get(key);
  if (hit !== undefined) return hit;
  let sum = SMOOTH_SELF_WEIGHT * selfCreationForPortability(span);
  let weight = SMOOTH_SELF_WEIGHT;
  for (const offset of [-1, 1]) {
    const neighbour = neighbourSpan(span, offset);
    if (neighbour) {
      sum += SMOOTH_NEIGHBOUR_WEIGHT * selfCreationForPortability(neighbour);
      weight += SMOOTH_NEIGHBOUR_WEIGHT;
    }
  }
  const value = sum / weight;
  smoothedCache.set(key, value);
  return value;
}

let percentileSortedByPositionBuilt: Map<Position, Float64Array> | null = null;
function percentileSortedByPosition(): Map<Position, Float64Array> {
  if (percentileSortedByPositionBuilt) return percentileSortedByPositionBuilt;
  const built = new Map<Position, Float64Array>();
  const byPos = new Map<Position, number[]>();
  for (const span of players) {
    const arr = byPos.get(span.primaryPosition) ?? [];
    arr.push(smoothedSelfCreationForPortability(span));
    byPos.set(span.primaryPosition, arr);
  }
  for (const [pos, arr] of byPos) {
    arr.sort((a, b) => a - b);
    built.set(pos, Float64Array.from(arr));
  }
  percentileSortedByPositionBuilt = built;
  return built;
}

/** Fraction of `position`'s spans with a strictly lower `selfCreationForPortability` value, 0-1. */
export function selfCreationPercentileForPortability(span: PlayerSpan): number {
  const sorted = percentileSortedByPosition().get(span.primaryPosition);
  if (!sorted || sorted.length === 0) return 0.5;
  const value = smoothedSelfCreationForPortability(span);
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}
