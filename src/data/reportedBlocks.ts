/**
 * Blocked shots counted from game stories for players whose careers ended before the NBA counted
 * blocks (1973-74). Regular season, per game, in the player's own era.
 *
 * Wilt Chamberlain: an APBR community project (apbr.org forum, topic 6064, presented at the Sloan
 * Sports Analytics Conference, March 2026) read 5-10k game stories and found reported totals for 180
 * regular-season and 77 playoff games (8.2 and 7.2 a game). The sample leans to his later seasons;
 * the author's own estimate of his career regular-season average is about 8.7 (9,058 blocks). An
 * estimate, used as one: the game reads it, TAL and D-TAL do not.
 *
 * Bill Russell: Thinking Basketball's estimate from about 100 unofficial box scores (~8 a game career,
 * near 9 at his peak); Basketball Reference's unofficial game lines give 7.6 in 25 games.
 *
 * Add a player only from a documented count like this one, never from memory.
 */
export interface ReportedBlocks {
  bpg: number;
  /** Seasons counted in full (season end year → blocks a game), used as they are. */
  seasons?: Record<number, number>;
  /** Games behind the figure. */
  games: number;
  source: string;
}
export const REPORTED_BLOCKS: Record<string, ReportedBlocks> = {
  'Wilt Chamberlain': { bpg: 8.7, seasons: { 1973: 5.4 }, games: 180, source: 'APBR topic 6064 (Sloan 2026): 180 counted regular-season games at 8.2; author estimate 8.7 career. 1972-73: 446 blocks from the Lakers via the Long Beach Independent (Sports Reference blog, 2026-03)' },
  'Bill Russell': { bpg: 8.0, games: 100, source: 'Thinking Basketball: ~100 unofficial box scores, ~8 a game career, near 9 at peak; Basketball Reference unofficial game lines 7.6 in 25 games' },
};
