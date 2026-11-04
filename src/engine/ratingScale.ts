import type { PlayerSpan, Position } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { computeDefensiveTalent, computeUncappedOffensiveTalent } from './talent';
import { effectiveTalent, type Grade } from './grades';

/**
 * 2026-11-04, the user ("lepszy niż 89% i tylko 73, no to dziwnie wygląda"; "jedna skala atak +
 * obrona i miękki sufit", "tylko rotacja"): the offense and defense the player sees, on one scale.
 * A window's number is its place among rotation players (TAL 55+) at its own position, mapped onto
 * fixed anchors: 50 the median, 68 the top quarter, 80 the top tenth, 90 the top 2.5%, and a soft
 * top where only the best ever reach 96-100. The engine's own O-TAL / D-TAL are untouched; this is
 * what cards, boards and exports show.
 */
export const RATING_SCALE = { rotationTal: 55 };
const ANCHORS: readonly [percentile: number, rating: number][] = [
  [0, 20], [0.25, 38], [0.5, 50], [0.75, 68], [0.9, 80], [0.975, 90], [0.995, 96], [1, 100],
];
/** Letters on the same scale, so a number and its letter always agree. */
const LETTERS: readonly [rating: number, grade: Exclude<Grade, 'S'>][] = [
  [96, 'A+'], [90, 'A'], [85, 'A-'], [80, 'B+'], [74, 'B'], [68, 'B-'], [60, 'C+'], [50, 'C'], [42, 'C-'], [36, 'D+'], [30, 'D'], [25, 'D-'], [0, 'F'],
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
      if (effectiveTalent(span) < RATING_SCALE.rotationTal) continue;
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
