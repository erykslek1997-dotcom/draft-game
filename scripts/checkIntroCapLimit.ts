import { CAP_LIMIT, ROSTER_SIZE, BENCH_SLOT_COUNT } from '../src/engine/positions';

/**
 * `App.tsx` hardcodes `DISPLAY_CAP_LIMIT` for the intro tagline instead of importing
 * `CAP_LIMIT` directly, so the intro screen has zero engine-module dependency (see its own
 * comment — that's the whole point of the 2026-07-30 load-time split, GameShell/DraftPoolBrowser
 * are lazy-loaded specifically so nothing about showing the intro text touches the ~10MB data
 * graph). This is the tradeoff's one failure mode: the two numbers can drift. Standing check,
 * not a runtime assertion, since App.tsx must not import engine/positions.ts at all.
 *
 * 2026-08-19: extended to `DISPLAY_ROSTER_SIZE`/`DISPLAY_BENCH_SLOT_COUNT`, added the same day the
 * How to Play copy moved from DraftLottery.tsx (which could afford a real import — it only ever
 * renders inside the already-lazy-loaded GameShell) onto App.tsx's own intro screen, which can't.
 */
const DISPLAY_CAP_LIMIT = 100.9;
const DISPLAY_ROSTER_SIZE = 9;
const DISPLAY_BENCH_SLOT_COUNT = 4;

let ok = true;
if (DISPLAY_CAP_LIMIT !== CAP_LIMIT) {
  console.log(`FAIL: App.tsx's DISPLAY_CAP_LIMIT (${DISPLAY_CAP_LIMIT}) != engine/positions.ts's CAP_LIMIT (${CAP_LIMIT})`);
  ok = false;
}
if (DISPLAY_ROSTER_SIZE !== ROSTER_SIZE) {
  console.log(`FAIL: App.tsx's DISPLAY_ROSTER_SIZE (${DISPLAY_ROSTER_SIZE}) != engine/positions.ts's ROSTER_SIZE (${ROSTER_SIZE})`);
  ok = false;
}
if (DISPLAY_BENCH_SLOT_COUNT !== BENCH_SLOT_COUNT) {
  console.log(`FAIL: App.tsx's DISPLAY_BENCH_SLOT_COUNT (${DISPLAY_BENCH_SLOT_COUNT}) != engine/positions.ts's BENCH_SLOT_COUNT (${BENCH_SLOT_COUNT})`);
  ok = false;
}
if (!ok) process.exit(1);
console.log(`PASS: DISPLAY_CAP_LIMIT/DISPLAY_ROSTER_SIZE/DISPLAY_BENCH_SLOT_COUNT match engine/positions.ts (${CAP_LIMIT}/${ROSTER_SIZE}/${BENCH_SLOT_COUNT})`);
