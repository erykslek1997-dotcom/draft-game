import type { PlayerSpan } from '../data/schema';
import veteranIds from '../data/veteranWindows.json';
import twilightIds from '../data/twilightWindows.json';

/**
 * 2026-11-11 (the user: "tak, weteran, generalnie to dość fajna mechanika"; then "coś mało tych
 * weteranów"): two sets from `scripts/listTwilightWindows.ts --out`.
 *
 *  - Veteran (142): 32+, at most 80% of his peak window's minutes and shots, his peak TAL 70+
 *    (Horry, Kidd, Battier, Iguodala, Ray Allen in Miami, Garnett's Celtics). The card trait and its
 *    FIT off the bench (`traits.ts`).
 *  - Twilight (39, the strict cut): a former scorer's late, reduced role — 32+, at most 70% of his
 *    peak minutes and shots, a peak of TAL 75+ on 14+ shots (Mullin 1997-99, Garnett 2012-14, Carter
 *    2011-13). Its TAL stays — those windows really helped win — but the AI keeps it for the bench in
 *    the early rounds and the rotation starts him only when clearly the better option.
 */
const VETERAN = new Set(veteranIds as string[]);
const TWILIGHT = new Set(twilightIds as string[]);
export function isVeteranWindow(span: PlayerSpan): boolean {
  return VETERAN.has(span.id) || TWILIGHT.has(span.id);
}
export function isTwilightWindow(span: PlayerSpan): boolean {
  return TWILIGHT.has(span.id);
}
