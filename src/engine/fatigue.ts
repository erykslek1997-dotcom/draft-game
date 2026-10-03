/**
 * 2026-10-02, the user: "więcej minut = gorsza skuteczność" — then "im więcej minut tym większa kara,
 * żeby silnik sam wybierał Jordanowi lub innemu graczowi mniej minut". One growing curve, shared by
 * the live game (a tired player makes fewer shots) and the minute solver (`minuteAllocation.ts`,
 * which therefore stops giving a star 40 minutes unless his bench truly can't cover).
 *
 * Past `FRESH_MINUTES` in a game each minute costs more than the one before: the 37th 0.5%, the 38th
 * 1%, the 39th 1.5% ... of his chance to make a shot, added up (38 minutes -1.5%, 40 -5%, 42 -10.5%).
 * Today's 30-point stars play at most ~36.5 minutes a game.
 */
export const FRESH_MINUTES = 36;
const STEP = 0.005;

/** Share of a player's shooting lost to `minutes` in one game. */
export function fatigueShare(minutes: number): number {
  const x = Math.max(0, minutes - FRESH_MINUTES);
  return (STEP / 2) * x * (x + 1);
}

/**
 * What one more minute at `minutes` costs, as a share of a minute's value: his value comes from all
 * his minutes, and the extra one tires every one of them — d/dm [m * (1 - fatigueShare(m))].
 */
export function marginalFatigueCost(minutes: number): number {
  const x = Math.max(0, minutes - FRESH_MINUTES);
  if (x <= 0) return 0;
  return fatigueShare(minutes) + minutes * (STEP / 2) * (2 * x + 1);
}
