/**
 * Temporary A/B-test profile for the AI draft.
 *
 * Keep the switches in one place so the established rules remain available for a clean
 * comparison after the test instead of being deleted or commented out across the engine.
 */
export const DRAFT_EXPERIMENT = {
  usePeakOnlyPool: false,
  pruneToObservedAiPool: true,
  greatestPeakBonus: false,
  starterFiveLock: false,
  d1d2d3Preference: false,
} as const;
