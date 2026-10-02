import type { PlayerSpan, Position } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { STARTER_SLOTS } from './positions';
import { mulberry32, hashSeed } from './rng';
import { gameWinProbability, projectMatchup } from './matchup';
import { lineupTeam, scoreLineup, type Lineup } from './bestFive';
import type { LegendFive } from './dailyMeta';
import type { Team } from './types';
import { contextLines } from './contextStats';
import { estimatedMinutesPerGame } from './minutesPerGame';

/**
 * 2026-09-28, the user (Daily Slot Machine 2.0: "możemy zrobić symulacje live? Z statystami"):
 * after the daily five is picked it plays the opponent of the day, possession by possession.
 *
 * Who wins and by how much is the engine's call, not the dice's: `projectMatchup` — the model the
 * season simulation uses (net rating, the team score with its fit/spacing/defense, and the other
 * side hunting your weakest defender) — gives the expected margin, and the possessions are tilted
 * so that is where the game lands on average. The legends play at the level of the day's fan-vote
 * five: the model margin used is yours against them minus the fan-vote five's against them, so
 * beating them means out-building the five biggest names, with this opponent's own matchup on top.
 *
 * The possessions themselves come from each player's box score: who shoots by his shots per game,
 * threes by his three-point rate, makes by his FG% / 3P%, free throws by his FT%, rebounds, assists,
 * steals and blocks by his per-game rates. Same five, same day — same game, every time.
 */

export type GameSide = 0 | 1;

export interface BoxLineStats {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  /** 2026-10-02, the user: "powinien być cały box score" — threes, free throws and turnovers. */
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  tov: number;
  /** Minutes played (2026-10-02: full teams play their rotation). */
  min: number;
}

export interface GamePlay {
  side: GameSide;
  text: string;
  /** Your Joker made the play. */
  joker: boolean;
  /** A dead ball worth nothing on the feed (0/2 at the line). */
  quiet: boolean;
}

export interface GameMoment {
  /** Game clock, seconds left in regulation. */
  left: number;
  quarter: number;
  score: [number, number];
  play: GamePlay | null;
  /** Each player's line so far, in `labels` order. */
  lines: [BoxLineStats[], BoxLineStats[]];
}

export interface LiveGameResult {
  moments: GameMoment[];
  final: [number, number];
  quarters: [number[], number[]];
  box: [Record<string, BoxLineStats>, Record<string, BoxLineStats>];
  /** Expected margin from the model, your side's view. */
  expectedMargin: number;
  players: [PlayerSpan[], PlayerSpan[]];
  /** Box-score names, PG→C (last names, full names where two share one). */
  labels: [string[], string[]];
  /** Your Joker's box-score name, if he played. */
  jokerLabel: string | null;
  /** Your best line of the night (points + rebounds + assists). */
  star: { name: string; line: BoxLineStats };
  /** One sentence on why it went the way it did. */
  recap: string;
}

/** The legends' spans: each player's stretch that ends nearest the season they're from. */
export function legendLineup(legend: LegendFive): Lineup | null {
  const lineup: Lineup = {};
  for (const [i, slot] of STARTER_SLOTS.entries()) {
    const name = legend.players[i];
    const spans = draftPool.filter((s) => s.playerName === name);
    if (spans.length === 0) return null;
    const endOf = (s: PlayerSpan) => Number(s.spanLabel.slice(0, 4)) + 2;
    lineup[slot] = [...spans].sort((a, b) => Math.abs(endOf(a) - legend.endYear) - Math.abs(endOf(b) - legend.endYear))[0];
  }
  return lineup;
}

/** The model's expected margin for `yours` against the legends, measured from the fan-vote five. */
export function expectedMargin(yours: Lineup, fanVote: Lineup, legends: Lineup): number {
  const them = lineupTeam(legends);
  const m = projectMatchup(lineupTeam(yours), them).marginA - projectMatchup(lineupTeam(fanVote), them).marginA;
  // The fan-vote five itself is a slight underdog: matching it is not quite enough.
  return Math.max(-25, Math.min(25, m - 1));
}

/** 2026-09-30, Draw Five vs the AI: the model's margin for one five against another, straight. */
export function headToHeadMargin(yours: Lineup, theirs: Lineup): number {
  return Math.max(-25, Math.min(25, projectMatchup(lineupTeam(yours), lineupTeam(theirs)).marginA));
}

const POSSESSIONS = 200;
const GAME_SECONDS = 48 * 60;
const TURNOVER = 0.12;
/**
 * 2026-10-02: each shooter draws fouls at his own real rate. A trip is ~2.1 free throws and an
 * and-one adds ~0.02 per shot, so a free-throw rate r (FTA per FGA) comes from a foul on a share
 * f = (r - 0.02) / (2.1 + r - 0.02) of his shots.
 */
function foulChance(freeThrowRate: number): number {
  return Math.max(0.02, Math.min(0.3, (freeThrowRate - 0.02) / (2.1 + freeThrowRate - 0.02)));
}
const AND_ONE = 0.05;
const OFF_REBOUND = 0.26;
/**
 * 2026-10-02, the user (Kawhi at half his real assists beside Jokic: "grał w dzielących się piłką
 * Spurs"): a five of good passers makes MORE assists, not the same number split thinner. The chance
 * a make was assisted follows the four teammates' combined assist rate (per 36) against a typical
 * four's, and the passer is then picked in plain proportion to his own rate.
 */
const ASSISTED = 0.55;
const TYPICAL_MATES_ASSISTS_PER_36 = 14;
const ASSISTED_RATE_POWER = 0.6;
function assistedChance(mates: CourtPlayer[]): number {
  const passing = mates.reduce((sum, c) => sum + rates(c.player.span).ast, 0);
  return Math.max(0.4, Math.min(0.85, ASSISTED * (passing / TYPICAL_MATES_ASSISTS_PER_36) ** ASSISTED_RATE_POWER));
}
/** Assists go to the real passers: weight by assists per game to this power (2026-10-02 — linear
 * weights spread them so evenly that Jokic averaged 5 and the league leader 9). */
/** Rebounds concentrate on the real rebounders a little more than their rates alone. */
const REBOUND_WEIGHT_POWER = 1.1;
/**
 * 2026-10-02, the user's season exports: who rebounds, assists, steals and blocks is weighted by
 * his rate PER MINUTE, not per game — a backup big's real rebounds came in fewer minutes (Gobert
 * 3.6 boards in 14 minutes), and a starter's per-game totals over-weighed him against a bench
 * player. One named exception for assists: "żaden inny C w historii aż tak nie rozgrywał" — Jokic.
 */
const PASSING_HUBS: Record<string, number> = { 'Nikola Jokic': 2 };
const rateCache = new WeakMap<PlayerSpan, { reb: number; ast: number; stl: number; blk: number }>();
function rates(span: PlayerSpan) {
  let r = rateCache.get(span);
  if (!r) {
    const k = 36 / (estimatedMinutesPerGame(span) ?? 36);
    r = { reb: span.box.rpg * k, ast: span.box.apg * k * (PASSING_HUBS[span.playerName] ?? 1), stl: span.box.spg * k, blk: span.box.bpg * k };
    rateCache.set(span, r);
  }
  return r;
}
// 2026-10-02: 0.07 gave a whole team ~1.8 blocks a game (an all-time season's leader 1.0); real
// teams block ~5, on roughly a sixth of their opponents' missed twos.
const BLOCKED = 0.17;
/** Make-probability tilt per point of expected margin (calibrated in scripts/testLiveGame.ts). */
/** Scoring chances a team gets in a game (possessions after turnovers, plus offensive rebounds) —
 * turns the engine's margin into a per-shot gap. */
const SHOTS_PER_TEAM = 98;
/** Largest share by which a team's shooting is nudged toward the engine's margin. */
const MAX_NUDGE = 0.3;
/** A usage-driven change in true shooting moves three-point accuracy about two-thirds as much. */
const THREE_PCT_PER_TS = 0.67;

const BIG_MOVES = ['layup', 'dunk', 'hook shot', 'putback'];
const WING_MOVES = ['pull-up jumper', 'driving layup', 'floater', 'mid-range jumper'];
const GUARD_MOVES = ['pull-up jumper', 'floater', 'drive to the rim', 'step-back jumper'];
function movesFor(slot: Position): string[] {
  if (slot === 'C' || slot === 'PF') return BIG_MOVES;
  return slot === 'PG' ? GUARD_MOVES : WING_MOVES;
}

function lastName(name: string): string {
  const parts = name.split(' ');
  const last = parts[parts.length - 1];
  return /^(Jr\.?|Sr\.?|II|III|IV)$/.test(last) && parts.length > 2 ? parts[parts.length - 2] : last;
}

function pickWeighted<T>(rng: () => number, items: T[], weight: (t: T) => number): T {
  const total = items.reduce((sum, t) => sum + weight(t), 0);
  let x = rng() * total;
  for (const t of items) {
    x -= weight(t);
    if (x <= 0) return t;
  }
  return items[items.length - 1];
}

function twoPointPct(s: PlayerSpan): number {
  const b = s.box;
  const threeA = Math.min(b.threePA, s.fga * 0.9);
  const twoA = s.fga - threeA;
  if (twoA <= 0.5) return 0.45;
  return Math.max(0.35, Math.min(0.68, (s.fga * b.fgPct - threeA * b.threePct) / twoA));
}

interface Player {
  span: PlayerSpan;
  slot: Position;
  label: string;
  joker: boolean;
}

/**
 * 2026-09-30, the user ("zrobiłem najlepszą piątkę i przegrałem, słaby user experience"; chose A + B):
 * a clear favourite — this many points or more by the model — always wins; the game only goes
 * either way when it's close. `upset` marks a close game the favourite lost.
 */
export const CLEAR_FAVOURITE = 5;

/** The model's call before tip-off: the favourite's win chance, or "clear" when it can't be lost. */
export function pregameOdds(margin: number): { you: number; clear: boolean } {
  if (Math.abs(margin) >= CLEAR_FAVOURITE) return { you: margin > 0 ? 1 : 0, clear: true };
  return { you: gameWinProbability(margin), clear: false };
}

export function simulateLiveGame(
  yours: Lineup,
  legends: Lineup,
  margin: number,
  seed: string,
  jokerId?: string,
): LiveGameResult {
  // Deterministic retakes: the first game of the seed whose winner agrees with a clear favourite.
  let game = playGame(yours, legends, margin, seed, jokerId);
  for (let take = 1; take < 40 && Math.abs(margin) >= CLEAR_FAVOURITE && game.final[0] > game.final[1] !== margin > 0; take++) {
    game = playGame(yours, legends, margin, `${seed}~${take}`, jokerId);
  }
  return game;
}

interface CourtPlayer {
  player: Player;
  /** Share of his shots that draw a shooting foul. */
  foul: number;
  /** His share of this five's shots and his percentages, re-read for this five (`contextStats.ts`). */
  shotShare: number;
  twoPct: number;
  threePct: number;
}

interface GameRoster {
  players: Player[];
  /** Minutes each player is due at each slot (a five: 48 at his own slot). */
  slotMinutes: Record<Position, { player: Player; minutes: number }[]>;
  starters: Lineup;
}

function labelPlayers(spans: { span: PlayerSpan; slot: Position }[], joker: (s: PlayerSpan) => boolean): Player[] {
  const names = new Map<string, number>();
  for (const { span } of spans) names.set(lastName(span.playerName), (names.get(lastName(span.playerName)) ?? 0) + 1);
  return spans.map(({ span, slot }) => ({
    span,
    slot,
    label: (names.get(lastName(span.playerName)) ?? 0) > 1 ? span.playerName : lastName(span.playerName),
    joker: joker(span),
  }));
}

function rosterFromFive(five: Lineup, joker: (s: PlayerSpan) => boolean): GameRoster {
  const players = labelPlayers(STARTER_SLOTS.map((slot) => ({ span: five[slot]!, slot })), joker);
  const slotMinutes = {} as GameRoster['slotMinutes'];
  STARTER_SLOTS.forEach((slot, i) => (slotMinutes[slot] = [{ player: players[i], minutes: 48 }]));
  return { players, slotMinutes, starters: five };
}

/** 2026-10-02, stage 2: a full team plays its rotation — each slot's minutes as the engine set them. */
function rosterFromTeam(team: Team): GameRoster {
  const byId = new Map(team.roster.map((span) => [span.id, span]));
  const order: { span: PlayerSpan; slot: Position }[] = [];
  const seen = new Set<string>();
  for (const slot of STARTER_SLOTS) {
    for (const a of team.rotation?.slots[slot] ?? []) {
      const span = byId.get(a.playerId);
      if (span && !seen.has(span.id)) {
        seen.add(span.id);
        order.push({ span, slot });
      }
    }
  }
  const players = labelPlayers(order, () => false);
  const playerById = new Map(players.map((p) => [p.span.id, p]));
  const slotMinutes = {} as GameRoster['slotMinutes'];
  const starters: Lineup = {};
  for (const slot of STARTER_SLOTS) {
    slotMinutes[slot] = (team.rotation?.slots[slot] ?? [])
      .filter((a) => a.minutes > 0 && playerById.has(a.playerId))
      .map((a) => ({ player: playerById.get(a.playerId)!, minutes: a.minutes }));
    if (slotMinutes[slot][0]) starters[slot] = slotMinutes[slot][0].player.span;
  }
  return { players, slotMinutes, starters };
}

/** Substitutions: before each possession every slot keeps its man unless another is clearly more
 * due (more of his minutes left, by `SUB_MARGIN`); nobody plays two slots at once, and the
 * starters open the game. Each player ends close to the minutes the rotation gave him. */
const SUB_MARGIN = 2;

class Bench {
  private roster: GameRoster;
  private left: Map<Position, Map<Player, number>>;
  private court = new Map<Position, Player>();
  constructor(roster: GameRoster) {
    this.roster = roster;
    this.left = new Map(STARTER_SLOTS.map((slot) => [slot, new Map(roster.slotMinutes[slot].map((e) => [e.player, e.minutes]))]));
  }
  next(minutes: number): Player[] {
    const taken = new Set<Player>();
    const five: Player[] = [];
    for (const slot of STARTER_SLOTS) {
      const left = this.left.get(slot)!;
      const current = this.court.get(slot);
      let best: Player | undefined;
      let bestLeft = -Infinity;
      for (const [player, remaining] of left) {
        if (taken.has(player)) continue;
        if (remaining > bestLeft) {
          best = player;
          bestLeft = remaining;
        }
      }
      let pick = best;
      if (current && !taken.has(current) && (left.get(current) ?? 0) > 0 && bestLeft - (left.get(current) ?? 0) < SUB_MARGIN) pick = current;
      if (!pick) pick = this.roster.players.find((p) => !taken.has(p));
      if (!pick) continue;
      taken.add(pick);
      five.push(pick);
      this.court.set(slot, pick);
      if (left.has(pick)) left.set(pick, (left.get(pick) ?? 0) - minutes);
    }
    return five;
  }
}

function courtFor(cache: Map<string, CourtPlayer[]>, five: Player[]): CourtPlayer[] {
  const key = five.map((p) => p.span.id).join('|');
  let court = cache.get(key);
  if (!court) {
    const lines = contextLines(five.map((p) => p.span));
    court = five.map((player, i) => ({
      player,
      shotShare: lines[i].shotWeight,
      foul: foulChance(lines[i].freeThrowRate),
      twoPct: Math.max(0.3, Math.min(0.72, twoPointPct(player.span) + lines[i].twoPointDelta + lines[i].usageDelta)),
      threePct: Math.max(0.15, Math.min(0.5, player.span.box.threePct + lines[i].usageDelta * THREE_PCT_PER_TS)),
    }));
    cache.set(key, court);
  }
  return court;
}

function playGame(
  yours: Lineup,
  legends: Lineup,
  margin: number,
  seed: string,
  jokerId?: string,
): LiveGameResult {
  return playRosters([rosterFromFive(yours, (s) => s.id === jokerId), rosterFromFive(legends, () => false)], margin, seed, true);
}

/**
 * 2026-10-02, stage 2 (season on the live engine): two full teams play their rotations. No
 * clear-favourite retakes — upsets happen. `record: false` skips the play-by-play (a season plays
 * hundreds of these).
 */
export function playTeamGame(
  a: Team,
  b: Team,
  margin: number,
  seed: string,
  /** `weakLinks`: each team's weakest defender (`teamWeakLink`), precomputed — a season reuses it. */
  options: { record?: boolean; weakLinks?: [string | null, string | null] } = {},
): LiveGameResult {
  return playRosters([rosterFromTeam(a), rosterFromTeam(b)], margin, seed, options.record ?? true, options.weakLinks);
}

/** The starting five's weakest defender, the man the other side hunts. */
export function teamWeakLink(team: Team): string | null {
  return scoreLineup(rosterFromTeam(team).starters).weakLink;
}

const emptyLine = (): BoxLineStats => ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, min: 0 });

function playRosters(
  rosters: [GameRoster, GameRoster],
  margin: number,
  seed: string,
  record: boolean,
  weakLinks?: [string | null, string | null],
): LiveGameResult {
  const rng = mulberry32(hashSeed(`${seed}:game`));
  const courts = [new Map<string, CourtPlayer[]>(), new Map<string, CourtPlayer[]>()];
  const starterFive = (r: GameRoster) => STARTER_SLOTS.map((slot) => r.slotMinutes[slot][0]?.player).filter((p): p is Player => Boolean(p));
  const starting = [courtFor(courts[0], starterFive(rosters[0])), courtFor(courts[1], starterFive(rosters[1]))];
  const possessionMinutes = GAME_SECONDS / POSSESSIONS / 60;
  // The substitutions are deterministic, so the whole game's fives are known before tip-off.
  const benches = [new Bench(rosters[0]), new Bench(rosters[1])];
  const schedule: [CourtPlayer[][], CourtPlayer[][]] = [[], []];
  for (let k = 0; k < POSSESSIONS; k++) for (const side of [0, 1] as GameSide[]) schedule[side].push(courtFor(courts[side], benches[side].next(possessionMinutes)));
  const perShot = (team: CourtPlayer[]) => {
    const shots = team.reduce((sum, c) => sum + c.shotShare, 0) || 1;
    let field = 0;
    let line = 0;
    for (const c of team) {
      const b = c.player.span.box;
      const r3 = Math.min(0.9, b.threePA / Math.max(1, c.player.span.fga));
      field += (c.shotShare / shots) * (1 - c.foul) * (r3 * 3 * c.threePct + (1 - r3) * 2 * c.twoPct * (1 + (AND_ONE * b.ftPct) / 2));
      line += (c.shotShare / shots) * c.foul * (r3 * 3 + (1 - r3) * 2) * b.ftPct;
    }
    return { field, line };
  };
  // 2026-10-02, the user's season export (good defenses finishing far above the engine's projection,
  // Korver at 56% from three): the old version levelled both teams to one shooting level off the
  // starting fives and tilted from there, which bent every player's percentages and left the bench
  // out. Now each team keeps its own shooting — every five of the whole game, bench included — and
  // only the GAP is nudged to the engine's margin: the smallest change that makes the average game
  // land where the model says.
  const natural = ([0, 1] as GameSide[]).map((side) => {
    let field = 0;
    let line = 0;
    let n = 0;
    schedule[side].forEach((court, k) => {
      if (k % 2 !== side) return;
      const e = perShot(court);
      field += e.field;
      line += e.line;
      n++;
    });
    return { field: field / Math.max(1, n), line: line / Math.max(1, n) };
  });
  const gap = natural[0].field + natural[0].line - natural[1].field - natural[1].line;
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, (margin / SHOTS_PER_TEAM - gap) / (natural[0].field + natural[1].field)));
  const makeScale: [number, number] = [1 + nudge, 1 - nudge];
  const box: [Record<string, BoxLineStats>, Record<string, BoxLineStats>] = [{}, {}];
  for (const side of [0, 1] as GameSide[]) for (const p of rosters[side].players) box[side][p.label] = emptyLine();
  const hunted = weakLinks ? [weakLinks[1], weakLinks[0]] : [scoreLineup(rosters[1].starters).weakLink, scoreLineup(rosters[0].starters).weakLink];
  const score: [number, number] = [0, 0];
  const quarters: [number[], number[]] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const moments: GameMoment[] = [];
  const snapshot = (): [BoxLineStats[], BoxLineStats[]] => [
    rosters[0].players.map((p) => ({ ...box[0][p.label] })),
    rosters[1].players.map((p) => ({ ...box[1][p.label] })),
  ];
  let lastCourt: [CourtPlayer[], CourtPlayer[]] = [starting[0], starting[1]];

  for (let k = 0; k < POSSESSIONS; k++) {
    const both: [CourtPlayer[], CourtPlayer[]] = [schedule[0][k], schedule[1][k]];
    lastCourt = both;
    for (const side of [0, 1] as GameSide[]) for (const c of both[side]) box[side][c.player.label].min += possessionMinutes;
    const o = (k % 2) as GameSide;
    const d = (1 - o) as GameSide;
    const off = both[o];
    const def = both[d].map((c) => c.player);
    const quarter = Math.min(3, Math.floor((k * 4) / POSSESSIONS));
    let play: GamePlay | null = null;
    let pts = 0;
    for (let guard = 0; guard < 4; guard++) {
      if (rng() < TURNOVER) {
        if (rng() < 0.55) {
          const thief = pickWeighted(rng, def, (p) => rates(p.span).stl + 0.2);
          const lost = pickWeighted(rng, off, (c) => c.shotShare).player;
          box[d][thief.label].stl++;
          box[o][lost.label].tov++;
          play = { side: d, text: `${thief.label} steals it from ${lost.label}`, joker: thief.joker, quiet: false };
        } else {
          box[o][pickWeighted(rng, off, (c) => c.shotShare + rates(c.player.span).ast / 40).player.label].tov++;
        }
        break;
      }
      const shot = pickWeighted(rng, off, (c) => c.shotShare);
      const shooter = shot.player;
      const line = box[o][shooter.label];
      const b = shooter.span.box;
      const three = rng() < Math.min(0.9, b.threePA / Math.max(1, shooter.span.fga));
      if (rng() < shot.foul) {
        const attempts = three ? 3 : 2;
        let made = 0;
        for (let f = 0; f < attempts; f++) if (rng() < b.ftPct) made++;
        line.fta += attempts;
        line.ftm += made;
        line.pts += made;
        pts += made;
        play = { side: o, text: `${shooter.label} ${made}/${attempts} at the line`, joker: shooter.joker, quiet: made === 0 };
        break;
      }
      line.fga++;
      if (three) line.tpa++;
      const p = (three ? shot.threePct : shot.twoPct) * makeScale[o];
      if (rng() < p) {
        const value = three ? 3 : 2;
        line.fgm++;
        if (three) line.tpm++;
        line.pts += value;
        pts += value;
        const moves = movesFor(shooter.slot);
        let text = three ? `${shooter.label} ${rng() < 0.3 ? 'corner three' : 'three'}` : `${shooter.label} ${moves[Math.floor(rng() * moves.length)]}`;
        // The engine's weakest defender on the other side gets hunted — shown, not just scored.
        const target = hunted[o];
        if (!three && target && rng() < 0.25) {
          const victim = def.find((x) => x.span.playerName === target);
          if (victim && victim.label !== shooter.label) text = `${shooter.label} attacks ${victim.label} — ${moves[Math.floor(rng() * moves.length)]}`;
        }
        if (!three && rng() < AND_ONE) {
          line.fta++;
          if (rng() < b.ftPct) {
            line.ftm++;
            line.pts++;
            pts++;
            text += ', and one';
          }
        }
        let joker = shooter.joker;
        const mates = off.filter((x) => x.player !== shooter);
        if (rng() < assistedChance(mates)) {
          const passer = pickWeighted(rng, mates, (x) => rates(x.player.span).ast + 0.3).player;
          box[o][passer.label].ast++;
          text += ` (${passer.label} assist)`;
          joker = joker || passer.joker;
        }
        play = { side: o, text, joker, quiet: false };
        break;
      }
      if (!three && rng() < BLOCKED) {
        const blocker = pickWeighted(rng, def, (x) => rates(x.span).blk + 0.05);
        box[d][blocker.label].blk++;
        play = { side: d, text: `${blocker.label} blocks ${shooter.label}`, joker: blocker.joker, quiet: false };
      }
      if (rng() < OFF_REBOUND) {
        box[o][pickWeighted(rng, off, (x) => rates(x.player.span).reb ** REBOUND_WEIGHT_POWER).player.label].reb++;
        continue;
      }
      box[d][pickWeighted(rng, def, (x) => rates(x.span).reb ** REBOUND_WEIGHT_POWER).label].reb++;
      break;
    }
    score[o] += pts;
    quarters[o][quarter] += pts;
    if (record) moments.push({ left: Math.max(0, GAME_SECONDS - ((k + 1) * GAME_SECONDS) / POSSESSIONS), quarter, score: [score[0], score[1]], play, lines: snapshot() });
  }
  // Overtime would need more possessions; a tie goes to whoever the model favours, on a last shot.
  if (score[0] === score[1]) {
    const o: GameSide = margin >= 0 ? 0 : 1;
    const shooter = pickWeighted(rng, lastCourt[o], (c) => c.shotShare).player;
    box[o][shooter.label].pts += 2;
    box[o][shooter.label].fgm++;
    box[o][shooter.label].fga++;
    score[o] += 2;
    quarters[o][3] += 2;
    if (record)
      moments.push({
        left: 0,
        quarter: 3,
        score: [score[0], score[1]],
        play: { side: o, text: `${shooter.label} at the buzzer — game winner`, joker: shooter.joker, quiet: false },
        lines: snapshot(),
      });
  }
  for (const side of [0, 1] as GameSide[]) for (const p of rosters[side].players) box[side][p.label].min = Math.round(box[side][p.label].min);

  const mine = rosters[0].players;
  const starOf = mine.reduce((best, p) => {
    const l = box[0][p.label];
    const bl = box[0][best.label];
    return l.pts + l.reb + l.ast > bl.pts + bl.reb + bl.ast ? p : best;
  }, mine[0]);
  const star = { name: starOf.label, line: box[0][starOf.label] };
  const won = score[0] > score[1];
  const labelOf = (side: GameSide, name: string) => rosters[side].players.find((p) => p.span.playerName === name)?.label ?? name;
  const recap = won
    ? hunted[0]
      ? `${star.name} led the way, and your five kept going at ${labelOf(1, hunted[0])} on defense.`
      : `${star.name} led the way — the five played like one.`
    : hunted[1]
      ? `They kept hunting ${labelOf(0, hunted[1])} on defense, and it cost you.`
      : `They were the better team tonight — ${star.name} did what he could.`;
  return {
    moments,
    final: [score[0], score[1]],
    quarters,
    box,
    expectedMargin: margin,
    players: [rosters[0].players.map((p) => p.span), rosters[1].players.map((p) => p.span)],
    labels: [rosters[0].players.map((p) => p.label), rosters[1].players.map((p) => p.label)],
    jokerLabel: mine.find((p) => p.joker)?.label ?? null,
    star,
    recap,
  };
}
