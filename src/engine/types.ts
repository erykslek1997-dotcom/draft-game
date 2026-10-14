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
  /** "City Name" of a franchise from the fixed pool (data/franchises.ts; older saves may hold a
   * name from the old random generator) — flavour only, never an identity: everything keyed to a
   * team uses `id`. The logo and colours are looked up by this name. */
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
