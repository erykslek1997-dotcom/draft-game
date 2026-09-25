import heightByName from './awards/height.json';
import weightByName from './awards/weight.json';
import { normalizePlayerName } from './schema';
import { resolveSourceName } from './sourceNameResolver';

/**
 * Source bio names re-keyed to the pool's own names (`sourceNameResolver.ts`: "jimmy butler iii",
 * "nene hilario", "nate archibald" ...). An exact source key always wins over an alias.
 */
function resolvedMap(source: Record<string, number>): Map<string, number> {
  const out = new Map<string, number>(Object.entries(source));
  for (const [name, value] of Object.entries(source)) {
    const key = resolveSourceName(name);
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}
const HEIGHT = resolvedMap(heightByName as Record<string, number>);
const WEIGHT = resolvedMap(weightByName as Record<string, number>);

/**
 * Real player height (inches, no shoes), from `scripts/buildHeightLookup.ts` — see that file's
 * own docstring for provenance and coverage (96.3% of the archive). Returns `undefined` for an
 * unmatched player rather than a guessed default — callers must treat "no data" as genuinely
 * unknown, not average height, same as every other partial-coverage real-data lookup in this
 * project (DARKO, WOWYR).
 */
export function getHeightInches(playerName: string): number | undefined {
  return HEIGHT.get(normalizePlayerName(playerName));
}

/** Real listed body mass from the same 6,692-row historical NBA bio export as height. */
export function getBodyWeightLbs(playerName: string): number | undefined {
  return WEIGHT.get(normalizePlayerName(playerName));
}
