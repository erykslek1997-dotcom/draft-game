import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import { buildDarkoYearMap } from './darkoLookup';
import { buildHistoricalApmYearMap } from './historicalApmLookup';
import { buildPipmYearMap } from './pipmLookup';

/**
 * Coverage-weighted blend of real DARKO dpm, real historical APM (see historicalApmLookup.ts
 * for provenance/known gaps), and real PIPM (see pipmLookup.ts - added 2026-07-31 specifically
 * because it fills historicalApm's documented Bird/Kareem/McHale/Magic/Parish/Isiah/Wilkins
 * gaps) - shared by impact.ts (informational) and historicalApmCorrection.ts (feeds
 * computeTalent) so both read "real total plus-minus value" the same way, the same reason
 * darkoLookup.ts is shared between darkoCorrection.ts and impact.ts.
 *
 * Blends rather than picking one source outright: found directly comparing DARKO and historical
 * APM for Rasheed Wallace's 1998-00 span - DARKO's dpm reads a modest +1 there (its own earliest
 * tracked seasons, right at 1997-98, are its least-stabilized - DARKO needs several surrounding
 * years to regularize), while the fuller historical-APM reading for the same real seasons is
 * +6.65. A strict "first source with any coverage wins" priority let that thin early-DARKO
 * reading silently override the fuller number. Coverage-weighting instead means whichever
 * source(s) actually have more of the span's years count for more, without guessing which
 * source is "right" - the same reasoning extends cleanly to a third source. PIPM/historicalApm
 * cross-validated at r=0.736 across 9,904 overlapping player-seasons before being trusted
 * together here (see pipmLookup.ts) - close enough to blend, not so close either could just
 * replace the other outright.
 *
 * `isModernEra` (true whenever DARKO contributes at all) tells callers which era a span belongs
 * to for regression-fitting purposes - a genuinely pre-1997 span (historical APM and/or PIPM
 * only, no DARKO overlap) needs its own era-appropriate regression rather than one calibrated
 * mostly off modern-era spans (which vastly outnumber the pre-1997 ones in the combined pool).
 */
const dpmByNameYear = buildDarkoYearMap('dpm');
const historicalApmYearMap = buildHistoricalApmYearMap();
const pipmYearMap = buildPipmYearMap();

function coverageForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): { avg: number; count: number } | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return { avg: values.reduce((sum, v) => sum + v, 0) / values.length, count: values.length };
}

export function blendedRealValueForSpan(span: PlayerSpan): { value: number; isModernEra: boolean } | null {
  const dpmCov = coverageForSpan(span, dpmByNameYear);
  const apmCov = coverageForSpan(span, historicalApmYearMap);
  const pipmCov = coverageForSpan(span, pipmYearMap);
  const covs = [dpmCov, apmCov, pipmCov].filter((c): c is { avg: number; count: number } => c !== null);
  if (covs.length === 0) return null;
  const totalWeight = covs.reduce((sum, c) => sum + c.count, 0);
  const value = covs.reduce((sum, c) => sum + c.avg * c.count, 0) / totalWeight;
  return { value, isModernEra: dpmCov !== null };
}
