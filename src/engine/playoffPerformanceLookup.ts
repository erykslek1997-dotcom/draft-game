import type { PlayerSpan } from '../data/schema';
import playoffCollapseData from '../data/awards/playoffCollapse.json';

const DATA = playoffCollapseData as Record<string, number>;

/**
 * 2026-08-12: replaced the old, PBP-shot-derived `playoffPerformance.json` (153/5205 spans,
 * 2.9% coverage) with `playoffCollapse.json` (3095 spans, ~59%) — see `scripts/buildPlayoffCollapse.ts`
 * for the full real methodology (real playoff-vs-regular TS% delta, real opponent-DRtg-faced
 * toughness adjustment, no team win/round-advanced gating). Old file kept as
 * `playoffPerformance.before.json` for reference, not read by any code. Same underlying real
 * signal now also feeds `grades.ts`'s `playoffCollapse`-driven tier cap (see that file) for the
 * elite-tier population this additive term can't move on its own (softCapTalent absorption,
 * confirmed directly: even a heavily scaled-up malus barely moved TAL for raw values above ~110).
 *
 * Flat TAL bonus/penalty from real playoff shooting efficiency (TS%) vs. regular season, per span,
 * ±5 range. Not gated on team wins/rounds advanced at all (the old mechanism's approach, replaced
 * specifically because it wasn't — see the 2026-08-12 note above): instead, a real drop is
 * softened when the player faced genuinely tough opponent defenses that postseason (measured, not
 * assumed) and left alone otherwise, whether or not the team won. Full method, thresholds and the
 * two real data sources are documented in `scripts/buildPlayoffCollapse.ts`, the single source of
 * truth for how `playoffCollapse.json` was computed — this docstring intentionally doesn't
 * duplicate it.
 *
 * **A same-day FG%-only variant of the old TS%-based mechanism (makes/attempts, no free throws)
 * was tried, found to further erode Taylor top-10/GOAT-40 correlation (0.806->0.794, 0.605->0.588)
 * beyond the already user-accepted TS%-based tradeoff, and reverted at the user's explicit "leave
 * it as it was." TS% (not EFG%, not raw FG%) is the shipped metric here — re-derive only if asked.**
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

/** 2026-08-12: `playoffCollapse.json`'s values are continuous (±5 range, 0.1 resolution), not the
 * old file's exact 8-value set — banded by magnitude instead of exact-matched. Bands split the
 * real ±5 range into even quarters (≤1 / ≤2.5 / ≤4 / ≤5), same 4-tier-per-direction shape as
 * before. */
function tierForMagnitude(bonus: number): PlayoffPerformanceTier {
  const dropper: PlayoffPerformanceTier[] = ['Bronze Dropper', 'Silver Dropper', 'Gold Dropper', 'Platinum Dropper'];
  const riser: PlayoffPerformanceTier[] = ['Bronze Riser', 'Silver Riser', 'Gold Riser', 'Platinum Riser'];
  const bands = bonus < 0 ? dropper : riser;
  const mag = Math.abs(bonus);
  if (mag <= 1) return bands[0];
  if (mag <= 2.5) return bands[1];
  if (mag <= 4) return bands[2];
  return bands[3];
}

export function playoffPerformanceTier(span: PlayerSpan): PlayoffPerformanceTier | null {
  const bonus = DATA[span.id];
  return bonus ? tierForMagnitude(bonus) : null;
}
