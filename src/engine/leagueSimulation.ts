import type { Team } from './types';
import { rankTeams } from './scoring';
import { projectMatchup, seriesWinProbability, gameWinProbability, type MatchupProjection, type MatchupTeamCache } from './matchup';
import { projectedNetRating } from './netRatingProjection';
import { fitScore } from './fit';
import { defensiveHuntability } from './defensiveHuntability';

/**
 * League-wide evaluation: every pairwise BO7 matchup among the 16 drafted rosters, plus a Monte
 * Carlo single-elimination championship simulation seeded by the existing "Final Power Ranking"
 * (`rankTeams`'s `overall`). The genuinely new piece from [[net_rating_model_and_spec_reviews]]'s
 * spec review — everything here is built on the already-validated `projectMatchup`/
 * `projectedNetRating`, no new unvalidated formulas.
 *
 * Championship probability requires simulation rather than closed-form math: which opponent a
 * team faces in round 2 depends on who wins round 1, so "probability of winning it all" isn't a
 * simple product of fixed-opponent probabilities. Monte Carlo is the standard, simplest-correct
 * way to handle that (and is literally what the spec itself recommended:
 * `simulation_recommended: true`).
 */

/** Standard single-elimination bracket seed order for 16 entrants — the well-known recursive
 * construction that keeps seed 1 and seed 2 on opposite halves of the bracket (so they can only
 * meet in the final), same shape as a real NBA/NCAA 16-team bracket. Consecutive pairs are
 * round-1 matchups: (1,16),(8,9),(4,13),(5,12),(2,15),(7,10),(3,14),(6,11). */
// 2026-08-19: exported so `playoffSimulation.ts` can reuse the exact same bracket construction
// for its own (different) purpose — a single deterministically-simulated bracket seeded by real
// season standings, instead of this file's Monte Carlo championship-probability estimate seeded
// by the Final Power Ranking. Reused rather than duplicated so the two can never drift apart.
export const SEED_ORDER_16 = [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11];

const DEFAULT_SIMULATIONS = 20000;

export interface MatchupSummary {
  opponentId: string;
  opponentLabel: string;
  seriesWinProb: number;
  marginA: number;
}

export interface TeamLeagueEvaluation {
  teamId: string;
  globalRank: number;
  expectedNetRating: number;
  avgSeriesWinProb: number;
  matchups: MatchupSummary[];
  bestMatchup: MatchupSummary;
  worstMatchup: MatchupSummary;
  championshipProbability: number;
}

/** One Monte Carlo pass through the bracket. `winProb(aIdx, bIdx)` returns aIdx's series win
 * probability against bIdx (indices into `seededTeamIds`, 0-based, already in rank order). */
function simulateOneBracket(seededTeamIds: string[], winProb: (aId: string, bId: string) => number): string {
  let current = SEED_ORDER_16.map((seed) => seededTeamIds[seed - 1]);
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i];
      const b = current[i + 1];
      next.push(Math.random() < winProb(a, b) ? a : b);
    }
    current = next;
  }
  return current[0];
}

/**
 * Full league evaluation for a completed 16-team draft. Returns one entry per team, indexed the
 * same order as `teams`. Falls back to championshipProbability=0/neutral matchup fields if
 * `teams.length !== 16` (the bracket seeding only makes sense for the real game's fixed
 * TEAM_COUNT) rather than throwing — a defensive guard, not an expected path.
 */
export function evaluateLeague(teams: Team[], simulations: number = DEFAULT_SIMULATIONS): TeamLeagueEvaluation[] {
  const ranked = rankTeams(teams); // rank 1 = best, per the existing Final Power Ranking
  const rankByTeamId = new Map(ranked.map(({ team, rank }) => [team.id, rank]));
  // 2026-09-14, user-reported live (asking for more background simulations "so the result is more
  // realistic"): every field of `MatchupTeamCache` (matchup.ts) is a real per-team computation this
  // precompute loop used to hand `projectMatchup` fresh for BOTH sides of every one of the 240
  // ordered pairs below — up to 15x redundant per team, each appearing in 15 pairs. Measured
  // (`scripts/_simPerfDiag.ts`, run once and discarded): `fitScore` (read for `huntingPotential`)
  // was the dominant cost at ~2.2ms/call, not the `overall`/`projectedNetRating` fields this cache
  // already carried before that measurement — see `MatchupTeamCache`'s own docstring for the full
  // story. One bundle per team, built once here from `rankTeams`/`projectedNetRating`/`fitScore`/
  // `defensiveHuntability`, reused for every pair that team appears in below — `fitScore` runs
  // elsewhere too (ResultsScreen.tsx's own "Team analysis"/matchup-explanation panels), but as
  // separate, uncached calls of its own; this cache is local to this one function's own pair loop.
  const cacheByTeamId = new Map<string, MatchupTeamCache>(
    ranked.map(({ team, breakdown }) => [
      team.id,
      {
        overall: breakdown.overall,
        netRating: projectedNetRating(team).net,
        huntingPotential: fitScore(team).inputs.huntingPotential,
        huntability: defensiveHuntability(team),
      },
    ]),
  );
  const seededTeamIds = [...teams].sort((a, b) => (rankByTeamId.get(a.id) ?? 999) - (rankByTeamId.get(b.id) ?? 999)).map((t) => t.id);

  // Precompute every pairwise matchup once (120 unique pairs for 16 teams) — the simulation loop
  // below only does cheap Math.random() + map lookups, not re-running projectedNetRating per sim.
  // Stores the full projection (not just seriesWinProbA) so the displayed `marginA` below
  // (MatchupMatrix.tsx) reflects the same mismatch-adjusted number that actually drives the win
  // probability, instead of a plain net-rating subtraction that silently disagreed with it.
  const matchupByPair = new Map<string, MatchupProjection>(); // key `${aId}|${bId}` -> a's projection
  for (const a of teams) {
    for (const b of teams) {
      if (a.id === b.id) continue;
      matchupByPair.set(`${a.id}|${b.id}`, projectMatchup(a, b, cacheByTeamId.get(a.id), cacheByTeamId.get(b.id)));
    }
  }
  const winProb = (aId: string, bId: string) => matchupByPair.get(`${aId}|${bId}`)?.seriesWinProbA ?? 0.5;

  const championshipCount = new Map<string, number>(teams.map((t) => [t.id, 0]));
  if (teams.length === 16) {
    for (let i = 0; i < simulations; i++) {
      const champion = simulateOneBracket(seededTeamIds, winProb);
      championshipCount.set(champion, (championshipCount.get(champion) ?? 0) + 1);
    }
  }

  return teams.map((team) => {
    const others = teams.filter((t) => t.id !== team.id);
    const matchups: MatchupSummary[] = others.map((opp) => {
      const projection = matchupByPair.get(`${team.id}|${opp.id}`);
      return {
        opponentId: opp.id,
        opponentLabel: opp.name,
        seriesWinProb: projection?.seriesWinProbA ?? 0.5,
        marginA: projection?.marginA ?? (projectedNetRating(team).net - projectedNetRating(opp).net),
      };
    });
    const avgSeriesWinProb = matchups.reduce((sum, m) => sum + m.seriesWinProb, 0) / (matchups.length || 1);
    const best = matchups.reduce((a, b) => (b.seriesWinProb > a.seriesWinProb ? b : a), matchups[0]);
    const worst = matchups.reduce((a, b) => (b.seriesWinProb < a.seriesWinProb ? b : a), matchups[0]);

    return {
      teamId: team.id,
      globalRank: rankByTeamId.get(team.id) ?? 0,
      expectedNetRating: projectedNetRating(team).net,
      avgSeriesWinProb,
      matchups,
      bestMatchup: best,
      worstMatchup: worst,
      championshipProbability: teams.length === 16 ? (championshipCount.get(team.id) ?? 0) / simulations : 0,
    };
  });
}

// Re-exported for callers that only need a single ad-hoc matchup (e.g. a "compare two teams"
// UI panel) without paying for the full 16-team league evaluation.
export { projectMatchup, seriesWinProbability, gameWinProbability };
