/**
 * Temporary A/B-test profile for the AI draft.
 *
 * Keep the switches in one place so the established rules remain available for a clean
 * comparison after the test instead of being deleted or commented out across the engine.
 *
 * 2026-09-09, user's call after live-play feedback ("gra działa wolno" on the draft +
 * "AI draftuje słabo"): reverted the two switches that were deviating from the established
 * defaults. `usePeakOnlyPool: false` made the draft (and `DraftBoard`'s per-span scoring memo)
 * run over the full ~9451-span `draftPool` instead of the ~1223-entry peak-only pool — a full
 * 16-team auto-finish measured at 204s. `greatestPeakBonus: false` disabled the tuned
 * legend-priority nudge (60/35/15), so Jordan/LeBron/Curry-tier peaks slid in the AI order.
 * Both restored to the pre-experiment defaults `peakDraftPool.ts`'s own docstring describes as
 * load-bearing ("Phase 1 behaves EXACTLY like today's one-step draft").
 */
export const DRAFT_EXPERIMENT = {
  usePeakOnlyPool: true,
  pruneToObservedAiPool: true,
  greatestPeakBonus: true,
  starterFiveLock: true,
  d1d2d3Preference: false,
} as const;
