import type { PlayerSpan } from '../data/schema';
import type { Team } from './types';
import { TEAM_COUNT } from './positions';
import { projectMatchup } from './matchup';
import { buildMatchupCache } from './seasonSimulation';
import { playPairingGame, prepareTeamPairing, teamWeakLink, type BoxLineStats, type LiveGameResult } from './liveGame';
import { hashSeed } from './rng';
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

export interface LiveStandingsRow {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface SeasonAwards {
  mvp: SeasonPlayerLine | null;
  dpoy: SeasonPlayerLine | null;
  sixthMan: SeasonPlayerLine | null;
  /** First, second and third team: two guards, two forwards, a center each (by primary position). */
  allNba: SeasonPlayerLine[][];
  /** First and second team, the same positions. */
  allDefense: SeasonPlayerLine[][];
  /** The 24 All-Stars, best first — a curiosity after the season (no conferences, no game). */
  allStars: SeasonPlayerLine[];
}

export interface LiveSeasonResult {
  standings: LiveStandingsRow[];
  players: SeasonPlayerLine[];
  awards: SeasonAwards;
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

/**
 * 2026-10-08, the user ("niekoniecznie mi się podoba to zagraj jeszcze raz"): one season per draft —
 * the same rosters and rotations always play the same season and the same playoffs, so there is
 * nothing to re-roll. The seed is the draft itself.
 */
export function seasonSeed(teams: Team[]): string {
  const draft = teams
    .map((t) => `${t.id}:${t.roster.map((p) => p.id).join(',')}:${Object.entries(t.rotation?.slots ?? {}).map(([slot, list]) => `${slot}=${list.map((a) => `${a.playerId}/${a.minutes}`).join('+')}`).join(';')}`)
    .join('|');
  return `season-${hashSeed(draft).toString(36)}`;
}

/** Adds one game's box score to the running player lines. */
function addGame(lines: Map<string, SeasonPlayerLine>, teams: [Team, Team], game: LiveGameResult, starterIds: Set<string>): void {
  for (const side of [0, 1] as const) {
    const team = teams[side];
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

const guard = (l: SeasonPlayerLine) => l.span.primaryPosition === 'PG' || l.span.primaryPosition === 'SG';
const forward = (l: SeasonPlayerLine) => l.span.primaryPosition === 'SF' || l.span.primaryPosition === 'PF';
const center = (l: SeasonPlayerLine) => l.span.primaryPosition === 'C';

/** `count` teams of two guards, two forwards and a center, best by `value` first; nobody twice. */
function positionalTeams(pool: SeasonPlayerLine[], value: (l: SeasonPlayerLine) => number, count: number): SeasonPlayerLine[][] {
  const ranked = [...pool].sort((x, y) => value(y) - value(x));
  const taken = new Set<SeasonPlayerLine>();
  const take = (is: (l: SeasonPlayerLine) => boolean, n: number) => {
    const picked = ranked.filter((l) => is(l) && !taken.has(l)).slice(0, n);
    picked.forEach((l) => taken.add(l));
    return picked;
  };
  return Array.from({ length: count }, () => [...take(guard, 2), ...take(forward, 2), ...take(center, 1)]);
}

/** The 24 All-Stars: the best lines with at least eight guards and eight frontcourt players. */
const ALL_STARS = 24;
const ALL_STAR_MIN_PER_COURT = 8;
function allStarsFrom(pool: SeasonPlayerLine[], value: (l: SeasonPlayerLine) => number): SeasonPlayerLine[] {
  const ranked = [...pool].sort((x, y) => value(y) - value(x));
  const picked = new Set<SeasonPlayerLine>([
    ...ranked.filter(guard).slice(0, ALL_STAR_MIN_PER_COURT),
    ...ranked.filter((l) => !guard(l)).slice(0, ALL_STAR_MIN_PER_COURT),
  ]);
  for (const l of ranked) {
    if (picked.size >= ALL_STARS) break;
    picked.add(l);
  }
  return ranked.filter((l) => picked.has(l));
}

export function simulateLiveSeason(teams: Team[], seed: string = seasonSeed(teams), onProgress?: (played: number, total: number) => void): LiveSeasonResult {
  const cache = buildMatchupCache(teams);
  const weak = new Map(teams.map((t) => [t.id, teamWeakLink(t)]));
  const record = new Map(teams.map((t) => [t.id, { teamId: t.id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]));
  const lines = new Map<string, SeasonPlayerLine>();
  const starterIds = new Set(teams.flatMap((t) => primaryStarters(t).map((e) => `${t.id}|${e.player.id}`)));

  let total = 0;
  for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) total += gamesForPair(i, j, teams.length);
  let played = 0;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i];
      const b = teams[j];
      const margin = projectMatchup(a, b, cache.get(a.id), cache.get(b.id), 'season').marginA;
      const games = gamesForPair(i, j, teams.length);
      const pairing = prepareTeamPairing(a, b, margin, [weak.get(a.id) ?? null, weak.get(b.id) ?? null]);
      for (let g = 0; g < games; g++) {
        const game = playPairingGame(pairing, `${seed}:${a.id}:${b.id}:${g}`, false);
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
        addGame(lines, [a, b], game, starterIds);
        played++;
      }
      onProgress?.(played, total);
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
  const mvpValue = (l: SeasonPlayerLine) => gameScorePerGame(l) * Math.sqrt(winPct.get(l.teamId) ?? 0);
  // DPOY (2026-10-02, the user: "powinno oba"): his own defense AND his team's — D-TAL plus
  // stocks, then the team's rank in points allowed weighs as much as a big D-TAL gap.
  const defenseValue = (l: SeasonPlayerLine) =>
    computeDefensiveTalent(l.span) +
    (2 * (l.totals.stl + l.totals.blk)) / l.games -
    DPOY_POINTS_PER_ALLOWED * ((pointsAllowed.get(l.teamId) ?? fewestAllowed) - fewestAllowed);
  // All-Stars lean on the numbers more than the record: a star on a losing team still goes.
  const allStarValue = (l: SeasonPlayerLine) => gameScorePerGame(l) * (0.8 + 0.4 * (winPct.get(l.teamId) ?? 0));
  return {
    standings,
    players,
    awards: {
      mvp: best(eligible, mvpValue),
      dpoy: best(eligible, defenseValue),
      sixthMan: best(eligible.filter((l) => !l.starter), gameScorePerGame),
      allNba: positionalTeams(eligible, mvpValue, 3),
      allDefense: positionalTeams(eligible, defenseValue, 2),
      allStars: allStarsFrom(eligible, allStarValue),
    },
  };
}

/** One playoff game: who played, the score, and the seed that replays it play by play. */
export interface LivePlayoffGame {
  seed: string;
  /** Points, team A first. */
  final: [number, number];
}

export interface LivePlayoffSeries {
  round: number;
  roundLabel: string;
  teamAId: string;
  teamASeed: number;
  teamBId: string;
  teamBSeed: number;
  winnerId: string;
  gamesWonA: number;
  gamesWonB: number;
  /** The engine's expected margin per game, team A's view — what a replay needs. */
  margin: number;
  games: LivePlayoffGame[];
}

export interface LivePlayoffResult {
  rounds: LivePlayoffSeries[][];
  championId: string;
  /** Playoff totals, every game of every round. */
  players: SeasonPlayerLine[];
  /** The best line per game on the champion in the Finals. */
  finalsMvp: SeasonPlayerLine | null;
}

/** The top 8 of the season, 1-8 / 4-5 on one side and 2-7 / 3-6 on the other, as before. */
const PLAYOFF_SEED_ORDER = [1, 8, 4, 5, 2, 7, 3, 6];
const PLAYOFF_ROUNDS = ['Quarterfinals', 'Semifinals', 'Finals'];

/**
 * 2026-10-08, the user (season simulation step): the playoffs on the live engine — every game a real
 * game with the playoff margin (`projectMatchup`, 'playoffs': the full style clash), best of seven.
 * Each game keeps its seed, so any of them can be watched play by play later and comes out the same
 * (`playLivePlayoffGame`).
 */
export function simulateLivePlayoffs(teams: Team[], standings: LiveStandingsRow[], seed: string = seasonSeed(teams)): LivePlayoffResult | null {
  if (teams.length !== TEAM_COUNT || standings.length !== TEAM_COUNT) return null;
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const cache = buildMatchupCache(teams);
  const starterIds = new Set(teams.flatMap((t) => primaryStarters(t).map((e) => `${t.id}|${e.player.id}`)));
  const lines = new Map<string, SeasonPlayerLine>();
  let current = PLAYOFF_SEED_ORDER.map((s) => ({ id: standings[s - 1].teamId, seed: s }));
  const rounds: LivePlayoffSeries[][] = [];
  const finalsLines = new Map<string, SeasonPlayerLine>();
  for (let round = 0; round < PLAYOFF_ROUNDS.length; round++) {
    const series: LivePlayoffSeries[] = [];
    const next: typeof current = [];
    for (let i = 0; i < current.length; i += 2) {
      const [ea, eb] = [current[i], current[i + 1]];
      const a = teamById.get(ea.id);
      const b = teamById.get(eb.id);
      if (!a || !b) return null;
      const margin = projectMatchup(a, b, cache.get(a.id), cache.get(b.id), 'playoffs').marginA;
      const pairing = prepareTeamPairing(a, b, margin);
      const games: LivePlayoffGame[] = [];
      let wa = 0;
      let wb = 0;
      const roundLines = round === PLAYOFF_ROUNDS.length - 1 ? finalsLines : null;
      while (wa < 4 && wb < 4) {
        const gameSeed = `${seed}:playoffs:${round}:${a.id}:${b.id}:${games.length}`;
        const game = playPairingGame(pairing, gameSeed, false);
        games.push({ seed: gameSeed, final: game.final });
        if (game.final[0] > game.final[1]) wa++;
        else wb++;
        addGame(lines, [a, b], game, starterIds);
        if (roundLines) addGame(roundLines, [a, b], game, starterIds);
      }
      const winner = wa === 4 ? ea : eb;
      series.push({ round: round + 1, roundLabel: PLAYOFF_ROUNDS[round], teamAId: a.id, teamASeed: ea.seed, teamBId: b.id, teamBSeed: eb.seed, winnerId: winner.id, gamesWonA: wa, gamesWonB: wb, margin, games });
      next.push(winner);
    }
    rounds.push(series);
    current = next;
  }
  const championId = current[0].id;
  const finalsMvp = [...finalsLines.values()]
    .filter((l) => l.teamId === championId)
    .reduce<SeasonPlayerLine | null>((top, l) => (!top || gameScorePerGame(l) > gameScorePerGame(top) ? l : top), null);
  return { rounds, championId, players: [...lines.values()], finalsMvp };
}

/** One playoff game played again with its play-by-play — the same game the bracket counted. */
export function playLivePlayoffGame(teams: Team[], series: LivePlayoffSeries, gameIndex: number): LiveGameResult | null {
  const a = teams.find((t) => t.id === series.teamAId);
  const b = teams.find((t) => t.id === series.teamBId);
  const game = series.games[gameIndex];
  if (!a || !b || !game) return null;
  return playPairingGame(prepareTeamPairing(a, b, series.margin), game.seed, true);
}
