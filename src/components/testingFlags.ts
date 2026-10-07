/**
 * Engine-calibration tools (TODO.md, Etap 1). 2026-10-07 (the UI simplification): hidden from
 * players — they show only on a browser that opened the site once with `?test` (remembered;
 * `?test=0` turns them off again).
 *
 * - `AUTO_FINISH_FOR_TESTING` (2026-09-30, the user: "do szybszej kalibracji potrzebuję testowego
 *   przycisku AUTOFINISH podczas pełnego draftu"): hands every remaining pick, yours included, to
 *   the CPU drafter and goes straight to the results with an auto-built rotation.
 * - `TEAM_EXPORT_FOR_TESTING` (2026-09-30, the user: "może po prostu export po drafcie wszystkich
 *   składów?"): the results screen copies every team as text (`engine/teamExport.ts`).
 * - `LIVE_TEST_BENCH_FOR_TESTING` (2026-10-02, the user: "oddzielny tryb do testów, dwie losowe
 *   drużyny"): a menu card that opens the live-game test bench (`LiveTestBench.tsx`).
 */
const TESTING_STORAGE_KEY = 'draftverse.testing';

function readTestingFlag(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('test');
    if (param !== null) {
      const on = param !== '0';
      if (on) window.localStorage.setItem(TESTING_STORAGE_KEY, '1');
      else window.localStorage.removeItem(TESTING_STORAGE_KEY);
      return on;
    }
    return window.localStorage.getItem(TESTING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const TESTING_TOOLS = typeof window !== 'undefined' && readTestingFlag();
export const AUTO_FINISH_FOR_TESTING = TESTING_TOOLS;
export const TEAM_EXPORT_FOR_TESTING = TESTING_TOOLS;
export const LIVE_TEST_BENCH_FOR_TESTING = TESTING_TOOLS;
