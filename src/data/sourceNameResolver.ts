import { normalizePlayerName } from './schema';
import { spanEndYears } from '../engine/era';
import poolData from './draftPool.json';

/**
 * 2026-09-25, full audit of every name-keyed source against the draft pool (the user: "dokładny
 * audyt"): the sources spell players their own way, and `normalizePlayerName` (accents + case
 * only) matched none of it. What that cost, before this file:
 *  - Accolades: Hakeem's five 1986-90 All-NBA teams (listed as "Akeem"), all of Tiny Archibald's
 *    ("Nate"), Penny Hardaway's ("Penny" vs the pool's "Anfernee"), Amar'e's 2005-08 ("Amare").
 *  - Real-value / defense sources: Jimmy Butler ("Jimmy Butler III"), J.R. Smith ("JR Smith"),
 *    Steve Smith ("Steven Smith"), Nenê ("Nene Hilario"), Enes Freedom ("Enes Kanter") and ~20 more
 *    read as having no data at all.
 *  - Father/son: one source's "Larry Nance" is the son while the father is "Larry Nance Sr."; one
 *    source files Tim Hardaway Jr.'s seasons under "Tim Hardaway". A name alone can't split them.
 *
 * `resolveSourceName(name, seasonEndYear?)` turns a SOURCE row's name into the pool's key:
 *  1. The exact normalized name, when it's a pool player active around that season.
 *  2. An explicit nickname/legal-name alias below (each verified — points per game match the pool
 *     span season by season, or it's a documented name change).
 *  3. The canonical form (no periods, apostrophes, Jr./Sr./II/III, dotless ı) matched to the one
 *     pool player of that form active that season — "J.J. Redick" = "JJ Redick", "Larry Nance Sr."
 *     = the pool's 1980s "Larry Nance", a 2017 "Larry Nance" row = "Larry Nance Jr.".
 *  4. Otherwise the plain normalized name (a player outside the pool, or out of any pool years —
 *     spans only ever read their own seasons, so such rows are simply never read).
 * Pool-side lookups keep keying by `normalizePlayerName(span.playerName)`.
 */
const EXPLICIT: Record<string, string> = {
  // source spelling -> pool name
  'Nate Archibald': 'Tiny Archibald',
  'Lafayette Lever': 'Fat Lever',
  'World Free': 'World B. Free',
  'Lloyd Free': 'World B. Free',
  'Micheal Ray Richardson': 'Michael Ray Richardson',
  'Steven Smith': 'Steve Smith',
  'Ken Sears': 'Kenny Sears',
  'Jojo White': 'Jo Jo White',
  'Flip Murray': 'Ronald Murray',
  'Johnny Kerr': 'Red Kerr',
  'Dan Schayes': 'Danny Schayes',
  'Clar. Weatherspoon': 'Clarence Weatherspoon',
  'Mel Turpin': 'Melvin Turpin',
  'Garfield Heard': 'Gar Heard',
  'Kenyon Martin Jr.': 'KJ Martin',
  'Ronald Holland II': 'Ron Holland',
  'Arthur Williams': 'Art Williams',
  'John Clemens': 'Barry Clemens',
  'Metta World Peace': 'Ron Artest',
  'Nene Hilario': 'Nenê',
  'Nene': 'Nenê',
  'Akeem Olajuwon': 'Hakeem Olajuwon',
  'Penny Hardaway': 'Anfernee Hardaway',
  'Lew Alcindor': 'Kareem Abdul-Jabbar',
  'Enes Kanter': 'Enes Freedom',
  'Dennis Schroeder': 'Dennis Schröder',
  'Nicolas Claxton': 'Nic Claxton',
  'Louis Williams': 'Lou Williams',
  'Patrick Mills': 'Patty Mills',
  'Jose Barea': 'J.J. Barea',
  'Ishmael Smith': 'Ish Smith',
  'Sviatoslav Mykhailiuk': 'Svi Mykhailiuk',
  'Wesley Iwundu': 'Wes Iwundu',
  'Mike Holton': 'Michael Holton',
  'Andriej Kirilenko': 'Andrei Kirilenko',
  'Wayne Rollins': 'Tree Rollins',
  'Don Watts': 'Slick Watts',
  'George T. Johnson': 'George Johnson',
};

export function canonicalPlayerName(name: string): string {
  return normalizePlayerName(name)
    .replace(/ı/g, 'i')
    .replace(/[.,'’`]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const YEAR_SLACK = 2;
const poolYears = new Map<string, Set<number>>();
const poolByCanon = new Map<string, string[]>();
for (const span of poolData as { playerName: string; spanLabel: string }[]) {
  const key = normalizePlayerName(span.playerName);
  let years = poolYears.get(key);
  if (!years) {
    years = new Set();
    poolYears.set(key, years);
    const canon = canonicalPlayerName(span.playerName);
    poolByCanon.set(canon, [...(poolByCanon.get(canon) ?? []), key]);
  }
  for (const y of spanEndYears(span.spanLabel)) years.add(y);
}
const explicitByCanon = new Map(
  Object.entries(EXPLICIT).map(([source, pool]) => [canonicalPlayerName(source), normalizePlayerName(pool)]),
);

function activeAround(key: string, year: number | undefined): boolean {
  if (year === undefined) return true;
  const years = poolYears.get(key);
  if (!years) return false;
  for (let d = -YEAR_SLACK; d <= YEAR_SLACK; d++) if (years.has(year + d)) return true;
  return false;
}

const cache = new Map<string, string>();
export function resolveSourceName(name: string, seasonEndYear?: number): string {
  const cacheKey = `${name}|${seasonEndYear ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  const key = normalizePlayerName(name);
  let out = key;
  if (!(poolYears.has(key) && activeAround(key, seasonEndYear))) {
    const canon = canonicalPlayerName(name);
    const explicit = explicitByCanon.get(canon);
    if (explicit) out = explicit;
    else {
      const candidates = (poolByCanon.get(canon) ?? []).filter((k) => k !== key && activeAround(k, seasonEndYear));
      if (candidates.length === 1) out = candidates[0];
    }
  }
  cache.set(cacheKey, out);
  return out;
}

/** Season end-year of a "1996-97" / "1997" style season label. */
export function seasonEndYearOf(season: string | number): number {
  const s = String(season);
  return s.includes('-') ? parseInt(s.slice(0, 4), 10) + 1 : parseInt(s, 10);
}
