import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import { buildDarkoYearMap } from './darkoLookup';
import { buildRaptorYearMap } from './raptorLookup';
import { buildMatchupDefenseYearMap } from './matchupDefenseLookup';
import { buildBpm2YearMap } from './bpm2Lookup';

/**
 * Real DARKO ddpm and real RAPTOR defense (see raptorLookup.ts for provenance) — a per-source
 * coverage lookup, NOT a blended value. Added 2026-07-31, motivated directly: comparing Shane
 * Battier (TAL 65) against OG Anunoby (TAL 58) found 86% of their entire TAL gap traced to
 * `darkoDefenseBonus`'s reaction to DARKO's ddpm alone — a single real source, with no
 * independent check on whether its specific read for a given span is representative or an
 * artifact of that one methodology. RAPTOR (FiveThirtyEight, a genuinely different real
 * plus-minus methodology) cross-validated at r=0.696 against DARKO on possession-filtered
 * overlapping player-seasons before being trusted here.
 *
 * **Deliberately exposes each source's own average separately, rather than blending them into
 * one number here.** First version did blend the raw values into one number and fit a single
 * regression against box defense to that blend — but DARKO and RAPTOR turned out to have
 * genuinely different relationships with box defense on their own (fit independently: DARKO's
 * own slope 0.087, RAPTOR's own slope 0.114 against the same box-defense measure), not just
 * different noise levels. Averaging the raw values first and fitting ONE regression to the
 * blend produces a line that sits awkwardly between two different true relationships — every
 * span then gets judged against a standard neither source actually predicts on its own, which
 * quietly punished real, established defenders (Shaquille O'Neal's 1999-2001 peak, real DARKO
 * +2.0 and real RAPTOR +2.3 — both genuinely plus readings — blended-then-regressed to an
 * excess of essentially zero). `darkoCorrection.ts` now fits each source's OWN regression, takes
 * each source's OWN excess over ITS OWN expectation, and blends the excesses — not the raw
 * inputs — so each source's idiosyncratic relationship with box defense is normalized away
 * before anything gets averaged.
 */
const ddpmByNameYear = buildDarkoYearMap('ddpm');
const raptorByNameYear = buildRaptorYearMap();
const matchupByNameYear = buildMatchupDefenseYearMap();
const bpm2ByNameYear = buildBpm2YearMap();

export interface SourceCoverage {
  avg: number;
  count: number;
}

/**
 * The pool de-dup (2026-08) made "Ron Artest" the single canonical span name for his whole
 * 1999-2017 career, but every real plus-minus source here (DARKO, RAPTOR, BPM2) only ever keys
 * him as "Metta World Peace" -- so without this alias his entire career got ZERO real-data
 * correction and his post-decline, post-All-Defense spans (2008-13) read pure box: D-TAL 45-56
 * for the primary wing defender of the 2010 champions. `availabilityLookup.ts` and
 * `pipmLookup.ts` already carry the exact same one-entry alias for the exact same reason. */
const REAL_DATA_NAME_ALIASES: Record<string, string> = {
  [normalizePlayerName('Ron Artest')]: normalizePlayerName('Metta World Peace'),
};

function coverageForSpan(span: PlayerSpan, byNameYear: Map<string, Map<number, number>>): SourceCoverage | null {
  const norm = normalizePlayerName(span.playerName);
  const yearMap = byNameYear.get(REAL_DATA_NAME_ALIASES[norm] ?? norm);
  if (!yearMap) return null;
  const values = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((v): v is number => v !== undefined);
  if (values.length === 0) return null;
  return { avg: values.reduce((sum, v) => sum + v, 0) / values.length, count: values.length };
}

export function ddpmCoverageForSpan(span: PlayerSpan): SourceCoverage | null {
  return coverageForSpan(span, ddpmByNameYear);
}

export function raptorCoverageForSpan(span: PlayerSpan): SourceCoverage | null {
  return coverageForSpan(span, raptorByNameYear);
}

/** 2026-08-03: real player-vs-player matchup defense (see matchupDefenseLookup.ts) — a third
 * independent real defensive source, structurally different from both DARKO and RAPTOR (direct
 * matchup shooting data, not a team-level plus-minus regression). Modern-only (2017-18+). */
export function matchupCoverageForSpan(span: PlayerSpan): SourceCoverage | null {
  return coverageForSpan(span, matchupByNameYear);
}

/** 2026-08-05: the user's own "BPM 2.0" model (see bpm2Lookup.ts) — near-full historical
 * coverage (1951-52+), but ONLY ever consulted by `darkoCorrection.ts`'s `blendedExcess` as a
 * last-resort fallback when NONE of ddpm/raptor/matchup cover a span. This coverage function
 * itself is source-agnostic (same shape as the other three); the exclusivity gate lives in
 * `blendedExcess`, not here. */
export function bpm2CoverageForSpan(span: PlayerSpan): SourceCoverage | null {
  return coverageForSpan(span, bpm2ByNameYear);
}
