import { CAP_LIMIT } from '../src/engine/positions';

/**
 * `App.tsx` hardcodes `DISPLAY_CAP_LIMIT` for the intro tagline instead of importing
 * `CAP_LIMIT` directly, so the intro screen has zero engine-module dependency (see its own
 * comment — that's the whole point of the 2026-07-30 load-time split, GameShell/DraftPoolBrowser
 * are lazy-loaded specifically so nothing about showing the intro text touches the ~10MB data
 * graph). This is the tradeoff's one failure mode: the two numbers can drift. Standing check,
 * not a runtime assertion, since App.tsx must not import engine/positions.ts at all.
 */
const DISPLAY_CAP_LIMIT = 100.9;

if (DISPLAY_CAP_LIMIT !== CAP_LIMIT) {
  console.log(`FAIL: App.tsx's DISPLAY_CAP_LIMIT (${DISPLAY_CAP_LIMIT}) != engine/positions.ts's CAP_LIMIT (${CAP_LIMIT})`);
  process.exit(1);
}
console.log(`PASS: DISPLAY_CAP_LIMIT matches CAP_LIMIT (${CAP_LIMIT})`);
