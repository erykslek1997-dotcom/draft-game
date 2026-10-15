import type { PlayerSpan } from '../data/schema';
import liftData from '../data/teammateLift.json';

/**
 * 2026-10-15, the user ("jak wpływają na efficiency zawodników obok"): how much better a player's
 * teammates really shot beside him, and how much his own real teammates lifted him — in true
 * shooting, built by `scripts/buildTeammateLift.ts` (which explains the measurement). Spans not
 * measured read 0.
 */
const DATA = liftData as unknown as Record<string, [number, number]>;

export interface TeammateLift {
  /** What he gives the teammates on the floor with him, TS points as a fraction (0.01 = one point). */
  lift: number;
  /** What his real teammates gave him, the same way (his real percentages already hold it). */
  realMates: number;
}

export function teammateLift(span: PlayerSpan): TeammateLift {
  const row = DATA[span.id];
  return row ? { lift: row[0] / 1000, realMates: row[1] / 1000 } : { lift: 0, realMates: 0 };
}
