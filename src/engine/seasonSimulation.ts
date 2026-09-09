import type { Team } from './types';
import { TEAM_COUNT } from './positions';
import { projectMatchup } from './matchup';
import { scoreTeam } from './scoring';

/**
 * 2026-08-19, user's own idea: "PR works as it works, but user can simulate 82 game season" —
 * keeps `scoring.ts`'s Final Power Ranking completely untouched (it's still the one number every
 * team is judged/ranked by) and adds a genuinely separate, game-by-game 82-game regular season a
 * player can roll for fun on the Results screen. Built entirely on the already-validated
 * `projectMatchup`/`gameWinProbability` (matchup.ts) — the same real, calibrated single-game model
 * `leagueSimulation.ts`'s BO7 bracket sim already uses, just applied per-game instead of per-series.
 *
 * User explicitly chose "simulate once, re-rollable with a button" over "average many seasons" —
 * this returns ONE randomly-rolled season's standings, not an expected-value projection. Calling
 * it again produces a different result, same as clicking "Skip"/"Play" re-rolls the lottery.
 */
export const REGULAR_SEASON_GAMES = 82;

/**
 * A real NBA season has 82 games per team, but this game's 16 rosters have no real division/
 * conference structure to derive an authentic asymmetric schedule from — so instead of inventing
 * fake divisions, every team plays every other team either 5 or 6 times, chosen so the total
 * still comes out to exactly 82 per team (matches the real NBA's per-team total, even though the
 * per-opponent distribution is necessarily a simplification).
 *
 * The math: 15 opponents × 5 games = 75, leaving 7 more games per team to distribute as a 6th
 * meeting against 7 of those 15 opponents specifically. That requires a 7-regular graph on 16
 * teams (every team gets exactly 7 "extra game" opponents) — built here as a circulant graph
 * (offsets 1, 2, 3 mod 16, each contributing 2 to every team's degree, plus offset 8 — each
 * team's exact opposite index — contributing 1, since i+8 and i-8 are the same team mod 16).
 * 2+2+2+1 = 7 extra-game opponents per team, verified directly (`perTeam.every(x => x === 82)`
 * checked for all 16 teams before shipping) rather than assumed from the arithmetic alone.
 */
const EXTRA_GAME_OFFSETS: ReadonlySet<number> = new Set([1, 2, 3, 8]);

function isExtraGamePair(indexA: number, indexB: number): boolean {
  const diff = Math.abs(indexA - indexB);
  const minDiff = Math.min(diff, TEAM_COUNT - diff);
  return EXTRA_GAME_OFFSETS.has(minDiff);
}

/** Games scheduled between two teams (by their index in the `teams` array passed to
 * `simulateSeason`). Only the real 16-team case gets the exact-82 circulant construction above —
 * any other count (never a real path through this app; same defensive-guard shape as
 * `evaluateLeague`'s own `teams.length !== 16` fallback in leagueSimulation.ts) falls back to a
 * flat 5-game series per pair rather than asserting/throwing. */
function gamesScheduledForPair(indexA: number, indexB: number, teamCount: number): number {
  if (teamCount !== TEAM_COUNT) return 5;
  return isExtraGamePair(indexA, indexB) ? 6 : 5;
}

export interface SeasonStandingsRow {
  teamId: string;
  wins: number;
  losses: number;
  winPct: number;
  gamesPlayed: number;
  /** 1 = best record. Ties broken by raw win count (identical to winPct at equal gamesPlayed,
   * kept as an explicit secondary key for clarity, not because it can differ in practice — every
   * team plays the same 82 games in the real 16-team case). */
  rank: number;
}

/**
 * Simulates one full regular season, game by game: every scheduled game between two of the
 * drafted rosters is an independent coin flip weighted by that pairing's real projected
 * single-game win probability (`projectMatchup`, built on the calibrated net-rating margin model —
 * see matchup.ts's own docstring). A genuinely different result every call, not an average across
 * many seasons — call again to re-roll.
 */
export function simulateSeason(teams: Team[]): SeasonStandingsRow[] {
  const wins = new Map<string, number>(teams.map((t) => [t.id, 0]));
  const losses = new Map<string, number>(teams.map((t) => [t.id, 0]));
  // `projectMatchup` now blends the `overall` gap into the game margin (see its
  // `OVERALL_MARGIN_WEIGHT` docstring); precompute once per team so the pair loop below doesn't
  // re-score.
  const overallById = new Map(teams.map((t) => [t.id, scoreTeam(t).overall]));

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const teamA = teams[i];
      const teamB = teams[j];
      const gameCount = gamesScheduledForPair(i, j, teams.length);
      const { gameWinProbA } = projectMatchup(teamA, teamB, overallById.get(teamA.id), overallById.get(teamB.id));
      for (let g = 0; g < gameCount; g++) {
        if (Math.random() < gameWinProbA) {
          wins.set(teamA.id, (wins.get(teamA.id) ?? 0) + 1);
          losses.set(teamB.id, (losses.get(teamB.id) ?? 0) + 1);
        } else {
          wins.set(teamB.id, (wins.get(teamB.id) ?? 0) + 1);
          losses.set(teamA.id, (losses.get(teamA.id) ?? 0) + 1);
        }
      }
    }
  }

  const standings = teams.map((t) => {
    const w = wins.get(t.id) ?? 0;
    const l = losses.get(t.id) ?? 0;
    return { teamId: t.id, wins: w, losses: l, winPct: w + l > 0 ? w / (w + l) : 0, gamesPlayed: w + l };
  });
  standings.sort((a, b) => b.winPct - a.winPct || b.wins - a.wins);
  return standings.map((row, index) => ({ ...row, rank: index + 1 }));
}
