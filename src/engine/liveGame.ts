import type { PlayerSpan, Position } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { STARTER_SLOTS } from './positions';
import { mulberry32, hashSeed } from './rng';
import { gameWinProbability, projectMatchup } from './matchup';
import { lineupTeam, scoreLineup, type Lineup } from './bestFive';
import type { LegendFive } from './dailyMeta';
import type { Team } from './types';
import { contextLines } from './contextStats';
import { modernBox } from './modernBox';
import { fatigueShare } from './fatigue';
import { estimatedMinutesPerGame } from './minutesPerGame';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { computeOffensiveTalent } from './talent';
import { rimPressureTeam } from './rimPressure';
import { fiveSwitchability } from './fit';
import { buildSelfCreationYearMap, measuredSelfCreationForSpan } from './selfCreationLookup';
import { assignMatchups, defenderProfile, fiveDefense, REFERENCE, type DefenderProfile, type FiveDefense } from './liveDefense';

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
  /** Personal fouls (2026-10-07: fouls are the defender's, and six send him to the bench). */
  pf: number;
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
/** Assists go to the real passers: weight by assists per 36 to this power (2026-10-02 — linear
 * weights spread them so evenly that Jokic averaged 5 and the league leader 9). How many makes are
 * assisted at all follows from the set-up shots (`SETUP_TUNING`). */
const PASSER_POWER = 1.3;
/** Rebounds concentrate on the real rebounders a little more than their rates alone. */
const REBOUND_WEIGHT_POWER = 1.1;
/** Offensive share of rebounds off a missed last free throw. */
const FT_OFF_REBOUND = 0.14;
/**
 * 2026-10-02, the user's season exports: who rebounds, assists, steals and blocks is weighted by
 * his rate PER MINUTE, not per game — a backup big's real rebounds came in fewer minutes (Gobert
 * 3.6 boards in 14 minutes), and a starter's per-game totals over-weighed him against a bench
 * player. One named exception for assists: "żaden inny C w historii aż tak nie rozgrywał" — Jokic.
 */
const PASSING_HUBS: Record<string, number> = { 'Nikola Jokic': 1.7 };
const rateCache = new WeakMap<PlayerSpan, { reb: number; ast: number; stl: number; blk: number }>();
function rates(span: PlayerSpan) {
  let r = rateCache.get(span);
  if (!r) {
    const k = 36 / (estimatedMinutesPerGame(span) ?? 36);
    const m = modernBox(span);
    r = { reb: m.rpg * k, ast: m.apg * k * (PASSING_HUBS[span.playerName] ?? 1), stl: m.spg * k, blk: m.bpg * k };
    rateCache.set(span, r);
  }
  return r;
}
/** Largest share by which a team's shooting is nudged toward the engine's margin. */
const MAX_NUDGE = 0.3;
/** A usage-driven change in true shooting moves three-point accuracy about two-thirds as much. */
const THREE_PCT_PER_TS = 0.67;
/**
 * 2026-10-02, the user (Jordan 37.8 a game beside Lowry, Bosh and Kareem — "czy powinien tyle
 * rzucać?"): a smaller share of the ball and better passers each lift a player, and together they
 * lifted a whole five of stars to 63-67% TS. Their sum is held to this many points of FG%.
 */
const MAX_CONTEXT_GAIN = 0.02;
const contextGain = (delta: number) => Math.min(MAX_CONTEXT_GAIN, delta);
/** 2026-10-02, the user (Jordan beside four shooters and beside four non-shooters came out within a
 * point of each other): the cap above was meant for the stacking of usage and passing, and it was
 * swallowing the room a five gives. Room has its own, wider bounds, both ways. */
const MAX_SPACING_GAIN = 0.04;
const spacingGain = (delta: number) => Math.max(-MAX_SPACING_GAIN, Math.min(MAX_SPACING_GAIN, delta));
/** A tired player makes fewer shots (`fatigue.ts`, the same curve the minute solver prices). */
const fatigue = (minutes: number) => 1 - fatigueShare(minutes);

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

/** His two-point % in today's game (`modernBox.ts`). */
function twoPointPct(s: PlayerSpan): number {
  return Math.max(0.35, Math.min(0.68, modernBox(s).twoPct));
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
  /** His share of this five's turnovers: the part of his usage that ends in one (`contextStats.ts`). */
  turnoverShare: number;
  twoPct: number;
  threePct: number;
  /** His two-pointers split by where they come from: share at the rim, and the make rate there and
   * from mid-range (the two average back to `twoPct`). */
  rimShare: number;
  rimPct: number;
  midPct: number;
  /** His three-point attempts per shot. */
  threeRate: number;
  /** His share of the five's plays (who the defense guards first). */
  usage: number;
  /** Share of his twos and threes set up by a pass in this five (`setupHere`), and how much better
   * those go in than his own (`setupEdge`). */
  setup2: number;
  setup3: number;
  edge2: number;
  edge3: number;
  /** His share of unassisted makes — who takes the shot when the clock runs out. */
  ownShare: number;
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

/** Substitutions: before each possession the five is chosen as a whole. Each man in each slot is
 * "due" by how far he is behind an even pace through his minutes there (planned x elapsed share,
 * minus what he has played); the man already on the floor counts `SUB_MARGIN` minutes extra, nobody
 * plays two slots at once, and a man past his minutes plays only when nobody else can. The starters
 * open the game. 2026-10-02: picking slot by slot, starters first, spent the starters' minutes early
 * and left the bench for the end, where a backup listed at two slots could cover only one and a
 * starter played past his minutes (Bird 37 -> 40). */
const SUB_MARGIN = 4;
const SPENT_PENALTY = 100;

class Bench {
  private roster: GameRoster;
  private left: Map<Position, Map<Player, number>>;
  private planned: Map<Position, Map<Player, number>>;
  private court = new Map<Position, Player>();
  private elapsed = 0;
  constructor(roster: GameRoster) {
    this.roster = roster;
    this.left = new Map(STARTER_SLOTS.map((slot) => [slot, new Map(roster.slotMinutes[slot].map((e) => [e.player, e.minutes]))]));
    this.planned = new Map(STARTER_SLOTS.map((slot) => [slot, new Map(roster.slotMinutes[slot].map((e) => [e.player, e.minutes]))]));
  }
  next(minutes: number): Player[] {
    const pace = Math.min(1, (this.elapsed + minutes) / 48);
    // A starter is due first: at tip-off nobody has played, so the bigger planned share wins.
    const options = STARTER_SLOTS.map((slot) => {
      const left = this.left.get(slot)!;
      const planned = this.planned.get(slot)!;
      const current = this.court.get(slot);
      return [...left].map(([player, remaining]) => {
        const plan = planned.get(player) ?? 0;
        const due = plan * pace - (plan - remaining);
        return { player, score: due + (player === current ? SUB_MARGIN : 0) - (remaining <= 0 ? SPENT_PENALTY : 0) };
      });
    });
    let best: (Player | undefined)[] = [];
    let bestScore = -Infinity;
    const pick: (Player | undefined)[] = [];
    const taken = new Set<Player>();
    const search = (i: number, score: number) => {
      if (i === STARTER_SLOTS.length) {
        if (score > bestScore) {
          bestScore = score;
          best = [...pick];
        }
        return;
      }
      let any = false;
      for (const o of options[i]) {
        if (taken.has(o.player)) continue;
        any = true;
        taken.add(o.player);
        pick[i] = o.player;
        search(i + 1, score + o.score);
        taken.delete(o.player);
      }
      if (!any) {
        pick[i] = undefined;
        search(i + 1, score - 2 * SPENT_PENALTY);
      }
    };
    search(0, 0);
    const five: Player[] = [];
    const used = new Set(best.filter((p): p is Player => Boolean(p)));
    STARTER_SLOTS.forEach((slot, i) => {
      const chosen = best[i] ?? this.roster.players.find((p) => !used.has(p));
      if (!chosen) return;
      used.add(chosen);
      five.push(chosen);
      this.court.set(slot, chosen);
      const left = this.left.get(slot)!;
      if (left.has(chosen)) left.set(chosen, (left.get(chosen) ?? 0) - minutes);
    });
    this.elapsed += minutes;
    return five;
  }
}

/**
 * 2026-10-07, stage 2b step 3 — defense as a mechanic (the user; budget from the NBA's four factors,
 * 2019-26: shooting 60%, turnovers 28%, rebounding 8%, fouls 4%). Each knob is per z-score of the
 * defense in `liveDefense.ts` (0 = the bench leagues' average), sized so the best tenth of defenses
 * land where the NBA's do: opponents' eFG -1.8 points, turnovers forced +1.3, defensive rebounds
 * +1.9, free throws per shot -2.3 points.
 */
/** Rim and mid-range make rates differ by this much (today: ~66% at the rim, ~42% from mid-range). */
const RIM_MID_GAP = 0.22;
const STEAL_SHARE = 0.55;
const STEAL_K = 0.08;
/** The defense knobs, in one place so the calibration scripts can sweep them. */
export const DEFENSE_TUNING = {
  rim: 0.055,
  direct: 0.035,
  mid: 0.045,
  help: 0.015,
  three: 0.04,
  threeRate: 0.08,
  tov: 0.26,
  reb: 0.1,
  foul: 0.85,
  refRim: 1.26,
  /** A player's real percentages already hold his breaks and putbacks; the half court gives back
   * what the game now adds there, so his season lands on his own numbers. */
  halfCourt: 0.99,
  turnover: 0.133,
  /** A player's real free-throw rate already holds his trips in the bonus, which the game now
   * plays as their own fouls; shooting fouls give that back, so the league's free throws stay
   * where the players' own numbers put them (~32 a team game). */
  shootingFoul: 0.9,
};
/**
 * 2026-10-07, stage 2b offense channels, step 1 (the user: ball handling -> turnovers). A five
 * turns it over as often as its players really did — the sum of each one's turnover share of his
 * usage, 0.131 a trip on average over 1920 drafted fives (starters and second units of 60 AI
 * drafts), where the game used one flat rate — and a real lead handler on the floor takes care of
 * the ball beyond that (best playmaking of the five: mean 92.8, spread 5.2).
 */
export const OFFENSE_TUNING = {
  ownTurnovers: 0.6,
  handler: 0.09,
};
const REF_FIVE_TURNOVERS = 0.1267;
/**
 * Step 2 (the user: passing -> shot quality). Before a shot the game decides whether a pass set it
 * up or he made it himself; a set-up shot goes in more often (`setupEdge`) and only a set-up make
 * is an assist.
 * How many of his shots are set up is his own (the user: "kto bardziej rzuca po asystach"): the
 * share of his makes that were assisted, twos and threes apart, from play-by-play since 1996-97
 * (Korver 89% / 97%, Klay 64% / 92%, Curry 35% / 57%, Harden 12% / 16%); before that, a fit of
 * those numbers on usage, position and assists (R² 0.54 / 0.59). The four beside him move it by
 * how much better or worse they pass than his real teammates, and his real percentages already
 * hold his real share, so he gains or loses only the difference.
 */
export const SETUP_TUNING = {
  twoBase: 0.02,
  twoSlope: 0.08,
  threeBase: 0.01,
  threeSlope: 0.05,
  matesPower: 0.6,
};
/**
 * How much better his set-up shots are than his own, by type (the user, 2026-10-07: "uzależnij od
 * typu gracza"): the less he creates for himself, the worse the shots he does create — Korver's or
 * Klay's pull-up three is far below his catch-and-shoot one (~5-6 points), Curry's a couple, Harden's
 * about the same. Across the pool it averages ~4 points for threes and ~4 for twos.
 */
function setupEdge(habit: { two: number; three: number }): { two: number; three: number } {
  return {
    two: SETUP_TUNING.twoBase + SETUP_TUNING.twoSlope * habit.two ** 2,
    three: SETUP_TUNING.threeBase + SETUP_TUNING.threeSlope * habit.three ** 3,
  };
}
const UNASSISTED_TWOS = buildSelfCreationYearMap('unassisted2Pt');
const UNASSISTED_THREES = buildSelfCreationYearMap('unassisted3Pt');
const habitCache = new WeakMap<PlayerSpan, { two: number; three: number }>();
function setupHabit(span: PlayerSpan, originalUsage: number): { two: number; three: number } {
  let h = habitCache.get(span);
  if (!h) {
    const big = span.primaryPosition === 'C' || span.primaryPosition === 'PF' ? 1 : 0;
    const two = measuredSelfCreationForSpan(span, UNASSISTED_TWOS);
    const three = measuredSelfCreationForSpan(span, UNASSISTED_THREES);
    const clamp = (v: number) => Math.max(0.05, Math.min(0.97, v));
    h = {
      two: clamp(two != null ? 1 - two : 0.726 - 0.519 * originalUsage + 0.092 * big - 0.046 * span.box.apg),
      three: clamp(three != null ? 1 - three : 1.108 - 0.785 * originalUsage + 0.071 * big - 0.037 * span.box.apg),
    };
    habitCache.set(span, h);
  }
  return h;
}
/** His set-up share here: his own, moved by his four teammates' passing against his real ones'. */
function setupHere(habit: number, line: { matesAssists: number; originalMatesAssists: number }): number {
  const passing = Math.max(0.6, Math.min(1.4, (Math.max(0.5, line.matesAssists) / Math.max(0.5, line.originalMatesAssists)) ** SETUP_TUNING.matesPower));
  return Math.max(0.05, Math.min(0.97, habit * passing));
}

const REF_HANDLER = { mean: 92.8, sd: 5.2 };
const handlerCache = new WeakMap<PlayerSpan, number>();
function handlerScore(span: PlayerSpan): number {
  let h = handlerCache.get(span);
  if (h === undefined) {
    h = playmakingScoreForPlayer(span) ?? 50;
    handlerCache.set(span, h);
  }
  return h;
}
/** The best lead handler on the floor against a typical five's, as a z-score. */
function handlerZ(off: CourtPlayer[]): number {
  const handler = Math.max(...off.map((c) => handlerScore(c.player.span)));
  return Math.max(-3, Math.min(2, (handler - REF_HANDLER.mean) / REF_HANDLER.sd));
}
/**
 * Step 3 (the user: self-creation -> possessions that break down). Some trips get nothing and end
 * with the clock running out — in the NBA ~8% of shots come with 0-4 seconds left, at an eFG ~11
 * points under the league's. More of them after a reset to 14 seconds, against a strong perimeter
 * defense, and without a real lead handler. The ball then goes to whoever can make his own shot
 * (his share of unassisted makes, `ownShare`), the shot is never set up (so a catch-and-shoot
 * player also pays his own-shot gap, `setupEdge`) and goes in `LATE_TUNING.penalty` less often.
 */
export const LATE_TUNING = {
  share: 0.09,
  reset: 1.8,
  defense: 0.15,
  handler: 0.15,
  penalty: 0.06,
  creatorPower: 1.5,
};
/**
 * Step 3b-A (the user: the star channel). A bigger or smaller share of the ball moves a player's
 * shooting by 0.25 TS points per usage point on average (`contextStats.ts`), but not alike: a real
 * creator takes the extra shots he is used to making himself and loses little (~0.1), a finisher
 * or spot-up shooter made to create loses most (~0.4) — so a five with no one to take the shots
 * pays for it, and a star beside specialists does not. By his share of unassisted makes. A smaller
 * share of the ball (a star among stars) keeps the plain 0.25 gain for everyone.
 */
export const STAR_TUNING = {
  usageCostMax: 0.4,
  usageCostMin: 0.1,
  creatorShare: 0.6,
};
/**
 * Step 3b-B: a star beats good defense more often than anyone else — what makes him worth more
 * against a good team. The cut a defense takes from his shots (contests, help, closeouts, fewer
 * threes) is 70% of the usual for the best scorers (O-TAL 100), rising to the full cut at 85 and
 * below (the user: "70% ok"). A bad defense helps everyone alike.
 */
const STAR_RESIST = { share: 0.3, from: 85, to: 100 };
const starCache = new WeakMap<PlayerSpan, number>();
function defenseResist(span: PlayerSpan): number {
  let r = starCache.get(span);
  if (r === undefined) {
    const star = Math.max(0, Math.min(1, (computeOffensiveTalent(span) - STAR_RESIST.from) / (STAR_RESIST.to - STAR_RESIST.from)));
    r = 1 - STAR_RESIST.share * star;
    starCache.set(span, r);
  }
  return r;
}
/** How much of a star he is, 0 to 1 (O-TAL 85 -> 100). */
const starness = (span: PlayerSpan) => (1 - defenseResist(span)) / STAR_RESIST.share;
/**
 * Step 3b-C: the end of a close game (last four minutes, within five). The ball goes to the star —
 * his share of the shots grows by `focus` times his starness (NBA: a star's usage rises ~5-8 points
 * in the clutch) — and every shot gets harder (clutch eFG ~3 points under the rest), the star's
 * least. It barely moves the average margin; it decides close games.
 */
export const CLUTCH_TUNING = {
  minutes: 4,
  margin: 5,
  focus: 0.8,
  penalty: 0.03,
  starKeep: 0.6,
};
function usageCostScale(ownShare: number): number {
  const creator = Math.min(1, ownShare / STAR_TUNING.creatorShare);
  return (STAR_TUNING.usageCostMax - (STAR_TUNING.usageCostMax - STAR_TUNING.usageCostMin) * creator) / 0.25;
}
/**
 * Step 4 (the user: rim pressure as a team). Each player's own trips to the rim are already his
 * (`rimShare`, his free-throw rate); what a five that keeps attacking the basket adds is the help it
 * draws: the defense collapses, and the threes kicked back out are better looks (`collapse` per
 * spread of the five's rim pressure, set-up threes only), and its rim protectors pick up fouls on
 * those drives (`foul`, and a third of the fouls at the rim go to the best rim protector on the floor
 * rather than the man guarding the shooter). The five's rim pressure is the engine's
 * (`rimPressure.ts`), against the drafted rotation fives' 71 (spread 20.5).
 */
export const RIM_TUNING = {
  collapse: 0.008,
  foul: 0.08,
  helpFoulShare: 0.35,
};
const REF_RIM_PRESSURE = { mean: 71.3, sd: 20.5 };
/**
 * Step 5 (the user: switchability as a mechanic). A five that can switch takes the mismatch away: a
 * weak defender is hunted less often (`hunt` per spread of the defense's switchability, Fit's own
 * reading, `fiveSwitchability`), and the actions it kills leave more isolations — more trips that
 * end late in the clock (`iso`), where the star who makes his own shot still gets his. Against the
 * drafted rotation fives' 64.6 (spread 15.6).
 */
export const SWITCH_TUNING = {
  hunt: 0.35,
  iso: 0.12,
};
const REF_SWITCH = { mean: 64.6, sd: 15.6 };
/** The five's own turnover rate against an average five's (1 = average). */
function ballSecurity(off: CourtPlayer[]): number {
  const own = off.reduce((s, c) => s + c.turnoverShare, 0) / REF_FIVE_TURNOVERS;
  const z = handlerZ(off);
  return Math.max(0.6, Math.min(1.6, own ** OFFENSE_TUNING.ownTurnovers * Math.exp(-OFFENSE_TUNING.handler * z)));
}
/** Five-level reference: the best rim protector plus a share of the second, and both ends'
 * rebounding per 36 summed over a five (bench leagues, minutes-weighted). */
const REF_FIVE_OREB = 5 * REFERENCE.oreb36.mean;
const SD_FIVE_OREB = REFERENCE.oreb36.sd * Math.sqrt(5);
const REF_FIVE_DREB = 5 * REFERENCE.dreb36.mean;
const SD_FIVE_DREB = REFERENCE.dreb36.sd * Math.sqrt(5);
const MOD_FLOOR = 0.75;
const MOD_CEIL = 1.25;
const clampMod = (v: number) => Math.max(MOD_FLOOR, Math.min(MOD_CEIL, v));
/** Hunting the weakest defender: chance per z he trails his four teammates, and what he gives up. */
const HUNT_PER_Z = 0.07;
const MAX_HUNT = 0.25;
const HUNT_PER_DTAL = 0.03;
/** Fouls away from the shot per trip, the bonus from the fifth team foul, six to foul out. */
const NON_SHOOTING_FOUL = 0.065;
const BONUS_FOULS = 4;
const FOUL_OUT = 6;
const TROUBLE_SOFTEN = 0.6;
/** Fast breaks: after a steal most trips run, after a defensive rebound some (the user: 15% until
 * there is data on tempo). A break is a shot at the rim with a head start, rarely a trailing three. */
const BREAK_AFTER_STEAL = 0.62;
const BREAK_AFTER_REBOUND = 0.15;
const BREAK_RIM_BONUS = 0.12;
const BREAK_THREE_RATE = 0.12;
const BREAK_FOUL = 1.3;
/** After an offensive rebound: a putback at the rim, or the ball back out on a 14-second clock —
 * scrambled defense, more and better threes, fewer turnovers and assists. */
const PUTBACK_SHARE = 0.37;
const PUTBACK_BONUS = 0.06;
const RESET_THREE_RATE = 1.3;
const RESET_THREE_PCT = 0.015;
const RESET_TURNOVER = 0.6;
const RESET_ASSISTED = 0.85;
/** Blocks: a sixth of missed twos overall, mostly at the rim and more with a rim protector. */
const BLOCKED_AT_RIM = 0.24;
const BLOCKED_MID = 0.06;
const BLOCK_PER_RIM = 0.25;

interface ShotMods {
  rim: number;
  mid: number;
  three: number;
  threeRate: number;
  foul: number;
}
interface Clash {
  def: FiveDefense;
  /** For each attacker, the index of his defender. */
  guard: number[];
  mods: ShotMods[];
  tovMul: number;
  stealShare: number;
  oreb: number;
  foulRate: number;
  huntP: number;
  /** Chance an open trip breaks down to the end of the clock. */
  lateP: number;
  /** The attacking five's rim pressure as a z-score, and the defense's best rim protector. */
  rimZ: number;
  rimAnchor: number;
}

function buildClash(off: CourtPlayer[], defCourt: CourtPlayer[]): Clash {
  const defSpans = defCourt.map((c) => c.player.span);
  const fd = fiveDefense(defSpans);
  const guard = assignMatchups(off.map((c) => c.player.span), off.map((c) => c.usage), defSpans);
  const offOreb = off.reduce((s, c) => s + defenderProfile(c.player.span).oreb36, 0);
  const switchZ = Math.max(-2.5, Math.min(2.5, (fiveSwitchability(defSpans, STARTER_SLOTS) - REF_SWITCH.mean) / REF_SWITCH.sd));
  const mods = off.map((c, i) => {
    const d = fd.profiles[guard[i]];
    const resist = defenseResist(c.player.span);
    const cut = (m: number) => (m < 1 ? 1 - (1 - m) * resist : m);
    return {
      rim: cut(clampMod(1 - DEFENSE_TUNING.rim * (fd.rim - DEFENSE_TUNING.refRim) - DEFENSE_TUNING.direct * d.dtal)),
      mid: cut(clampMod(1 - DEFENSE_TUNING.mid * d.dtal - DEFENSE_TUNING.help * fd.perimeter)),
      three: cut(clampMod(1 - DEFENSE_TUNING.three * d.perimeter)),
      threeRate: cut(clampMod(1 - DEFENSE_TUNING.threeRate * fd.perimeter)),
      foul: d.foulIndex ** DEFENSE_TUNING.foul,
    };
  });
  return {
    def: fd,
    guard,
    mods,
    tovMul: clampMod(1 + DEFENSE_TUNING.tov * (0.5 * fd.perimeter + 0.5 * fd.stl)) * ballSecurity(off),
    stealShare: Math.max(0.35, Math.min(0.75, STEAL_SHARE * (1 + STEAL_K * fd.stl))),
    oreb: OFF_REBOUND * Math.exp(DEFENSE_TUNING.reb * ((offOreb - REF_FIVE_OREB) / SD_FIVE_OREB - (fd.dreb36 - REF_FIVE_DREB) / SD_FIVE_DREB)),
    foulRate: fd.profiles.reduce((s, p) => s + p.foulIndex ** DEFENSE_TUNING.foul, 0) / fd.profiles.length,
    huntP: Math.min(MAX_HUNT, HUNT_PER_Z * fd.weakGap) * Math.max(0.2, 1 - SWITCH_TUNING.hunt * switchZ),
    rimZ: Math.max(-2.5, Math.min(2.5, (rimPressureTeam(off.map((c) => c.player.span)) - REF_RIM_PRESSURE.mean) / REF_RIM_PRESSURE.sd)),
    rimAnchor: fd.profiles.reduce((best, p, i) => (p.rim > fd.profiles[best].rim ? i : best), 0),
    lateP: Math.min(0.3, LATE_TUNING.share * Math.exp(LATE_TUNING.defense * fd.perimeter - LATE_TUNING.handler * handlerZ(off) + SWITCH_TUNING.iso * switchZ)),
  };
}

/** What the weakest defender gives up when he is hunted, on top of his own matchup. */
function huntMod(d: DefenderProfile): number {
  return clampMod(1 - HUNT_PER_DTAL * d.dtal);
}

/** Expected points of one trip for `off` against this defense at shooting `scale` — the measure the
 * nudge evens out (turnovers, second chances and free throws included). */
function expectedPossession(off: CourtPlayer[], cl: Clash, tired: Map<string, number>, scale: number): number {
  const shots = off.reduce((s, c) => s + c.shotShare, 0) || 1;
  const lateWeights = off.map((c) => c.shotShare * c.ownShare ** LATE_TUNING.creatorPower);
  const lateTotal = lateWeights.reduce((s, v) => s + v, 0) || 1;
  // Trips that go at the weakest defender: his own matchup gap, at the hunting rate.
  const hunted = 1 + cl.huntP * (huntMod(cl.def.profiles[cl.def.weakest]) - 1);
  let value = 0;
  let miss = 0;
  off.forEach((c, i) => {
    const m = cl.mods[i];
    const t = (tired.get(c.player.label) ?? 1) * scale;
    const r3 = Math.min(0.9, c.threeRate * m.threeRate);
    const foulP = c.foul * m.foul * DEFENSE_TUNING.shootingFoul * Math.max(0.5, 1 + RIM_TUNING.foul * cl.rimZ * (1 - r3) * c.rimShare);
    const ft = c.player.span.box.ftPct;
    const line = (r3 * 3 + (1 - r3) * 2) * ft;
    const two = c.rimShare * c.rimPct * m.rim + (1 - c.rimShare) * c.midPct * m.mid;
    // Normal trips at his average; late ones his own shot, minus the clock.
    for (const [w, p3, p2] of [
      [((1 - cl.lateP) * c.shotShare) / shots, (c.threePct * m.three + RIM_TUNING.collapse * cl.rimZ * Math.min(0.97, c.setup3 / (1 - LATE_TUNING.share))) * t * hunted, two * t * hunted],
      [(cl.lateP * lateWeights[i]) / lateTotal, Math.max(0.05, c.threePct * m.three - c.edge3 * Math.min(0.97, c.setup3 / (1 - LATE_TUNING.share)) - LATE_TUNING.penalty) * t, Math.max(0.05, two - c.edge2 * Math.min(0.97, c.setup2 / (1 - LATE_TUNING.share)) - LATE_TUNING.penalty) * t],
    ]) {
      const field = r3 * 3 * p3 + (1 - r3) * 2 * p2 * (1 + (AND_ONE * ft) / 2);
      value += w * ((1 - foulP) * field + foulP * line);
      miss += w * (1 - foulP) * (r3 * (1 - p3) + (1 - r3) * (1 - p2));
    }
  });
  const tov = DEFENSE_TUNING.turnover * cl.tovMul;
  return ((1 - tov) * value) / (1 - (1 - tov) * miss * cl.oreb);
}

function courtFor(cache: Map<string, CourtPlayer[]>, five: Player[]): CourtPlayer[] {
  const key = five.map((p) => p.span.id).join('|');
  let court = cache.get(key);
  if (!court) {
    const lines = contextLines(five.map((p) => p.span));
    const habits = five.map((p, i) => setupHabit(p.span, lines[i].originalUsage));
    const setups = habits.map((h, i) => ({ two: setupHere(h.two, lines[i]), three: setupHere(h.three, lines[i]) }));
    const edges = habits.map(setupEdge);
    const owns = five.map((p, i) => {
      const r3 = Math.min(0.9, p.span.box.threePA / Math.max(1, p.span.fga));
      return Math.max(0.02, 1 - ((1 - r3) * habits[i].two + r3 * habits[i].three));
    });
    const usageCost = owns.map(usageCostScale);
    court = five.map((player, i) => ({
      player,
      shotShare: lines[i].shotWeight,
      turnoverShare: Math.max(0.005, lines[i].usage - lines[i].shotWeight),
      foul: foulChance(lines[i].freeThrowRate),
      twoPct: Math.max(0.3, Math.min(0.72, twoPointPct(player.span) + spacingGain(lines[i].twoPointDelta) + contextGain(lines[i].usageDelta * (lines[i].usageDelta < 0 ? usageCost[i] : 1)) + edges[i].two * (setups[i].two - habits[i].two))),
      threePct: Math.max(0.15, Math.min(0.5, modernBox(player.span).threePct + contextGain(lines[i].usageDelta * (lines[i].usageDelta < 0 ? usageCost[i] : 1)) * THREE_PCT_PER_TS + edges[i].three * (setups[i].three - habits[i].three))),
      rimShare: lines[i].rimShare,
      rimPct: 0,
      midPct: 0,
      threeRate: Math.min(0.9, player.span.box.threePA / Math.max(1, player.span.fga)),
      usage: lines[i].usage,
      setup2: setups[i].two,
      setup3: setups[i].three,
      edge2: edges[i].two,
      edge3: edges[i].three,
      ownShare: owns[i],
    }));
    for (const c of court) {
      c.twoPct *= DEFENSE_TUNING.halfCourt;
      c.threePct *= DEFENSE_TUNING.halfCourt;
      c.rimPct = Math.min(0.85, c.twoPct + (1 - c.rimShare) * RIM_MID_GAP);
      c.midPct = Math.max(0.2, c.twoPct - c.rimShare * RIM_MID_GAP);
    }
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
  return playRosters([rosterFromTeam(a), rosterFromTeam(b)], margin, seed, options.record ?? true, options.weakLinks, true);
}

/** The starting five's weakest defender, the man the other side hunts. */
export function teamWeakLink(team: Team): string | null {
  return scoreLineup(rosterFromTeam(team).starters).weakLink;
}

const emptyLine = (): BoxLineStats => ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0, min: 0 });

function playRosters(
  rosters: [GameRoster, GameRoster],
  margin: number,
  seed: string,
  record: boolean,
  weakLinks?: [string | null, string | null],
  /** Only a full rotation tires: a five alone (Daily, Draw Five) plays the whole game by design. */
  tiring = false,
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
  const tired = ([0, 1] as GameSide[]).map((side) => {
    const minutes = new Map<string, number>();
    for (const court of schedule[side]) for (const c of court) minutes.set(c.player.label, (minutes.get(c.player.label) ?? 0) + possessionMinutes);
    return new Map([...minutes].map(([label, m]) => [label, tiring ? fatigue(m) : 1]));
  });
  // 2026-10-07, stage 2b step 3 (the user: defense as a mechanic, budget 60/28/8/4): who guards
  // whom and what the defense on the floor does to every shot, turnover, rebound and foul
  // (`liveDefense.ts`). The engine's margin still decides the average game, but it is now met on the
  // whole possession — shots, turnovers and second chances — so the nudge only covers what the
  // mechanics leave.
  const clashCache = new Map<string, Clash>();
  const keyOf = (court: CourtPlayer[]) => court.map((c) => c.player.span.id).join('|');
  const clashFor = (off: CourtPlayer[], def: CourtPlayer[]): Clash => {
    const key = `${keyOf(off)}>${keyOf(def)}`;
    let c = clashCache.get(key);
    if (!c) {
      c = buildClash(off, def);
      clashCache.set(key, c);
    }
    return c;
  };
  const meanPossession = (side: GameSide, scale: number) => {
    let sum = 0;
    let n = 0;
    for (let k = side; k < POSSESSIONS; k += 2) {
      sum += expectedPossession(schedule[side][k], clashFor(schedule[side][k], schedule[1 - side][k]), tired[side], scale);
      n++;
    }
    return sum / Math.max(1, n);
  };
  const perTeam = POSSESSIONS / 2;
  const gapAt = (n: number) => perTeam * (meanPossession(0, 1 + n) - meanPossession(1, 1 - n));
  let nudge: number;
  if (gapAt(MAX_NUDGE) <= margin) nudge = MAX_NUDGE;
  else if (gapAt(-MAX_NUDGE) >= margin) nudge = -MAX_NUDGE;
  else {
    let lo = -MAX_NUDGE;
    let hi = MAX_NUDGE;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (gapAt(mid) < margin) lo = mid;
      else hi = mid;
    }
    nudge = (lo + hi) / 2;
  }
  const makeScale: [number, number] = [1 + nudge, 1 - nudge];
  const box: [Record<string, BoxLineStats>, Record<string, BoxLineStats>] = [{}, {}];
  for (const side of [0, 1] as GameSide[]) for (const p of rosters[side].players) box[side][p.label] = emptyLine();
  const hunted = weakLinks ? [weakLinks[1], weakLinks[0]] : [scoreLineup(rosters[1].starters).weakLink, scoreLineup(rosters[0].starters).weakLink];
  const score: [number, number] = [0, 0];
  const quarters: [number[], number[]] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const teamFouls: [number[], number[]] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const fouledOut = [new Set<Player>(), new Set<Player>()];
  // A break the other way: set by a steal or a defensive rebound, used by that team's next trip.
  const breakNext: [number, number] = [0, 0];
  const moments: GameMoment[] = [];
  const snapshot = (): [BoxLineStats[], BoxLineStats[]] => [
    rosters[0].players.map((p) => ({ ...box[0][p.label] })),
    rosters[1].players.map((p) => ({ ...box[1][p.label] })),
  ];
  let lastCourt: [CourtPlayer[], CourtPlayer[]] = [starting[0], starting[1]];
  // A defender in foul trouble (2 in the first quarter, 3 by half, 4 in the third, 5) plays softer.
  const inTrouble = (side: GameSide, p: Player, quarter: number) => box[side][p.label].pf >= [2, 3, 4, 5][quarter];
  const foul = (side: GameSide, p: Player, k: number, quarter: number) => {
    const line = box[side][p.label];
    line.pf++;
    teamFouls[side][quarter]++;
    if (line.pf >= FOUL_OUT && !fouledOut[side].has(p)) {
      fouledOut[side].add(p);
      // His remaining minutes go to the bench: whoever is listed at his slot, else anyone free.
      for (let j = k + 1; j < POSSESSIONS; j++) {
        const court = schedule[side][j];
        const at = court.findIndex((c) => c.player === p);
        if (at < 0) continue;
        const five = court.map((c) => c.player);
        const slot = STARTER_SLOTS[at];
        const free = (q: Player) => !five.includes(q) && !fouledOut[side].has(q);
        const sub = rosters[side].slotMinutes[slot].map((e) => e.player).find(free) ?? rosters[side].players.find(free);
        if (!sub) break;
        five[at] = sub;
        schedule[side][j] = courtFor(courts[side], five);
      }
    }
  };
  const freeThrows = (o: GameSide, shooter: Player, attempts: number) => {
    const line = box[o][shooter.label];
    let made = 0;
    let lastMissed = false;
    for (let f = 0; f < attempts; f++) {
      lastMissed = rng() >= shooter.span.box.ftPct;
      if (!lastMissed) made++;
    }
    line.fta += attempts;
    line.ftm += made;
    line.pts += made;
    return { made, lastMissed };
  };

  for (let k = 0; k < POSSESSIONS; k++) {
    const both: [CourtPlayer[], CourtPlayer[]] = [schedule[0][k], schedule[1][k]];
    lastCourt = both;
    for (const side of [0, 1] as GameSide[]) for (const c of both[side]) box[side][c.player.label].min += possessionMinutes;
    const o = (k % 2) as GameSide;
    const d = (1 - o) as GameSide;
    const off = both[o];
    const defCourt = both[d];
    const def = defCourt.map((c) => c.player);
    const clash = clashFor(off, defCourt);
    const quarter = Math.min(3, Math.floor((k * 4) / POSSESSIONS));
    const clutch = k >= POSSESSIONS * (1 - CLUTCH_TUNING.minutes / 48) && Math.abs(score[o] - score[d]) <= CLUTCH_TUNING.margin;
    let play: GamePlay | null = null;
    let pts = 0;
    const onBreak = breakNext[o];
    breakNext[o] = 0;
    // Away from the ball: a foul that is not on a shot (side out, or two shots in the bonus).
    if (!onBreak && rng() < NON_SHOOTING_FOUL * clash.foulRate) {
      const fouler = pickWeighted(rng, def, (p) => defenderProfile(p.span).foulIndex);
      const inBonus = teamFouls[d][quarter] >= BONUS_FOULS;
      foul(d, fouler, k, quarter);
      if (inBonus) {
        const fouled = pickWeighted(rng, off, (c) => c.shotShare).player;
        const ft = freeThrows(o, fouled, 2);
        pts += ft.made;
        play = { side: o, text: `${fouled.label} ${ft.made}/2 in the bonus`, joker: fouled.joker, quiet: ft.made === 0 };
        score[o] += pts;
        quarters[o][quarter] += pts;
        if (record) moments.push({ left: Math.max(0, GAME_SECONDS - ((k + 1) * GAME_SECONDS) / POSSESSIONS), quarter, score: [score[0], score[1]], play, lines: snapshot() });
        continue;
      }
    }
    let next: 'open' | 'putback' | 'reset' = 'open';
    let putbackBy: CourtPlayer | null = null;
    for (let guard = 0; guard < 4; guard++) {
      const tovChance = DEFENSE_TUNING.turnover * clash.tovMul * (next === 'reset' ? RESET_TURNOVER : 1) * (onBreak && guard === 0 ? 0.5 : 1);
      if (next !== 'putback' && rng() < tovChance) {
        if (rng() < clash.stealShare) {
          const thief = pickWeighted(rng, def, (p) => rates(p.span).stl + 0.2);
          const lost = pickWeighted(rng, off, (c) => c.turnoverShare).player;
          box[d][thief.label].stl++;
          box[o][lost.label].tov++;
          if (rng() < BREAK_AFTER_STEAL) breakNext[d] = 1;
          play = { side: d, text: `${thief.label} steals it from ${lost.label}`, joker: thief.joker, quiet: false };
        } else {
          box[o][pickWeighted(rng, off, (c) => c.turnoverShare).player.label].tov++;
        }
        break;
      }
      const late = next !== 'putback' && !(onBreak && guard === 0) && rng() < clash.lateP * (next === 'reset' ? LATE_TUNING.reset : 1);
      const focus = (c: CourtPlayer) => (clutch ? 1 + CLUTCH_TUNING.focus * starness(c.player.span) : 1);
      const shooterIdx =
        next === 'putback' && putbackBy
          ? off.indexOf(putbackBy)
          : off.indexOf(pickWeighted(rng, off, late ? (c) => c.shotShare * c.ownShare ** LATE_TUNING.creatorPower * focus(c) : (c) => c.shotShare * focus(c)));
      const shot = off[shooterIdx];
      const shooter = shot.player;
      const line = box[o][shooter.label];
      let defIdx = clash.guard[shooterIdx];
      let hunting = false;
      if (next === 'open' && !onBreak && !late && clash.def.weakest !== defIdx && rng() < clash.huntP) {
        defIdx = clash.def.weakest;
        hunting = true;
      }
      const defender = def[defIdx];
      const soft = inTrouble(d, defender, quarter) ? TROUBLE_SOFTEN : 1;
      const mods = clash.mods[shooterIdx];
      const fresh = onBreak && guard === 0;
      const three = next !== 'putback' && rng() < (fresh ? BREAK_THREE_RATE : Math.min(0.9, shot.threeRate * (hunting ? 1 : mods.threeRate) * (next === 'reset' ? RESET_THREE_RATE : 1)));
      const atRim = !three && (next === 'putback' || fresh || rng() < shot.rimShare);
      const drawn = atRim ? Math.max(0.5, 1 + RIM_TUNING.foul * clash.rimZ) : 1;
      const foulChance = DEFENSE_TUNING.shootingFoul * shot.foul * drawn * (hunting ? defenderProfile(defender.span).foulIndex ** DEFENSE_TUNING.foul : mods.foul) * (fresh || next === 'putback' ? BREAK_FOUL : 1);
      if (rng() < foulChance) {
        foul(d, atRim && !hunting && rng() < RIM_TUNING.helpFoulShare ? def[clash.rimAnchor] : defender, k, quarter);
        const ft = freeThrows(o, shooter, three ? 3 : 2);
        pts += ft.made;
        play = { side: o, text: `${shooter.label} ${ft.made}/${three ? 3 : 2} at the line`, joker: shooter.joker, quiet: ft.made === 0 };
        // A missed last free throw is a live ball (2026-10-02: every rebound in the league came off
        // a missed field goal, ~3-4 a team short of a real game).
        if (ft.lastMissed) {
          if (rng() < FT_OFF_REBOUND) {
            box[o][pickWeighted(rng, off, (x) => rates(x.player.span).reb ** REBOUND_WEIGHT_POWER).player.label].reb++;
            next = 'reset';
            continue;
          }
          box[d][pickWeighted(rng, def, (x) => rates(x.span).reb ** REBOUND_WEIGHT_POWER).label].reb++;
        }
        break;
      }
      line.fga++;
      if (three) line.tpa++;
      const defended = (m: number) => 1 - (1 - m) * soft * (fresh ? 0.5 : 1);
      const hunt = hunting ? huntMod(defenderProfile(defender.span)) : 1;
      const base = three
        ? (shot.threePct + (next === 'reset' ? RESET_THREE_PCT : 0)) * defended(mods.three)
        : atRim
          ? Math.min(0.85, shot.rimPct + (fresh ? BREAK_RIM_BONUS : next === 'putback' ? PUTBACK_BONUS : 0)) * defended(mods.rim)
          : shot.midPct * defended(mods.mid);
      // Set up by a pass or his own; his percentages above are the average of the two.
      // His real share holds his late-clock shots too, which are never set up: the others make up for it.
      const setupShare = Math.min(0.97, (three ? shot.setup3 : shot.setup2) / (1 - LATE_TUNING.share));
      const setup = next !== 'putback' && !late && rng() < setupShare * (next === 'reset' ? RESET_ASSISTED : 1);
      const edge = (three ? shot.edge3 : shot.edge2) * (setup ? 1 - setupShare : -setupShare) - (late ? LATE_TUNING.penalty : 0) + (three && setup ? RIM_TUNING.collapse * clash.rimZ : 0);
      const pressure = clutch ? CLUTCH_TUNING.penalty * (1 - CLUTCH_TUNING.starKeep * starness(shooter.span)) : 0;
      const p = Math.max(0.05, base + edge - pressure) * hunt * makeScale[o] * (tired[o].get(shooter.label) ?? 1);
      if (rng() < p) {
        const value = three ? 3 : 2;
        line.fgm++;
        if (three) line.tpm++;
        line.pts += value;
        pts += value;
        const moves = movesFor(shooter.slot);
        let text = three
          ? `${shooter.label} ${rng() < 0.3 ? 'corner three' : 'three'}`
          : fresh
            ? `${shooter.label} on the break — ${rng() < 0.5 ? 'dunk' : 'layup'}`
            : next === 'putback'
              ? `${shooter.label} putback`
              : `${shooter.label} ${moves[Math.floor(rng() * moves.length)]}`;
        if (hunting) text = `${shooter.label} attacks ${defender.label} — ${three ? 'three' : moves[Math.floor(rng() * moves.length)]}`;
        if (late) text = `${shooter.label} beats the shot clock — ${three ? 'three' : moves[Math.floor(rng() * moves.length)]}`;
        if (!three && rng() < AND_ONE * (fresh || next === 'putback' ? BREAK_FOUL : 1)) {
          foul(d, defender, k, quarter);
          line.fta++;
          if (rng() < shooter.span.box.ftPct) {
            line.ftm++;
            line.pts++;
            pts++;
            text += ', and one';
          }
        }
        let joker = shooter.joker;
        const mates = off.filter((x) => x.player !== shooter);
        if (setup) {
          const passer = pickWeighted(rng, mates, (x) => rates(x.player.span).ast ** PASSER_POWER + 0.2).player;
          box[o][passer.label].ast++;
          text += ` (${passer.label} assist)`;
          joker = joker || passer.joker;
        }
        play = { side: o, text, joker, quiet: false };
        break;
      }
      if (!three && rng() < (atRim ? BLOCKED_AT_RIM * Math.max(0.4, 1 + BLOCK_PER_RIM * clash.def.rim) : BLOCKED_MID)) {
        const blocker = pickWeighted(rng, def, (x) => rates(x.span).blk + 0.05);
        box[d][blocker.label].blk++;
        play = { side: d, text: `${blocker.label} blocks ${shooter.label}`, joker: blocker.joker, quiet: false };
      }
      if (rng() < clash.oreb) {
        const rebounder = pickWeighted(rng, off, (x) => defenderProfile(x.player.span).oreb36 ** REBOUND_WEIGHT_POWER + 0.05);
        box[o][rebounder.player.label].reb++;
        // A tip-back at the rim, or the ball back out and a fresh 14 seconds.
        if (rng() < PUTBACK_SHARE) {
          next = 'putback';
          putbackBy = rebounder;
        } else next = 'reset';
        continue;
      }
      box[d][pickWeighted(rng, def, (x) => defenderProfile(x.span).dreb36 ** REBOUND_WEIGHT_POWER + 0.05).label].reb++;
      if (rng() < BREAK_AFTER_REBOUND) breakNext[d] = 2;
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
