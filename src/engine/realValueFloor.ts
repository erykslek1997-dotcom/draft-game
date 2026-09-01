import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { players } from '../data/players';
import { blendedRealValueForSpan } from './blendedRealValueLookup';
import { madeAllNbaInSpan } from './allNbaLookup';
import type { OverallTier } from './grades';

/**
 * 2026-09-01, user-reported (Chris Bosh / Pau Gasol / LaMarcus Aldridge reading Role Player / Sixth
 * Man): a real, measured structural gap. `computeTalent`'s box-score base rewards efficiency and
 * assists heavily, so a high-volume mid-range scoring big (Bosh 22.5/9.4, O-TAL 65; Aldridge
 * 23.3/10.7, O-TAL 58; Rasheed Wallace) grades ~Role Player on the box even when the real
 * plus-minus record (DARKO ddpm + historical APM, blended in `blendedRealValueLookup`) puts their
 * impact at +4 — higher than Chris Webber (+3.4, model MVP) or Kevin Love (+3.8, model All-NBA).
 * `hiddenValueBonus` (historicalApmCorrection) only nudges +2-3 there, and raising its scale
 * breaks the Taylor top-10 (0.891 -> 0.72).
 *
 * This is a TIER-LAYER floor, same shape as the (reverted) accolade floor and the `NAMED_TIER_*`
 * maps — it never touches `computeTalent` / the Taylor-validated blend, only the displayed tier in
 * `overallTierForSpan`. Deliberately:
 * - **Modern-era only** (`rv.isModernEra`) — the DARKO/APM blend is reliable ~1997+.
 * - **Sustained** — the player must clear `SUSTAINED_BAR` in at least `SUSTAINED_MIN_SPANS` of
 *   their own spans, so one noisy plus-minus season can't manufacture a tier. A genuine HoF-level
 *   impact player has this many times over; a fluke doesn't.
 * - **Capped at 'All-star'** — real plus-minus rewards role/fit/team context that this project
 *   deliberately doesn't let drive All-NBA+ (that stays the Taylor/GOAT gates' territory).
 * - **Raises only**, and yields to an explicit `NAMED_TIER_DOWNCAPS` entry for the same span.
 */
const STARTER_FLOOR_RV = 3.5;
const ALLSTAR_FLOOR_RV = 4.6;
/** Lower All-star bar for a span the league itself voted top-15 (an in-window All-NBA team) — the
 * `blendedRealValue` signal saturates/clusters near 4.0-4.5 for a lot of genuine stars, and a real
 * All-NBA selection that year is a strong independent corroboration that this specific span was
 * All-star-caliber. Chris Bosh 2007-09 (All-NBA 2nd 2007, rv 4.12), LaMarcus Aldridge 2011-15,
 * Amar'e 2007-09 (All-NBA 1st 2007) all land here; a defense-first role player who never made an
 * All-NBA team (Danny Green, Mookie Blaylock) does not. */
const ALLSTAR_FLOOR_RV_WITH_ALL_NBA = 4.0;
const SUSTAINED_BAR = 3.0;
const SUSTAINED_MIN_SPANS = 3;

const sustained = new Set<string>();
{
  const counts = new Map<string, number>();
  for (const s of players) {
    const rv = blendedRealValueForSpan(s);
    if (rv && rv.isModernEra && rv.value >= SUSTAINED_BAR) {
      const k = normalizePlayerName(s.playerName);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  for (const [k, c] of counts) if (c >= SUSTAINED_MIN_SPANS) sustained.add(k);
}

export type RealValueFloor = Extract<OverallTier, 'All-star' | 'Starter'> | null;

export function realValueTierFloor(span: PlayerSpan): RealValueFloor {
  if (!sustained.has(normalizePlayerName(span.playerName))) return null;
  const rv = blendedRealValueForSpan(span);
  if (!rv || !rv.isModernEra) return null;
  const allStarBar = madeAllNbaInSpan(span.playerName, span.spanLabel)
    ? ALLSTAR_FLOOR_RV_WITH_ALL_NBA
    : ALLSTAR_FLOOR_RV;
  if (rv.value >= allStarBar) return 'All-star';
  if (rv.value >= STARTER_FLOOR_RV) return 'Starter';
  return null;
}
