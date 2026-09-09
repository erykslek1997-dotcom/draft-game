/**
 * Temporary A/B-test profile for the AI draft.
 *
 * Keep the switches in one place so the established rules remain available for a clean
 * comparison after the test instead of being deleted or commented out across the engine.
 *
 * 2026-09-09, user's call after live-play feedback ("AI draftuje słabo"): re-enabled
 * `greatestPeakBonus` — the tuned legend-priority nudge (60/35/15) was off, so
 * Jordan/LeBron/Curry-tier peaks slid in the AI order.
 *
 * `spanPoolMode` — which span pool a draft draws from:
 *  - `'full'`  : the whole `draftPool` (9451 spans, every player × every career window).
 *  - `'peak'`  : `peakDraftPool` (1223, one span per player). Flipped on 2026-09-09 and reverted
 *    the same day — collapsing everyone to one span strips the sub-2-FGA glue windows that
 *    `isPickLegal`'s cap dead-end escape hatch (draft.ts — a forced cheapest pick when nothing
 *    fits under cap, to avoid an 8-man roster) relies on, pushing a team past the 100.9 FGA cap
 *    (`testDraftRulesSlow` seed 29: Topeka Turtles reach 101.1).
 *  - `'lean'`  : `leanDraftPool` (~5200) — the user's refinement: peak-only for genuine offensive
 *    hubs, but every career window kept for role players / low-usage bigs (peak FGA < 12), so the
 *    cap dead-end can't be forced while the AI's candidate scan still shrinks ~45%.
 */
export const DRAFT_EXPERIMENT = {
  spanPoolMode: 'lean' as 'full' | 'peak' | 'lean',
  pruneToObservedAiPool: true,
  greatestPeakBonus: true,
  starterFiveLock: true,
  d1d2d3Preference: false,
} as const;
