import type { PlayerSpan } from '../data/schema';
import playoffPerformanceData from '../data/awards/playoffPerformance.json';

const DATA = playoffPerformanceData as Record<string, number>;

/**
 * Flat TAL bonus/penalty from real playoff shooting efficiency (TS%) vs. regular season,
 * relative to the league-wide average drop (playoffs are tougher across the board, so raw
 * zero isn't the right baseline — see MEMORY.md for the full derivation).
 *
 * **A same-day FG%-only variant (makes/attempts, no free throws) was tried, found to further
 * erode Taylor top-10/GOAT-40 correlation (0.806->0.794, 0.605->0.588) beyond the already
 * user-accepted TS%-based tradeoff, and reverted at the user's explicit "leave it as it was."
 * TS% is the shipped, current metric — don't re-derive FG% again without being asked.**
 *
 * Rise tiers are gated on actual playoff series wins: the raw efficiency excess sets a CEILING
 * tier (platinum/gold/silver), and how far the team actually advanced that postseason (bronze =
 * won round 1, silver = won round 2, gold = won the conference finals, platinum = won it all)
 * determines how much of that ceiling is unlocked — team success can only pull the tag DOWN from
 * the efficiency ceiling, never up. This stops a player from earning a "riser" tag purely by
 * padding efficiency on a team that never won anything (Tracy McGrady was the motivating case).
 * Drop tiers go one level higher too (Platinum -8, excess <= -6.5) for the most extreme real
 * collapses.
 *
 * Drop tiers ARE ALSO shaped by real team success, mirroring the rise side's logic but in the
 * opposite direction — a real efficiency collapse shouldn't read the same whether the team won
 * anyway or flamed out early:
 * - **A true first option (span FGA > 15) who at least reached the Finals is fully exempted**
 *   from any drop tag, regardless of raw TS% excess — their efficiency dip is the cost of
 *   being the focal point of a defense during a real title-contending run, not a competitive
 *   failure. This is a real, general rule, not a named-player carve-out: it independently
 *   exempts Jordan, Kobe, LeBron (several spans), Durant, Curry (two title runs), Jokić (two
 *   title runs), Tatum, Dončić, Malone's two Finals runs, Giannis 2020-22, and both Shai
 *   Gilgeous-Alexander title spans — the whole population of genuine go-to scorers on real
 *   championship-or-Finals teams, not a hand-picked list.
 * - **Any other span whose team still won real playoff success gets its penalty capped**, not
 *   removed: won the title -> capped at Bronze, lost the Finals -> capped at Silver, lost the
 *   conference finals -> capped at Gold, anything less -> the full raw penalty stands. This is
 *   what happens to Jrue Holiday's 2020-22 span (14.1 FGA, below the first-option bar, so not
 *   exempted) — his real TS% collapse was the single most extreme in the whole dataset, but the
 *   2021 title caps it at Bronze rather than the raw Platinum his numbers alone would imply.
 * - Spans with zero playoff series wins that postseason get neither the exemption nor the cap —
 *   a real collapse on a team that also lost immediately stays at its full raw tier.
 * Precomputed from 1996-2024 play-by-play shot/free-throw data (see scripts/awards source),
 * keyed by span id since it's a one-off precomputed tag, not a per-year lookup.
 */
export function playoffPerformanceBonus(span: PlayerSpan): number {
  return DATA[span.id] ?? 0;
}

export type PlayoffPerformanceTier =
  | 'Platinum Dropper'
  | 'Gold Dropper'
  | 'Silver Dropper'
  | 'Bronze Dropper'
  | 'Bronze Riser'
  | 'Silver Riser'
  | 'Gold Riser'
  | 'Platinum Riser';

/** The delta value alone uniquely identifies the tier (each of the 8 tiers maps to exactly one
 * of the 8 possible nonzero values), so this is a pure lookup, not a re-derivation of the
 * underlying TS%/series-win logic that produced `playoffPerformance.json` in the first place. */
const TIER_BY_DELTA: Record<number, PlayoffPerformanceTier> = {
  [-8]: 'Platinum Dropper',
  [-6]: 'Gold Dropper',
  [-4]: 'Silver Dropper',
  [-2]: 'Bronze Dropper',
  [2]: 'Bronze Riser',
  [4]: 'Silver Riser',
  [6]: 'Gold Riser',
  [8]: 'Platinum Riser',
};

export function playoffPerformanceTier(span: PlayerSpan): PlayoffPerformanceTier | null {
  const bonus = DATA[span.id];
  return bonus ? TIER_BY_DELTA[bonus] ?? null : null;
}
