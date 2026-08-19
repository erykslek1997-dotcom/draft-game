import type { Team } from './types';
import { TEAM_COUNT } from './positions';
import { projectMatchup } from './matchup';
import { SEED_ORDER_16 } from './leagueSimulation';
import type { SeasonStandingsRow } from './seasonSimulation';

/**
 * 2026-08-19, user's follow-up on the just-shipped 82-game season sim ("can we add playoffs?"):
 * confirmed via AskUserQuestion before building — seeded by the JUST-SIMULATED season's own
 * standings (not the Final Power Ranking `leagueSimulation.ts`'s championship-odds % already uses),
 * and every series is genuinely played out game by game (not a single random draw against the
 * closed-form series-win probability) — same "simulate once, real result, re-rollable" spirit the
 * season sim itself already established, and it lets a playoff series show a real score line like
 * "4-2" instead of just a winner.
 *
 * Deliberately its own file, not folded into `seasonSimulation.ts` — a season and a playoff
 * bracket are two genuinely different rolls (re-rolling the playoffs alone, from the SAME already-
 * rolled season standings, is a real, expected use case: "same season, let's see the playoffs
 * again"), so they need independent state/re-roll buttons in the UI. Reuses `SEED_ORDER_16` from
 * `leagueSimulation.ts` (the exact same bracket construction, just seeded by a different source and
 * resolved by a different method) rather than a second copy.
 */

const ROUND_LABELS: readonly string[] = ['First Round', 'Quarterfinals', 'Semifinals', 'Finals'];

export interface PlayoffSeriesResult {
  round: number;
  roundLabel: string;
  teamAId: string;
  teamASeed: number;
  teamBId: string;
  teamBSeed: number;
  winnerId: string;
  gamesWonA: number;
  gamesWonB: number;
}

export interface PlayoffResult {
  /** One entry per round, in order — `rounds[0]` is the 8-series First Round (16 teams),
   * `rounds[3]` is the 1-series Finals. */
  rounds: PlayoffSeriesResult[][];
  championId: string;
}

/** Plays out one best-of-7 series as real individual games — each game an independent coin flip
 * weighted by that pairing's real projected single-game win probability (`projectMatchup`, the
 * same calibrated model `seasonSimulation.ts`'s own regular-season games already use), stopping
 * the moment either side reaches 4 wins. Genuinely produces final tallies like 4-0 through 4-3,
 * not just a winner. */
function simulateSeries(teamA: Team, teamB: Team): { winnerId: string; gamesWonA: number; gamesWonB: number } {
  const { gameWinProbA } = projectMatchup(teamA, teamB);
  let gamesWonA = 0;
  let gamesWonB = 0;
  while (gamesWonA < 4 && gamesWonB < 4) {
    if (Math.random() < gameWinProbA) gamesWonA++;
    else gamesWonB++;
  }
  return { winnerId: gamesWonA === 4 ? teamA.id : teamB.id, gamesWonA, gamesWonB };
}

/**
 * Simulates a full 16-team single-elimination playoff bracket, seeded by `standings` (expected to
 * be a `simulateSeason` result for these same teams — the caller's responsibility, not re-derived
 * here). Returns `null` for anything other than the real game's fixed 16-team case (same
 * defensive-guard shape as `evaluateLeague`'s own `teams.length !== 16` check) — the bracket
 * construction only makes sense at that exact size.
 */
export function simulatePlayoffs(teams: Team[], standings: SeasonStandingsRow[]): PlayoffResult | null {
  if (teams.length !== TEAM_COUNT || standings.length !== TEAM_COUNT) return null;

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamIdBySeed = new Map(standings.map((row) => [row.rank, row.teamId]));

  let currentIds = SEED_ORDER_16.map((seed) => teamIdBySeed.get(seed));
  let currentSeeds = [...SEED_ORDER_16];
  if (currentIds.some((id) => id === undefined)) return null; // malformed standings — defensive, not expected

  const rounds: PlayoffSeriesResult[][] = [];
  for (let round = 0; round < ROUND_LABELS.length; round++) {
    const seriesResults: PlayoffSeriesResult[] = [];
    const nextIds: string[] = [];
    const nextSeeds: number[] = [];
    for (let i = 0; i < currentIds.length; i += 2) {
      const teamAId = currentIds[i] as string;
      const teamBId = currentIds[i + 1] as string;
      const teamASeed = currentSeeds[i];
      const teamBSeed = currentSeeds[i + 1];
      const teamA = teamById.get(teamAId);
      const teamB = teamById.get(teamBId);
      if (!teamA || !teamB) return null; // defensive — every seeded id must resolve to a real team
      const { winnerId, gamesWonA, gamesWonB } = simulateSeries(teamA, teamB);
      seriesResults.push({
        round: round + 1,
        roundLabel: ROUND_LABELS[round],
        teamAId,
        teamASeed,
        teamBId,
        teamBSeed,
        winnerId,
        gamesWonA,
        gamesWonB,
      });
      nextIds.push(winnerId);
      nextSeeds.push(winnerId === teamAId ? teamASeed : teamBSeed);
    }
    rounds.push(seriesResults);
    currentIds = nextIds;
    currentSeeds = nextSeeds;
  }

  return { rounds, championId: currentIds[0] as string };
}
