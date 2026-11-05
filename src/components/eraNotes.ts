/**
 * 2026-09-25, user's ask ("mamy całą historię NBA… można dodać drobne smaczki z dawnych lat"):
 * small, accurate nods to when a player actually played. A stat that didn't exist yet shows as a
 * dash with the reason on hover, instead of a misleading 0.0.
 */
import type { PlayerSpan } from '../data/schema';
import { predatesThreePointLine, stealsBlocksFullyRecorded } from '../engine/era';

export const NOT_YET = '—';
export const THREE_POINT_LINE_NOTE = 'No 3-point line yet — it arrived in 1979-80.';
export const STEALS_BLOCKS_NOTE = 'Steals and blocks weren’t officially recorded until 1973-74.';

export function hadThreePointLine(span: Pick<PlayerSpan, 'spanLabel'>): boolean {
  return !predatesThreePointLine(span.spanLabel);
}

export function hadStealsBlocksRecorded(span: Pick<PlayerSpan, 'spanLabel'>): boolean {
  return stealsBlocksFullyRecorded(span.spanLabel);
}

export type EraKey = 'vintage' | 'showtime' | 'jordan' | 'deadball' | 'modern';

export interface EraStamp {
  key: EraKey;
  /** Hover text: which era and why it's remembered. */
  title: string;
}

