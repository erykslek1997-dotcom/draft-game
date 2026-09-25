/**
 * 2026-09-25, user's ask ("mamy całą historię NBA… można dodać drobne smaczki z dawnych lat"):
 * small, accurate nods to when a player actually played. A stat that didn't exist yet shows as a
 * dash with the reason on hover, instead of a misleading 0.0.
 */
import type { PlayerSpan } from '../data/schema';
import { predatesThreePointLine, spanEndYears, stealsBlocksFullyRecorded } from '../engine/era';

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

/**
 * 2026-09-25, user's follow-up ("mamy tylko vintage smaczki, może coś z okresu Bird/Magic, Jordan
 * era, deadball era"): each older era gets its own small years stamp, styled after its time.
 * Picked by the span's middle season (season-end years); anything from 2011 on is the
 * Pace & space era.
 */
export function eraStamp(span: Pick<PlayerSpan, 'spanLabel'>): EraStamp | null {
  if (predatesThreePointLine(span.spanLabel)) {
    return { key: 'vintage', title: 'Vintage era — played before the 3-point line (1979-80).' };
  }
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) return null;
  const mid = years[Math.floor((years.length - 1) / 2)];
  if (mid <= 1990) return { key: 'showtime', title: 'Showtime era (1980-1991) — Bird vs. Magic, and the 3-point line’s first decade.' };
  if (mid <= 1998) return { key: 'jordan', title: 'Jordan era (1991-1998) — six titles in eight years, hand-checking still legal.' };
  if (mid <= 2010) return { key: 'deadball', title: 'Deadball era (1999-2010) — slow pace, half-court grind and the lowest scoring since the shot clock arrived.' };
  return { key: 'modern', title: 'Pace & space era (2011-today) — threes, switching everything and the fastest pace since the late ’80s.' };
}
