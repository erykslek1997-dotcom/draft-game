import { normalizePlayerName } from '../data/schema';

/**
 * Ben Taylor's (thinkingbasketball.net) two published all-time rankings — the same two lists
 * `scripts/validateAgainstTaylorTop10.ts` and `scripts/validateAgainstBackpicksGoat.ts` already
 * use as this project's external validation anchors. Single source of truth here so both scripts
 * and any runtime rule (see `grades.ts`'s pre-1976-and-unvalidated tier cap) read the exact same
 * names — a hand-copied second list would drift the moment one gets updated and the other
 * doesn't.
 */
export const TAYLOR_TOP10: string[] = [
  'Michael Jordan', 'LeBron James', "Shaquille O'Neal", 'Hakeem Olajuwon', 'Larry Bird',
  'Kareem Abdul-Jabbar', 'Stephen Curry', 'Kevin Garnett', 'Tim Duncan', 'Magic Johnson',
];

// Rank 1 = GOAT. Source: thinkingbasketball.net Backpicks GOAT list, 2022 podcast-series
// update (rank order = list position; parenthetical old-ranks in the source are not used here).
export const BACKPICKS_GOAT_2022: string[] = [
  'LeBron James', 'Kareem Abdul-Jabbar', 'Michael Jordan', 'Bill Russell', "Shaquille O'Neal",
  'Hakeem Olajuwon', 'Tim Duncan', 'Wilt Chamberlain', 'Kevin Garnett', 'Larry Bird',
  'Magic Johnson', 'Kobe Bryant', 'Karl Malone', 'Oscar Robertson', 'Dirk Nowitzki',
  'Stephen Curry', 'Chris Paul', 'Jerry West', 'David Robinson', 'Julius Erving',
  'Kevin Durant', 'Charles Barkley', 'Steve Nash', 'John Stockton', 'Dwyane Wade',
  'Scottie Pippen', 'Moses Malone', 'Rick Barry', 'Reggie Miller', 'James Harden',
  'Bob Pettit', 'John Havlicek', 'Jason Kidd', 'Artis Gilmore', 'Patrick Ewing',
  'Paul Pierce', 'Walt Frazier', 'Elgin Baylor', 'Isiah Thomas', 'Clyde Drexler',
];

/** Union of both lists, normalized once — the membership test `grades.ts` actually gates on. */
export const TAYLOR_VALIDATED_NAMES: ReadonlySet<string> = new Set(
  [...TAYLOR_TOP10, ...BACKPICKS_GOAT_2022].map(normalizePlayerName),
);
