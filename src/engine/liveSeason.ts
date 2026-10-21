import type { PlayerSpan, Position } from '../data/schema';
import type { Rotation, Team } from './types';
import { STARTER_SLOTS, TEAM_COUNT } from './positions';
import { projectMatchup } from './matchup';
import { buildMatchupCache } from './seasonSimulation';
import { playPairingGame, prepareTeamPairing, teamWeakLink, type BoxLineStats, type LiveGameResult } from './liveGame';
import { hashSeed } from './rng';
import { computeDefensiveTalent } from './defensiveTalent';
import { bestPrimaryAssignment, primaryStarters } from './rotation';
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
  /** Games with 10+ in two (three) of points, rebounds, assists, steals and blocks. */
  doubleDoubles: number;
  tripleDoubles: number;
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

/** A team's season in sums (2026-10-08, for descriptions grounded in what happened): its own box
 * totals, its opponents' against it, and its record in games decided by five points or fewer. */
export interface LiveTeamSeason {
  teamId: string;
  games: number;
  for: BoxLineStats;
  against: BoxLineStats;
  closeWins: number;
  closeLosses: number;
}

/** One side's best line of a game: the most points (game score breaks a tie). */
export interface SeasonGameTop {
  spanId: string;
  line: BoxLineStats;
}

/** One regular-season game, in calendar order (`round` is the night; every team plays once a round). */
export interface LiveSeasonGame {
  round: number;
  aId: string;
  bId: string;
  /** Points, team A first. */
  final: [number, number];
  top: [SeasonGameTop | null, SeasonGameTop | null];
  /** The game's seed: `playLiveSeasonGame` plays it again with its play-by-play. */
  seed: string;
}

/** The players' season so far at a break: after `afterRound` (0-based) rounds have been played. */
export interface SeasonSnapshot {
  afterRound: number;
  /** "November", or "All-Star break". */
  label: string;
  kind: 'month' | 'asg';
  players: { teamId: string; spanId: string; games: number; totals: BoxLineStats }[];
}

/** The All-Star Game (2026-10-21, the night edition's season calendar): the 24 at the break, the
 * two best captain a side and pick in turns, the game played on the engine. */
export interface LiveAllStarGame {
  /** Each side: its captain first, then the picks in order; the first five start. */
  sides: [{ teamId: string; span: PlayerSpan; pick: number | null }[], { teamId: string; span: PlayerSpan; pick: number | null }[]];
  final: [number, number];
  seed: string;
  /** The best line on the winning side. */
  mvp: { side: 0 | 1; teamId: string; span: PlayerSpan; line: BoxLineStats } | null;
}

export interface LiveSeasonResult {
  standings: LiveStandingsRow[];
  players: SeasonPlayerLine[];
  awards: SeasonAwards;
  teamSeasons: LiveTeamSeason[];
  /** Every game in calendar order (2026-10-21, the season calendar: month breaks, records). */
  games: LiveSeasonGame[];
  /** The date of each round, `YYYY-MM-DD`. */
  dates: string[];
  /** The All-Star break comes after this round (0-based). */
  asgAfterRound: number;
  snapshots: SeasonSnapshot[];
  allStarGame: LiveAllStarGame | null;
}

/** Sum of one side's box score. */
export function sideTotals(box: Record<string, BoxLineStats>): BoxLineStats {
  const sum = zero();
  for (const line of Object.values(box)) for (const stat of Object.keys(sum) as (keyof BoxLineStats)[]) sum[stat] += line[stat];
  return sum;
}

function addTo(into: BoxLineStats, add: BoxLineStats): void {
  for (const stat of Object.keys(into) as (keyof BoxLineStats)[]) into[stat] += add[stat];
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
/** Defensive awards (audit 2026-10-08, the user: McMillan at 22 minutes on All-Defense, six of ten
 * from the best defensive team): the team's points allowed weigh 1 per point above the best defense
 * (was 3 — the team swamped the player), a defender counts in full from 32 minutes a game (less
 * below), and All-Defense takes two guards and three frontcourt players (one center left Duncan,
 * Wallace and Wembanyama out behind two others). 18 seasons: nobody under 28 minutes (15 of 180
 * before), 2.8 of the ten best regular defenders left out per season (5.4). Then (the user: "za
 * dużo all-d z jednej drużyny") at most `perTeam` from one team over both teams. Knobs: `perAllowed`,
 * `fullMinutes`, `perTeam`, `layout` ('positions': 2 G / 2 F / C, 'frontcourt': 2 G / 3 F-C, 'none'). */
export const DEFENSE_AWARDS = { perAllowed: 1, fullMinutes: 32, perTeam: 3, wingHandicap: 4, layout: 'frontcourt' as 'positions' | 'frontcourt' | 'none' };

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
 * 2026-10-21, the season calendar: the same 82 games, a night at a time. A round-robin (the circle
 * method) gives fifteen nights where every team plays once; five of those cycles make the 75 games
 * every pair plays, and seven more nights the sixth games of the near neighbours (`gamesForPair`).
 * Each game keeps the seed it always had, so the season comes out the same in any order.
 */
export function seasonRounds(count: number): [number, number][][] {
  const ids = Array.from({ length: count + (count % 2) }, (_, i) => i);
  const n = ids.length;
  const cycle: [number, number][][] = [];
  const rot = [...ids];
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];
    for (let k = 0; k < n / 2; k++) {
      const a = rot[k];
      const b = rot[n - 1 - k];
      if (a < count && b < count) round.push(a < b ? [a, b] : [b, a]);
    }
    cycle.push(round);
    rot.splice(1, 0, rot.pop()!);
  }
  const base: [number, number][][] = [];
  for (let c = 0; c < 5; c++) base.push(...cycle.map((r) => [...r]));
  if (count !== TEAM_COUNT) return base;
  // The sixth games: offsets 1, 2 and 3 as two nights each (alternate edges of their cycles), 8 as one.
  const extra: [number, number][][] = [];
  const pair = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
  for (const k of [1, 2, 3]) {
    const nights: [number, number][][] = [[], []];
    const seen = new Set<number>();
    for (let start = 0; start < count; start++) {
      if (seen.has(start)) continue;
      const walk: number[] = [];
      for (let v = start; !seen.has(v); v = (v + k) % count) {
        seen.add(v);
        walk.push(v);
      }
      walk.forEach((v, i) => nights[i % 2].push(pair(v, (v + k) % count)));
    }
    extra.push(...nights);
  }
  extra.push(Array.from({ length: count / 2 }, (_, i) => pair(i, i + count / 2)));
  // Spread the seven extra nights through the season.
  const out: [number, number][][] = [];
  const every = Math.floor(base.length / extra.length);
  base.forEach((round, i) => {
    out.push(round);
    if ((i + 1) % every === 0 && extra.length) out.push(extra.shift()!);
  });
  out.push(...extra);
  return out;
}

/** Opening night and the spacing of the calendar: a night about every two days, Oct 22 to mid-April,
 * with six days off at the All-Star break. */
const SEASON_START = Date.UTC(2025, 9, 22);
const DAYS_PER_ROUND = 2.08;
const ASG_BREAK_DAYS = 6;
export function seasonDates(rounds: number, asgAfterRound: number): string[] {
  return Array.from({ length: rounds }, (_, r) => {
    const day = Math.round(r * DAYS_PER_ROUND) + (r > asgAfterRound ? ASG_BREAK_DAYS : 0);
    return new Date(SEASON_START + day * 864e5).toISOString().slice(0, 10);
  });
}

/** The best line of one side of a game: the most points, game score breaking a tie. */
function topLine(game: LiveGameResult, side: 0 | 1): SeasonGameTop | null {
  let best: SeasonGameTop | null = null;
  let bestKey = -Infinity;
  game.players[side].forEach((span, k) => {
    const line = game.box[side][game.labels[side][k]];
    if (!line || line.min <= 0) return;
    const key = line.pts * 100 + line.pts + 0.4 * line.fgm - 0.7 * line.fga + 0.3 * line.reb + 0.7 * line.ast + line.stl + 0.7 * line.blk - line.tov;
    if (key > bestKey) {
      bestKey = key;
      best = { spanId: span.id, line: { ...line } };
    }
  });
  return best;
}

/** The All-Star sides: the two best captain, then pick in turns (A, B, B, A, …), best available
 * first. A captain and his first four picks start. */
export function allStarDraft<T>(stars: T[]): { item: T; pick: number | null }[][] {
  if (stars.length < 2) return [];
  const sides: { item: T; pick: number | null }[][] = [[{ item: stars[0], pick: null }], [{ item: stars[1], pick: null }]];
  stars.slice(2).forEach((item, i) => sides[[0, 1, 1, 0][i % 4]].push({ item, pick: i + 1 }));
  return sides;
}

/** An All-Star side's minutes: the five starters at their best positions, 28 minutes each, the
 * reserves sharing the other 20 of the spot they fit. */
function allStarRotation(roster: PlayerSpan[]): Rotation {
  const starters = roster.slice(0, 5);
  const { assignment } = bestPrimaryAssignment(starters);
  const slots = {} as Rotation['slots'];
  const used = new Set<string>();
  const free = [...starters];
  for (const slot of STARTER_SLOTS) {
    const span = assignment[slot] && !used.has(assignment[slot]!.id) ? assignment[slot]! : free.find((x) => !used.has(x.id))!;
    used.add(span.id);
    slots[slot] = [{ playerId: span.id, minutes: 28 }];
  }
  const reserves = roster.slice(5);
  const bySlot = new Map<Position, PlayerSpan[]>(STARTER_SLOTS.map((p) => [p, []]));
  for (const span of reserves) {
    const order = [...STARTER_SLOTS].sort((x, y) => (bySlot.get(x)!.length - bySlot.get(y)!.length) * 10 + (x === span.primaryPosition ? -1 : 0) - (y === span.primaryPosition ? -1 : 0));
    bySlot.get(order[0])!.push(span);
  }
  for (const slot of STARTER_SLOTS) {
    const list = bySlot.get(slot)!;
    if (!list.length) {
      slots[slot][0].minutes = 48;
      continue;
    }
    const each = Math.floor(20 / list.length);
    list.forEach((span, i) => slots[slot].push({ playerId: span.id, minutes: i === 0 ? 20 - each * (list.length - 1) : each }));
  }
  return { slots };
}

/** The All-Star Game on the engine: two sides of twelve, an even game, the seed the season gives. */
function playAllStarGame(sides: { teamId: string; span: PlayerSpan; pick: number | null }[][], seed: string): LiveAllStarGame | null {
  if (sides.length !== 2 || sides.some((s) => s.length < 5)) return null;
  const teams = sides.map((side, k) => {
    const roster = side.map((x) => x.span);
    return { id: `asg-${k}`, name: `Team ${side[0].span.playerName.split(' ').slice(-1)[0]}`, draftSlot: k + 1, isHuman: false, roster, rotation: allStarRotation(roster) } as Team;
  });
  const gameSeed = `${seed}:all-star`;
  const game = playPairingGame(prepareTeamPairing(teams[0], teams[1], 0, [null, null]), gameSeed, false);
  const winner: 0 | 1 = game.final[0] > game.final[1] ? 0 : 1;
  const top = topLine(game, winner);
  const who = top ? sides[winner].find((x) => x.span.id === top.spanId) : undefined;
  return {
    sides: [sides[0], sides[1]] as LiveAllStarGame['sides'],
    final: game.final,
    seed: gameSeed,
    mvp: top && who ? { side: winner, teamId: who.teamId, span: who.span, line: top.line } : null,
  };
}

/** The All-Star Game played again with its play-by-play. */
export function playLiveAllStarGame(asg: LiveAllStarGame): LiveGameResult {
  const teams = asg.sides.map((side, k) => {
    const roster = side.map((x) => x.span);
    return { id: `asg-${k}`, name: `Team ${side[0].span.playerName.split(' ').slice(-1)[0]}`, draftSlot: k + 1, isHuman: false, roster, rotation: allStarRotation(roster) } as Team;
  });
  return playPairingGame(prepareTeamPairing(teams[0], teams[1], 0, [null, null]), asg.seed, true);
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
      const line = lines.get(key) ?? { span, teamId: team.id, games: 0, totals: zero(), starter: starterIds.has(key), doubleDoubles: 0, tripleDoubles: 0 };
      line.games++;
      const tens = [box.pts, box.reb, box.ast, box.stl, box.blk].filter((v) => v >= 10).length;
      if (tens >= 2) line.doubleDoubles++;
      if (tens >= 3) line.tripleDoubles++;
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

function defenseTeams(pool: SeasonPlayerLine[], value: (l: SeasonPlayerLine) => number): SeasonPlayerLine[][] {
  const ranked = [...pool].sort((x, y) => value(y) - value(x));
  const taken = new Set<SeasonPlayerLine>();
  const perTeam = new Map<string, number>();
  // At most `perTeam` from one team over both teams (the user: "za dużo all-d z jednej drużyny").
  const take = (is: (l: SeasonPlayerLine) => boolean, n: number) => {
    const picked: SeasonPlayerLine[] = [];
    for (const l of ranked) {
      if (picked.length >= n) break;
      if (!is(l) || taken.has(l) || (perTeam.get(l.teamId) ?? 0) >= DEFENSE_AWARDS.perTeam) continue;
      picked.push(l);
      taken.add(l);
      perTeam.set(l.teamId, (perTeam.get(l.teamId) ?? 0) + 1);
    }
    return picked;
  };
  const any = () => true;
  if (DEFENSE_AWARDS.layout === 'none') return [take(any, 5), take(any, 5)];
  if (DEFENSE_AWARDS.layout === 'positions') return [0, 1].map(() => [...take(guard, 2), ...take(forward, 2), ...take(center, 1)]);
  return [0, 1].map(() => [...take(guard, 2), ...take((l) => !guard(l), 3)]);
}

/** The 24 All-Stars: every All-NBA player, then the best lines, with at least eight guards and eight
 * frontcourt players. */
const ALL_STARS = 24;
const ALL_STAR_MIN_PER_COURT = 8;
function allStarsFrom(pool: SeasonPlayerLine[], value: (l: SeasonPlayerLine) => number, sure: SeasonPlayerLine[]): SeasonPlayerLine[] {
  const ranked = [...pool].sort((x, y) => value(y) - value(x));
  const picked = new Set<SeasonPlayerLine>(sure);
  const fill = (is: (l: SeasonPlayerLine) => boolean, atLeast: number) => {
    for (const l of ranked) {
      if ([...picked].filter(is).length >= atLeast || picked.size >= ALL_STARS) break;
      if (is(l)) picked.add(l);
    }
  };
  fill(guard, ALL_STAR_MIN_PER_COURT);
  fill((l) => !guard(l), ALL_STAR_MIN_PER_COURT);
  fill(() => true, ALL_STARS);
  return ranked.filter((l) => picked.has(l));
}

/** Progress of a season or a playoff run being played: games played of the total. */
export interface SimProgress {
  played: number;
  total: number;
}

/** Plays a step-wise simulation to the end in one go. */
function runSteps<T>(steps: Generator<SimProgress, T>, onProgress?: (p: SimProgress) => void): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    onProgress?.(next.value);
  }
}

/**
 * The same, a slice at a time, handing the main thread back between slices so a page stays
 * responsive while a season plays (~4 s of work in ~30 ms slices). Rejects with an `AbortError` if
 * `signal` aborts.
 */
async function runStepsAsync<T>(steps: Generator<SimProgress, T>, onProgress?: (p: SimProgress) => void, signal?: AbortSignal): Promise<T> {
  const SLICE_MS = 30;
  let sliceStart = Date.now();
  for (;;) {
    if (signal?.aborted) throw new DOMException('Season simulation aborted', 'AbortError');
    const next = steps.next();
    if (next.done) return next.value;
    if (Date.now() - sliceStart >= SLICE_MS) {
      onProgress?.(next.value);
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }
}

export function simulateLiveSeason(teams: Team[], seed: string = seasonSeed(teams), onProgress?: (p: SimProgress) => void): LiveSeasonResult {
  return runSteps(seasonSteps(teams, seed), onProgress);
}

/** `simulateLiveSeason` without blocking the page — the same season for the same seed. */
export function simulateLiveSeasonAsync(teams: Team[], seed: string = seasonSeed(teams), onProgress?: (p: SimProgress) => void, signal?: AbortSignal): Promise<LiveSeasonResult> {
  return runStepsAsync(seasonSteps(teams, seed), onProgress, signal);
}

function* seasonSteps(teams: Team[], seed: string): Generator<SimProgress, LiveSeasonResult> {
  const cache = buildMatchupCache(teams);
  const weak = new Map(teams.map((t) => [t.id, teamWeakLink(t)]));
  const record = new Map(teams.map((t) => [t.id, { teamId: t.id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]));
  const teamSeasons = new Map<string, LiveTeamSeason>(teams.map((t) => [t.id, { teamId: t.id, games: 0, for: zero(), against: zero(), closeWins: 0, closeLosses: 0 }]));
  const lines = new Map<string, SeasonPlayerLine>();
  const starterIds = new Set(teams.flatMap((t) => primaryStarters(t).map((e) => `${t.id}|${e.player.id}`)));

  const schedule = seasonRounds(teams.length);
  const total = schedule.reduce((n, r) => n + r.length, 0);
  const asgAfterRound = Math.min(schedule.length - 1, Math.round(schedule.length * 0.66) - 1);
  const dates = seasonDates(schedule.length, asgAfterRound);
  const pairings = new Map<string, ReturnType<typeof prepareTeamPairing>>();
  const met = new Map<string, number>();
  const games: LiveSeasonGame[] = [];
  const snapshots: SeasonSnapshot[] = [];
  let allStarGame: LiveAllStarGame | null = null;
  const snapshot = (afterRound: number, label: string, kind: SeasonSnapshot['kind']) =>
    snapshots.push({ afterRound, label, kind, players: [...lines.values()].map((l) => ({ teamId: l.teamId, spanId: l.span.id, games: l.games, totals: { ...l.totals } })) });
  let played = 0;
  for (let round = 0; round < schedule.length; round++) {
    for (const [i, j] of schedule[round]) {
      const a = teams[i];
      const b = teams[j];
      const key = `${a.id}:${b.id}`;
      let pairing = pairings.get(key);
      if (!pairing) {
        const margin = projectMatchup(a, b, cache.get(a.id), cache.get(b.id), 'season').marginA;
        pairing = prepareTeamPairing(a, b, margin, [weak.get(a.id) ?? null, weak.get(b.id) ?? null]);
        pairings.set(key, pairing);
      }
      const g = met.get(key) ?? 0;
      met.set(key, g + 1);
      const gameSeed = `${seed}:${a.id}:${b.id}:${g}`;
      const game = playPairingGame(pairing, gameSeed, false);
      const [sa, sb] = game.final;
      games.push({ round, aId: a.id, bId: b.id, final: [sa, sb], top: [topLine(game, 0), topLine(game, 1)], seed: gameSeed });
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
      const ta = teamSeasons.get(a.id)!;
      const tb = teamSeasons.get(b.id)!;
      const boxA = sideTotals(game.box[0]);
      const boxB = sideTotals(game.box[1]);
      ta.games++;
      tb.games++;
      addTo(ta.for, boxA);
      addTo(ta.against, boxB);
      addTo(tb.for, boxB);
      addTo(tb.against, boxA);
      if (Math.abs(sa - sb) <= 5) {
        if (sa > sb) {
          ta.closeWins++;
          tb.closeLosses++;
        } else {
          tb.closeWins++;
          ta.closeLosses++;
        }
      }
      played++;
    }
    const month = dates[round].slice(5, 7);
    const sinceLast = round - (snapshots.length ? snapshots[snapshots.length - 1].afterRound : -1);
    if (round < schedule.length - 1 && dates[round + 1].slice(5, 7) !== month && sinceLast >= 8) {
      snapshot(round, new Date(`${dates[round]}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }), 'month');
    }
    if (round === asgAfterRound) {
      snapshot(round, 'All-Star break', 'asg');
      const winPctNow = new Map([...record.values()].map((r) => [r.teamId, r.wins / Math.max(1, r.wins + r.losses)]));
      const now = [...lines.values()].filter((l) => l.games >= (round + 1) * 0.7 && l.totals.min / l.games >= AWARD_MIN_MINUTES);
      const starValue = (l: SeasonPlayerLine) => gameScorePerGame(l) * (0.8 + 0.4 * (winPctNow.get(l.teamId) ?? 0));
      const nbaValue = (l: SeasonPlayerLine) => gameScorePerGame(l) * (winPctNow.get(l.teamId) ?? 0) ** 0.3;
      const stars = allStarsFrom(now, starValue, positionalTeams(now, nbaValue, 3).flat());
      const draft = allStarDraft(stars).map((side) => side.map(({ item, pick }) => ({ teamId: item.teamId, span: item.span, pick })));
      allStarGame = playAllStarGame(draft, seed);
    }
    yield { played, total };
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
  // 2026-10-10 (the user, after league D2S2 crowned Jokic from 9th place): the record squared, not
  // its square root — over 20 AI-league seasons the MVP's team ranks 1.15 on average (was 2.25),
  // never outside the top 8, and he gives up ~2.3 game score to the league's best line.
  const mvpValue = (l: SeasonPlayerLine) => gameScorePerGame(l) * (winPct.get(l.teamId) ?? 0) ** 2;
  // DPOY (2026-10-02, the user: "powinno oba"): his own defense AND his team's — D-TAL plus
  // stocks by his minutes, then the team's points allowed (`DEFENSE_AWARDS`).
  const defenseValue = (l: SeasonPlayerLine) => {
    const own = computeDefensiveTalent(l.span) + (2 * (l.totals.stl + l.totals.blk)) / l.games;
    const share = DEFENSE_AWARDS.fullMinutes > 0 ? Math.min(1, l.totals.min / l.games / DEFENSE_AWARDS.fullMinutes) : 1;
    return own * share - DEFENSE_AWARDS.perAllowed * ((pointsAllowed.get(l.teamId) ?? fewestAllowed) - fewestAllowed);
  };
  // All-NBA (the user: "troszkę mocniejszy ale bez przesady"): the record counts less than for the
  // MVP. All-Stars lean on the numbers more still: a star on a losing team goes.
  const allNbaValue = (l: SeasonPlayerLine) => gameScorePerGame(l) * (winPct.get(l.teamId) ?? 0) ** 0.3;
  const allStarValue = (l: SeasonPlayerLine) => gameScorePerGame(l) * (0.8 + 0.4 * (winPct.get(l.teamId) ?? 0));
  const mvp = best(eligible, mvpValue);
  // DPOY (2026-10-08, the user: "ograniczenie na SF/PF/C, głównie PF/C" — in an all-time league the
  // bigs own defense): forwards and centers only, a small forward `wingHandicap` behind.
  const dpoy = best(
    eligible.filter((l) => !guard(l)),
    (l) => defenseValue(l) - (l.span.primaryPosition === 'SF' ? DEFENSE_AWARDS.wingHandicap : 0),
  );
  // The MVP always makes the All-NBA first team, the DPOY the All-Defense first team.
  const first = (winner: SeasonPlayerLine | null, value: (l: SeasonPlayerLine) => number) => (l: SeasonPlayerLine) => (l === winner ? Infinity : value(l));
  const allNba = positionalTeams(eligible, first(mvp, allNbaValue), 3);
  return {
    standings,
    players,
    awards: {
      mvp,
      dpoy,
      sixthMan: best(eligible.filter((l) => !l.starter), gameScorePerGame),
      allNba,
      allDefense: defenseTeams(eligible, first(dpoy, defenseValue)),
      allStars: allStarsFrom(eligible, allStarValue, allNba.flat()),
    },
    teamSeasons: [...teamSeasons.values()],
    games,
    dates,
    asgAfterRound,
    snapshots,
    allStarGame,
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

/** A play-in game (2026-10-21, the season calendar): seeds 7 to 10, one game each. */
export interface LivePlayInGame {
  /** '7v8': the winner is the 7 seed. '9v10': the loser is out. 'last': for the 8 seed. */
  kind: '7v8' | '9v10' | 'last';
  teamAId: string;
  teamASeed: number;
  teamBId: string;
  teamBSeed: number;
  margin: number;
  seed: string;
  final: [number, number];
  winnerId: string;
}

export interface LivePlayoffResult {
  /** Seeds 7 to 10 before the bracket: 7v8, 9v10, then the 7v8 loser against the 9v10 winner. */
  playIn: LivePlayInGame[];
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
  return runSteps(playoffSteps(teams, standings, seed));
}

/** `simulateLivePlayoffs` without blocking the page. */
export function simulateLivePlayoffsAsync(teams: Team[], standings: LiveStandingsRow[], seed: string = seasonSeed(teams), signal?: AbortSignal): Promise<LivePlayoffResult | null> {
  return runStepsAsync(playoffSteps(teams, standings, seed), undefined, signal);
}

/** At most 7 games in each of 7 series. */
const PLAYOFF_MAX_GAMES = 49;

function* playoffSteps(teams: Team[], standings: LiveStandingsRow[], seed: string): Generator<SimProgress, LivePlayoffResult | null> {
  if (teams.length !== TEAM_COUNT || standings.length !== TEAM_COUNT) return null;
  let playedGames = 0;
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const cache = buildMatchupCache(teams);
  const starterIds = new Set(teams.flatMap((t) => primaryStarters(t).map((e) => `${t.id}|${e.player.id}`)));
  const lines = new Map<string, SeasonPlayerLine>();
  // The play-in: 7 v 8 for the 7 seed, 9 v 10 to stay alive, then the 7v8 loser and the 9v10
  // winner for the 8 seed. Single games on the playoff margin, the higher seed as team A.
  const playIn: LivePlayInGame[] = [];
  const playInGame = (kind: LivePlayInGame['kind'], a: { id: string; seed: number }, b: { id: string; seed: number }) => {
    const ta = teamById.get(a.id)!;
    const tb = teamById.get(b.id)!;
    const margin = projectMatchup(ta, tb, cache.get(ta.id), cache.get(tb.id), 'playoffs').marginA;
    const gameSeed = `${seed}:playin:${kind}`;
    const game = playPairingGame(prepareTeamPairing(ta, tb, margin), gameSeed, false);
    const g: LivePlayInGame = { kind, teamAId: a.id, teamASeed: a.seed, teamBId: b.id, teamBSeed: b.seed, margin, seed: gameSeed, final: game.final, winnerId: game.final[0] > game.final[1] ? a.id : b.id };
    playIn.push(g);
    return g;
  };
  const seedRow = (n: number) => ({ id: standings[n - 1].teamId, seed: n });
  const g78 = playInGame('7v8', seedRow(7), seedRow(8));
  const g910 = playInGame('9v10', seedRow(9), seedRow(10));
  const loser78 = g78.winnerId === g78.teamAId ? seedRow(8) : seedRow(7);
  const winner910 = g910.winnerId === g910.teamAId ? seedRow(9) : seedRow(10);
  const gLast = playInGame('last', loser78, winner910);
  const seedOf = (n: number) => (n === 7 ? g78.winnerId : n === 8 ? gLast.winnerId : standings[n - 1].teamId);
  let current = PLAYOFF_SEED_ORDER.map((s) => ({ id: seedOf(s), seed: s }));
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
        yield { played: ++playedGames, total: PLAYOFF_MAX_GAMES };
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
  return { playIn, rounds, championId, players: [...lines.values()], finalsMvp };
}

/** A regular-season game played again with its play-by-play — the same game the season counted. */
export function playLiveSeasonGame(teams: Team[], game: LiveSeasonGame): LiveGameResult | null {
  const a = teams.find((t) => t.id === game.aId);
  const b = teams.find((t) => t.id === game.bId);
  if (!a || !b) return null;
  const cache = buildMatchupCache([a, b]);
  const margin = projectMatchup(a, b, cache.get(a.id), cache.get(b.id), 'season').marginA;
  return playPairingGame(prepareTeamPairing(a, b, margin, [teamWeakLink(a), teamWeakLink(b)]), game.seed, true);
}

/** The MVP race's number: game score per game on a winning team, the record squared (as the award). */
export function mvpRaceValue(gameScore: number, winPct: number): number {
  return gameScore * winPct ** 2;
}

/** A play-in game played again with its play-by-play. */
export function playLivePlayInGame(teams: Team[], game: LivePlayInGame): LiveGameResult | null {
  const a = teams.find((t) => t.id === game.teamAId);
  const b = teams.find((t) => t.id === game.teamBId);
  if (!a || !b) return null;
  return playPairingGame(prepareTeamPairing(a, b, game.margin), game.seed, true);
}

/** One playoff game played again with its play-by-play — the same game the bracket counted. */
export function playLivePlayoffGame(teams: Team[], series: LivePlayoffSeries, gameIndex: number): LiveGameResult | null {
  const a = teams.find((t) => t.id === series.teamAId);
  const b = teams.find((t) => t.id === series.teamBId);
  const game = series.games[gameIndex];
  if (!a || !b || !game) return null;
  return playPairingGame(prepareTeamPairing(a, b, series.margin), game.seed, true);
}
