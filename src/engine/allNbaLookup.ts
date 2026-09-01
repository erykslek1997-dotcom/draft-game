import allNbaData from '../data/awards/allNba.json';
import allStarsData from '../data/awards/allStars.json';
import { normalizeAwardName } from './allStarLookup';
import { spanEndYears } from './era';

/**
 * "Did this player ever make an All-Star team or any All-NBA team, at any point in their career."
 * Companion to `allStarLookup`'s `allStarCount` — same "reputation data, deliberately kept out of
 * the CORE box-score signal" boundary (see that file's docstring).
 *
 * Its one consumer is `talent.ts`'s spacing-boost taper (2026-09-01, uncommitted). The taper
 * de-inflates a span whose flat talent sits just under the star gate but rides the +18% spacing
 * multiplier to an All-NBA number (Mike James 2004-06 — one good season in Toronto, never an
 * All-Star, never All-NBA). It can't tell that fluke apart from a genuine prime span on the
 * counting stats alone. The user's rule: a player who earned real accolades *somewhere in their
 * career* is "validated" and exempt — the taper only ever touches players the league never once
 * recognized. (6th Man of the Year and Finals MVP are deliberately NOT in the check — the user
 * framed it as All-Star / All-NBA recognition specifically.)
 *
 * Same category of deliberate, targeted exception as `positionCorrectionFor`'s existing Magic
 * Johnson / center-spacing carve-outs — it modifies ONE correction term, not the raw talent sum,
 * and never touches `computeOffensiveTalent` / `computeDefensiveTalent` / the Taylor-validated
 * blend.
 */
interface AllNbaSeason {
  season: string;
  tiers: string[][];
}
interface AllStarRow {
  name: string;
  count: number;
}

const validated = new Set<string>();
for (const r of allStarsData as AllStarRow[]) {
  if (r.count > 0) validated.add(normalizeAwardName(r.name));
}
for (const s of allNbaData as AllNbaSeason[]) {
  for (const tier of s.tiers) {
    for (const n of tier) validated.add(normalizeAwardName(n));
  }
}

/** True if the player was ever named an All-Star or to any All-NBA team, career-wide. */
export function wasEverAllStarCaliber(playerName: string): boolean {
  return validated.has(normalizeAwardName(playerName));
}

/** name -> Set of season-END years the player made any All-NBA team. */
const allNbaEndYears = new Map<string, Set<number>>();
for (const s of allNbaData as { season: string; tiers: string[][] }[]) {
  const endYear = parseInt(s.season.slice(0, 4), 10) + 1;
  for (const tier of s.tiers) {
    for (const n of tier) {
      const k = normalizeAwardName(n);
      let set = allNbaEndYears.get(k);
      if (!set) allNbaEndYears.set(k, (set = new Set()));
      set.add(endYear);
    }
  }
}

/** True if the player made an All-NBA team in a season this span's label covers, OR the year
 * immediately before it starts — a 3-year span like "2007-09" (seasons ending 2008-2009) belongs
 * to an All-NBA-caliber stretch if the selection came in 2007. An in-window top-15 vote is a much
 * stronger corroborating signal than a career-wide check for a floor. */
export function madeAllNbaInSpan(playerName: string, spanLabel: string): boolean {
  const set = allNbaEndYears.get(normalizeAwardName(playerName));
  if (!set) return false;
  const years = spanEndYears(spanLabel);
  if (years.length === 0) return false;
  return years.some((y) => set.has(y)) || set.has(years[0] - 1);
}
