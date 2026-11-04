
import type { PlayerSpan, Position } from '../data/schema';

/**
 * 2026-10-14, the draft screen redesign (approved mockups "v2 Desktop"/"v2 Phone"): the pieces
 * around the board and the player list — the status bar (whose pick, the round, your caps), the
 * "Before you pick again" lane of rival teams, and your five (a half court on desktop, five dots
 * on a phone).
 */

/** One upcoming pick in snake order. */
export interface UpcomingPick {
  /** 1-based overall pick number. */
  pick: number;
  teamIdx: number;
}

/** Every pick from `start` (0-based overall index) to the end of the draft, in order. */
export function upcomingPicks(start: number, teamCount: number, rounds: number): UpcomingPick[] {
  const out: UpcomingPick[] = [];
  for (let k = start; k < teamCount * rounds; k++) {
    const round = Math.floor(k / teamCount);
    const inRound = k % teamCount;
    out.push({ pick: k + 1, teamIdx: round % 2 === 0 ? inRound : teamCount - 1 - inRound });
  }
  return out;
}

/** Starter slots a roster has filled, by the same best assignment the rest of the screen uses. */
export type FiveAssignment = Partial<Record<Position, PlayerSpan>>;

export interface BigBoardEntry {
  name: string;
  span: PlayerSpan;
  /** Can be drafted with this pick. */
  legal: boolean;
}
