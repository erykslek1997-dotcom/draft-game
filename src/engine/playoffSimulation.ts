import type { Team } from './types';
import { TEAM_COUNT } from './positions';
import { projectMatchup, type MatchupTeamCache } from './matchup';
import { buildMatchupCache, type SeasonStandingsRow } from './seasonSimulation';
const SEED_ORDER_8 = [1, 8, 4, 5, 2, 7, 3, 6];
const ROUND_LABELS: readonly string[] = ['Quarterfinals', 'Semifinals', 'Finals'];

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
  /** One entry per round, in order — `rounds[0]` is the 4-series Quarterfinals (top 8 of the
   * season), `rounds[2]` is the 1-series Finals. */
  rounds: PlayoffSeriesResult[][];
  championId: string;
}

/** Plays out one best-of-7 series as real individual games — each game an independent coin flip
 * weighted by that pairing's real projected single-game win probability (`projectMatchup`, the
 * same calibrated model `seasonSimulation.ts`'s own regular-season games already use), stopping
 * the moment either side reaches 4 wins. Genuinely produces final tallies like 4-0 through 4-3,
 * not just a winner. */
function simulateSeries(
  teamA: Team,
  teamB: Team,
  /** Precomputed `MatchupTeamCache` for each side (matchup.ts) — precomputed once in
   * `simulatePlayoffs` so a re-rolled bracket doesn't re-derive every team's cache from scratch. */
  cacheA?: MatchupTeamCache,
  cacheB?: MatchupTeamCache,
): { winnerId: string; gamesWonA: number; gamesWonB: number } {
  const { gameWinProbA } = projectMatchup(teamA, teamB, cacheA, cacheB, 'playoffs');
  let gamesWonA = 0;
  let gamesWonB = 0;
  while (gamesWonA < 4 && gamesWonB < 4) {
    if (Math.random() < gameWinProbA) gamesWonA++;
    else gamesWonB++;
  }
  return { winnerId: gamesWonA === 4 ? teamA.id : teamB.id, gamesWonA, gamesWonB };
}

/**
 * Simulates an 8-team single-elimination playoff bracket from the top 8 of `standings` (expected
 * to be a `simulateSeason` result for these same teams — the caller's responsibility, not
 * re-derived here). Returns `null` for anything other than the real game's fixed 16-team league.
 */
export function simulatePlayoffs(
  teams: Team[],
  standings: SeasonStandingsRow[],
  /** Precomputed per-team `MatchupTeamCache` (see `buildMatchupCache`, seasonSimulation.ts, and
   * its own docstring) — pass it so re-rolling the bracket from the same standings doesn't
   * re-derive every team's cache from scratch. Falls back to building it once here when omitted. */
  cacheByTeamId?: Map<string, MatchupTeamCache>,
): PlayoffResult | null {
  if (teams.length !== TEAM_COUNT || standings.length !== TEAM_COUNT) return null;

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamIdBySeed = new Map(standings.map((row) => [row.rank, row.teamId]));
  const cacheById = cacheByTeamId ?? buildMatchupCache(teams);

  let currentIds = SEED_ORDER_8.map((seed) => teamIdBySeed.get(seed));
  let currentSeeds = [...SEED_ORDER_8];
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
      const { winnerId, gamesWonA, gamesWonB } = simulateSeries(
        teamA,
        teamB,
        cacheById.get(teamAId),
        cacheById.get(teamBId),
      );
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
