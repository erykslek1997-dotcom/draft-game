import type { PlayerSpan, Position } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { computeDefensiveTalent, computeOffensiveTalent, computeUncappedOffensiveTalent } from './talent';
import { effectiveTalent, type Grade } from './grades';
import { realSpan } from './realAdvancedLookup';
import { eraBaseline, LEAGUE_PACE_BASELINE } from './era';
import { astPctForSpan } from './ballHandling';
import { modernBox } from './modernBox';
import { estimatedMinutesPerGame } from './minutesPerGame';

/**
 * 2026-11-04, the user ("lepszy niż 89% i tylko 73, no to dziwnie wygląda"; "jedna skala atak +
 * obrona i miękki sufit", "tylko rotacja"): the offense and defense the player sees, on one scale.
 * A window's number is its place among rotation players (TAL 55+) at its own position, mapped onto
 * fixed anchors (the user's pick, the compromise; the bottom reworked below): 60 the median rotation player, 75 the top quarter,
 * 85 the top tenth, 92 the top 2.5%, and a soft top where only the best ever reach 97-100. The engine's own O-TAL / D-TAL are untouched; this is
 * what cards, boards and exports show.
 */
const ROTATION_TAL = 55;
/**
 * 2026-11-04, the user (George Hill 2010-12, OBPM +0.8, read 40: "+1 czy 0,0 znaczy że są po prostu
 * średniakami, wynik 40 sugeruje że są słabi"; "najgorszy ustaw jako 20"): rotation players are
 * mostly better than the league on offense, so a league-average scorer sat at the 12-18th percentile
 * and read ~38, while a league-average defender read ~54. Below the median the scale now runs from
 * 20 (the worst rotation window at the position) through 50 at the league average — the windows of
 * that side's BPM within half a point of zero (`LEAGUE_AVERAGE_BAND`) — to 60 at the median; the top
 * keeps its anchors. The same number means the same on both sides.
 */
const UPPER_ANCHORS: readonly [percentile: number, rating: number][] = [[0.75, 75], [0.9, 85], [0.975, 92], [0.995, 97], [1, 100]];
const FLOOR_RATING = 20;
const LEAGUE_AVERAGE_RATING = 50;
const LEAGUE_AVERAGE_BAND = 0.5;
const LEAGUE_AVERAGE_MIN_MINUTES = 2000;
/** Where the league average may sit, so a thin position cannot bend the scale. */
const LEAGUE_AVERAGE_PERCENTILE_RANGE = [0.05, 0.7] as const;
/** The median rotation player at any position. */
export const RATING_MEDIAN = 60;

/** Letters on the same scale, so a number and its letter always agree. */
const LETTERS: readonly [rating: number, grade: Exclude<Grade, 'S'>][] = [
  [96, 'A+'], [91, 'A'], [87, 'A-'], [83, 'B+'], [78, 'B'], [73, 'B-'], [66, 'C+'], [58, 'C'], [50, 'C-'], [44, 'D+'], [38, 'D'], [32, 'D-'], [0, 'F'],
];
/** The best few windows of each side read S, as before (the top of the rotation pool). */
const S_RATING = 98.5;

type Side = 'offense' | 'defense';
const sideValue = (span: PlayerSpan, side: Side) => (side === 'offense' ? computeUncappedOffensiveTalent(span) : computeDefensiveTalent(span));
const sideBpm = (span: PlayerSpan, side: Side): number | null => {
  const real = realSpan(span);
  if (real?.bpm == null || real.dbpm == null || real.minutes < LEAGUE_AVERAGE_MIN_MINUTES) return null;
  return side === 'offense' ? real.bpm - real.dbpm : real.dbpm;
};
let pools: Map<string, { values: number[]; anchors: [number, number][] }> | null = null;
function poolFor(position: Position, side: Side): { values: number[]; anchors: [number, number][] } {
  if (!pools) {
    const values = new Map<string, number[]>();
    const average = new Map<string, number[]>();
    for (const span of draftPool) {
      if (effectiveTalent(span) < ROTATION_TAL) continue;
      for (const s of ['offense', 'defense'] as const) {
        const key = `${span.primaryPosition}|${s}`;
        const v = sideValue(span, s);
        values.set(key, [...(values.get(key) ?? []), v]);
        const bpm = sideBpm(span, s);
        if (bpm !== null && Math.abs(bpm) < LEAGUE_AVERAGE_BAND) average.set(key, [...(average.get(key) ?? []), v]);
      }
    }
    pools = new Map();
    for (const [key, list] of values) {
      list.sort((a, b) => a - b);
      const near = (average.get(key) ?? []).sort((a, b) => a - b);
      const raw = near.length ? percentileOf(list, near[Math.floor(near.length / 2)]) : 0.5;
      const avg = Math.min(LEAGUE_AVERAGE_PERCENTILE_RANGE[1], Math.max(LEAGUE_AVERAGE_PERCENTILE_RANGE[0], raw));
      const anchors: [number, number][] = [[0, FLOOR_RATING], [avg, LEAGUE_AVERAGE_RATING]];
      if (avg < 0.5) anchors.push([0.5, RATING_MEDIAN]);
      pools.set(key, { values: list, anchors: [...anchors, ...UPPER_ANCHORS] });
    }
  }
  return pools.get(`${position}|${side}`) ?? { values: [], anchors: [[0, FLOOR_RATING], [0.5, RATING_MEDIAN], ...UPPER_ANCHORS] };
}

function percentileOf(values: number[], value: number): number {
  if (values.length === 0) return 0.5;
  let lo = 0;
  while (lo < values.length && values[lo] < value) lo++;
  let hi = lo;
  while (hi < values.length && values[hi] === value) hi++;
  return (lo + hi) / 2 / values.length;
}

function ratingAt(percentile: number, anchors: readonly [number, number][]): number {
  for (let i = 1; i < anchors.length; i++) {
    const [p1, r1] = anchors[i];
    if (percentile <= p1) {
      const [p0, r0] = anchors[i - 1];
      return r0 + ((percentile - p0) / (p1 - p0)) * (r1 - r0);
    }
  }
  return 100;
}

/**
 * 2026-11-04, the user (Al Horford 2014-16, TAL 80, read 65 / 63: "dla gracza z zewnątrz to nie
 * będzie dobrze oceniać"; "już takie 73/71 dla Horforda ma więcej sensu"): the card's two numbers
 * add up to the player. Half of each is the position scale above, half a scale around his TAL —
 * the two sides average to TAL and their gap is the gap between his O-TAL and D-TAL, halved and held
 * to `CARD_BLEND.maxGap` — so an All-NBA two-way four reads about 72 / 72, not 65 / 63, and a TAL
 * lift from playoffs or awards shows on the card (Brunson 2024-26).
 */
const CARD_BLEND = { positional: 0.5, maxGap: 20, top: 99 };
function aroundTal(span: PlayerSpan, side: Side): number {
  const gap = Math.max(-CARD_BLEND.maxGap, Math.min(CARD_BLEND.maxGap, (computeOffensiveTalent(span) - computeDefensiveTalent(span)) / 2));
  return Math.min(CARD_BLEND.top, effectiveTalent(span) + (side === 'offense' ? gap : -gap));
}

const cache = new Map<string, number>();
function rating(span: PlayerSpan, side: Side): number {
  const key = `${span.id}|${side}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const pool = poolFor(span.primaryPosition, side);
  const positional = ratingAt(percentileOf(pool.values, sideValue(span, side)), pool.anchors);
  const result = Math.round(CARD_BLEND.positional * positional + (1 - CARD_BLEND.positional) * aroundTal(span, side));
  cache.set(key, result);
  return result;
}

/**
 * 2026-11-04, the user (Dillon Brooks 2024-26 read offense 38 on 16.7 points: "35 sugeruje kogoś,
 * kto w ataku nic nie robi"): the card's offense is also what a player can do with the ball, not
 * only what it did for the score. A scorer reads at least his scoring role — his points on today's
 * pace placed among the rotation players at his position, on the same anchors — less
 * `SCORING_ROLE.margin`; a player who never scored (Ben Wallace) gets nothing from it.
 */
const SCORING_ROLE = { margin: 10 };
let scoringPools: Map<string, number[]> | null = null;
const pacedPoints = (span: PlayerSpan) => span.box.ppg * (LEAGUE_PACE_BASELINE / eraBaseline(span.spanLabel).pace);
function scoringRole(span: PlayerSpan): number {
  if (!scoringPools) {
    scoringPools = new Map();
    for (const p of draftPool) {
      if (effectiveTalent(p) < ROTATION_TAL) continue;
      scoringPools.set(p.primaryPosition, [...(scoringPools.get(p.primaryPosition) ?? []), pacedPoints(p)]);
    }
    for (const list of scoringPools.values()) list.sort((a, b) => a - b);
  }
  const pool = poolFor(span.primaryPosition, 'offense');
  return ratingAt(percentileOf(scoringPools.get(span.primaryPosition) ?? [], pacedPoints(span)), pool.anchors);
}
const offenseCache = new Map<string, number>();
export const offenseRating = (span: PlayerSpan): number => {
  const hit = offenseCache.get(span.id);
  if (hit !== undefined) return hit;
  const value = Math.max(rating(span, 'offense'), Math.round(scoringRole(span) - SCORING_ROLE.margin));
  offenseCache.set(span.id, value);
  return value;
};
export const defenseRating = (span: PlayerSpan): number => rating(span, 'defense');

function ratingGrade(value: number): Grade {
  if (value >= S_RATING) return 'S';
  return LETTERS.find(([t]) => value >= t)![1];
}
export const offenseRatingGrade = (span: PlayerSpan): Grade => ratingGrade(offenseRating(span));
export const defenseRatingGrade = (span: PlayerSpan): Grade => ratingGrade(defenseRating(span));

/**
 * 2026-11-12 (the user: "atak, obrona i shooting trochę mało, biorąc pod uwagę, ile tu mamy"): two
 * more scouting grades on the card's scale — a percentile among the rotation windows at his position
 * (TAL 55+), the median at 60, the same upper anchors and letters as Offense and Defense.
 *  - Playmaking: his AST% (BBRef; before 1973-74 read from assists a 36 minutes) — the number the
 *    engine's ball-handling reads.
 *  - Rebounding: his rebounds a 36 minutes on the modern box (`modernBox`, pace and misses of his era
 *    taken out) — the glass the live game plays.
 */
type Metric = 'playmaking' | 'rebounding';
const metricValue = (span: PlayerSpan, metric: Metric): number => {
  if (metric === 'playmaking') return astPctForSpan(span);
  const m = modernBox(span);
  return (m.rpg * 36) / Math.max(10, estimatedMinutesPerGame(span) ?? 32);
};
const METRIC_ANCHORS: [number, number][] = [[0, FLOOR_RATING], [0.5, RATING_MEDIAN], ...UPPER_ANCHORS];
let metricPools: Map<string, number[]> | null = null;
const metricCache = new Map<string, number>();
function metricRating(span: PlayerSpan, metric: Metric): number {
  const key = `${span.id}|${metric}`;
  const hit = metricCache.get(key);
  if (hit !== undefined) return hit;
  if (!metricPools) {
    metricPools = new Map();
    for (const p of draftPool) {
      if (effectiveTalent(p) < ROTATION_TAL) continue;
      for (const m of ['playmaking', 'rebounding'] as const) {
        const k = `${p.primaryPosition}|${m}`;
        metricPools.set(k, [...(metricPools.get(k) ?? []), metricValue(p, m)]);
      }
    }
    for (const list of metricPools.values()) list.sort((a, b) => a - b);
  }
  const value = Math.round(ratingAt(percentileOf(metricPools.get(`${span.primaryPosition}|${metric}`) ?? [], metricValue(span, metric)), METRIC_ANCHORS));
  metricCache.set(key, value);
  return value;
}
export const playmakingRating = (span: PlayerSpan): number => metricRating(span, 'playmaking');
export const reboundingRating = (span: PlayerSpan): number => metricRating(span, 'rebounding');
export const playmakingRatingGrade = (span: PlayerSpan): Grade => ratingGrade(playmakingRating(span));
export const reboundingRatingGrade = (span: PlayerSpan): Grade => ratingGrade(reboundingRating(span));
