import { normalizePlayerName } from './schema';

/**
 * 2026-09-25, found auditing pre-1997 rim pressure (the user: "sprawdź dokładnie dane"): 27 pool
 * players never matched the box-rates export and a handful never matched the shot-zone export,
 * because the sources spell them differently — Tiny Archibald 1971-73 (the league's free-throw
 * leader) read as having no free throws at all, Jimmy Butler had no shot-location data anywhere.
 * `normalizePlayerName` only strips accents and case, so none of these could match on their own.
 *
 * Pool name -> the source spellings to also read. Rows are MERGED by season (a player can appear
 * under two names in one export — "Jimmy Butler" through 2024-25, "Jimmy Butler III" after).
 * Every entry was checked against the source's own seasons (e.g. "Rob Williams" is a different,
 * 1982-83 player; "Robert Williams III" is the pool's 2020-22 span). Not found in either export:
 * Barry Clemens, Red Kerr (only "Johnny Kerr", same player — added), Ronald Murray ("Flip Murray").
 */
const ALIASES: Record<string, string[]> = {
  'Ron Artest': ['Metta World Peace'],
  'Tiny Archibald': ['Nate Archibald'],
  'Ömer Aşık': ['Omer Asik'],
  'World B. Free': ['World Free'],
  'A.J. Green': ['AJ Green'],
  'Gar Heard': ['Garfield Heard'],
  'Nenê': ['Nene Hilario'],
  'Ron Holland': ['Ronald Holland II'],
  'Red Kerr': ['Johnny Kerr'],
  'Fat Lever': ['Lafayette Lever'],
  'KJ Martin': ['Kenyon Martin Jr.'],
  'Roger Mason': ['Roger Mason Jr.'],
  'C.J. Miles': ['CJ Miles'],
  'Marcus Morris': ['Marcus Morris Sr.'],
  'Ronald Murray': ['Flip Murray'],
  'A.J. Price': ['AJ Price'],
  'Michael Ray Richardson': ['Micheal Ray Richardson'],
  'Danny Schayes': ['Dan Schayes'],
  'Kenny Sears': ['Ken Sears'],
  'J.R. Smith': ['JR Smith'],
  'Steve Smith': ['Steven Smith'],
  'Melvin Turpin': ['Mel Turpin'],
  'Clarence Weatherspoon': ['Clar. Weatherspoon'],
  'Jo Jo White': ['Jojo White'],
  'Art Williams': ['Arthur Williams'],
  'Robert Williams': ['Robert Williams III'],
  'Jimmy Butler': ['Jimmy Butler III'],
};

/** Normalized pool name -> normalized source names. */
export const SOURCE_NAME_ALIASES: ReadonlyMap<string, string[]> = new Map(
  Object.entries(ALIASES).map(([pool, sources]) => [normalizePlayerName(pool), sources.map(normalizePlayerName)]),
);

/** Adds every alias to a name -> (season -> row) map, merging seasons into the pool name's own. */
export function applySourceNameAliases<Row>(byNameYear: Map<string, Map<number, Row>>): void {
  for (const [pool, sources] of SOURCE_NAME_ALIASES) {
    const merged = new Map(byNameYear.get(pool) ?? []);
    for (const source of sources) {
      for (const [year, row] of byNameYear.get(source) ?? []) {
        if (!merged.has(year)) merged.set(year, row);
      }
    }
    if (merged.size > 0) byNameYear.set(pool, merged);
  }
}
