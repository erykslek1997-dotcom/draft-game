import type { PlayerSpan } from '../data/schema';
import type { Team } from './types';
import liftData from '../data/teammateLift.json';

/**
 * 2026-10-15, the user ("jak wpływają na efficiency zawodników obok"): how much better a player's
 * teammates really shot beside him, and how much his own real teammates lifted him — in true
 * shooting, built by `scripts/buildTeammateLift.ts` (which explains the measurement). Spans not
 * measured read 0.
 */
const DATA = liftData as unknown as Record<string, [number, number]>;

export interface TeammateLift {
  /** What he gives the teammates on the floor with him, TS points as a fraction (0.01 = one point). */
  lift: number;
  /** What his real teammates gave him, the same way (his real percentages already hold it). */
  realMates: number;
}

export function teammateLift(span: PlayerSpan): TeammateLift {
  const row = DATA[span.id];
  return row ? { lift: row[0] / 1000, realMates: row[1] / 1000 } : { lift: 0, realMates: 0 };
}

/**
 * The teammates on the floor lift a player's shooting by what they really lifted their teammates
 * (Nash +1.4 TS, Jokic +1.3, Curry +0.8, LeBron +0.3, Paul 0, Jordan -0.7), less what his own real
 * teammates gave him. `ref` is the drafted fives' mean of it (160 AI-drafted teams, starters and
 * second units: +0.34), so the league's shooting does not move. Checked in the live game on the same
 * four (Korver, Kirilenko, Marion, Stoudemire) beside each point guard, against Conley: Nash's
 * teammates +0.9 -> +2.4, Stockton's +0.1 -> +1.5, Iverson's -0.7 -> +0.2 (real +1.6, +1.3, +0.6).
 * Tried and dropped the same day: each player carrying his own anchor and the overload by his share
 * of the shots (the user's idea for Curry) — it took Nash's teammates from +0.9 to +0.4.
 *
 * The engine (`matchup.ts`) counts the same lift for a whole team, so the game's margin nudge meets
 * it instead of spreading a five's edge over every shooter alike: `pointsPerTs` turns a team's mean
 * shooting shift into points a game (a team takes ~98 true shot attempts a game: 2 x 98).
 *
 * `threes`: how much of it reaches his three-point % (the rest is his twos). The same real seasons
 * move teammates' threes far less than their true shooting (Nash +0.4 points of 3P% for +2.1 TS,
 * Curry +1.1 for +1.5, LeBron -0.5 for +0.6); at 0.67 (the game's usual share) Klay beside Curry and
 * Nash beside the Suns lost three points of 3P% away from them (2026-10-15, the user: good shooters
 * at a poor shooter's 3P%).
 */
export const LIFT_TUNING = { scale: 1, ref: 0.0034, pointsPerTs: 196, threes: 0.3 };

/** Each player's shooting shift (TS as a fraction) from the four beside him, in the five's order. */
export function fiveLiftShifts(five: PlayerSpan[]): number[] {
  const lifts = five.map(teammateLift);
  const sum = lifts.reduce((s, l) => s + l.lift, 0);
  return lifts.map((l) => LIFT_TUNING.scale * (sum - l.lift - l.realMates - LIFT_TUNING.ref));
}

/**
 * A team's mean shooting shift over its rotation: each player by his minutes, the four beside him by
 * how much of his time each is on the floor (their minutes over everyone else's, times four).
 */
export function teamLiftShift(team: Team): number {
  const minutes = new Map<string, number>();
  for (const slot of Object.values(team.rotation?.slots ?? {})) for (const a of slot) if (a.minutes > 0) minutes.set(a.playerId, (minutes.get(a.playerId) ?? 0) + a.minutes);
  const players = team.roster.filter((p) => (minutes.get(p.id) ?? 0) > 0);
  const total = players.reduce((s, p) => s + minutes.get(p.id)!, 0);
  let shift = 0;
  if (total > 0) {
    const lifts = new Map(players.map((p) => [p.id, teammateLift(p)]));
    for (const p of players) {
      const own = minutes.get(p.id)!;
      const others = total - own;
      let mates = 0;
      if (others > 0) for (const q of players) if (q !== p) mates += (4 * minutes.get(q.id)!) / others * lifts.get(q.id)!.lift;
      shift += (own / total) * LIFT_TUNING.scale * (mates - lifts.get(p.id)!.realMates - LIFT_TUNING.ref);
    }
  }
  return shift;
}

/** The same in points a game. */
export const teamLiftPoints = (team: Team) => teamLiftShift(team) * LIFT_TUNING.pointsPerTs;

/**
 * Points of single-game margin one point of team overall is worth (matchup.ts: the overall weight
 * 0.85 times 1 point per unit). 2026-10-15: the lift goes into the team's overall (scoring.ts
 * `scoreTeam`) at this rate, so the results ranking, the AI's bench picks and the season seeds see
 * it, and one game's margin still gets exactly `teamLiftPoints`.
 */
export const LIFT_POINTS_PER_OVERALL = 0.85;
export const liftAdjustment = (team: Team) => teamLiftPoints(team) / LIFT_POINTS_PER_OVERALL;
