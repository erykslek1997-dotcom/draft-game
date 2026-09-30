import type { PlayerSpan } from '../data/schema';

/**
 * 2026-09-30, engine calibration session 5: a player's windows one season earlier and later, for
 * the neighbour blends in team-level D-TAL (defensiveTalent.ts) and team spacing
 * (midrangeGravity.ts). Registered by fit.ts, which already loads the player list, so the rating
 * modules don't import the data layer. Before registration there are no neighbours.
 */
let provider: ((span: PlayerSpan) => PlayerSpan[]) | null = null;
const listeners: Array<() => void> = [];

export function registerNeighbourWindows(fn: (span: PlayerSpan) => PlayerSpan[]): void {
  provider = fn;
  for (const listener of listeners) listener();
}

export function onNeighbourWindowsRegistered(listener: () => void): void {
  listeners.push(listener);
}

export function neighbourWindowsRegistered(): boolean {
  return provider !== null;
}

export function neighbourWindowsFor(span: PlayerSpan): PlayerSpan[] {
  return provider ? provider(span) : [];
}

/** `own` blended with the neighbours' values: `share` of the result when any neighbour exists. */
export function blendWithNeighbours(own: number, neighbours: number[], share: number): number {
  if (neighbours.length === 0) return own;
  return own * (1 - share) + (neighbours.reduce((sum, v) => sum + v, 0) / neighbours.length) * share;
}
