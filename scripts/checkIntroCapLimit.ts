import { CAP_LIMIT, ROSTER_SIZE, BENCH_SLOT_COUNT } from '../src/engine/positions';
import { QUICK_CAP_LIMIT } from '../src/engine/quickDraft';

/**
 * `App.tsx` hardcodes `DISPLAY_ROSTER_SIZE` for the Draft mode card's description instead of
 * importing `ROSTER_SIZE` directly, so the intro screen has zero engine-module dependency (see
 * its own comment — that's the whole point of the 2026-07-30 load-time split, GameShell/
 * DraftPoolBrowser are lazy-loaded specifically so nothing about showing the intro text touches
 * the ~10MB data graph). This is the tradeoff's one failure mode: the two numbers can drift.
 * Standing check, not a runtime assertion, since App.tsx must not import engine/positions.ts at
 * all.
 *
 * 2026-09-11: extended to `DISPLAY_QUICK_CAP_LIMIT`, for the Szybka 5 mode card's own one-line
 * description on the same intro screen (`quickDraft.ts` is real engine weight too — same
 * zero-engine-dependency reasoning as everything else this check covers).
 *
 * 2026-09-17: `DISPLAY_CAP_LIMIT`/`DISPLAY_BENCH_SLOT_COUNT` dropped along with the old tagline/
 * How to Play copy (Hoopverse rebrand), then REVIVED same day for the mode cards' own "?"
 * popovers (user's own ask — full rules a glance away, right on the menu).
 */
const DISPLAY_CAP_LIMIT = 100.9;
const DISPLAY_ROSTER_SIZE = 9;
const DISPLAY_BENCH_SLOT_COUNT = 4;
const DISPLAY_QUICK_CAP_LIMIT = 70;

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
if (DISPLAY_QUICK_CAP_LIMIT !== QUICK_CAP_LIMIT) {
  console.log(`FAIL: App.tsx's DISPLAY_QUICK_CAP_LIMIT (${DISPLAY_QUICK_CAP_LIMIT}) != quickDraft.ts's QUICK_CAP_LIMIT (${QUICK_CAP_LIMIT})`);
  ok = false;
}
if (!ok) process.exit(1);
console.log(`PASS: DISPLAY_CAP_LIMIT/DISPLAY_ROSTER_SIZE/DISPLAY_BENCH_SLOT_COUNT/DISPLAY_QUICK_CAP_LIMIT match the engine (${CAP_LIMIT}/${ROSTER_SIZE}/${BENCH_SLOT_COUNT}/${QUICK_CAP_LIMIT})`);
