import wowyrPrimeByName from '../data/awards/wowyrPrimeByName.json';

/**
 * Real-player-name -> Prime WOWYR. Precomputed by `scripts/precomputeCorrectionCoefficients.ts`
 * (2026-07-30, the load-time fix) rather than fuzzy-matched live against the full ~13,145-span
 * dataset every session — the matching logic (thinkingbasketball.net's inconsistent key formats:
 * usually "First.Last", but old-timers with common surnames stored surname-first or as a bare
 * surname) only needs to run once, since neither the dataset's real names nor the WOWYR source
 * ever change between sessions; shipping the full dataset just to rebuild the same ~650-entry
 * map was the actual cost, not the matching itself. The matching logic still lives in the
 * precompute script (duplicated, not deleted) for whenever it needs re-running — e.g. after the
 * dataset gains new players whose names might not have been matchable before.
 */
export function getPrimeWowyrByPlayerName(): Map<string, number> {
  return new Map(Object.entries(wowyrPrimeByName));
}
