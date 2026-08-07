import type { PlayerSpan, Position } from '../data/schema';

export interface SlotAssignment {
  playerId: string;
  minutes: number;
}

/** Each of the 5 slots totals 48 minutes across one or more players (starter + backup(s)). */
export interface Rotation {
  slots: Record<Position, SlotAssignment[]>;
}

export interface Team {
  id: string;
  /** Randomly generated "Place Mascot" label (see engine/teamNames.ts) — flavour only, never
   * an identity: everything keyed to a team uses `id`. */
  name: string;
  /** 1-based position in the round-1 draft order, shown next to the name as "#4". */
  draftSlot: number;
  isHuman: boolean;
  roster: PlayerSpan[]; // drafted players, in pick order
  rotation: Rotation | null;
}

export interface DraftHistoryEntry {
  pickNumber: number;
  teamId: string;
  playerId: string;
}
