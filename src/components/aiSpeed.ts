import { getSettings, type DraftSpeed } from '../settings';

/**
 * CPU pick pacing shared by the All-Time Draft (GameShell) and Quick 5. 2026-10-07, the user ("prędkość
 * cpu nie wiem czy jest potrzebna jeśli będzie dobrze prędkość ustawiona"): the Slow/Normal/Fast/
 * Instant control is gone from the draft screens; every draft runs at one calm pace.
 * 2026-10-16, the user ("okienko ustawień gdzie np będzie zmiana szybkości draftowania"): the pace is
 * a setting again, in the settings window (settings.ts) — calm by default.
 */
export const CPU_PICK_DELAY_MS = 450;

/**
 * 2026-09-26, the user: "jak odpalamy draft to spokojnie, niech użytkownik się oswoi, pierwsze
 * picki AI nie muszą być zrobione od razu". The opening pick waits `OPENING_PAUSE_MS` (the board
 * settles in and the "draft is about to begin" line shows), and the first round of CPU picks runs
 * at `FIRST_ROUND_MS`, so the first sixteen picks can be read one by one.
 */
export const OPENING_PAUSE_MS = 2600;
const FIRST_ROUND_MS = 1300;

/** Fast is about three times quicker; Instant keeps only a beat so the board still repaints. */
const SPEED_FACTOR: Record<DraftSpeed, number> = { calm: 1, fast: 0.35, instant: 0 };
const INSTANT_MS = 40;

export function cpuPickDelay(picksMade: number, teamCount: number): number {
  const base = picksMade === 0 ? OPENING_PAUSE_MS : picksMade < teamCount ? FIRST_ROUND_MS : CPU_PICK_DELAY_MS;
  const factor = SPEED_FACTOR[getSettings().draftSpeed];
  return factor === 0 ? INSTANT_MS : Math.round(base * factor);
}
