import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
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

/**
 * 2026-09-30, engine calibration session 3 (the user: "ręczna kalibracja"): zone data starts in
 * 1996-97, so every earlier jump shooter read as a non-shooter to the team's floor geometry — Bob
 * McAdoo (a 15-to-20-foot scorer) was a "block-camping center", Jerry West and Oscar Robertson
 * (no three-point line in their era) read like Shaq. A hand-set midrange-gravity value for spans
 * without zone data, on the same 0-80 scale the data produces (Garnett 2002-04 ~80, Webber ~64,
 * Karl Malone 1996-98 ~66, Duncan ~20). Reputation-based by design — adjust freely; only the
 * team-spacing read uses it, never TAL.
 */
const PRE_ZONE_MIDRANGE_SPACING: ReadonlyMap<string, number> = new Map(
  (
    [
      ['Jerry West', 75], ['Michael Jordan', 75], ['Bill Sharman', 70], ['George Gervin', 70],
      ['Kiki Vandeweghe', 70], ['Bob McAdoo', 72], ['Rick Barry', 65], ['Alex English', 65],
      ['Pete Maravich', 65], ['Karl Malone', 60], ['Oscar Robertson', 60], ['Jack Twyman', 60],
      ['Dolph Schayes', 60], ['Lou Hudson', 60], ['Walter Davis', 60], ['Bernard King', 55],
      ['Patrick Ewing', 55], ['Paul Arizin', 55], ['John Havlicek', 55], ['Rolando Blackman', 55],
      ['Mark Aguirre', 55], ['Kelly Tripucka', 55], ['World B. Free', 55], ['Paul Westphal', 55],
      ['Cliff Hagan', 50], ['Richie Guerin', 50], ['Dominique Wilkins', 50], ['Tom Chambers', 50],
      ['Bob Lanier', 50], ['Dan Issel', 50], ['Rudy Tomjanovich', 50], ['Adrian Dantley', 45],
      ['Hakeem Olajuwon', 45], ['David Robinson', 45], ['Bob Pettit', 45], ['Earl Monroe', 45],
      ['Spencer Haywood', 45], ['Marques Johnson', 45], ['Doug Collins', 45], ['David Thompson', 45],
      ['Reggie Theus', 45], ['Detlef Schrempf', 45], ['Elgin Baylor', 45], ['George Yardley', 45],
      ['Billy Knight', 45], ['Isiah Thomas', 40], ['Tiny Archibald', 40], ['Sidney Moncrief', 40],
      ['Clyde Drexler', 40], ['Randy Smith', 40], ['Kenny Sears', 40], ['Larry Johnson', 40],
      ['Kareem Abdul-Jabbar', 25], ['Kevin Johnson', 35], ['Brad Daugherty', 35], ['Julius Erving', 35],
      ['James Worthy', 35], ['Grant Hill', 35], ['Larry Nance', 30], ['Neil Johnston', 30],
      ['Ed Macauley', 30], ['Ron Harper', 30], ['Kevin McHale', 25], ['Jeff Ruland', 25],
      ['Charles Barkley', 20], ['Walt Bellamy', 20],
    ] as const
  ).map(([name, value]) => [normalizePlayerName(name), value]),
);

function preZoneMidrangeSpacing(span: PlayerSpan): number {
  if (runtimeZoneTotalsForSpan(span)) return 0;
  return PRE_ZONE_MIDRANGE_SPACING.get(normalizePlayerName(span.playerName)) ?? 0;
}

/** A player's spacing as the TEAM's floor geometry sees it: three-point spacing, or partial
 * midrange-gravity credit when that is higher (measured from zone data, or hand-set before it). */
export function teamSpacingValue(span: PlayerSpan): number {
  return Math.max(computeSpacing(span), midrangeGravitySpacing(span), preZoneMidrangeSpacing(span));
}
