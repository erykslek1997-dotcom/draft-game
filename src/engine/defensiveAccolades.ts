import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import allDefenseData from '../data/awards/allDefense.json';
import dpoyData from '../data/awards/dpoy.json';

/**
 * All-Defense / Defensive Player of the Year selections, as a 0-1 "was this span's defender
 * recognized as an individual stopper" rate.
 *
 * **This is a deliberate, scoped exception to the project's otherwise strict "accolades are
 * never a scoring input" rule** (which follows Ben Taylor's own methodology and still holds for
 * `computeTalent` — nothing in this file reaches TAL). The exception exists because the box
 * score is *structurally* blind to on-ball defense: `computeDefensiveImpact` is built from
 * steals, blocks and rebounds, which measure event generation and help-side/team defense, and
 * DARKO's DDPM is a team-level on/off measure that credits a defense's whole shell to everyone
 * in it (Stephen Curry's 2016-18 DDPM is +1.5 — real data crediting him for Golden State's
 * defense). Neither can see a lockdown point-of-attack defender: Bruce Bowen's box-score
 * defensive impact (15.6) is *below the dataset median for a small forward*, and his DARKO
 * bonus was already saturated at its cap, so no amount of rescaling those two signals could
 * ever rate him as anything but a non-defender. All-Defense voting is the only broad
 * historical record in this project of *perceived individual* defensive quality, going back to
 * 1968-69 — noisy and reputation-driven, which is exactly why it's capped, additive, and
 * confined to the D-TAL display metric.
 *
 * Per-year weights rather than a career count, because a grade describes one specific span:
 * a player's All-Defense years have to actually overlap the span being graded.
 */
/** 2026-08-03: first/second-team weights lowered from 0.9/0.55 — recalibrated by
 * `calibrateDefensiveTalent.ts` after matchup-defense data (a third real defensive source) was
 * added to `darkoDefenseBonus`/`darkoDefenseShortfall`, which the ladder's raw-defense input now
 * reads a real signal from that it didn't before; the calibration grid search re-ran against the
 * corrected 3-source blend rather than the stale DARKO-only regression it had silently been
 * using since RAPTOR was added. */
const DPOY_WEIGHT = 1;
const ALL_D_FIRST_WEIGHT = 0.75;
const ALL_D_SECOND_WEIGHT = 0.45;

/** Real name variants in the award exports that `normalizePlayerName` can't reconcile (it only
 * strips accents/case). Verified one at a time against the span dataset — the same class of fix
 * `buildD1D2D3Allowlist.ts` needed for the real-draft spreadsheets.
 *
 * `jaren jackson` is the load-bearing one: the All-Defense export lists Jaren Jackson Jr. under
 * his father's exact name, and **Jaren Jackson Sr. is a separate real player in this dataset**
 * (SG, 1996-2000). The per-year overlap check meant this silently cost Jr. his two 1st-team
 * selections rather than mis-crediting Sr., but it did cost them — his D-TAL was reading as a
 * non-DPOY defender. */
const AWARD_NAME_ALIASES: Record<string, string> = {
  'jaren jackson': 'Jaren Jackson Jr.',
  'andriej kirilenko': 'Andrei Kirilenko',
  'lew alcindor': 'Kareem Abdul-Jabbar',
  'wayne rollins': 'Tree Rollins',
  'don watts': 'Slick Watts',
  'george t. johnson': 'George Johnson',
  'micheal ray richardson': 'Michael Ray Richardson',
};

/** Both award exports carry a trailing "()" on many rows — an extraction artifact from the
 * source tables' footnote markers ("Walt Frazier ()"). Left unstripped it silently dropped ~25
 * selections, including Kareem's, Pippen's, Ewing's and Wade's. */
function awardKey(name: string): string {
  const cleaned = normalizePlayerName(name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' '));
  return normalizePlayerName(AWARD_NAME_ALIASES[cleaned] ?? cleaned);
}

const allDefenseRows = allDefenseData as { season: string; tiers: string[][] }[];

// name -> season end-year -> tier (1 = All-Defense 1st team, 2 = 2nd team)
const tierByNameYear = new Map<string, Map<number, number>>();
for (const row of allDefenseRows) {
  const endYear = parseInt(row.season.slice(0, 4), 10) + 1;
  row.tiers.forEach((tier, index) => {
    for (const name of tier) {
      const key = awardKey(name);
      let years = tierByNameYear.get(key);
      if (!years) {
        years = new Map();
        tierByNameYear.set(key, years);
      }
      years.set(endYear, index + 1);
    }
  });
}

const dpoyYearsByName = new Map<string, Set<number>>();
for (const row of dpoyData as { season: string; name: string }[]) {
  const endYear = parseInt(row.season.slice(0, 4), 10) + 1;
  const key = awardKey(row.name);
  let years = dpoyYearsByName.get(key);
  if (!years) {
    years = new Set();
    dpoyYearsByName.set(key, years);
  }
  years.add(endYear);
}

/** The award data's own coverage window (currently 1969-2024) — derived, not hardcoded, so
 * dropping in a newer export widens it automatically.
 *
 * 2026-08-07, made lazy (was two eager top-level `const`s): this module has no import of its
 * own that cycles back to it, but `individualDefenseRate` below is called from deep inside the
 * real `talent.ts` <-> `portability.ts` cycle (`talent.ts` -> `defensiveTalent.ts` ->
 * `defensiveAccolades.ts`, same shape `portability.ts`'s own `defenseTalentSortedByPosition` and
 * `grades.ts`'s S-thresholds already had to solve, see their comments for the fuller
 * explanation) — depending on which module the real app happens to reach FIRST on a cold boot,
 * a caller elsewhere in that cycle can invoke `individualDefenseRate` before this module's own
 * top-level `const`s below have run, throwing `ReferenceError: Cannot access 'AWARD_FIRST_YEAR'
 * before initialization`. Reproduced directly on a real browser cold load (not just a script),
 * which was the actual gap — scripts run through `tsx`/Node's own module resolution, which
 * doesn't hit this the same way native ESM does in the browser, so it never showed up in any of
 * this project's `scripts/` regression checks. Same fix as the other two: defer into a
 * lazily-cached function so the read only ever happens on first actual CALL, by which point the
 * whole module graph has finished its synchronous top-level evaluation regardless of the cycle. */
let awardYearRange: { first: number; last: number } | null = null;
function awardCoverageWindow(): { first: number; last: number } {
  if (awardYearRange) return awardYearRange;
  const years = allDefenseRows.map((r) => parseInt(r.season.slice(0, 4), 10) + 1);
  awardYearRange = { first: Math.min(...years), last: Math.max(...years) };
  return awardYearRange;
}

/**
 * 0-1 rate: the span's average per-season individual-defense recognition.
 *
 * Averaged over only the span years the award data actually **covers**, the same convention
 * `avgDarkoFieldForSpan` uses for DARKO — "no data" must never read as "no award." Without it,
 * every span running past the export's last season is diluted toward zero purely from missing
 * data: Victor Wembanyama's 2024-26 span has no covered year at all, and his 2023-25 span would
 * have had its 2024 1st-team selection halved by the uncovered 2025.
 */
/** True when at least one season of the span falls inside the All-Defense/DPOY data window — i.e.
 * an `individualDefenseRate` of 0 there means "no recognition", not "no data" (pre-1969 spans,
 * before All-Defense existed, are the latter). */
export function hasDefenseAwardCoverage(span: PlayerSpan): boolean {
  const { first, last } = awardCoverageWindow();
  return spanEndYears(span.spanLabel).some((y) => y >= first && y <= last);
}

export function individualDefenseRate(span: PlayerSpan): number {
  const { first, last } = awardCoverageWindow();
  const years = spanEndYears(span.spanLabel).filter((y) => y >= first && y <= last);
  if (years.length === 0) return 0;
  const key = normalizePlayerName(span.playerName);
  const tiers = tierByNameYear.get(key);
  const dpoyYears = dpoyYearsByName.get(key);
  if (!tiers && !dpoyYears) return 0;

  let total = 0;
  for (const year of years) {
    const tier = tiers?.get(year);
    let value = tier === 1 ? ALL_D_FIRST_WEIGHT : tier === 2 ? ALL_D_SECOND_WEIGHT : 0;
    if (dpoyYears?.has(year)) value = Math.max(value, DPOY_WEIGHT);
    total += value;
  }
  return Math.min(1, total / years.length);
}
