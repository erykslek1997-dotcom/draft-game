import type { PlayerSpan } from './schema';
import { normalizePlayerName } from './schema';
import { spanEndYears } from '../engine/era';

/**
 * Defenders whose value the box score and the defensive data miss: the hardest assignment every
 * night, deflections, charges, loose balls, the player opponents hate playing against.
 * 2026-10-10, the user ("silnik nie docenia takich graczy jak Dillon… bierze najtrudniejszy
 * assignment, daje hustle"; Brooks's Memphis, Houston and Phoenix all played above their talent).
 * Measured on 1051 real teams 1981–2025: a team beat its box-score forecast by +0.52 points a game
 * per full-time player of this kind (t ≈ 2.0, better than 86% of random sets of role players with
 * the same BPM), about 10 D-TAL points. Single players are too noisy to price one by one, so the
 * list is curated by hand (drafted by Claude, checked against the data, accepted by the user) and
 * priced by tier, below the measured value: `primary` +8, `partial` +4. `from`/`to` are the
 * season-end years he played that role.
 */
export interface HustleDefender {
  playerName: string;
  tier: 'primary' | 'partial';
  from: number;
  to: number;
}

const P = (playerName: string, from: number, to: number): HustleDefender => ({ playerName, tier: 'primary', from, to });
const Q = (playerName: string, from: number, to: number): HustleDefender => ({ playerName, tier: 'partial', from, to });

export const HUSTLE_DEFENDERS: HustleDefender[] = [
  // primary
  P('Dillon Brooks', 2020, 2026), P('Marcus Smart', 2015, 2026), P('Tony Allen', 2005, 2017), P('Bruce Bowen', 1998, 2009),
  P('Luguentz Dort', 2020, 2026), P('Patrick Beverley', 2013, 2023), P('Dennis Rodman', 1987, 2000), P('Charles Oakley', 1986, 2004),
  P('Anthony Mason', 1990, 2003), P('Herbert Jones', 2022, 2026), P('Gary Payton II', 2017, 2026), P('Kenrich Williams', 2019, 2026),
  P('OG Anunoby', 2018, 2026), P('Mikal Bridges', 2019, 2026), P('Nate McMillan', 1987, 1998), P('Jerome Kersey', 1985, 2000),
  P('Greg Anthony', 1992, 2002), P('Xavier McDaniel', 1986, 1998), P('Danny Green', 2011, 2023), P('Dennis Johnson', 1977, 1990),
  P('Thabo Sefolosha', 2007, 2020), P('Ronnie Brewer', 2007, 2015), P('Derrick McKey', 1988, 2002), P('Dan Majerle', 1989, 2002),
  P('Ausar Thompson', 2024, 2026), P('Jalen Suggs', 2022, 2026), P('Tari Eason', 2023, 2026),
  // partial
  Q('Joe Dumars', 1986, 1999), Q('Bill Laimbeer', 1982, 1994), Q('Michael Cooper', 1979, 1990),
  Q('Raja Bell', 2001, 2012), Q('Shane Battier', 2002, 2014), Q('Jae Crowder', 2013, 2025), Q('Stephen Jackson', 2001, 2013),
  Q('Avery Bradley', 2011, 2021), Q('Jose Alvarado', 2022, 2026), Q('Reggie Evans', 2003, 2015), Q('Kendrick Perkins', 2004, 2017),
  Q('Udonis Haslem', 2004, 2020), Q('Chuck Hayes', 2006, 2016), Q('Luc Mbah a Moute', 2009, 2020), Q('Joakim Noah', 2008, 2020),
  Q('Tayshaun Prince', 2003, 2016), Q('George Lynch', 1994, 2005), Q("Royce O'Neale", 2018, 2026), Q('Bryon Russell', 1994, 2006),
  Q('P.J. Brown', 1994, 2008), Q('Aaron McKie', 1994, 2007), Q('Delon Wright', 2016, 2026), Q("De'Anthony Melton", 2019, 2026),
  Q('George Hill', 2009, 2022),
];

export const HUSTLE_BONUS = { primary: 8, partial: 4 } as const;
/** The bonus only lifts a defender the engine reads below this; at or above it he is already priced. */
export const HUSTLE_CEILING = 85;

const byName = new Map(HUSTLE_DEFENDERS.map((h) => [normalizePlayerName(h.playerName), h]));

/** The list entry for a span in which he played that role (at least two of its three seasons). */
export function hustleDefenderForSpan(span: Pick<PlayerSpan, 'playerName' | 'spanLabel'>): HustleDefender | null {
  const h = byName.get(normalizePlayerName(span.playerName));
  if (!h) return null;
  const inRole = spanEndYears(span.spanLabel).filter((y) => y >= h.from && y <= h.to).length;
  return inRole >= 2 ? h : null;
}

/** D-TAL with the hustle bonus: +8 / +4, never past the ceiling, nothing for those already above it. */
export function withHustleBonus(span: Pick<PlayerSpan, 'playerName' | 'spanLabel'>, dtal: number): number {
  const h = hustleDefenderForSpan(span);
  if (!h || dtal >= HUSTLE_CEILING) return dtal;
  return Math.min(HUSTLE_CEILING, dtal + HUSTLE_BONUS[h.tier]);
}
