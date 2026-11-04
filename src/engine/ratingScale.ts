import type { PlayerSpan, Position } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { computeDefensiveTalent, computeUncappedOffensiveTalent } from './talent';
import { effectiveTalent, type Grade } from './grades';

/**
 * 2026-11-04, the user ("lepszy niż 89% i tylko 73, no to dziwnie wygląda"; "jedna skala atak +
 * obrona i miękki sufit", "tylko rotacja"): the offense and defense the player sees, on one scale.
 * A window's number is its place among rotation players (TAL 55+) at its own position, mapped onto
 * fixed anchors (the user's pick, the compromise): 60 the median rotation player, 75 the top quarter,
 * 85 the top tenth, 92 the top 2.5%, and a soft top where only the best ever reach 97-100. The engine's own O-TAL / D-TAL are untouched; this is
 * what cards, boards and exports show.
 */
const ROTATION_TAL = 55;
const ANCHORS: readonly [percentile: number, rating: number][] = [
  [0, 25], [0.25, 45], [0.5, 60], [0.75, 75], [0.9, 85], [0.975, 92], [0.995, 97], [1, 100],
];
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
let pools: Map<string, number[]> | null = null;
function poolFor(position: Position, side: Side): number[] {
  if (!pools) {
    pools = new Map();
    for (const span of draftPool) {
      if (effectiveTalent(span) < ROTATION_TAL) continue;
      for (const s of ['offense', 'defense'] as const) {
        const key = `${span.primaryPosition}|${s}`;
        pools.set(key, [...(pools.get(key) ?? []), sideValue(span, s)]);
      }
    }
    for (const list of pools.values()) list.sort((a, b) => a - b);
  }
  return pools.get(`${position}|${side}`) ?? [];
}

function percentileOf(values: number[], value: number): number {
  if (values.length === 0) return 0.5;
  let lo = 0;
  while (lo < values.length && values[lo] < value) lo++;
  let hi = lo;
  while (hi < values.length && values[hi] === value) hi++;
  return (lo + hi) / 2 / values.length;
}

function ratingAt(percentile: number): number {
  for (let i = 1; i < ANCHORS.length; i++) {
    const [p1, r1] = ANCHORS[i];
    if (percentile <= p1) {
      const [p0, r0] = ANCHORS[i - 1];
      return r0 + ((percentile - p0) / (p1 - p0)) * (r1 - r0);
    }
  }
  return 100;
}

const cache = new Map<string, number>();
function rating(span: PlayerSpan, side: Side): number {
  const key = `${span.id}|${side}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const result = Math.round(ratingAt(percentileOf(poolFor(span.primaryPosition, side), sideValue(span, side))));
  cache.set(key, result);
  return result;
}

export const offenseRating = (span: PlayerSpan): number => rating(span, 'offense');
export const defenseRating = (span: PlayerSpan): number => rating(span, 'defense');

export function ratingGrade(value: number): Grade {
  if (value >= S_RATING) return 'S';
  return LETTERS.find(([t]) => value >= t)![1];
}
export const offenseRatingGrade = (span: PlayerSpan): Grade => ratingGrade(offenseRating(span));
export const defenseRatingGrade = (span: PlayerSpan): Grade => ratingGrade(defenseRating(span));
