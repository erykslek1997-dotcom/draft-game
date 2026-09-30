/**
 * Engine-calibration tools (TODO.md, Etap 1) — set both to false before release.
 *
 * - `AUTO_FINISH_FOR_TESTING` (2026-09-30, the user: "do szybszej kalibracji potrzebuję testowego
 *   przycisku AUTOFINISH podczas pełnego draftu"): hands every remaining pick, yours included, to
 *   the CPU drafter and goes straight to the results with an auto-built rotation.
 * - `TEAM_EXPORT_FOR_TESTING` (2026-09-30, the user: "może po prostu export po drafcie wszystkich
 *   składów?"): the results screen copies every team as text (`engine/teamExport.ts`).
 */
export const AUTO_FINISH_FOR_TESTING = true;
export const TEAM_EXPORT_FOR_TESTING = true;
