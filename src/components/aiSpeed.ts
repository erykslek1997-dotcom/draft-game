/**
 * CPU pick pacing shared by the All-Time Draft (GameShell) and Quick 5. 2026-10-07, the user ("prędkość
 * cpu nie wiem czy jest potrzebna jeśli będzie dobrze prędkość ustawiona"): the Slow/Normal/Fast/
 * Instant control is gone from the draft screens; every draft runs at one calm pace.
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

export function cpuPickDelay(picksMade: number, teamCount: number): number {
  if (picksMade === 0) return OPENING_PAUSE_MS;
  if (picksMade < teamCount) return FIRST_ROUND_MS;
  return CPU_PICK_DELAY_MS;
}
