import type { PlayerSpan } from './schema';
import { normalizePlayerName } from './schema';

/**
 * Rim-pressure evidence for pre-tracking-era players (no shot-location data before 1996-97).
 *
 * 2026-09-26: rebuilt from the user's own ratings of 97 candidates (the artifact "Lista slasherów
 * przed 1997"): how strongly attacking the rim was a defining trait of the player — `mocny`,
 * `dobry`, `sredni`, `slaby` — rather than an in/out list. The user's point: a player is rarely
 * all or nothing (Reggie Miller's free throws came partly from shooting fouls, partly from
 * cutting to the rim). Four players left unrated carry Claude's suggestion (`ratedBy`).
 *
 * How it is used:
 * - `rimPressure.ts`: a guard or wing's pre-1997 box-score proxy is read against real 1997+
 *   slashers with weight `rimPressureEvidenceWeight` (1 / 0.75 / 0.5 / 0) and against all
 *   perimeter players with the rest — the list picks the reference group, the player's own box
 *   line still decides the number.
 * - the shadow role-fit scorer: the Slasher / Athletic Finisher / Roll & Cut Big fit is unlocked for
 *   `mocny` and `dobry` only, still gated on real box minimums there.
 * No possession counts or shooting percentages are invented here.
 */
export type RimPressureRole = 'Slasher' | 'Athletic Finisher' | 'Roll & Cut Big';

export type RimPressureStrength = 'mocny' | 'dobry' | 'sredni' | 'slaby';

export interface HistoricalRimPressureEvidence {
  playerName: string;
  role: RimPressureRole;
  strength: RimPressureStrength;
  /** Set when the user left the player unrated and Claude's suggestion stands. */
  ratedBy?: 'suggestion';
}

const STRENGTH_WEIGHT: Record<RimPressureStrength, number> = { mocny: 1, dobry: 0.75, sredni: 0.5, slaby: 0 };
/** The role-fit unlock needs at least this strength. */
const ROLE_UNLOCK_WEIGHT = 0.75;

export const HISTORICAL_RIM_PRESSURE_EVIDENCE: HistoricalRimPressureEvidence[] = [
  { playerName: 'Michael Jordan', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Dominique Wilkins', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Elgin Baylor', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Dennis Rodman', role: 'Athletic Finisher', strength: 'sredni' },
  { playerName: 'Wilt Chamberlain', role: 'Roll & Cut Big', strength: 'mocny' },
  { playerName: 'Shaquille O\'Neal', role: 'Roll & Cut Big', strength: 'mocny' },
  { playerName: 'Julius Erving', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Connie Hawkins', role: 'Slasher', strength: 'mocny' },
  { playerName: 'David Thompson', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Clyde Drexler', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Kevin Johnson', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Tiny Archibald', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Isiah Thomas', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Earl Monroe', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Gus Williams', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Sidney Moncrief', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Ron Harper', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Anfernee Hardaway', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Latrell Sprewell', role: 'Slasher', strength: 'mocny' },
  { playerName: 'James Worthy', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Rod Strickland', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Scottie Pippen', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Grant Hill', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Dave Bing', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Charles Barkley', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Adrian Dantley', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Bernard King', role: 'Slasher', strength: 'dobry' },
  { playerName: 'George Gervin', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Marques Johnson', role: 'Slasher', strength: 'sredni', ratedBy: 'suggestion' },
  { playerName: 'Xavier McDaniel', role: 'Slasher', strength: 'sredni', ratedBy: 'suggestion' },
  { playerName: 'Mark Aguirre', role: 'Slasher', strength: 'sredni', ratedBy: 'suggestion' },
  { playerName: 'Magic Johnson', role: 'Slasher', strength: 'mocny' },
  { playerName: 'Oscar Robertson', role: 'Slasher', strength: 'dobry' },
  { playerName: 'John Havlicek', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Walt Frazier', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Dennis Johnson', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Pete Maravich', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Gail Goodrich', role: 'Slasher', strength: 'sredni' },
  { playerName: 'World B. Free', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Reggie Theus', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Otis Birdsong', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Bob Dandridge', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Paul Westphal', role: 'Slasher', strength: 'sredni', ratedBy: 'suggestion' },
  { playerName: 'Spencer Haywood', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Alvin Robertson', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Doc Rivers', role: 'Slasher', strength: 'slaby' },
  { playerName: 'Spud Webb', role: 'Slasher', strength: 'slaby' },
  { playerName: 'Dee Brown', role: 'Slasher', strength: 'slaby' },
  { playerName: 'Kenny Anderson', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Gary Payton', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Tim Hardaway', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Mitch Richmond', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Cedric Ceballos', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Jerome Kersey', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Cedric Maxwell', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Detlef Schrempf', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Walter Davis', role: 'Slasher', strength: 'slaby' },
  { playerName: 'Alex English', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Rolando Blackman', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Jerry West', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Rick Barry', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Hal Greer', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Calvin Murphy', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Larry Bird', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Reggie Miller', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Mark Price', role: 'Slasher', strength: 'slaby' },
  { playerName: 'Chris Mullin', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Derek Harper', role: 'Slasher', strength: 'sredni' },
  { playerName: 'Jamaal Wilkes', role: 'Slasher', strength: 'dobry' },
  { playerName: 'Shawn Kemp', role: 'Athletic Finisher', strength: 'mocny' },
  { playerName: 'Larry Nance', role: 'Athletic Finisher', strength: 'mocny' },
  { playerName: 'Moses Malone', role: 'Roll & Cut Big', strength: 'mocny' },
  { playerName: 'Darryl Dawkins', role: 'Roll & Cut Big', strength: 'dobry' },
  { playerName: 'Buck Williams', role: 'Athletic Finisher', strength: 'dobry' },
  { playerName: 'Horace Grant', role: 'Athletic Finisher', strength: 'dobry' },
  { playerName: 'Karl Malone', role: 'Athletic Finisher', strength: 'mocny' },
  { playerName: 'Chris Webber', role: 'Roll & Cut Big', strength: 'dobry' },
  { playerName: 'Artis Gilmore', role: 'Roll & Cut Big', strength: 'mocny' },
  { playerName: 'David Robinson', role: 'Roll & Cut Big', strength: 'mocny' },
  { playerName: 'Otis Thorpe', role: 'Athletic Finisher', strength: 'dobry' },
  { playerName: 'Dikembe Mutombo', role: 'Roll & Cut Big', strength: 'dobry' },
  { playerName: 'Charles Oakley', role: 'Athletic Finisher', strength: 'sredni' },
  { playerName: 'Bill Russell', role: 'Roll & Cut Big', strength: 'sredni' },
  { playerName: 'Nate Thurmond', role: 'Roll & Cut Big', strength: 'sredni' },
  { playerName: 'Wes Unseld', role: 'Roll & Cut Big', strength: 'sredni' },
  { playerName: 'Robert Parish', role: 'Roll & Cut Big', strength: 'sredni' },
  { playerName: 'Bill Walton', role: 'Roll & Cut Big', strength: 'dobry' },
  { playerName: 'Alonzo Mourning', role: 'Roll & Cut Big', strength: 'dobry' },
  { playerName: 'Tom Chambers', role: 'Athletic Finisher', strength: 'sredni' },
  { playerName: 'A.C. Green', role: 'Athletic Finisher', strength: 'sredni' },
  { playerName: 'Armen Gilliam', role: 'Athletic Finisher', strength: 'sredni' },
  { playerName: 'Elvin Hayes', role: 'Roll & Cut Big', strength: 'sredni' },
  { playerName: 'Kareem Abdul-Jabbar', role: 'Roll & Cut Big', strength: 'dobry' },
  { playerName: 'Hakeem Olajuwon', role: 'Roll & Cut Big', strength: 'dobry' },
  { playerName: 'Patrick Ewing', role: 'Roll & Cut Big', strength: 'dobry' },
  { playerName: 'Kevin McHale', role: 'Athletic Finisher', strength: 'dobry' },
  { playerName: 'Bob McAdoo', role: 'Roll & Cut Big', strength: 'sredni' },
];

const evidenceByKey = new Map(
  HISTORICAL_RIM_PRESSURE_EVIDENCE.map((entry) => [`${normalizePlayerName(entry.playerName)}|${entry.role}`, entry]),
);

/** 0-1: how strongly the player's rim pressure is documented in `role` (0 when unlisted). */
export function rimPressureEvidenceWeight(span: Pick<PlayerSpan, 'playerName'>, role: RimPressureRole): number {
  const entry = evidenceByKey.get(`${normalizePlayerName(span.playerName)}|${role}`);
  return entry ? STRENGTH_WEIGHT[entry.strength] : 0;
}

/** The entry, when it is strong enough to unlock the role fit (`mocny` / `dobry`). */
export function historicalRimPressureEvidenceForSpan(
  span: Pick<PlayerSpan, 'playerName'>,
  role: RimPressureRole,
): HistoricalRimPressureEvidence | null {
  const entry = evidenceByKey.get(`${normalizePlayerName(span.playerName)}|${role}`) ?? null;
  return entry && STRENGTH_WEIGHT[entry.strength] >= ROLE_UNLOCK_WEIGHT ? entry : null;
}
