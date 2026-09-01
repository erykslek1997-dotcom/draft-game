import allNbaData from '../data/awards/allNba.json';
import allStarsData from '../data/awards/allStars.json';
import { normalizeAwardName } from './allStarLookup';

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
