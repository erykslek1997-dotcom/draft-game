import type { PlayerSpan } from '../data/schema';

/**
 * 2026-09-26, the user ("tak, wdrażaj dla wszystkich"): a named TAL adjustment (grades.ts's
 * per-player ceilings and peak targets) carries into O-TAL and D-TAL too, so the team offense and
 * defense ratings agree with the card. The shift is computed in grades.ts (it needs the display
 * pipeline) and registered here, so talent.ts / defensiveTalent.ts can add it without importing
 * grades.ts (which imports them). Before registration every shift is zero.
 */
export interface NamedShift {
  offense: number;
  defense: number;
}

const ZERO: NamedShift = { offense: 0, defense: 0 };
let provider: ((span: PlayerSpan) => NamedShift) | null = null;

export function registerNamedShift(fn: (span: PlayerSpan) => NamedShift): void {
  provider = fn;
}

export function namedShiftRegistered(): boolean {
  return provider !== null;
}

export function namedShiftFor(span: PlayerSpan): NamedShift {
  return provider ? provider(span) : ZERO;
}
