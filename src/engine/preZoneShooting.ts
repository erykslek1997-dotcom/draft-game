import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import preZoneModel from '../data/preZoneMidrange.json';

/**
 * 2026-09-30, engine calibration session 3 (the user: "ręczna kalibracja"): zone data starts in
 * 1996-97, so every earlier jump shooter read as a non-shooter to the team's floor geometry — Bob
 * McAdoo (a 15-to-20-foot scorer) was a "block-camping center", Jerry West and Oscar Robertson
 * (no three-point line in their era) read like Shaq. A hand-set midrange-gravity value for spans
 * without zone data, on the same 0-80 scale the data produces (Garnett 2002-04 ~80, Webber ~64,
 * Karl Malone 1996-98 ~66, Duncan ~20). Reputation-based by design — adjust freely; only the
 * team-spacing read uses it, never TAL. 2026-10-29: the user went through the 133 best pre-zone
 * players on a review page (the model's value or this list's as the start, a step of 10) and set 50
 * of them — Robinson 65, Penny 60, Isiah 60, Pippen 49, Payton and Barkley 40, Kareem 0.
 */
const PRE_ZONE_MIDRANGE_SPACING: ReadonlyMap<string, number> = new Map(
  (
    [
      ['Jerry West', 80], ['Michael Jordan', 80], ['Bob McAdoo', 72], ['Bill Sharman', 70],
      ['George Gervin', 70], ['Karl Malone', 70], ['Kiki Vandeweghe', 70], ['Oscar Robertson', 70],
      ['Walt Frazier', 67], ['Alex English', 65], ['David Robinson', 65], ['Pete Maravich', 65],
      ['Rick Barry', 65], ['Anfernee Hardaway', 60], ['Clyde Drexler', 60], ['Dolph Schayes', 60],
      ['Isiah Thomas', 60], ['Jack Twyman', 60], ['Lou Hudson', 60], ['Walter Davis', 60],
      ['Adrian Dantley', 55], ['Bernard King', 55], ['David Thompson', 55], ['Detlef Schrempf', 55],
      ['Elgin Baylor', 55], ['Hakeem Olajuwon', 55], ['John Havlicek', 55], ['Julius Erving', 55],
      ['Kelly Tripucka', 55], ['Mark Aguirre', 55], ['Marques Johnson', 55], ['Paul Arizin', 55],
      ['Paul Westphal', 55], ['Rolando Blackman', 55], ['World B. Free', 55], ['Bob Lanier', 50],
      ['Cliff Hagan', 50], ['Dan Issel', 50], ['Dominique Wilkins', 50], ['Richie Guerin', 50],
      ['Rudy Tomjanovich', 50], ['Tom Chambers', 50], ['Scottie Pippen', 49], ['Billy Knight', 45],
      ['Doug Collins', 45], ['Earl Monroe', 45], ['George Yardley', 45], ['Grant Hill', 45],
      ['Kevin Johnson', 45], ['Patrick Ewing', 45], ['Reggie Theus', 45], ['Spencer Haywood', 45],
      ['Charles Barkley', 40], ['Gary Payton', 40], ['Kenny Sears', 40], ['Larry Johnson', 40],
      ['Randy Smith', 40], ['Sidney Moncrief', 40], ['Tiny Archibald', 40], ['Toni Kukoč', 40],
      ['Jack Sikma', 37], ['Jamaal Wilkes', 37], ['Alvin Robertson', 35], ['Brad Daugherty', 35],
      ['James Worthy', 35], ['Kevin McHale', 35], ['Ed Macauley', 30], ['Jerome Kersey', 30],
      ['Larry Nance', 30], ['Mookie Blaylock', 30], ['Neil Johnston', 30], ['Ron Harper', 30],
      ['Terrell Brandon', 30], ['Bob Pettit', 25], ['Jeff Ruland', 25], ['Bill Walton', 20],
      ['Chris Webber', 20], ['Doc Rivers', 20], ['Mark Jackson', 20],
      ['Michael Ray Richardson', 20], ['Micheal Williams', 20], ['Paul Pressey', 20],
      ['Robert Horry', 20], ['Shawn Kemp', 20], ['Alonzo Mourning', 10], ['Bobby Jones', 10],
      ['Derrick McKey', 10], ['Rodney McCray', 10], ['Avery Johnson', 0], ['Bill Russell', 0],
      ['Kareem Abdul-Jabbar', 0], ['Moses Malone', 0], ['Shaquille O\'Neal', 0],
      ['Walt Bellamy', 0],
    ] as const
  ).map(([name, value]) => [normalizePlayerName(name), value]),
);

/**
 * 2026-10-29 (the user: the hand list "będzie długo z bólem robiona sesja, chyba że masz jakiś
 * pomysł"): every other pre-zone span reads the model `scripts/fitPreZoneMidrange.ts` fits on the
 * zone data — box numbers every era has (free throws, two-point volume and accuracy, free-throw rate,
 * offensive rebounding, height, position, AST%), nearest neighbours among 2005-on spans, quantile-
 * mapped to the zone data's spread. On 1997-2004 spans it never saw: R² 0.44, r 0.68; against the
 * hand list r 0.69. It reads perimeter jump shooters well (Gervin, English, Havlicek, Bird) and
 * undersells midrange bigs (Malone 1996-98 14 against 66 from zones), hence the hand list first.
 */
const PRE_ZONE_MODEL = preZoneModel as Record<string, number>;
export const PRE_ZONE_RULES = { model: true };

/** A pre-zone span's shooting skill on the 0-80 midrange scale: the hand list, else the model. */
export function preZoneShootingSkill(span: PlayerSpan): number | undefined {
  return PRE_ZONE_MIDRANGE_SPACING.get(normalizePlayerName(span.playerName)) ?? (PRE_ZONE_RULES.model ? PRE_ZONE_MODEL[span.id] : undefined);
}
