import type { PlayerSpan } from '../data/schema';
import veteranIds from '../data/veteranWindows.json';

/**
 * 2026-11-11 (the user: "tak, weteran, generalnie to dość fajna mechanika"): a former scorer's late,
 * reduced-role window — 32+, at most 70% of his peak window's minutes and shots, his peak a starter's
 * with 14+ shots (`scripts/listTwilightWindows.ts --out`, 39 windows: Mullin 1997-99, Garnett
 * 2012-14, Carter 2011-13, Duncan 2014-16...). Its TAL stays — those windows really helped win — but
 * the card says Veteran, the AI keeps it for the bench in the early rounds, and the rotation starts
 * him only when he is clearly the better option.
 */
const VETERAN = new Set(veteranIds as string[]);
export function isVeteranWindow(span: PlayerSpan): boolean {
  return VETERAN.has(span.id);
}
