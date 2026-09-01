import { normalizePlayerName } from '../data/schema';
import allStarsData from '../data/awards/allStars.json';

/**
 * Career All-Star selection count, purely for the player-mode draft board's sort order — a
 * deliberately different use of the awards data from `computeTalent`, which ignores accolades
 * entirely (matches Taylor's own stated methodology, see the project's "known, accepted gaps").
 * Sorting a *display list* by real-world reputation instead of the judge's own TAL number is
 * exactly what makes player mode a blind scouting exercise rather than "developer mode with the
 * numbers scribbled out" — the list order itself was still leaking TAL's opinion before this.
 */
interface AllStarRow {
  name: string;
  count: number;
  years: number[];
}
const allStars = allStarsData as AllStarRow[];

/** The source table carries Basketball-Reference footnote marks on some names (Hall-of-Fame
 * dagger `†`, active-player `§`, etc. — Kyle Lowry†, Gordon Hayward§) that `normalizePlayerName`
 * doesn't strip, so a raw normalize would silently miss those players. */
export function normalizeAwardName(name: string): string {
  return normalizePlayerName(name.replace(/[†§*^‡]/g, '').trim());
}

const countByName = new Map<string, number>();
for (const r of allStars) countByName.set(normalizeAwardName(r.name), r.count);

export function allStarCount(playerName: string): number {
  return countByName.get(normalizeAwardName(playerName)) ?? 0;
}
