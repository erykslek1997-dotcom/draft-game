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
 * `usePeakOnlyPool` was flipped to `true` in the same pass and then reverted: the peak-only pool
 * (~1223, one span per player) lacks the sub-2-FGA glue spans the full pool carries, so
 * `isPickLegal`'s cap dead-end escape hatch (draft.ts — a forced cheapest pick when nothing fits
 * under cap, to avoid an 8-man roster) fires far more often and pushes a team past the 100.9 FGA
 * cap (`testDraftRulesSlow` seed 29: Topeka Turtles reach 101.1). Left `false` until the peak
 * pool carries a real cheap span for glue players, or the escape hatch is reworked to stop
 * short rather than overspend.
 */
export const DRAFT_EXPERIMENT = {
  usePeakOnlyPool: false,
  pruneToObservedAiPool: true,
  greatestPeakBonus: true,
  starterFiveLock: true,
  d1d2d3Preference: false,
} as const;
