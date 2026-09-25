import type { PlayerSpan } from '../data/schema';
import { runtimeZoneTotalsForSpan } from './runtimeSpanLookups';
import { computeSpacing } from './spacing';

/**
 * 2026-09-25, user-confirmed ("KG vs Ryan Anderson do sprawdzenia" -> option A): `computeSpacing`
 * is built from three-point volume and accuracy only, so a genuine high-volume midrange shooter
 * reads exactly like Shaq. Kevin Garnett 2002-04 took ~12.5 midrange shots a game at 45.7% and
 * scored spacing 5 ("Non-shooter"); swapping him for Ryan Anderson (spacing 95, 0.7 midrange
 * attempts a game) raised a neutral lineup's team offense 59 -> 61. Defenses cannot sag off a
 * big hitting 45% from 18 feet, so he is not a hard non-spacer.
 *
 * Scales with the midrange POINTS a player actually produces (attempts x accuracy x 2), gated by
 * accuracy, so more volume at better efficiency earns more gravity (user: "Skalowalność? KG rzuca
 * więcej i na lepszej skuteczności"). Tops out at 80, the "Great shooter" band: KG ~80, Webber
 * ~64, DeRozan ~69, Malone 1996-98 ~66, Duncan ~20, Shaq 0. Same neutral lineup: KG 59 -> 64,
 * Ryan Anderson 61, Malone 68 -> 71.
 *
 * Deliberately a TEAM-spacing input only: `computeSpacing` itself feeds `computeTalent` (TAL,
 * AI draft value, grades), and this must not move any player's individual rating. Capped below
 * the "Walking gravity" tier: a midrange threat pulls his defender out, but does not stretch the
 * floor as far as an elite three-point shooter does.
 *
 * Zone data covers 1996-97 onward only; older spans get no credit (unchanged behaviour).
 */
const MIN_CLASSIFIED_FGA = 150;
const MID_POINTS_START = 4;
const MID_POINTS_FULL = 11;
const MID_ACCURACY_START = 0.36;
const MID_ACCURACY_FULL = 0.44;
export const MAX_MIDRANGE_SPACING = 80;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function midrangeGravitySpacing(span: PlayerSpan): number {
  const totals = runtimeZoneTotalsForSpan(span);
  if (!totals) return 0;
  const classified = totals.rimFga + totals.midFga + totals.threeFga;
  if (classified < MIN_CLASSIFIED_FGA || totals.midFga <= 0) return 0;
  const midPerGame = span.fga * (totals.midFga / classified);
  const midPct = totals.midFgm / totals.midFga;
  const midPoints = midPerGame * midPct * 2;
  const volume = clamp01((midPoints - MID_POINTS_START) / (MID_POINTS_FULL - MID_POINTS_START));
  const accuracy = clamp01((midPct - MID_ACCURACY_START) / (MID_ACCURACY_FULL - MID_ACCURACY_START));
  return MAX_MIDRANGE_SPACING * volume * accuracy;
}

/** A player's spacing as the TEAM's floor geometry sees it: three-point spacing, or partial
 * midrange-gravity credit when that is higher. */
export function teamSpacingValue(span: PlayerSpan): number {
  return Math.max(computeSpacing(span), midrangeGravitySpacing(span));
}
