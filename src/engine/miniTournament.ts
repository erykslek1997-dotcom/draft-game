import type { Team } from './types';
import { projectMatchup } from './matchup';
import { buildMatchupCache } from './seasonSimulation';
import { playPairingGame, prepareTeamPairing, type LiveGameResult } from './liveGame';

/**
 * The Mini's tournament (2026-10-22, the user; mockup `docs/mockups/mini-ncaa.html`): after the
 * draft the sixteen teams are seeded 1-16 by their draft grade and play a single-elimination
 * bracket — 1-16, 8-9, 5-12, 4-13 on one half, 6-11, 3-14, 7-10, 2-15 on the other — one game a
 * round, the loser out. Four rounds. Every game is a real game on the playoff margin with its own
 * seed, so any of them plays out the same again when watched (`playMiniGame`).
 */
export const MINI_ROUNDS = ['Round of 16', 'Elite Eight', 'Final Four', 'Final'] as const;
const FIRST_ROUND: [number, number][] = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];

export interface MiniGame {
  round: number;
  /** Team A is the higher seed. */
  teamAId: string;
  teamASeed: number;
  teamBId: string;
  teamBSeed: number;
  /** The engine's expected margin, team A's view. */
  margin: number;
  seed: string;
  final: [number, number];
  winnerId: string;
}

export interface MiniTournament {
  /** Team ids by seed: `seeds[0]` is the 1 seed. */
  seeds: string[];
  rounds: MiniGame[][];
  championId: string;
}

/** `seeded`: the sixteen teams, best draft grade first. */
export function simulateMiniTournament(seeded: Team[], seed: string): MiniTournament {
  const byId = new Map(seeded.map((t) => [t.id, t]));
  const cache = buildMatchupCache(seeded);
  const seedOf = new Map(seeded.map((t, i) => [t.id, i + 1]));
  let field = FIRST_ROUND.flat().map((s) => seeded[s - 1].id);
  const rounds: MiniGame[][] = [];
  for (let round = 0; round < MINI_ROUNDS.length; round++) {
    const games: MiniGame[] = [];
    for (let i = 0; i < field.length; i += 2) {
      const [x, y] = [field[i], field[i + 1]];
      const [aId, bId] = seedOf.get(x)! <= seedOf.get(y)! ? [x, y] : [y, x];
      const a = byId.get(aId)!;
      const b = byId.get(bId)!;
      const margin = projectMatchup(a, b, cache.get(a.id), cache.get(b.id), 'playoffs').marginA;
      const gameSeed = `${seed}:mini-tournament:${round}:${aId}:${bId}`;
      const game = playPairingGame(prepareTeamPairing(a, b, margin), gameSeed, false);
      games.push({ round, teamAId: aId, teamASeed: seedOf.get(aId)!, teamBId: bId, teamBSeed: seedOf.get(bId)!, margin, seed: gameSeed, final: game.final, winnerId: game.final[0] > game.final[1] ? aId : bId });
    }
    rounds.push(games);
    field = games.map((g) => g.winnerId);
  }
  return { seeds: seeded.map((t) => t.id), rounds, championId: field[0] };
}

/** One tournament game play by play — the same game the bracket recorded. */
export function playMiniGame(teams: Team[], game: MiniGame): LiveGameResult | null {
  const a = teams.find((t) => t.id === game.teamAId);
  const b = teams.find((t) => t.id === game.teamBId);
  if (!a || !b) return null;
  return playPairingGame(prepareTeamPairing(a, b, game.margin), game.seed, true);
}

/** The round a team went out in (its loss), or null for the champion. */
export function exitRound(t: MiniTournament, teamId: string): number | null {
  for (const games of t.rounds) for (const g of games) if ((g.teamAId === teamId || g.teamBId === teamId) && g.winnerId !== teamId) return g.round;
  return null;
}
