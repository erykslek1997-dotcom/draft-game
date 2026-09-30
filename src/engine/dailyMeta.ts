import type { Position } from '../data/schema';
import { mulberry32, hashSeed } from './rng';

/**
 * 2026-09-28, the user (Daily Slot Machine 2.0, see TODO.md): what a daily board is known by before
 * anything is dealt — the day's position order, where the Joker shows up and the opponent of the
 * day. Seed-only and dependency-light on purpose: the menu reads it without loading the engine.
 */

const SLOTS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** A legendary starting five the daily board plays after the draft. Players listed PG→C. */
export interface LegendFive {
  id: string;
  /** "1991–92 Chicago Bulls". */
  name: string;
  /** "'92 Bulls". */
  short: string;
  /** The season the five is from, by the year it ended (a span ending nearest to it is used). */
  endYear: number;
  players: [string, string, string, string, string];
}

/** Title-winning (or iconic) starting fives, every player checked against the draft pool. */
export const LEGEND_FIVES: LegendFive[] = [
  { id: 'bulls92', name: '1991–92 Chicago Bulls', short: "'92 Bulls", endYear: 1992, players: ['John Paxson', 'Michael Jordan', 'Scottie Pippen', 'Horace Grant', 'Bill Cartwright'] },
  { id: 'celtics86', name: '1985–86 Boston Celtics', short: "'86 Celtics", endYear: 1986, players: ['Dennis Johnson', 'Danny Ainge', 'Larry Bird', 'Kevin McHale', 'Robert Parish'] },
  { id: 'lakers87', name: '1986–87 Los Angeles Lakers', short: "'87 Lakers", endYear: 1987, players: ['Magic Johnson', 'Byron Scott', 'James Worthy', 'A.C. Green', 'Kareem Abdul-Jabbar'] },
  { id: 'lakers01', name: '2000–01 Los Angeles Lakers', short: "'01 Lakers", endYear: 2001, players: ['Derek Fisher', 'Kobe Bryant', 'Rick Fox', 'Horace Grant', "Shaquille O'Neal"] },
  { id: 'spurs14', name: '2013–14 San Antonio Spurs', short: "'14 Spurs", endYear: 2014, players: ['Tony Parker', 'Danny Green', 'Kawhi Leonard', 'Tim Duncan', 'Tiago Splitter'] },
  { id: 'warriors17', name: '2016–17 Golden State Warriors', short: "'17 Warriors", endYear: 2017, players: ['Stephen Curry', 'Klay Thompson', 'Kevin Durant', 'Draymond Green', 'Zaza Pachulia'] },
  { id: 'pistons89', name: '1988–89 Detroit Pistons', short: "'89 Pistons", endYear: 1989, players: ['Isiah Thomas', 'Joe Dumars', 'Mark Aguirre', 'Dennis Rodman', 'Bill Laimbeer'] },
  { id: 'sixers83', name: '1982–83 Philadelphia 76ers', short: "'83 Sixers", endYear: 1983, players: ['Maurice Cheeks', 'Andrew Toney', 'Julius Erving', 'Bobby Jones', 'Moses Malone'] },
  { id: 'heat13', name: '2012–13 Miami Heat', short: "'13 Heat", endYear: 2013, players: ['Mario Chalmers', 'Dwyane Wade', 'LeBron James', 'Udonis Haslem', 'Chris Bosh'] },
  { id: 'cavs16', name: '2015–16 Cleveland Cavaliers', short: "'16 Cavs", endYear: 2016, players: ['Kyrie Irving', 'J.R. Smith', 'LeBron James', 'Kevin Love', 'Tristan Thompson'] },
  { id: 'bucks21', name: '2020–21 Milwaukee Bucks', short: "'21 Bucks", endYear: 2021, players: ['Jrue Holiday', 'Donte DiVincenzo', 'Khris Middleton', 'Giannis Antetokounmpo', 'Brook Lopez'] },
  { id: 'nuggets23', name: '2022–23 Denver Nuggets', short: "'23 Nuggets", endYear: 2023, players: ['Jamal Murray', 'Kentavious Caldwell-Pope', 'Michael Porter Jr.', 'Aaron Gordon', 'Nikola Jokic'] },
  { id: 'mavs11', name: '2010–11 Dallas Mavericks', short: "'11 Mavs", endYear: 2011, players: ['Jason Kidd', 'Jason Terry', 'Shawn Marion', 'Dirk Nowitzki', 'Tyson Chandler'] },
  { id: 'pistons04', name: '2003–04 Detroit Pistons', short: "'04 Pistons", endYear: 2004, players: ['Chauncey Billups', 'Richard Hamilton', 'Tayshaun Prince', 'Rasheed Wallace', 'Ben Wallace'] },
  { id: 'celtics08', name: '2007–08 Boston Celtics', short: "'08 Celtics", endYear: 2008, players: ['Rajon Rondo', 'Ray Allen', 'Paul Pierce', 'Kevin Garnett', 'Kendrick Perkins'] },
  { id: 'rockets95', name: '1994–95 Houston Rockets', short: "'95 Rockets", endYear: 1995, players: ['Kenny Smith', 'Clyde Drexler', 'Mario Elie', 'Robert Horry', 'Hakeem Olajuwon'] },
  { id: 'jazz97', name: '1996–97 Utah Jazz', short: "'97 Jazz", endYear: 1997, players: ['John Stockton', 'Jeff Hornacek', 'Bryon Russell', 'Karl Malone', 'Greg Ostertag'] },
  { id: 'sonics96', name: '1995–96 Seattle SuperSonics', short: "'96 Sonics", endYear: 1996, players: ['Gary Payton', 'Hersey Hawkins', 'Detlef Schrempf', 'Shawn Kemp', 'Sam Perkins'] },
  { id: 'celtics24', name: '2023–24 Boston Celtics', short: "'24 Celtics", endYear: 2024, players: ['Jrue Holiday', 'Derrick White', 'Jaylen Brown', 'Jayson Tatum', 'Al Horford'] },
  { id: 'lakers72', name: '1971–72 Los Angeles Lakers', short: "'72 Lakers", endYear: 1972, players: ['Jerry West', 'Gail Goodrich', 'Jim McMillian', 'Happy Hairston', 'Wilt Chamberlain'] },
];

export interface DailyMeta {
  /** The order the positions are dealt in today. */
  order: Position[];
  /** Where today's Joker plays — never the first or second position dealt. */
  jokerSlot: Position;
  opponent: LegendFive;
  /** The round (index in `order`) after which the Joker leaves the table if nobody has bought him,
   * or null when he stays until his own round. Fixed by the seed, so the same for everyone. */
  jokerLeavesAfter: number | null;
}

/**
 * 2026-09-30, the user (Draw Five, Joker variant C): the Joker sits on the table from the first
 * round and his price drops by this share every round until his own position comes up.
 */
export const JOKER_DROP_PCT = 0.12;
/** The chance, shown on his card, that the Joker leaves the table after round 1, 2, 3, 4 (the user
 * chose a rising chance you can see over a hidden moment). */
export const JOKER_LEAVE_CHANCE = [0.2, 0.4, 0.6, 0.8];

/** The Joker's price in round `round` (0-based) — full price in the first round, then 12% less every
 * round, no lower than in his own round. One decimal, like every other cap cost. */
export function jokerPriceAt(fullPrice: number, round: number, jokerRound: number): number {
  return Math.round(fullPrice * Math.pow(1 - JOKER_DROP_PCT, Math.max(0, Math.min(round, jokerRound))) * 10) / 10;
}

/**
 * 2026-09-28, the user ("kto powiedział że losowanie pozycji musi zaczynać się na PG?"): the
 * positions come in a different order every day, and the Joker can be at any of them as long as at
 * least two picks come before it — there has to be something to save caps on.
 */
export function dailyMeta(seed: string): DailyMeta {
  const rng = mulberry32(hashSeed(`${seed}:meta`));
  const order = SLOTS.map((s) => ({ s, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.s);
  const jokerSlot = order[2 + Math.floor(rng() * 3)];
  const opponent = LEGEND_FIVES[Math.floor(rng() * LEGEND_FIVES.length)];
  let jokerLeavesAfter: number | null = null;
  for (let r = 0; r < order.indexOf(jokerSlot); r++) {
    if (rng() < JOKER_LEAVE_CHANCE[r]) {
      jokerLeavesAfter = r;
      break;
    }
  }
  return { order, jokerSlot, opponent, jokerLeavesAfter };
}
