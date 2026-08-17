import heightByName from './awards/height.json';
import { normalizePlayerName } from './schema';

/**
 * Real player height (inches, no shoes), from `scripts/buildHeightLookup.ts` — see that file's
 * own docstring for provenance and coverage (96.3% of the archive). Returns `undefined` for an
 * unmatched player rather than a guessed default — callers must treat "no data" as genuinely
 * unknown, not average height, same as every other partial-coverage real-data lookup in this
 * project (DARKO, WOWYR).
 */
export function getHeightInches(playerName: string): number | undefined {
  return (heightByName as Record<string, number>)[normalizePlayerName(playerName)];
}
