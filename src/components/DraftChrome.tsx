
import type { PlayerSpan } from '../data/schema';
import { rimPressureTeam } from '../engine/rimPressure';

/**
 * 2026-09-24: small pieces of draft-screen chrome shared by the All-Time Draft (DraftBoard) and
 * Quick 5, so both modes behave the same: the collapsed-board ticker and the "leave this draft?"
 * confirm.
 */

export interface TickerPick {
  pickNumber: number;
  teamCode: string;
  isHuman: boolean;
  shortName: string;
}

/** 2026-09-25, user-reported ("miałem niski rim pressure… nie ma żadnej takiej informacji podczas
 * draftu"): the results screen scores team rim pressure, but nothing warned about it while there
 * was still time to fix it. Same `rimPressureTeam` the fit score reads, on the current starters.
 * Below 55 is roughly the bottom tenth of finished CPU fives (seeded full drafts, 2026-09-25);
 * held back until three starters are in, when one pick can't yet be the whole story. */
const RIM_PRESSURE_WARN_BELOW = 55;
const RIM_PRESSURE_WARN_MIN_STARTERS = 3;

/** Three or more starters and nobody who attacks the basket. */
export function lowRimPressure(starters: PlayerSpan[]): boolean {
  return starters.length >= RIM_PRESSURE_WARN_MIN_STARTERS && starters.length <= 5 && rimPressureTeam(starters) < RIM_PRESSURE_WARN_BELOW;
}
