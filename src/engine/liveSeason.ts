import type { PlayerSpan } from '../data/schema';
import type { Team } from './types';
import { TEAM_COUNT } from './positions';
import { projectMatchup } from './matchup';
import { buildMatchupCache } from './seasonSimulation';
import { playTeamGame, teamWeakLink, type BoxLineStats } from './liveGame';
import { computeDefensiveTalent } from './defensiveTalent';
import { primaryStarters } from './rotation';
import { scoreTeam } from './scoring';

/**
 * 2026-10-02, stage 2, the user ("najwięcej by nam dała symulacja sezonu"): the regular season
 * played game by game on the live engine — every team's full rotation, every box score kept — so
 * the standings, the players' season numbers and the awards all come from the same games.
 *
 * Schedule as `seasonSimulation.ts` (82 games: every opponent 5 or 6 times). Each game's margin is
 * the engine's season projection (`projectMatchup`, 'season'); the possessions decide who wins, with
 * no clear-favourite retakes.
 */
export interface SeasonPlayerLine {
  span: PlayerSpan;
  teamId: string;
  games: number;
  /** Season totals. */
  totals: BoxLineStats;
  starter: boolean;
}

export interface LiveSeasonResult {
  standings: { teamId: string; wins: number; losses: number; pointsFor: number; pointsAgainst: number }[];
  players: SeasonPlayerLine[];
  awards: { mvp: SeasonPlayerLine | null; dpoy: SeasonPlayerLine | null; sixthMan: SeasonPlayerLine | null };
}

const EXTRA_GAME_OFFSETS = new Set([1, 2, 3, 8]);
export function gamesForPair(i: number, j: number, count: number): number {
  if (count !== TEAM_COUNT) return 5;
  const diff = Math.abs(i - j);
  return EXTRA_GAME_OFFSETS.has(Math.min(diff, count - diff)) ? 6 : 5;
}

const zero = (): BoxLineStats => ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0, min: 0 });

/** Hollinger-style game score per game, without fouls and the offensive/defensive rebound split. */
export function gameScorePerGame(line: SeasonPlayerLine): number {
  const t = line.totals;
  const value = t.pts + 0.4 * t.fgm - 0.7 * t.fga - 0.4 * (t.fta - t.ftm) + 0.4 * t.reb + t.stl + 0.7 * t.ast + 0.7 * t.blk - t.tov;
  return line.games > 0 ? value / line.games : 0;
}

/** Minimum share of the season a player must play to win an award. */
const AWARD_MIN_GAMES = 58;
const AWARD_MIN_MINUTES = 20;
/** D-TAL points one point of team points allowed per game is worth in the DPOY vote. */
const DPOY_POINTS_PER_ALLOWED = 3;

/** The engine's own view of each team, to compare with how its season went: the score breakdown,
 * the rank by overall, and the wins the season projection expects over this schedule. */
export interface EngineTeamView {
  rank: number;
  expectedWins: number;
  overall: number;
  talent: number;
  offense: number;
  defense: number;
  spacing: number;
  fit: number;
}

export function engineTeamViews(teams: Team[]): Map<string, EngineTeamView> {
  const cache = buildMatchupCache(teams);
  const expected = new Map(teams.map((t) => [t.id, 0]));
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i];
      const b = teams[j];
      const p = projectMatchup(a, b, cache.get(a.id), cache.get(b.id), 'season').gameWinProbA;
      const games = gamesForPair(i, j, teams.length);
      expected.set(a.id, (expected.get(a.id) ?? 0) + games * p);
      expected.set(b.id, (expected.get(b.id) ?? 0) + games * (1 - p));
    }
  }
  const scored = teams.map((t) => ({ team: t, score: scoreTeam(t) })).sort((x, y) => y.score.overallExact - x.score.overallExact);
  return new Map(
    scored.map(({ team, score }, index) => [
      team.id,
      {
        rank: index + 1,
        expectedWins: expected.get(team.id) ?? 0,
        overall: score.overall,
        talent: score.talentScore,
        offense: score.offenseScore,
        defense: score.defenseScore,
        spacing: score.spacingScore,
        fit: score.fitScore,
      },
    ]),
  );
}

export function simulateLiveSeason(teams: Team[], seed: string = String(Math.random())): LiveSeasonResult {
  const cache = buildMatchupCache(teams);
  const weak = new Map(teams.map((t) => [t.id, teamWeakLink(t)]));
  const record = new Map(teams.map((t) => [t.id, { teamId: t.id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]));
  const lines = new Map<string, SeasonPlayerLine>();
  const starterIds = new Set(teams.flatMap((t) => primaryStarters(t).map((e) => `${t.id}|${e.player.id}`)));

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i];
      const b = teams[j];
      const margin = projectMatchup(a, b, cache.get(a.id), cache.get(b.id), 'season').marginA;
      const games = gamesForPair(i, j, teams.length);
      for (let g = 0; g < games; g++) {
        const game = playTeamGame(a, b, margin, `${seed}:${a.id}:${b.id}:${g}`, { record: false, weakLinks: [weak.get(a.id) ?? null, weak.get(b.id) ?? null] });
        const [sa, sb] = game.final;
        const ra = record.get(a.id)!;
        const rb = record.get(b.id)!;
        ra.pointsFor += sa;
        ra.pointsAgainst += sb;
        rb.pointsFor += sb;
        rb.pointsAgainst += sa;
        if (sa > sb) {
          ra.wins++;
          rb.losses++;
        } else {
          rb.wins++;
          ra.losses++;
        }
        for (const side of [0, 1] as const) {
          const team = side === 0 ? a : b;
          game.players[side].forEach((span, k) => {
            const box = game.box[side][game.labels[side][k]];
            if (box.min <= 0) return;
            const key = `${team.id}|${span.id}`;
            const line = lines.get(key) ?? { span, teamId: team.id, games: 0, totals: zero(), starter: starterIds.has(key) };
            line.games++;
            for (const stat of Object.keys(line.totals) as (keyof BoxLineStats)[]) line.totals[stat] += box[stat];
            lines.set(key, line);
          });
        }
      }
    }
  }

  const standings = [...record.values()].sort((x, y) => y.wins - x.wins || y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst));
  const winPct = new Map(standings.map((r) => [r.teamId, r.wins / Math.max(1, r.wins + r.losses)]));
  const players = [...lines.values()];
  const eligible = players.filter((l) => l.games >= AWARD_MIN_GAMES && l.totals.min / l.games >= AWARD_MIN_MINUTES);
  const best = (pool: SeasonPlayerLine[], value: (l: SeasonPlayerLine) => number) =>
    pool.reduce<SeasonPlayerLine | null>((top, l) => (!top || value(l) > value(top) ? l : top), null);
  // MVP: the best game score on a winning team. DPOY: the engine's D-TAL with real minutes, on a
  // good defensive team (fewest points allowed). Sixth Man: the best game score off the bench.
  const pointsAllowed = new Map(standings.map((r) => [r.teamId, r.pointsAgainst / Math.max(1, r.wins + r.losses)]));
  const fewestAllowed = Math.min(...pointsAllowed.values());
  return {
    standings,
    players,
    awards: {
      mvp: best(eligible, (l) => gameScorePerGame(l) * Math.sqrt(winPct.get(l.teamId) ?? 0)),
      // DPOY (2026-10-02, the user: "powinno oba"): his own defense AND his team's — D-TAL plus
      // stocks, then the team's rank in points allowed weighs as much as a big D-TAL gap.
      dpoy: best(
        eligible,
        (l) =>
          computeDefensiveTalent(l.span) +
          (2 * (l.totals.stl + l.totals.blk)) / l.games -
          DPOY_POINTS_PER_ALLOWED * ((pointsAllowed.get(l.teamId) ?? fewestAllowed) - fewestAllowed),
      ),
      sixthMan: best(eligible.filter((l) => !l.starter), gameScorePerGame),
    },
  };
}
