/** 2026-11-12, the career's week points, XP and levels (pure; online/career.ts keeps the results). */
export type CareerMode = 'drawfive' | 'mini' | 'alltime' | 'bomb';

interface Scored {
  mode: CareerMode;
  daily: boolean;
  place: number;
  field: number;
  won: boolean;
  title: boolean;
}

/** How much a free draft can move the week, by mode (a Mini is short, a Draw Five shorter). */
const WEIGHT: Record<CareerMode, number> = { drawfive: 2, mini: 3, alltime: 5, bomb: 5 };

/** 1 for first, 0 for last. */
function standing(place: number, field: number): number {
  return field > 1 ? (field - place) / (field - 1) : 1;
}

/** Week points for a free draft: −weight..+weight by place, +2 for a title. Dailies score on their own table. */
export function draftPoints(r: Pick<Scored, 'mode' | 'daily' | 'place' | 'field' | 'title'>): number {
  if (r.daily) return 0;
  const p = (standing(r.place, r.field) - 0.5) * 2 * WEIGHT[r.mode];
  return Math.round((p + (r.title ? 2 : 0)) * 10) / 10;
}

/** XP never goes down: 10 for playing, up to 10 for the place, +5 a win, +15 a title, ×1.5 a daily. */
export function draftXp(r: Pick<Scored, 'daily' | 'place' | 'field' | 'won' | 'title'>): number {
  const base = 10 + Math.round(10 * standing(r.place, r.field)) + (r.won ? 5 : 0) + (r.title ? 15 : 0);
  return Math.min(60, Math.round(base * (r.daily ? 1.5 : 1)));
}

/** Level n starts at 40·(n−1)² XP. */
export function levelOf(xp: number): { level: number; into: number; next: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1;
  const from = 40 * (level - 1) ** 2;
  const to = 40 * level ** 2;
  return { level, into: xp - from, next: to - from };
}

