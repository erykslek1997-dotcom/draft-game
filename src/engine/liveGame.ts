import type { PlayerSpan, Position } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { STARTER_SLOTS } from './positions';
import { mulberry32, hashSeed } from './rng';
import { gameWinProbability, projectMatchup } from './matchup';
import { lineupTeam, scoreLineup, type Lineup } from './bestFive';
import type { LegendFive } from './dailyMeta';
import { contextLines } from './contextStats';

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
const SHOOTING_FOUL = 0.09;
const AND_ONE = 0.05;
const OFF_REBOUND = 0.26;
const ASSISTED = 0.6;
const BLOCKED = 0.07;
/** Make-probability tilt per point of expected margin (calibrated in scripts/testLiveGame.ts). */
const TILT_PER_POINT = 0.0066;
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
  /** 2026-10-02: his numbers re-read for this five (`contextStats.ts`) — share of the shots and
   * his two- and three-point percentages with the room and the usage he has here. */
  shotShare: number;
  twoPct: number;
  threePct: number;
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

function playGame(
  yours: Lineup,
  legends: Lineup,
  margin: number,
  seed: string,
  jokerId?: string,
): LiveGameResult {
  const rng = mulberry32(hashSeed(`${seed}:game`));
  const sides: [Player[], Player[]] = [[], []];
  const lineups = [yours, legends];
  for (const side of [0, 1] as GameSide[]) {
    const names = new Map<string, number>();
    for (const slot of STARTER_SLOTS) {
      const s = lineups[side][slot]!;
      names.set(lastName(s.playerName), (names.get(lastName(s.playerName)) ?? 0) + 1);
    }
    for (const slot of STARTER_SLOTS) {
      const s = lineups[side][slot]!;
      const short = lastName(s.playerName);
      sides[side].push({
        span: s,
        slot,
        label: (names.get(short) ?? 0) > 1 ? s.playerName : short,
        joker: side === 0 && s.id === jokerId,
        shotShare: 0,
        twoPct: 0,
        threePct: 0,
      });
    }
    const lines = contextLines(sides[side].map((p) => p.span));
    sides[side].forEach((p, i) => {
      const line = lines[i];
      p.shotShare = line.usage;
      p.twoPct = Math.max(0.3, Math.min(0.72, twoPointPct(p.span) + line.twoPointDelta + line.usageDelta));
      p.threePct = Math.max(0.15, Math.min(0.5, p.span.box.threePct + line.usageDelta * THREE_PCT_PER_TS));
    });
  }
  // Level the two box scores first — the model's margin, not raw shooting numbers from different
  // eras, decides the game — then tilt by that margin. Free throws aren't scaled, so the field-goal
  // scale is solved for equal expected points per shot including them.
  const perShot = (team: Player[]) => {
    const shots = team.reduce((sum, p) => sum + p.shotShare, 0) || 1;
    let field = 0;
    let line = 0;
    for (const p of team) {
      const b = p.span.box;
      const r3 = Math.min(0.9, b.threePA / Math.max(1, p.span.fga));
      field += (p.shotShare / shots) * (1 - SHOOTING_FOUL) * (r3 * 3 * p.threePct + (1 - r3) * 2 * p.twoPct * (1 + (AND_ONE * b.ftPct) / 2));
      line += (p.shotShare / shots) * SHOOTING_FOUL * (r3 * 3 + (1 - r3) * 2) * b.ftPct;
    }
    return { field, line };
  };
  const eps = [perShot(sides[0]), perShot(sides[1])];
  const level = (eps[0].field + eps[0].line + eps[1].field + eps[1].line) / 2;
  const tilt = margin * TILT_PER_POINT;
  const makeScale: [number, number] = [
    ((level - eps[0].line) / eps[0].field) * (1 + tilt),
    ((level - eps[1].line) / eps[1].field) * (1 - tilt),
  ];
  const box: [Record<string, BoxLineStats>, Record<string, BoxLineStats>] = [{}, {}];
  for (const side of [0, 1] as GameSide[]) for (const p of sides[side]) box[side][p.label] = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0 };
  const hunted = [scoreLineup(legends).weakLink, scoreLineup(yours).weakLink];
  const score: [number, number] = [0, 0];
  const quarters: [number[], number[]] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const moments: GameMoment[] = [];
  const snapshot = (): [BoxLineStats[], BoxLineStats[]] => [
    sides[0].map((p) => ({ ...box[0][p.label] })),
    sides[1].map((p) => ({ ...box[1][p.label] })),
  ];

  for (let k = 0; k < POSSESSIONS; k++) {
    const o = (k % 2) as GameSide;
    const d = (1 - o) as GameSide;
    const off = sides[o];
    const def = sides[d];
    const quarter = Math.min(3, Math.floor((k * 4) / POSSESSIONS));
    let play: GamePlay | null = null;
    let pts = 0;
    for (let guard = 0; guard < 4; guard++) {
      if (rng() < TURNOVER) {
        if (rng() < 0.55) {
          const thief = pickWeighted(rng, def, (p) => p.span.box.spg + 0.2);
          const lost = pickWeighted(rng, off, (p) => p.span.fga);
          box[d][thief.label].stl++;
          box[o][lost.label].tov++;
          play = { side: d, text: `${thief.label} steals it from ${lost.label}`, joker: thief.joker, quiet: false };
        } else {
          box[o][pickWeighted(rng, off, (p) => p.span.fga + p.span.box.apg).label].tov++;
        }
        break;
      }
      const shooter = pickWeighted(rng, off, (p) => p.shotShare);
      const line = box[o][shooter.label];
      const b = shooter.span.box;
      const three = rng() < Math.min(0.9, b.threePA / Math.max(1, shooter.span.fga));
      if (rng() < SHOOTING_FOUL) {
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
      const p = (three ? shooter.threePct : shooter.twoPct) * makeScale[o];
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
        if (rng() < ASSISTED) {
          const passer = pickWeighted(rng, off.filter((x) => x !== shooter), (x) => x.span.box.apg + 0.3);
          box[o][passer.label].ast++;
          text += ` (${passer.label} assist)`;
          joker = joker || passer.joker;
        }
        play = { side: o, text, joker, quiet: false };
        break;
      }
      if (!three && rng() < BLOCKED) {
        const blocker = pickWeighted(rng, def, (x) => x.span.box.bpg + 0.05);
        box[d][blocker.label].blk++;
        play = { side: d, text: `${blocker.label} blocks ${shooter.label}`, joker: blocker.joker, quiet: false };
      }
      if (rng() < OFF_REBOUND) {
        box[o][pickWeighted(rng, off, (x) => x.span.box.rpg).label].reb++;
        continue;
      }
      box[d][pickWeighted(rng, def, (x) => x.span.box.rpg).label].reb++;
      break;
    }
    score[o] += pts;
    quarters[o][quarter] += pts;
    moments.push({ left: Math.max(0, GAME_SECONDS - ((k + 1) * GAME_SECONDS) / POSSESSIONS), quarter, score: [score[0], score[1]], play, lines: snapshot() });
  }
  // Overtime would need more possessions; a tie goes to whoever the model favours, on a last shot.
  if (score[0] === score[1]) {
    const o: GameSide = margin >= 0 ? 0 : 1;
    const shooter = pickWeighted(rng, sides[o], (p) => p.span.fga);
    box[o][shooter.label].pts += 2;
    box[o][shooter.label].fgm++;
    box[o][shooter.label].fga++;
    score[o] += 2;
    quarters[o][3] += 2;
    moments.push({
      left: 0,
      quarter: 3,
      score: [score[0], score[1]],
      play: { side: o, text: `${shooter.label} at the buzzer — game winner`, joker: shooter.joker, quiet: false },
      lines: snapshot(),
    });
  }

  const starOf = sides[0].reduce((best, p) => {
    const l = box[0][p.label];
    const bl = box[0][best.label];
    return l.pts + l.reb + l.ast > bl.pts + bl.reb + bl.ast ? p : best;
  }, sides[0][0]);
  const star = { name: starOf.label, line: box[0][starOf.label] };
  const won = score[0] > score[1];
  const recap = won
    ? hunted[0]
      ? `${star.name} led the way, and your five kept going at ${sides[1].find((p) => p.span.playerName === hunted[0])?.label ?? hunted[0]} on defense.`
      : `${star.name} led the way — the five played like one.`
    : hunted[1]
      ? `They kept hunting ${sides[0].find((p) => p.span.playerName === hunted[1])?.label ?? hunted[1]} on defense, and it cost you.`
      : `They were the better team tonight — ${star.name} did what he could.`;
  return {
    moments,
    final: [score[0], score[1]],
    quarters,
    box,
    expectedMargin: margin,
    players: [sides[0].map((p) => p.span), sides[1].map((p) => p.span)],
    labels: [sides[0].map((p) => p.label), sides[1].map((p) => p.label)],
    jokerLabel: sides[0].find((p) => p.joker)?.label ?? null,
    star,
    recap,
  };
}
