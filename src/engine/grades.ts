import type { Position, PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { draftPool } from '../data/draftPool';
import {
  computeTalent,
  computeOffensiveTalent,
  computeUncappedOffensiveTalent,
  computeDefensiveTalent,
  computeTalentWithoutEliteDefenseBonus,
  computeTalentWithoutBridge,
  rawUncappedTalent,
  applyGradeCeiling,
  isCP3TwoWayExempt,
} from './talent';
import { computeOffensivePortability, computeDefensivePortability } from './portability';
import { computeSpacing } from './spacing';
import { spanEndYears } from './era';
import { TAYLOR_VALIDATED_NAMES } from './taylorValidatedNames';
import { playoffPerformanceBonus } from './playoffPerformanceLookup';
import { realValueTierFloor } from './realValueFloor';
import { madeAllNbaInSpan } from './allNbaLookup';
import { playoffBpm2ForSpan } from './playoffBpm2Lookup';

/**
 * Letter-grade display for O-TAL/D-TAL, purely a UI presentation layer over the existing
 * 0-100 numbers — doesn't change what's computed, just how it's shown. S is reserved for the
 * top tier (the "3 best in category" cutoff), everything else is a standard A-F band with
 * +/- thirds.
 */
export type Grade = 'S' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F';

function letterForValue(value: number): Exclude<Grade, 'S'> {
  if (value >= 95) return 'A+';
  if (value >= 90) return 'A';
  if (value >= 85) return 'A-';
  if (value >= 80) return 'B+';
  if (value >= 75) return 'B';
  if (value >= 70) return 'B-';
  if (value >= 65) return 'C+';
  if (value >= 60) return 'C';
  if (value >= 55) return 'C-';
  if (value >= 50) return 'D+';
  if (value >= 45) return 'D';
  if (value >= 40) return 'D-';
  return 'F';
}

/**
 * D-TAL's own letter-grade cutoffs, distinct from `letterForValue` (which is calibrated for the
 * TAL/O-TAL distribution). 2026-08-31, user-reported ("DDPM -1 is league average, an average
 * defender shouldn't read D/F"): `computeDefensiveTalent` is a per-position percentile LADDER whose
 * output distribution is nothing like TAL's — the median perimeter defender lands at D-TAL ~34-39
 * and p75 at ~54. Run through `letterForValue` (C = 60-64) that made the MEDIAN defender at every
 * guard/wing position grade "F", and a genuinely top-third span (young KD, D-TAL 47 ≈ 67th
 * percentile among SFs) grade "D". These cutoffs are shifted down so the middle of the real D-TAL
 * distribution reads around C-/C and only the actual bottom reads D/F, while the top (Ben Wallace
 * ~99, Gobert ~85, Bruce Bowen ~87) still reads A-tier. S is still decided separately by
 * `defensiveSThreshold`.
 */
function letterForDefensiveTalent(value: number): Exclude<Grade, 'S'> {
  if (value >= 94) return 'A+';
  if (value >= 88) return 'A';
  if (value >= 83) return 'A-';
  if (value >= 77) return 'B+';
  if (value >= 70) return 'B';
  if (value >= 62) return 'B-';
  if (value >= 54) return 'C+';
  if (value >= 46) return 'C';
  if (value >= 39) return 'C-';
  if (value >= 32) return 'D+';
  if (value >= 24) return 'D';
  if (value >= 16) return 'D-';
  return 'F';
}

/** The value a span needs to clear for S — the 3rd-highest *distinct* value in the reference
 * population, so ties at the cutoff all earn S together rather than an arbitrary cut mid-tie. */
function computeSThreshold(values: number[]): number {
  const sorted = [...new Set(values)].sort((a, b) => b - a);
  return sorted[2] ?? sorted[sorted.length - 1] ?? 100;
}

/**
 * Per-PLAYER-peak S threshold — the 3rd-best player's ceiling, not the 3rd-highest span value.
 *
 * 2026-08-31, user-reported ("no player has S O-TAL"): `computeUncappedOffensiveTalent` is an
 * uncapped scale, and Nikola Jokić's recent offense sits 7+ points clear of anyone else (uncapped
 * 119-123 vs LeBron 112 / Durant 108 / Harden 106). With the span-wise threshold, Jokić's own top
 * three spans ARE the top three distinct values, so the cutoff (119) landed on his own 3rd span and
 * S collapsed to "Jokić, three spans" — every other elite offensive engine read A+. Deduping to
 * each player's single best span first restores "S = the 3 best offensive players in the pool"
 * (Jokić / LeBron / Durant — 9 spans between them at the 108 cutoff), which is what S is documented
 * to mean. The grade CHECK still runs per span (a specific span can clear or miss it); only the
 * threshold's reference set changes. Offense-only — the D-TAL ladder caps at 100 so its top is a
 * real multi-player cluster, not a one-player outlier, and its span-wise threshold is unaffected.
 */
function computeSThresholdByPlayerPeak(valueOf: (span: PlayerSpan) => number): number {
  const peakByPlayer = new Map<string, number>();
  for (const span of draftPool) {
    const key = normalizePlayerName(span.playerName);
    peakByPlayer.set(key, Math.max(peakByPlayer.get(key) ?? -Infinity, valueOf(span)));
  }
  return computeSThreshold([...peakByPlayer.values()]);
}

export function gradeForValue(value: number, sThreshold: number): Grade {
  return value >= sThreshold ? 'S' : letterForValue(value);
}

// Computed once from the actual in-game pool (not the full ~14,000-span archive), so "3 best
// in category" means the 3 best options a drafter can actually take right now — and stays
// correct automatically if the pool itself changes (e.g. the D1/D2/D3 restriction in
// buildDraftPool.ts). Every span, not one per player, since a grade describes a specific span.
//
// 2026-08-06, made lazy (was eager top-level `const`s): `portability.ts` now imports
// `computeDefensiveTalent` from `talent.ts`, which imports `portabilityBonus` from
// `portabilityCorrection.ts`, which imports back from `portability.ts` — a real cycle. Eagerly
// calling into that cycle from THIS module's top level (this file is a common import target for
// UI components) broke real page loads with a `ReferenceError` inside `defensiveAccolades.ts`
// depending on which module reached the cycle first. Deferring to first-call sidesteps the
// ordering problem entirely — see `portability.ts`'s own lazy `defenseTalentSortedByPosition`
// for the fuller explanation, same fix, same root cause.
let offensiveSThreshold: number | null = null;
let defensiveSThreshold: number | null = null;

/**
 * 2026-08-08, Harden S-grade narrowing follow-up (see `computeUncappedOffensiveTalent`'s own
 * docstring in talent.ts for the root cause). The pool-wide threshold now reads the real,
 * unflattened spread instead of the clamped-at-100 one, so it lands well above the old value —
 * `uncappedValue` lets every call site's S-check compare against that same real number. Below the
 * threshold this makes no difference (the clamp only ever changes values that were already >100
 * before clamping, and every A+ band starts at 95 — comfortably below where the clamp kicks in —
 * so an uncapped 105 and a clamped 100 land in the same letter bucket either way), which is why
 * `uncappedValue` defaults to `value`: any caller that only has the already-clamped display number
 * (validation scripts, synthetic contexts) keeps its exact old behavior, it just can't distinguish
 * two different top-of-scale spans from each other for the S cutoff specifically.
 */
export function offensiveGrade(value: number, uncappedValue: number = value): Grade {
  if (offensiveSThreshold === null) {
    offensiveSThreshold = computeSThresholdByPlayerPeak((p) => computeUncappedOffensiveTalent(p));
  }
  return uncappedValue >= offensiveSThreshold ? 'S' : letterForValue(value);
}

export function defensiveGrade(value: number): Grade {
  if (defensiveSThreshold === null) {
    defensiveSThreshold = computeSThreshold(draftPool.map((p) => computeDefensiveTalent(p)));
  }
  return value >= defensiveSThreshold ? 'S' : letterForDefensiveTalent(value);
}

/**
 * 2026-08-06, user's own ask: the same S-F letter-grade treatment O-TAL/D-TAL already get,
 * applied to portability — but split into offense/defense from the start rather than one
 * combined POR grade. A single blended number couldn't simultaneously satisfy "Chris Mullin/
 * Kyle Korver/Glen Rice shouldn't rate as high as Anunoby/Kawhi" (needs defense to swing a lot)
 * and "elite one-way shooters like Ray Allen/Reggie Miller should still reach S" (needs defense
 * to NOT swing much) — those are two different claims about one number. The combined
 * `computePortability`/`portabilityGrade` this replaced is gone entirely (removed the same
 * session, per explicit user request) — `portabilityCorrection.ts`'s small TAL bonus now
 * regresses against the average of these two split scores instead. Same "3 best in current pool"
 * dynamic S-cutoff as O-TAL/D-TAL, each computed independently from its own value distribution.
 */
let offensivePortabilitySThreshold: number | null = null;
let defensivePortabilitySThreshold: number | null = null;

/**
 * 2026-08-13, user-reported: O-POR's letter grades pile up hard at the bottom — 44.4% of the
 * whole pool reads F, vs. O-TAL's naturally well-spread 12.3% F on the exact same fixed
 * `letterForValue` bands. Root cause confirmed, not assumed: O-POR's own raw value distribution
 * is real but heavily right-skewed (median 43, p75 only 59), while O-TAL's is roughly even across
 * the same 0-100 range — the fixed bands (built assuming an O-TAL-shaped distribution) just
 * compress most of O-POR's real spread into D/F.
 *
 * Simplest fix tried first (explicit user ask, before reaching for a bigger rework): convert the
 * raw value to its percentile RANK in the real O-POR population before handing it to the
 * existing, completely unchanged `gradeForValue`/`letterForValue` machinery — same shared grading
 * function every other stat uses, just fed a differently-scaled input. Purely a display
 * transform: `computeOffensivePortability`'s own return value, and every real consumer of it
 * (`portabilityCorrection.ts`'s TAL-blend regression chief among them), is completely untouched —
 * only what letter this ONE badge shows changes. Scoped to O-POR alone; D-POR's own distribution
 * skews the opposite way (median rank 67, not flagged by the user) and O-TAL/D-TAL are already
 * healthy, so none of the three share this fix.
 */
let offensivePortabilitySortedValues: number[] | null = null; // sorted ascending, cached once

function percentileRank(value: number, sortedAscending: number[]): number {
  let lo = 0;
  let hi = sortedAscending.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAscending[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return (100 * lo) / sortedAscending.length;
}

export function offensivePortabilityGrade(value: number): Grade {
  if (offensivePortabilitySortedValues === null) {
    offensivePortabilitySortedValues = draftPool.map((p) => computeOffensivePortability(p)).sort((a, b) => a - b);
  }
  if (offensivePortabilitySThreshold === null) {
    // Same "3rd-highest distinct raw value" cutoff as before, just re-expressed as a rank so it
    // still compares correctly against the rank-space value below.
    const rawSThreshold = computeSThreshold(offensivePortabilitySortedValues);
    offensivePortabilitySThreshold = percentileRank(rawSThreshold, offensivePortabilitySortedValues);
  }
  const rank = percentileRank(value, offensivePortabilitySortedValues);
  return gradeForValue(rank, offensivePortabilitySThreshold);
}

export function defensivePortabilityGrade(value: number): Grade {
  if (defensivePortabilitySThreshold === null) {
    defensivePortabilitySThreshold = computeSThreshold(draftPool.map((p) => computeDefensivePortability(p)));
  }
  return gradeForValue(value, defensivePortabilitySThreshold);
}

/**
 * Named-tier display for the overall TAL rating, on the same "purely presentational" footing as
 * the letter grades above — the user's own bands (2026-07-30), asked to render as coloured pills
 * like SPACING's shooter tags rather than plain letters, since TAL is the headline number.
 *
 * The 94-point overlap in the user's own spec ("Greatest peak 94+" and "MVP 94-88" both claim
 * 94) is resolved by checking floors ascending and letting the highest one win ties — same
 * pattern as `spacing.ts`/`durability.ts`'s tier floors, so 94 lands in Greatest peak and MVP is
 * effectively 88-93.
 */
export type OverallTier =
  | 'GOAT'
  | 'Greatest peak'
  | 'MVP'
  | 'All-NBA'
  | 'All-star'
  | 'Starter'
  | 'Sixth Man'
  | 'Role Player'
  | 'Bench Warmer'
  | 'Cigarette Butt';

const OVERALL_TIER_FLOORS: ReadonlyArray<readonly [number, OverallTier]> = [
  [0, 'Cigarette Butt'],
  [40, 'Bench Warmer'],
  [50, 'Role Player'],
  [60, 'Starter'],
  [70, 'All-star'],
  [80, 'All-NBA'],
  [88, 'MVP'],
  [94, 'Greatest peak'],
];

export function overallTier(value: number): OverallTier {
  let tier: OverallTier = 'Cigarette Butt';
  for (const [floor, named] of OVERALL_TIER_FLOORS) {
    if (value >= floor) tier = named;
  }
  return tier;
}

/**
 * 2026-08-05, user's own hand-graded calibration batch: a big raw TAL number without a matching
 * real O/D letter grade (or, at guard, enough shot volume to have actually carried an offensive
 * role) shouldn't get to claim the top tier NAMES even when the underlying number technically
 * clears that tier's floor — John Stockton (PG, O-TAL grade below A-) reading as "MVP" alongside
 * genuine two-way engines was the motivating case. Same "purely presentational" footing as the
 * rest of this file: this caps the DISPLAYED tier only, never the TAL number itself, so draft
 * value/sorting/scoring are completely untouched — a capped player still drafts and scores
 * exactly as their real TAL says, they just don't get to wear a tier badge their O/D profile
 * doesn't back up. Position-specific because the user's own rules are: a PG's case for MVP+ rests
 * on real half-court shot creation (grade + volume), an SG's case for the top tier specifically
 * rests on true two-way value (offense-only volume scorers cap below "Greatest peak"), etc.
 * Every rule caps *downward only* — never raises a tier above what raw TAL already earned.
 *
 * 2026-08-07: a same-day batch of position-specific refinements to these rules (PG/SG/SF/C, plus
 * a matching TAL/O-TAL formula batch) was tried and then explicitly reverted by the user the same
 * session — the refinements kept cascading into new problems in other positions faster than they
 * fixed the one being reported (an O-TAL usage-scale fix aimed at PG ended up re-inflating SF/PF/C
 * players past tier gates calibrated earlier the same day). Rolled back to this original,
 * 2026-08-05/06 version rather than keep patching forward. If PG tier crowding gets revisited,
 * start from a full population audit (which spans cluster where and why) before touching any
 * single rule again — the reverted session's own transcript is the record of what was tried.
 */
const GRADE_ORDER: Grade[] = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S'];
function gradeRank(g: Grade): number {
  return GRADE_ORDER.indexOf(g);
}
function gradeAtLeast(g: Grade, min: Grade): boolean {
  return gradeRank(g) >= gradeRank(min);
}

const TIER_ORDER: OverallTier[] = [
  'Cigarette Butt',
  'Bench Warmer',
  'Role Player',
  'Sixth Man',
  'Starter',
  'All-star',
  'All-NBA',
  'MVP',
  'Greatest peak',
  'GOAT',
];
/**
 * Exported (2026-08-08, user's v0.2 rating batch) so UI sort comparators can break ties on the
 * TIER, not just the raw number — `displayTalentForSpan`'s own number is capped at each tier's
 * ceiling (`tierCeiling`), and GOAT specifically has no ceiling of its own (`tierCeiling('GOAT')`
 * is `Infinity`), so a GOAT-tier span and a merely-Greatest-Peak span can land on the EXACT SAME
 * displayed number (both 98, say) with nothing in the number itself distinguishing them. Found via
 * LeBron (GOAT, 98) sorting BELOW Larry Bird (Greatest peak, 98) in the draft pool list — the sort
 * only compared the tied number, so array order (not rank) decided who showed first. See
 * `DraftBoard.tsx`'s own sort comparator for the fix.
 */
export function tierRank(t: OverallTier): number {
  return TIER_ORDER.indexOf(t);
}
function stricterTier(a: OverallTier, b: OverallTier): OverallTier {
  return tierRank(a) <= tierRank(b) ? a : b;
}

/** Low-volume floor for the guard-specific FGA gates below — under this, "the offense even
 * came through them" is itself in question, independent of how efficient the shots they did
 * take were. */
const TIER_GATE_LOW_FGA = 10;

/** User's explicit follow-up narrowing the PG archetype rule's own entry point (below) further
 * than the original "below All-NBA" scope — see that rule's own call-site docstring for the
 * full history ("zróbmy że powyżej 75 TAL nie robimy sixth mana, zmniejszmy też próg wejścia"). */
const PG_ARCHETYPE_ENTRY_TAL_CEILING = 75;
/** Real, already-established thresholds for the user's PG shooter/playmaker/defense archetype
 * ask — see `overallTierForSpan`'s own call-site docstring for the full derivation. */
const PG_ARCHETYPE_SHOOTER_SPACING_FLOOR = 65;
const PG_ARCHETYPE_PLAYMAKER_APG_FLOOR = 6.0;
const PG_ARCHETYPE_DEFENSE_DTAL_FLOOR = 55;
/** A PG grading below this on offense (`letterForValue`) is treated as genuinely offense-limited
 * for the defense-only All-NBA cap in `overallTierForSpan` — 'B-' = O-TAL < 70. */
const PG_DEFENSE_ONLY_OTAL_FLOOR: Grade = 'B-';
/** 2026-08-31, user-reported (Mike James 2004-06, and the same batch's spacing-cliff fix): the
 * "shooter, not-quite-a-playmaker, weak defense" branch labels a span "Bench Warmer" ("shit
 * player") — right for a genuine empty spot-up guard, wrong for a real 20-ppg lead scorer whose
 * assists just miss 6.0 (Damian Lillard 2013-15 O-TAL 69 / apg 5.9, Mike James's own fluke year
 * O-TAL 67). A span with a real offensive engine isn't a "shit player" regardless of the other two
 * factors — at this O-TAL it drops one tier less far (Sixth Man, not Bench Warmer). */
const PG_ARCHETYPE_REAL_SCORER_OTAL = 64;

/** Position-specific downward tier caps, applied ascending so a player can trip more than one
 * (the most restrictive wins — see `stricterTier` fold below). Every threshold reuses the exact
 * letter-grade bands `offensiveGrade`/`defensiveGrade` already display, so the rule reads the
 * same way the user specified it ("PG below A- can't be MVP") rather than a re-derived number. */
/**
 * 2026-08-08, user's explicit, direct ask: Harden's 2018-20 span (his real 35.3 ppg MVP season,
 * O-TAL A+/106 uncapped after the SG position fix earlier this session) reaches "Greatest peak"
 * — a single, named span exception, matching this project's existing `GOAT_NAMES` precedent
 * (below) for "the user explicitly wants this exact display outcome, not a formula fix."
 * Deliberately does NOT touch the O-TAL grade itself (stays honest A+, not faked to S) — this
 * bypasses only the ONE literal-S/two-way tier-cap gate below, the same shape as `GOAT_NAMES`
 * bypassing the tier ceiling rather than inventing a fake underlying number. His real defense
 * (DTAL 62) doesn't clear the two-way bar, and his O-TAL doesn't clear the pool's own S bar
 * (119, effectively Jokić alone) — asked for directly, not derived from any formula reasoning,
 * so scoped to this exact (player, span) pair only, not a pattern to extend without being asked
 * again (same warning `GOAT_NAMES` carries).
 */
const NAMED_TIER_EXCEPTIONS: ReadonlySet<string> = new Set(
  [{ name: 'James Harden', spanLabel: '2018-20' }].map((e) => `${normalizePlayerName(e.name)}|${e.spanLabel}`),
);

function hasNamedTierException(playerName?: string, spanLabel?: string): boolean {
  if (!playerName || !spanLabel) return false;
  return NAMED_TIER_EXCEPTIONS.has(`${normalizePlayerName(playerName)}|${spanLabel}`);
}

/**
 * 2026-08-14, user-reported: Andrei Kirilenko's 2004-06 span (SF, O-TAL D+/62, D-TAL literal
 * S/99) displays MVP on defense alone — SF's own `tierCaps` case (below) has exactly one rule
 * (All-NBA needs A- on at least one side), no MVP-tier offense floor at all, unlike C's more
 * layered two-way rules.
 *
 * A general "SF needs B+ offense to reach MVP" rule was tried first and rejected on blast radius:
 * full archive, 25 spans, sweeping in real, externally-validated two-way wing peaks whose own
 * defense sits in the same S/A+ band as Kirilenko's and can't be told apart from his on grade
 * alone — Scottie Pippen (7 spans), Julius Erving (5), Kawhi 2014-16, Giannis 2016-18, Larry Bird,
 * Paul George, Grant Hill, Elgin Baylor, Jimmy Butler, Paul Pierce. Named downcap instead, same
 * shape as `NAMED_TIER_EXCEPTIONS` above but in the opposite direction (forces a tier DOWN rather
 * than bypassing a cap) — the same "scoped to exactly the one span asked about, not a new general
 * rule" reasoning as `talent.ts`'s own Durant SF-defense-cap exclusion / CP3 two-way exemption.
 */
/**
 * 2026-08-19, user-reported: Scott Skiles's 1990-92 span (raw/eff TAL 76, SPC90/APG7.8/DTAL20)
 * is the exact "good shooter + good playmaker + bad defense" combo the PG archetype rule above
 * maps to Sixth Man — but it sits 1 point above `PG_ARCHETYPE_ENTRY_TAL_CEILING` (75), so the
 * general rule correctly leaves it alone (same as 3 other real PGs at this identical edge: Steve
 * Francis 2000-02, Jamal Murray 2024-26, Steve Nash 2002-04 — all measured, not guessed). Raising
 * the ceiling to catch this one span would immediately re-catch genuine stars in the same combo
 * one point higher (Lillard 2023-25, Kyrie 2017-19 — the ceiling's own original motivating case —
 * Haliburton, Bibby, Garland...), so the general threshold stays put. User's explicit call after
 * seeing the other 76-TAL company Skiles keeps: he's "too weak" to sit among them at All-star —
 * named downcap for exactly this one span, not a general rule change.
 */
/**
 * 2026-08-19, user-reported: CJ McCollum's 2020-22 span (PG, O-TAL C+/65, D-TAL D/47) displays
 * All-NBA off raw TAL (81) alone landing in that tier's floor band — no PG-side rule pulls it
 * back down, since PG's own tierCaps case (unlike SG's) has no "needs real two-way value or
 * elite offense to reach All-NBA" downcap at all. Tried building that general rule first
 * (mirroring SG's exact threshold) and rejected it on blast radius before shipping: full PG
 * archive, 86 All-NBA+-tier spans would have been wrongly downcapped, including real MVP-caliber
 * peaks (Westbrook 2015-17, Magic 1986-88, Oscar Robertson 1965-67, Isiah Thomas 1984-86, Luka
 * 2019-21) whose own O-TAL grade (B/B+) sits well below SG's A- bar but is still a genuine star
 * profile for a PG specifically — PG's real O-TAL distribution runs structurally lower than SG's
 * (compared against an elite-playmaking-peak bar, not a scoring one), so SG's exact threshold
 * doesn't transfer. A narrower, PG-calibrated version (offense >= B- OR defense >= A-) fixed most
 * of that but still had real judgment calls left in the remainder (Chris Paul 2017-19, Kyrie
 * 2014-16 — genuinely no-standout-side profiles, arguably correct to downcap, but not clearly
 * asked for). User's own call: fix this one reported span directly, same shape as the two
 * existing named downcaps below, not a new general PG rule.
 */
const NAMED_TIER_DOWNCAPS: ReadonlyMap<string, OverallTier> = new Map(
  [
    { name: 'Andrei Kirilenko', spanLabel: '2004-06', cap: 'All-NBA' as OverallTier },
    { name: 'Scott Skiles', spanLabel: '1990-92', cap: 'Sixth Man' as OverallTier },
    { name: 'CJ McCollum', spanLabel: '2020-22', cap: 'All-star' as OverallTier },
    { name: 'Vince Carter', spanLabel: '2012-14', cap: 'Starter' as OverallTier },
    { name: 'Chris Webber', spanLabel: '1996-98', cap: 'All-NBA' as OverallTier },
    // 2026-08-31 (D-TAL->TAL bridge pass): McMillan's 1992-94 peak (O-TAL 42 / D-TAL 99 — a genuine
    // 2x All-Defense 1st-team perimeter menace, real DPOY-vote-adjacent) is the one span where the
    // bridge's rank-relative defensive credit alone carries a near-zero offensive game to All-star.
    // User's explicit call: cap it. 'Starter' is exactly its non-bridge tier — the bridge can still
    // move the NUMBER, it just can't wear an All-star badge on defense alone. A named single-span
    // exception, not a slope: the same "defensive specialist reaching All-star" question for every
    // 3-and-D wing (Danny Green / P.J. Tucker / OG Anunoby) is a feature of the bridge, not a bug.
    { name: 'Nate McMillan', spanLabel: '1992-94', cap: 'Starter' as OverallTier },
    // 2026-08-31, follow-up on the bridge: SF has only two tier-cap rules and neither catches a
    // "mediocre offense + mediocre defense" wing, so a +5 bridge correction tips a handful of
    // journeyman SF spans across the All-star floor (70). PG's own archetype caps catch the PG
    // equivalents; SF has no such net. A blanket SF "sub-C+ offense AND sub-D+ defense -> Starter"
    // rule was measured and rejected — SF O-TAL grades run low for real scorers, so it also caught
    // Jamal Mashburn, Dan Majerle, Danny Granger and Jaylen Brown 2023-25 (a 23-ppg All-NBA wing
    // reading "O C"). Named downcaps for the three whose non-bridge TAL was genuinely below the
    // All-star floor and whose profile is journeyman both ways (O C-, D D-/D+/F).
    { name: 'Jim Jackson', spanLabel: '2003-05', cap: 'Starter' as OverallTier },
    { name: 'Stephen Jackson', spanLabel: '2003-05', cap: 'Starter' as OverallTier },
    { name: 'Walt Williams', spanLabel: '1995-97', cap: 'Starter' as OverallTier },
    // 2026-09-01, SG audit: two never-All-Star empty-volume scorers whose O-TAL alone carries them
    // to All-star while every real plus-minus source has them clearly net-negative. The SG two-way
    // cap holds them at All-star (out of All-NBA) but has no lower rung. Monta Ellis 2009-11 (25.5
    // ppg on poor efficiency, D-TAL F, blendedRealValue -2.10 — the canonical "stats All-Star" who
    // never actually made one); Jason Terry 2000-02 (young chucker on 25-win Hawks, rv -0.79,
    // pre-Sixth-Man-of-the-Year). Both scoped single spans — their real, positive-value seasons
    // (Terry's Mavs/Sixth Man years, Ellis's later Mavs/Pacers) are untouched.
    { name: 'Monta Ellis', spanLabel: '2009-11', cap: 'Starter' as OverallTier },
    { name: 'Jason Terry', spanLabel: '2000-02', cap: 'Starter' as OverallTier },
    // 2026-09-01, SF audit: same empty-volume pattern as the two SG downcaps above. Jalen Rose's
    // 1999-2002 Pacers peak (19-20 ppg lead scorer, incl. the 2000 Finals run) reads All-star off
    // O-TAL alone while every plus-minus source has him net-negative (rv -0.64 / -0.87, D-TAL D)
    // and he was never a real All-Star. His genuine positive seasons aren't in the pool at
    // All-star anyway; scoped to the two peak-usage spans.
    { name: 'Jalen Rose', spanLabel: '1999-01', cap: 'Starter' as OverallTier },
    { name: 'Jalen Rose', spanLabel: '2000-02', cap: 'Starter' as OverallTier },
    // 2026-09-02, user batch feedback: Dirk / Malone read a "Greatest peak" badge a rung too
    // high, Cousins "MVP zbyt wysoko". All ride the +7 two-way synergy bonus (maxed — see
    // talent.ts `MAX_TWO_WAY_SYNERGY_BONUS`); a synergy trim was measured (`scripts/_diagSynergy.ts`)
    // and reverted — it cost GOAT-40 0.009 for near-zero effect at the very top (the 95-100
    // soft-cap absorbs a -1) and no clean surgical parameter exists (Malone/Cousins clear the
    // ramp on real box defense; Dirk can't be told apart from real 3-and-D wings by normalized
    // defense). Named downcap on each affected span instead — display + gameplay number both
    // drop (post-2026-08-19 `effectiveTalent` unification), `computeTalent` raw is untouched so
    // Taylor top-10 / Backpicks GOAT-40 are unaffected (both validate off raw). (SGA / Kawhi /
    // AD were also flagged "~3 too high" but a downcap to MVP over-corrects them to ~90 — that
    // trio is the deferred "top of the scale is compressed" session, left alone here.)
    { name: 'DeMarcus Cousins', spanLabel: '2014-16', cap: 'All-NBA' as OverallTier },
    { name: 'Dirk Nowitzki', spanLabel: '2002-04', cap: 'MVP' as OverallTier },
    { name: 'Dirk Nowitzki', spanLabel: '2004-06', cap: 'MVP' as OverallTier },
    { name: 'Karl Malone', spanLabel: '1992-94', cap: 'MVP' as OverallTier },
    { name: 'Karl Malone', spanLabel: '1994-96', cap: 'MVP' as OverallTier },
  ].map((e) => [`${normalizePlayerName(e.name)}|${e.spanLabel}`, e.cap]),
);

function namedTierDowncap(playerName?: string, spanLabel?: string): OverallTier | undefined {
  if (!playerName || !spanLabel) return undefined;
  return NAMED_TIER_DOWNCAPS.get(`${normalizePlayerName(playerName)}|${spanLabel}`);
}

/**
 * 2026-09-02, user batch feedback ("Tatum 84, powinien być 87"): the span the browse-list header
 * shows for Tatum is 2020-22 at eff 84, but his real peak — 2021-23 (the 2022 Finals run,
 * All-NBA 1st) — has raw `computeTalent` 96 that `tierCaps`' SF "needs an A-tier grade on at
 * least one side for MVP+" rule (his own grades are B+ offense / B- defense) folds to All-NBA,
 * and `applyGradeCeiling` then compresses 96 hard against All-NBA's 87 ceiling down to 83. Every
 * other tool over/under-shoots: a `NAMED_TIER_RAISES` -> MVP lands him at 90 (`applyGradeCeiling`
 * to the MVP ceiling), a `talent.ts` `NAMED_TAL_PENALTY`-style raw bump does nothing (the tier
 * cap re-compresses it), and relaxing the SF cap itself moves a validated wing population.
 *
 * `NAMED_DISPLAY_TAL` sets the final displayed/effective number directly for a named span,
 * post-everything — the last resort when the span's raw is fine, its badge is fine, but the
 * cap + `applyGradeCeiling` interaction produces a number the user disagrees with. Tatum 2021-23
 * -> 87 (top of the All-NBA band, so badge and number stay consistent). Does not touch
 * `computeTalent` (raw stays 96) or `overallTierForSpan` (badge stays All-NBA); flows to
 * `effectiveTalent` and thus gameplay. Not in TAYLOR_TOP10 / GOAT-40 — anchors unaffected.
 */
const NAMED_DISPLAY_TAL: ReadonlyMap<string, number> = new Map(
  [{ name: 'Jayson Tatum', spanLabel: '2021-23', tal: 87 }].map(
    (e) => [`${normalizePlayerName(e.name)}|${e.spanLabel}`, e.tal] as const,
  ),
);

function namedDisplayTal(playerName?: string, spanLabel?: string): number | undefined {
  if (!playerName || !spanLabel) return undefined;
  return NAMED_DISPLAY_TAL.get(`${normalizePlayerName(playerName)}|${spanLabel}`);
}

/**
 * 2026-08-19, user's explicit ask ("make klay all-nba"), direct follow-up on the off-ball-
 * archetype usage-penalty fix (talent.ts) shipped the same day. That fix genuinely raised Klay
 * Thompson's raw TAL (his best span, 2015-17, went from a penalized number up to a real 78) — but
 * 78 still sits 2 points under the All-NBA floor (80), so no amount of cap-bypassing reaches it:
 * unlike `NAMED_TIER_DOWNCAPS` above, this isn't a cap being wrongly strict, it's the BASE tier
 * ladder itself (`overallTier`) reading the real number honestly. Caps only ever lower a tier from
 * that base (this function's own established rule, same one `GOAT_NAMES` below is the sole
 * documented exception to) — raising one requires a genuine override, not a cap adjustment.
 *
 * Same shape as `GOAT_NAMES`: a named, single-span exception because the user explicitly wants
 * this exact display outcome, not a formula fix — a general "off-ball shooters get an extra tier
 * boost" rule wasn't asked for and would need the same kind of full blast-radius check the
 * rejected general PG downcap rule (see `NAMED_TIER_DOWNCAPS`'s own McCollum entry above) already
 * demonstrated is necessary before touching anything pool-wide. Unlike `GOAT_NAMES`, this doesn't
 * require already having earned a real tier first — it's a direct override, so `displayTalentForSpan`
 * is also taught about it (see its own docstring) so the badge and the number stay in agreement.
 */
const NAMED_TIER_RAISES: ReadonlyMap<string, OverallTier> = new Map(
  [
    { name: 'Klay Thompson', spanLabel: '2015-17', tier: 'All-NBA' as OverallTier },
    // 2026-08-31, user's SG-cap review: the SG `!gradeAtLeast(dtalGrade, 'C') && !A+ offense ->
    // All-star` rule (built to cap modern empty-volume scorers like Zach LaVine 2020-22) also
    // dumps two genuine peak-scoring seasons — Kobe 2004-06 (35.4 ppg, O A/92, real 1st-team
    // All-NBA 2006) and T-Mac 2002-04 (32 ppg, O A/94, real 1st-team All-NBA 2002/03) — all the
    // way to All-star on their weak defense. Loosening the rule's A+ bar to A re-frees LaVine
    // (also O A/94), so a named raise to the tier they actually earned instead. Not MVP — that
    // still wants real two-way value they don't have; All-NBA matches the real award.
    { name: 'Kobe Bryant', spanLabel: '2004-06', tier: 'All-NBA' as OverallTier },
    { name: 'Tracy McGrady', spanLabel: '2002-04', tier: 'All-NBA' as OverallTier },
    // 2026-09-01, PF audit follow-up to the reference-data trim fix: `realValueFloor.ts`'s
    // sustained-real-value floor requires `rv.isModernEra` (real DARKO coverage, ~1997+), which
    // exists because pre-DARKO plus-minus data was assumed too thin to trust. But these three
    // spans use `bpm2-fallback`/pre-DARKO `measured-blend` sourced real data (the same trim that
    // fixed Jim Jackson/Jamison/Griffith) showing a genuine sustained signal well past the floor's
    // own 3.5 Starter bar (Laettner 3.67, Nance 3.66, Kemp 3.58 - Kemp's span also has a real
    // in-window All-NBA selection) that the era gate blocks outright. Tried lifting the gate
    // itself first and rejected it on blast radius: 47 spans move, reaching back to Cousy/Schayes/
    // Bill Russell/Oscar Robertson - clearly not scoped to the PF gap being fixed here, touches
    // Taylor/GOAT-validated eras. Three narrow named raises instead, same shape as Klay/Kobe/
    // T-Mac above - each one individually verified past the floor's real threshold, not a rule.
    { name: 'Christian Laettner', spanLabel: '1996-98', tier: 'Starter' as OverallTier },
    { name: 'Larry Nance', spanLabel: '1983-85', tier: 'Starter' as OverallTier },
    { name: 'Shawn Kemp', spanLabel: '1992-94', tier: 'Starter' as OverallTier },
    // 2026-09-01, PF audit: Elvin Hayes 1972-74 (both seasons real All-NBA 2nd team) reads Bench
    // Warmer / TAL 43 purely because the NBA didn't record blocks until 1973-74. His own adjacent,
    // 2/3-overlapping 1973-75 span (also All-NBA both years, same player, same skills) lands
    // All-star / TAL 82 — the entire ~22-point `computeDefensiveImpact` gap between them is the
    // `(steals+blocks)*4.5` term appearing. `maximumDefenseBonus`'s pre-stocks widening exists for
    // exactly this but is gated on `computeDefensiveImpact > 15`, which Hayes barely clears (15.4,
    // rebounding-only) because his defensive value was blocks, not rebounds — a real gap in that
    // mechanism, but widening the gate is a pool-wide blast. Named raise to the tier his
    // mechanically-luckier neighbouring span already earned; not All-NBA (our gate wants the
    // offense his real .473 TS genuinely lacked, even as the league voted him All-NBA on volume).
    { name: 'Elvin Hayes', spanLabel: '1972-74', tier: 'All-star' as OverallTier },
    // 2026-09-01, PF audit: Larry Nance 1989-91 reads Role Player / TAL 55 wedged between 1988-90
    // (Starter 67) and 1990-92 (All-star 77) with a nearly identical box line (0.8 spg / 2.3 bpg vs
    // 0.8/2.4 and 0.9/2.8). The whole 12-point D-TAL crater is `darkoDefenseBonus` stepping to
    // exactly 0.00 for this one span (neighbours 0.09-2.66) — his BPM2 that window is 1.11 vs
    // ~1.5-1.7 around it, a real but small dip (age 30-31, knee, Phoenix->Cleveland trade) that
    // tips the real-minus-box excess just under zero, and the bonus never subtracts so it floors.
    // A step function at 0 over-reacting to a ~0.4 BPM2 move, amplified by the ladder being steep
    // there. Raise to Starter (the lower bracket, 1988-90) — not All-star: rv 3.01 and BPM2 1.11
    // both independently agree this was his weakest peak-era window, just not a Role-Player one.
    { name: 'Larry Nance', spanLabel: '1989-91', tier: 'Starter' as OverallTier },
    // 2026-09-01, SG audit: George Gervin's 1979-84 scoring peak reads Role Player across four
    // straight spans despite being 4x scoring champion / 5x consecutive All-NBA 1st team, with a
    // still-positive blendedRealValue (2.2-2.3 in 1979-82). The cause is real — both his box stocks
    // (1.7/1.2 -> 1.1/0.6 spg/bpg) and BPM2 (-0.25 -> -1.7) agree his defense genuinely declined
    // with age and rising offensive load — but the 0.4 defense weight in the TAL blend then drops
    // a historically elite one-way scorer below the All-star floor entirely. Mirror image of the
    // Monta Ellis / Jason Terry overrate downcaps above (empty volume READING All-star); this is
    // real volume with real positive value reading Role Player. Raised to All-star, not All-NBA
    // (his own 1977-79 span, with the defense still intact, is the All-NBA one) — the decline was
    // real, just not a Role-Player one for a 33-ppg 5x-1st-team peak.
    { name: 'George Gervin', spanLabel: '1979-81', tier: 'All-star' as OverallTier },
    { name: 'George Gervin', spanLabel: '1980-82', tier: 'All-star' as OverallTier },
    { name: 'George Gervin', spanLabel: '1981-83', tier: 'All-star' as OverallTier },
    { name: 'George Gervin', spanLabel: '1982-84', tier: 'All-star' as OverallTier },
  ].map((e) => [`${normalizePlayerName(e.name)}|${e.spanLabel}`, e.tier]),
);

function namedTierRaise(playerName?: string, spanLabel?: string): OverallTier | undefined {
  if (!playerName || !spanLabel) return undefined;
  return NAMED_TIER_RAISES.get(`${normalizePlayerName(playerName)}|${spanLabel}`);
}

function tierCaps(
  position: Position,
  otalGrade: Grade,
  dtalGrade: Grade,
  fga: number,
  namedTierException: boolean = false,
  otal: number = 0,
  cp3TwoWayExempt: boolean = false,
): OverallTier[] {
  const caps: OverallTier[] = [];
  switch (position) {
    case 'PG': {
      // Real half-court shot creation (grade + volume) is the PG case for MVP+; missing either
      // caps at All-NBA. A weak offensive grade on top of that caps much lower, at Starter.
      //
      // 2026-08-08, user-reported: Mike Conley's headline span (2011-13, TAL73, DTAL88/A-) reads
      // as merely "Starter" — root-caused to this exact Starter cap having NO two-way exemption
      // at all, unlike SG's/C's equivalent cap one tier up (`sgTwoWayElite`/`cTwoWayElite` below).
      // A truly elite defender (A- or better) covers for a below-average offense the same way
      // this project already lets elite defense cover for offense everywhere else — added the
      // same shape of bypass. Checked blast radius first (`scripts/_checkPgTwoWayExemptionBlast.ts`,
      // deleted after use): 36 of 1121 PG spans clear the DTAL>=A- floor while failing the OTAL
      // floor — a real, coherent population of legitimately elite defensive point guards (Payton,
      // Kidd, Blaylock, Rondo, Holiday, Marcus Smart, Conley, Ben Simmons...), not a broad
      // giveaway; most sit at low-to-mid raw TAL, so the base tier from raw TAL alone (not this
      // cap) is still what actually decides most of their final result — this only stops the cap
      // from artificially dragging down the handful whose TAL is otherwise high enough to clear
      // Starter on its own.
      const pgDefenseCarriesStarterCap = gradeAtLeast(dtalGrade, 'A-');
      // 2026-08-19, user-reported ("dlaczego pokazuje 83 jeśli jego TAL jest 96"): `talent.ts`'s
      // own CP3 two-way exemption already uncaps `computeTalent` itself for these seasons (real
      // TAL 95-96, not compressed) — this cap independently re-capped the DISPLAYED badge at
      // All-NBA with no matching exemption, so the badge and the real number disagreed. Passing
      // the same `isCP3TwoWayExempt` check through from the caller closes that gap instead of
      // adding a second, drifting copy of the same rule.
      if ((!gradeAtLeast(otalGrade, 'A-') || fga < TIER_GATE_LOW_FGA) && !cp3TwoWayExempt) caps.push('All-NBA');
      if (!gradeAtLeast(otalGrade, 'C+') && !pgDefenseCarriesStarterCap) caps.push('Starter');
      // 2026-08-05 follow-up: a genuinely bad defender (below C-) with only an ordinary (not
      // truly elite) offensive peak doesn't have the profile for MVP either — a real top-of-scale
      // offense is its own exemption, same shape as SG's below. Gated on A+ rather than strictly
      // 'S' — S is a *relative* cutoff (3rd-best in the current pool) that can drift as other
      // formula changes move the pool around, so pinning an exemption to it exactly is fragile;
      // A+ (a fixed 95+ floor) reads the same "truly elite" intent without that fragility.
      if (!gradeAtLeast(dtalGrade, 'C-') && !gradeAtLeast(otalGrade, 'A+')) caps.push('All-NBA');
      // 2026-08-19, user's explicit PG shooter/playmaker/defense archetype ask: handled in
      // `overallTierForSpan` (after this function's own caps are folded), not here — it needs to
      // gate on the tier AFTER these caps apply, which isn't known yet at this point in the call.
      // See that function's own docstring for the full rule and why it's gated post-fold.
      break;
    }
    case 'SG': {
      // 2026-08-05: threshold for the two-way bypass below — user's own follow-up named both
      // Harden (A+) and McGrady (A-) as cases that should clear it, so A- (not A+) is the real
      // bar: a genuinely elite offensive grade on its own, regardless of exactly how far into
      // the A-tier it reaches.
      const otalIsElite = gradeAtLeast(otalGrade, 'A-');
      // "Greatest peak" specifically requires real two-way volume, not just one elite side —
      // unchanged even for an S-grade offense, which only guarantees MVP (see below), not the
      // top tier.
      if (!gradeAtLeast(otalGrade, 'B+')) caps.push('MVP');
      // 2026-08-13, user-reported: Zach LaVine's 2020-22 peak (OTAL A/94, DTAL F/25) displayed as
      // "MVP" — raw TAL (89) never even reached the "Greatest peak" floor (94) on its own, so the
      // old version of this rule (below, capping only at MVP) was a dead cap for him: it can only
      // ever stop a player from reaching "Greatest peak", and he was never going to get there
      // regardless. The real ask was a genuinely lower ceiling — All-star, not MVP — for an SG
      // with unconfirmed/bad defense (DTAL<C), same shape as the twoWay All-star cap below but
      // independent of it (that one exempts on OTAL>=A-; this one demands a literal A+, checked
      // directly against Ray Allen's whole career: only his two true A+-offense spans (2000-02,
      // 1999-01) keep their real tier — his other four All-NBA-raw A/A- spans drop to All-star
      // too, confirmed as the intended shape, not a side effect). Full-pool blast radius checked
      // before shipping: this is the literal replacement of the old `caps.push('MVP')` line, not
      // an addition — the old rule never fired without this one also firing on the same
      // condition, so there's no case where keeping both would matter.
      const otalIsTrulyElite = gradeAtLeast(otalGrade, 'A+');
      if (!gradeAtLeast(dtalGrade, 'C') && !otalIsTrulyElite) caps.push('All-star');
      // All-NBA requires genuine two-way value: strong on one end AND at least good on the
      // other, either direction — an offense-only or defense-only case caps at All-star.
      // 2026-08-05 follow-up: this was catching real offensive engines too hard (Harden, A+
      // O-TAL, still fell to All-star on a weak D-TAL) — a truly elite (A+) offense alone now
      // guarantees at least MVP, bypassing just this one cap (the MVP-blocking rules above still
      // apply normally, so a merely-good defense still keeps him out of "Greatest peak").
      const twoWay =
        (gradeAtLeast(otalGrade, 'B+') && gradeAtLeast(dtalGrade, 'B-')) ||
        (gradeAtLeast(otalGrade, 'B-') && gradeAtLeast(dtalGrade, 'B+'));
      if (!twoWay && !otalIsElite) caps.push('All-star');
      if (fga < TIER_GATE_LOW_FGA) caps.push('Starter');
      // 2026-08-06: "Greatest peak" for an SG specifically requires a true top-of-scale (S)
      // offensive grade — even a two-way A- guard doesn't have the case for the very top tier,
      // just MVP. Literal `=== 'S'` (not `gradeAtLeast(..., 'A+')` like the PG exemptions above)
      // is intentional here: this is the defining bar for the rule, not a fragile secondary
      // exemption riding on top of another cap, so it should track the same dynamic "3 best in
      // the pool" S actually means everywhere else it's displayed.
      //
      // 2026-08-08, user's v0.2 rating batch: Kobe and Wade were missing from Greatest Peak
      // entirely — both are genuine two-way greats (Kobe 2002-04: A offense/B defense; Wade
      // 2008-10: A offense/A- defense) whose real offensive peak (A/A-, 88-93) never quite
      // reaches the literal-S bar this rule demands, unlike a pure offensive engine (Harden).
      // Added a second path: real two-way excellence (OTAL >= A- AND DTAL >= B) also clears the
      // gate, on the same reasoning the All-NBA rule above already uses one tier down. Checked
      // the full pool blast radius first (`scripts/_v02_sg_exemption_audit.ts`, deleted after
      // use): only Kobe/Wade/Magic Johnson (SG-tagged spans) actually clear the underlying TAL>=94
      // floor this exemption would matter for — Manu Ginóbili and Kobe/Wade's lesser spans also
      // technically clear the grade bars but sit well below 94 raw, so the cap removal has no
      // practical effect on them (caps only ever lower a tier, never raise one past the real
      // numeric floor). Harden correctly stays excluded either way — his DTAL never clears B on
      // any span.
      const sgTwoWayElite = gradeAtLeast(otalGrade, 'A-') && gradeAtLeast(dtalGrade, 'B');
      if (otalGrade !== 'S' && !sgTwoWayElite && !namedTierException) caps.push('MVP');
      break;
    }
    case 'SF':
      // 2026-08-05, replaces the earlier OTAL-only version: needs a real A-tier grade (A- or
      // better) on AT LEAST ONE side, offense or defense, to clear All-NBA — a merely-good
      // all-around profile with no standout side doesn't have the case for MVP+.
      if (!gradeAtLeast(otalGrade, 'A-') && !gradeAtLeast(dtalGrade, 'A-')) caps.push('All-NBA');
      // 2026-08-31, user-reported (real examples: Kirilenko 2002-04/2004-06/2005-07, Metta World
      // Peace 2005-09, Shawn Marion 2001-03/2002-04/2006-08, Gerald Wallace 2008-10 — all reading
      // All-NBA at TAL 81-91). The rule above only stops elite-D-alone from reaching MVP+; nothing
      // stopped it from clearing All-NBA outright with a genuinely weak offense (grades as low as
      // D+/F), unlike every other position's equivalent — PG needs real A- offense for All-NBA+
      // with no defense escape at all; PF already caps below C+ offense straight to All-star. A
      // real elite-two-way wing (B- offense or better, alongside A- defense) is untouched; a
      // wing carried ENTIRELY by defense with no functional offensive floor is not an All-NBA
      // case. Measured before shipping: 43 of 1279 SF spans (3.4%) affected, all below B- offense
      // with A-+ defense — display-only, does not touch TAL/sorting/scoring.
      if (gradeAtLeast(dtalGrade, 'A-') && !gradeAtLeast(otalGrade, 'B-')) caps.push('All-star');
      break;
    case 'PF':
      if (!gradeAtLeast(otalGrade, 'C+')) caps.push('All-star');
      break;
    case 'C': {
      // 2026-08-05: "Greatest peak" needs real A- offense — Robinson/Olajuwon-type exception for
      // a true S-grade defense (an elite-enough anchor overrides the offensive requirement
      // entirely — not those two players by name, anyone whose defense actually reaches S clears
      // it the same way). The exception has to waive BOTH offense-gated caps below, not just the
      // Greatest-peak one — otherwise the weaker "MVP needs B-" cap still fires on its own and
      // quietly drags an S-defense anchor down to All-NBA instead of the intended Greatest peak.
      //
      // 2026-08-08, user's v0.2 rating batch, two follow-ups:
      // - Dwight Howard was stuck at All-NBA (real DTAL 95, a true A+ anchor, but short of the
      //   dynamic S threshold which currently sits at 98) and the ask was specifically MVP tier,
      //   not Greatest peak — relaxed literal-S to a fixed A+ (>=95) for the All-NBA->MVP gate
      //   ONLY (same "S is a fragile relative cutoff, A+ reads the same elite intent" reasoning as
      //   the PG defense-cap exemption earlier this batch), deliberately NOT for the MVP->Greatest
      //   peak gate — Howard's real offense (C+, 67) is meaningfully weaker than every other real
      //   member of that literal-S club (Hakeem/Robinson/Kareem all B or better), so letting him
      //   ride pure defense all the way to Greatest peak would overshoot what was actually asked
      //   and dilute what that top tier is supposed to mean. Checked directly: with the Greatest-
      //   peak gate left at literal S, Howard lands exactly at MVP as requested.
      // - Wembanyama (OTAL B/78, DTAL A/93) still doesn't clear A+ defense OR A- offense on his
      //   own, but IS a genuine two-way anchor — added a second, narrower bypass (OTAL>=B AND
      //   DTAL>=A) for the MVP->Greatest-peak gate specifically, mirroring the SG two-way path
      //   above. Checked the blast radius first (`scripts/_v02_c_exemption_audit.ts`, deleted
      //   after use): only Hakeem/Robinson/Kareem/Wemby clear it — all genuine two-way anchors,
      //   and the first three already reach Greatest peak via other spans regardless, so Wemby is
      //   the real beneficiary, not a new blanket relaxation.
      const dtalIsS = dtalGrade === 'S';
      const cTwoWayElite = gradeAtLeast(otalGrade, 'B') && gradeAtLeast(dtalGrade, 'A');
      if (!gradeAtLeast(otalGrade, 'A-') && !dtalIsS && !cTwoWayElite) caps.push('MVP');
      // 2026-08-14, user-reported (post the `aiDrafter.ts` tier-cap wiring, `displayTalentForSpan`
      // now feeding the AI's own valuation, not just a UI badge): this All-NBA gate's own defense
      // bypass used to be pinned to literal A+ (>=95, the same Howard-era 2026-08-08 threshold the
      // MVP->Greatest-peak gate above still uses on `dtalIsS`/`cTwoWayElite`), while Tim Duncan's
      // real defensive ceiling across his whole career tops out at 94 (A) — one point short — so
      // his declining-offense/elite-defense spans (2003-05 raw MVP-tier TAL 93, 2005-07 raw 89) got
      // capped to All-NBA even though he's as clear a "genuinely elite anchor" case as this bypass
      // is meant to catch. Relaxed to A (>=90) for THIS gate specifically — deliberately NOT
      // touching the MVP->Greatest-peak gate above, which keeps its own literal-A+/S bar.
      const dtalEliteForAllNbaGate = gradeAtLeast(dtalGrade, 'A');
      if (!gradeAtLeast(otalGrade, 'B-') && !dtalEliteForAllNbaGate) caps.push('All-NBA');
      // 2026-08-05 follow-up: a center with neither side reaching a real B+ doesn't have a
      // standout case for MVP+ either, even if their OTAL alone still clears the B- floor above —
      // caught DeMarcus Cousins (2016-18: OTAL B/77, DTAL C/60 — decent both ways, elite at
      // neither) sitting at MVP with no individually strong trait backing it up.
      if (!gradeAtLeast(otalGrade, 'B+') && !gradeAtLeast(dtalGrade, 'B+')) caps.push('All-NBA');
      // 2026-08-13, user-reported: Domantas Sabonis's 2022-24 peak (OTAL A+/95, DTAL F/18)
      // displayed All-NBA untouched by any rule above — every one of them is offense-gated (only
      // fires when OTAL fails some floor), and his OTAL clears all three outright. Unlike PG
      // above, C never had an independent defense floor at all. Mirrors PG's own
      // `!gradeAtLeast(dtalGrade,'C-') && !gradeAtLeast(otalGrade,'A+') -> cap All-NBA` shape, but
      // PG's A+ bypass would be a no-op here — Sabonis's OTAL grade IS A+, so an A+-gated
      // exemption leaves him exactly as untouched as before.
      //
      // First shipped gated on literal S (dynamic "3 best in the pool" cutoff) instead of A+ —
      // caught in blast-radius review before shipping: Nikola Jokić's OTAL is clamped at the
      // scale's hard ceiling (100, `computeOffensiveTalent`'s own `Math.min(100, ...)`) on 5 real
      // spans, but only SOME of those get graded literal S vs A+ depending on which other spans
      // happen to occupy the pool's dynamic top-3 that round — the exact "S is a fragile relative
      // cutoff" problem this file's own PG/Howard comments already warn about, here catching two
      // of Jokić's spans (2019-21, 2020-22) into an unintended "Greatest peak" -> "All-NBA" drop
      // for no real reason tied to his actual offense. Fixed by testing the raw, hard-clamped
      // OTAL number instead of its letter grade — `otal >= 100` is an absolute scale-ceiling
      // fact, not a relative rank, so it can't flicker between spans of identical real quality.
      // Checked directly across the whole C pool before shipping: OTAL>=100 belongs to Jokić (5
      // spans) alone among anyone this cap could otherwise reach; Sabonis peaks at 95, Embiid at
      // 99 — both still correctly capped.
      if (!gradeAtLeast(dtalGrade, 'C-') && otal < 100) caps.push('All-NBA');
      break;
    }
  }
  return caps;
}

export interface TierGateContext {
  position: Position;
  tal: number;
  otal: number;
  dtal: number;
  fga: number;
  /** Optional — only needed for the GOAT-tier check below. Every real UI call site
   * (`tierContextFor` in DraftBoard.tsx) supplies it; left optional so any caller building a
   * synthetic/hypothetical context (validation scripts, dry-runs) doesn't need to invent a name. */
  playerName?: string;
  /** Optional, same reasoning as `playerName` above — feeds `offensiveGrade`'s S-check (see its
   * own docstring). Real UI call sites (`tierContextFor`) supply the span's real
   * `computeUncappedOffensiveTalent`; synthetic/hypothetical contexts default to `otal`, same as
   * calling `offensiveGrade` with no second argument. */
  otalUncapped?: number;
  /** Optional, same reasoning as `playerName` — feeds `NAMED_TIER_EXCEPTIONS` (a (player, span)
   * pair, not player alone, same scoping reason `GREATEST_PEAK_TIER_BONUS` in aiDrafter.ts uses
   * for its own named-span bonuses). */
  spanLabel?: string;
  /** Optional — real, un-tier-scaled playoff efficiency signal (negative = a real collapse,
   * positive = a real riser; see `PLAYOFF_COLLAPSE_TIER_CAP` below for why this exists and why it
   * gates the TIER rather than the number). Left optional for the same reason as the other
   * context fields: synthetic/validation contexts default to no signal (0). */
  playoffCollapse?: number;
  /** 2026-08-14, user's own "Sixth Man" tag idea (`sixthMan.ts`'s own docstring has the full
   * derivation/thresholds) — a real instant-offense-off-the-bench profile, deliberately computed
   * OUTSIDE this file (`sixthMan.ts` imports `offensiveGrade`/`defensiveGrade` FROM here, so this
   * file importing back from `sixthMan.ts` would be the exact import cycle `portability.ts`'s own
   * docstring already warns about) — every real UI call site sets it by calling
   * `isSixthManProfile(span)` itself; left optional/undefined-safe so synthetic/validation
   * contexts and `aiDrafter.ts`'s own `tierContextFor` calls (which don't need the display label)
   * are unaffected. When true, overrides the computed tier to 'Sixth Man' — a role description,
   * not a power ranking, so it does NOT go through the normal `stricterTier` cap-folding above. */
  isSixthMan?: boolean;
  /** 2026-08-19, user's explicit PG archetype ask (shooter/playmaker/defense, scoped to
   * below-All-NBA only — see `tierCaps`'s PG case for the full rule). Optional/undefined-safe
   * like every other context field above: a synthetic/validation context that omits these simply
   * never trips the new gate, same "no signal, no restriction" default the others already use. */
  spacing?: number;
  apg?: number;
  /** 2026-08-31, user-reported (batch feedback: `talent.ts`'s new elite-one-way-defense bonus —
   * see that bonus's own docstring — pushed Rudy Gobert's five affected spans, plus one span
   * each for Dwight Howard/Mourning/Walton/prime Hakeem/Duncan, from All-NBA into MVP). Optional/
   * undefined-safe like every other context field: when omitted, `tal` is used in its place, so
   * the gate below simply never fires for a synthetic/validation context — the same "no signal,
   * no restriction" default this file already uses everywhere else. */
  talWithoutEliteDefenseBonus?: number;
  /** 2026-08-31 (dedicated bridge pass): the number `computeTalent` would produce without the
   * D-TAL->TAL bridge (`talent.ts`'s `dtalBridgeCorrection`). The bridge is a small mean-zero
   * defensive rank nudge (cap +5 / -6); near a hard tier threshold that move still flips the whole
   * badge. Same optional/undefined-safe shape as `talWithoutEliteDefenseBonus` — omitted contexts
   * fall back to `tal`, so the two bridge gates below simply never fire for synthetic/validation
   * contexts. */
  talWithoutBridge?: number;
  /** 2026-09-01, user-reported (Bosh/Gasol/Aldridge): a sustained real plus-minus record (DARKO +
   * historical APM, `realValueFloor.ts`) that the box-score base badly understates for high-volume
   * mid-range scoring bigs. When set ('Starter' or 'All-star'), the displayed tier can't read
   * below it — a raise only, yields to `NAMED_TIER_DOWNCAPS`, never manufactures All-NBA+.
   * Optional/undefined-safe like every other context field. */
  realValueFloor?: OverallTier;
  /** Raise a real All-NBA span with strong, reliable playoff BPM to an All-NBA floor. */
  playoffValidatedAllNba?: boolean;
}

/**
 * 2026-08-07, user explicit ask: "LeBron, Jordan and Curry [have] not so much separation" from
 * the rest of "Greatest peak" (a real, honest consequence of the soft-cap — see talent.ts's own
 * docstring on `SOFT_CAP_K`, which deliberately compresses the whole top band toward 100 so nothing
 * can hard-clip into an indistinguishable tie). This is the FOURTH named-player special case in
 * the whole project (after Curry's shooting-gravity cap, Magic's SF position-correction override,
 * and Durant's SF-defense-cap exclusion) — still exceptional, not a pattern to extend to a fourth
 * name without being asked. Purely a DISPLAY tier, one rung above "Greatest peak": doesn't touch
 * `computeTalent`, draft value, sorting, or sim behavior anywhere — a real draft-priority slide is
 * a separate question (checked directly via `checkEliteSlideDiagnostic.ts` the same session: 25
 * simulated 16-team drafts put Jordan at pick 1-8 every single time, avg 2.7 — the existing
 * `GREATEST_PEAK_DRAFT_TIERS` tier-1 bonus in aiDrafter.ts is already doing that job for real; a
 * single live-game slide to pick 32 reads as rare lottery variance, not a systemic regression).
 * Survived the 2026-08-07 partial revert (see `GRADE_ORDER`'s own docstring above) — the user
 * explicitly asked to keep GOAT while rolling back the tier-cap/O-TAL formula experiments.
 */
const GOAT_NAMES: ReadonlySet<string> = new Set(['Michael Jordan', 'LeBron James', 'Stephen Curry'].map(normalizePlayerName));

/**
 * 2026-08-12, prototype: user's own follow-up on the playoff-performance work this session —
 * Embiid's real, repeated playoff efficiency collapses (measured directly from real playoff-vs-
 * regular-season TS%, opponent-defense-adjusted; see the playoff-BPM/TS-delta session work)
 * barely move his DISPLAYED TAL even with a tier-scaled additive malus up to 3.5x, because his
 * raw (pre-softcap) value sits at 109-120 — deep enough into `softCapTalent`'s asymptotic
 * compression that no realistically-sized additive number moves the shown TAL at all. Confirmed
 * directly: a -10.2 to -10.8 malus (the tier-scaled attempt) only ever moved his displayed TAL by
 * 1 point.
 *
 * Gating the TIER BADGE instead, exactly the same shape as every other rule in `tierCaps` below
 * (position-specific FGA/grade gates), sidesteps the softcap fight entirely: "Greatest peak"/
 * "GOAT" is a claim about being one of the best seasons ever, and a real, evidence-based,
 * opponent-adjusted playoff collapse is real counter-evidence against that specific claim,
 * independent of how compressed the underlying number is. Position-agnostic (a real collapse is
 * not a position-specific concept), unlike the rest of `tierCaps`.
 *
 * Thresholds are the same base (un-tier-scaled) signal already built and validated this session
 * (TS%-delta vs opponent toughness, REF=8/POWER=1.5 curve, capped ±5) — NOT run through the tier
 * multiplier, since the whole point of this mechanism is to stop depending on the number being
 * large enough to survive the softcap. A genuinely severe reading (clearing roughly 40% of that
 * curve's own ±5 range) removes eligibility for "Greatest peak"/"GOAT"; a reading at or near the
 * curve's own cap removes eligibility for "MVP" too. Still a prototype — not yet validated against
 * the project's usual Taylor top-10/GOAT-40/blast-radius checks before shipping.
 */
const PLAYOFF_COLLAPSE_MVP_CAP_THRESHOLD = -2;
const PLAYOFF_COLLAPSE_ALL_NBA_CAP_THRESHOLD = -4;

/**
 * 2026-08-13, user proposal for the McAdoo/Lanier "accepted pre-DARKO gap" bucket (see
 * `talent.ts`'s own docstring on `extremeUsageRatioPenalty` and this project's memory for the
 * fuller history — real BPM2-corroborated defense credit pushes both of them to MVP-tier with no
 * clean numeric lever to pull without also dragging down genuinely elite modern two-way bigs who
 * share the same `darkoDefenseBonus` mechanism). Rather than fight the number, cap the BADGE:
 * a span that entirely predates 1976 (before the 1976 ABA-NBA merger, roughly the point this
 * project's external validation sources start having real opinions about a player) and whose
 * player never appears in either of Ben Taylor's published all-time lists (`taylorValidatedNames.ts`
 * — the same lists `validateAgainstTaylorTop10.ts`/`validateAgainstBackpicksGoat.ts` already treat
 * as this project's external ground truth) can't claim MVP+ on an unverifiable, single-source
 * (BPM2-only) defensive read alone. Position-agnostic, same shape as the playoff-collapse cap
 * above. A genuine, externally-corroborated legend from that era (Kareem, Wilt, Russell, Oscar,
 * West, Havlicek, Pettit, Frazier, Baylor, Barry, Gilmore — all already on one of the two lists)
 * is completely untouched; this only reaches players this project has no outside opinion on.
 */
const UNVALIDATED_ERA_CAP_YEAR = 1976;

function isUnvalidatedPre1976Span(spanLabel: string, playerName?: string): boolean {
  if (playerName && TAYLOR_VALIDATED_NAMES.has(normalizePlayerName(playerName))) return false;
  const years = spanEndYears(spanLabel);
  return years.length > 0 && years.every((year) => year < UNVALIDATED_ERA_CAP_YEAR);
}

/** The tier-badge function every UI call site should use instead of the raw `overallTier` —
 * same output for anyone who clears every gate for their position, strictly lower (never
 * higher) for anyone who doesn't. `overallTier` itself stays exported and untouched, since
 * scoring.ts and any non-per-player context has no single (position, O-TAL, D-TAL, FGA) tuple
 * to gate on. */
export function overallTierForSpan(ctx: TierGateContext): OverallTier {
  const base = overallTier(ctx.tal);
  const otalGrade = offensiveGrade(ctx.otal, ctx.otalUncapped ?? ctx.otal);
  const dtalGrade = defensiveGrade(ctx.dtal);
  const caps = tierCaps(
    ctx.position,
    otalGrade,
    dtalGrade,
    ctx.fga,
    hasNamedTierException(ctx.playerName, ctx.spanLabel),
    ctx.otal,
    isCP3TwoWayExempt(ctx.playerName ?? '', ctx.otal, ctx.dtal),
  );
  const playoffCollapse = ctx.playoffCollapse ?? 0;
  if (playoffCollapse <= PLAYOFF_COLLAPSE_ALL_NBA_CAP_THRESHOLD) caps.push('All-NBA');
  else if (playoffCollapse <= PLAYOFF_COLLAPSE_MVP_CAP_THRESHOLD) caps.push('MVP');
  if (ctx.spanLabel && isUnvalidatedPre1976Span(ctx.spanLabel, ctx.playerName)) caps.push('All-NBA');
  const downcap = namedTierDowncap(ctx.playerName, ctx.spanLabel);
  if (downcap) caps.push(downcap);
  // 2026-09-01, user's long-open "PG overvalues defensive profiles" follow-up. A defensive PG with
  // a weak offensive grade can stack `twoWaySynergyBonus` + `darkoDefenseBonus` + the
  // `synergyGateDefense` corroboration bump into an All-NBA number — Mookie Blaylock x4 (1
  // All-Star, never All-NBA), Terrell Brandon, Maurice Cheeks. Capping the bonus SUM in `talent.ts`
  // was tested and cost GOAT-40 0.016 while missing the base-defense cases. This tier cap is the
  // surgical version: a PG whose offense grades below `PG_DEFENSE_ONLY_OTAL_FLOOR` can't display
  // above All-star UNLESS the league actually voted them All-NBA in this span's own window
  // (`madeAllNbaInSpan` — Kidd / Payton / Frazier / Fat Lever all have real in-window picks and
  // are untouched). Display-only, no TAL change, Taylor/GOAT-safe.
  if (
    ctx.position === 'PG' &&
    ctx.playerName &&
    ctx.spanLabel &&
    !gradeAtLeast(otalGrade, PG_DEFENSE_ONLY_OTAL_FLOOR) &&
    !madeAllNbaInSpan(ctx.playerName, ctx.spanLabel)
  ) {
    caps.push('All-star');
  }
  let capped = caps.reduce((tier, cap) => stricterTier(tier, cap), base);
  // 2026-08-31, user-reported (batch feedback): `talent.ts`'s new elite-one-way-defense bonus
  // (see that bonus's own docstring — Ben Wallace/Mark Eaton/Mutombo/Bill Russell/Tony Allen, all
  // real 4x-DPOY-or-comparable specialists topping out well below where their defense alone
  // should carry them) is meant to lift a genuine one-way anchor to a respectable level, not let
  // that ONE bonus alone be the reason a span crosses into MVP+ — that tier is still meant to
  // require the span to have gotten there on its OTHER merits too. Measured directly before
  // shipping (`scripts` batch, full C-position before/after tier sweep): only 11 spans actually
  // cross this way — Rudy Gobert (5 of his 6 spans), plus one span each for Dwight Howard,
  // Alonzo Mourning, Bill Walton, prime Hakeem (1986-88) and Tim Duncan (2004-06). Every other
  // MVP+ center in the pool (the vast majority — Hakeem's other 8 spans, every Duncan/Robinson/
  // Kareem/Wembanyama span) already cleared MVP on their pre-bonus number and is completely
  // unaffected, since this only fires when the bonus itself was the deciding factor.
  const withoutBonusTal = ctx.talWithoutEliteDefenseBonus ?? ctx.tal;
  if (tierRank(capped) >= tierRank('MVP') && tierRank(overallTier(withoutBonusTal)) < tierRank('MVP')) {
    capped = stricterTier(capped, 'All-NBA');
  }
  // 2026-08-31 (dedicated bridge pass): same shape as the elite-defense-bonus gate directly above,
  // extended to every top-tier boundary. The D-TAL->TAL bridge (`talent.ts`) is a small mean-zero
  // defensive rank correction (cap +5 / -6); near a top-tier floor that nudge flips the whole badge
  // (Anthony Edwards 2024-26 into MVP, Durant 2009-11 MVP->Greatest peak, Dirk 1999-01, Kobe
  // 2008-10 all measured crossing this way). The bridge can lift the displayed NUMBER within a
  // band, but it can't lift the displayed TIER above what the non-bridge number earns once that
  // tier is MVP or higher — never below All-NBA, so a legit All-NBA span the bridge nudged isn't
  // over-punished (matching the elite-defense gate's own floor). The Sixth-Man/PG-archetype floor
  // is gated the same way further down.
  const withoutBridgeTal = ctx.talWithoutBridge ?? ctx.tal;
  const bridgeFreeTier = overallTier(withoutBridgeTal);
  if (tierRank(capped) >= tierRank('MVP') && tierRank(capped) > tierRank(bridgeFreeTier)) {
    capped = stricterTier(capped, tierRank(bridgeFreeTier) >= tierRank('MVP') ? bridgeFreeTier : 'All-NBA');
  }
  // 2026-08-19, user's explicit PG shooter/playmaker/defense archetype ask. Originally scoped to
  // "only below All-NBA" (tier rank), but the user's own direct follow-up narrowed the entry
  // threshold further after seeing real Sixth-Man-capped cases still read close to Starter/
  // All-star numbers (Lillard, Kyrie, Haliburton...): "zróbmy że powyżej 75 TAL nie robimy sixth
  // mana, zmniejszmy też próg wejścia" (above 75 TAL, no Sixth Man; lower the entry threshold
  // too). Now gated on the actual NUMBER after every existing cap above (`numberSoFar`), not tier
  // rank — a span whose raw TAL nominally reaches All-NBA but is already pulled down by an
  // existing cap is a real below-threshold span for this purpose too (the same reasoning that
  // caught LaMelo Ball's 2021-23 span originally), while a span whose post-cap number is already
  // above `PG_ARCHETYPE_ENTRY_TAL_CEILING` is left alone entirely — this is what directly
  // guarantees "no Sixth Man above 75," since nothing in this rule can fire past that point at
  // all, not just the Sixth Man branches specifically. Real, already-established thresholds for
  // the three archetype factors, not invented fresh: `PLUS_SHOOTER_SPACING` (65, the existing
  // "genuine floor-spacer" bar `isPlusShooter`/`talent.ts`'s spacing correction both already use)
  // for shooting; PG's own real APG distribution (p50=5.6, p75=7.3 in the pool) for playmaking,
  // landing on 6.0 as a real "clearly above average, short of the existing 7.0
  // ELITE_PLAYMAKING_APG_THRESHOLD" bar; PG's own real D-TAL p75 (55) for defense.
  if (ctx.position === 'PG') {
    // Entry gated on the NON-bridge number (2026-08-31): the archetype rule is about a PG's own
    // shooting/playmaking/defense profile and whether it's star-level enough to be exempt — a
    // separate mean-zero defensive rank nudge shouldn't be what pushes a span across the 75 entry
    // line in either direction (Steve Nash / Isaiah Thomas / Trae Young sit just above it and a
    // downward bridge correction would newly demote them here; Curry 2010-12 / Kemba 2017-19 sit
    // just below and an upward one would newly exempt them).
    const numberSoFar = applyGradeCeiling(withoutBridgeTal, tierCeiling(capped));
    if (numberSoFar <= PG_ARCHETYPE_ENTRY_TAL_CEILING) {
      const isGoodShooter = (ctx.spacing ?? 0) >= PG_ARCHETYPE_SHOOTER_SPACING_FLOOR;
      const isGoodPlaymaker = (ctx.apg ?? 0) >= PG_ARCHETYPE_PLAYMAKER_APG_FLOOR;
      const isGoodDefense = ctx.dtal >= PG_ARCHETYPE_DEFENSE_DTAL_FLOOR;
      const isRealScorer = ctx.otal >= PG_ARCHETYPE_REAL_SCORER_OTAL;
      let archetypeCap: OverallTier | null = null;
      if (isGoodShooter && !isGoodPlaymaker && !isGoodDefense) archetypeCap = isRealScorer ? 'Sixth Man' : 'Bench Warmer'; // "shit player" unless a real scorer
      else if (isGoodShooter && !isGoodPlaymaker && isGoodDefense) archetypeCap = 'Sixth Man'; // "good rotation player"
      else if (isGoodShooter && isGoodPlaymaker && !isGoodDefense) archetypeCap = 'Sixth Man'; // "good sixthman"
      else if (!isGoodShooter && isGoodPlaymaker && isGoodDefense) archetypeCap = 'Starter'; // "starter in SOME TEAMS"
      // good/good/good ("good enough for starter") and the 3 combinations the user didn't name
      // are deliberately left untouched — whatever `capped` already reads stands.
      // 2026-09-01, PG audit: a real in-window All-NBA selection is the league voting the player
      // top-15 that season — categorically not the "limited shooter/playmaker, bench player"
      // profile the Sixth Man / Bench Warmer branches claim. For those spans the archetype cap
      // can still pull an inflated number DOWN, but not below All-star — Kemba Walker 2017-19
      // (All-NBA 3rd 2019), Tyrese Maxey 2024-26, De'Aaron Fox 2023-25, Cade Cunningham 2023-25,
      // Tim Hardaway 1997-99 (All-NBA 1st), Damian Lillard 2014-16, Mark Price 1987-89 were all
      // being dumped to Sixth Man. Deliberately a FLOOR on the cap, not an exemption: removing the
      // cap entirely let a dozen spans (Rondo, Ja Morant, John Wall, Stockton...) float from their
      // real tier all the way to All-NBA on the bridge/spacing inflation the cap exists to hold.
      if (
        archetypeCap &&
        ctx.playerName &&
        ctx.spanLabel &&
        madeAllNbaInSpan(ctx.playerName, ctx.spanLabel) &&
        tierRank(archetypeCap) < tierRank('All-star')
      ) {
        archetypeCap = 'All-star';
      }
      if (archetypeCap) capped = stricterTier(capped, archetypeCap);
    }
  }
  // GOAT is a RAISE, deliberately the only exception to this function's own "caps only ever
  // lower a tier" rule (see every other case above) — gated on already having earned "Greatest
  // peak" on the real merits first, so it can never manufacture a top tier out of nothing.
  if (capped === 'Greatest peak' && ctx.playerName && GOAT_NAMES.has(normalizePlayerName(ctx.playerName))) {
    return 'GOAT';
  }
  // 'Sixth Man' is a role RELABEL, not a rank — same "independent of the cap-folding above"
  // shape as the GOAT raise, just never able to conflict with it in practice (`isSixthManProfile`
  // requires TAL<80, GOAT requires 'Greatest peak' i.e. TAL>=94 first).
  let result: OverallTier = ctx.isSixthMan ? 'Sixth Man' : capped;
  // 2026-09-01 (Bosh/Gasol/Aldridge): a sustained real plus-minus record (`realValueFloor.ts`) the
  // box-score base badly understates for high-volume mid-range scoring bigs. Raise only, capped at
  // 'All-star' by construction, yields to an explicit `NAMED_TIER_DOWNCAPS` entry, and beats the
  // instant-offense-off-the-bench relabel (a genuine +4 real-value player is not a bench
  // specialist — the same case the `isSixthManProfile` real-value guard in `sixthMan.ts` handles).
  if (ctx.realValueFloor && !downcap && tierRank(ctx.realValueFloor) > tierRank(result)) {
    result = ctx.realValueFloor;
  }
  if (ctx.playoffValidatedAllNba && !downcap && tierRank(result) < tierRank('All-NBA')) {
    result = 'All-NBA';
  }
  // See NAMED_TIER_RAISES's own docstring — a direct override, not gated on any real tier the
  // span already earned (unlike GOAT above). Only ever takes effect if it's actually HIGHER than
  // what capped/caps already computed, so it can't accidentally undo a real downcap for the same
  // span if one ever existed.
  const raise = namedTierRaise(ctx.playerName, ctx.spanLabel);
  if (raise && tierRank(raise) > tierRank(result)) return raise;
  return result;
}

/** The top of each tier's own band — one below the next tier's floor, so a capped player's
 * displayed number can never read as high as a real, uncapped member of the tier above. The
 * top two tiers ('Greatest peak', 'GOAT') have no ceiling of their own (nothing to cap
 * against) — GOAT isn't in `OVERALL_TIER_FLOORS` at all (TAL itself never earns it, see above),
 * so it needs its own explicit case rather than falling through the floor lookup. */
function tierCeiling(tier: OverallTier): number {
  if (tier === 'GOAT') return Infinity;
  // Not in `OVERALL_TIER_FLOORS` (same reason GOAT isn't — it's a relabel, not a rank on that
  // ladder).
  // 2026-08-19, user's explicit ask ("niższy pułap" — lower ceiling), found while shipping the PG
  // shooter/playmaker/defense archetype rule (`overallTierForSpan`'s own docstring): the old 79
  // was documented as "a safety ceiling, not an active clamp in practice" for the original
  // `isSixthManProfile` relabel, but checked directly against the real pool — that claim was only
  // ever true by luck. All 6 real isSixthMan-flagged spans currently AT this tier have raw TAL
  // above 65, so the old 79 ceiling was doing real (if small) work even there. The archetype
  // rule's own new "good/good/bad" and "good/bad/good" PG cases made the gap much more visible —
  // 95 spans land at Sixth Man through it, 78 of them with raw TAL above 65 (Lillard, Kyrie,
  // Haliburton, Garland...), showing a number that read exactly like Starter/All-star with a
  // demoted label, not a genuinely lower one. Lowered to 65 — clearly below Starter's own ceiling
  // (69), so "Sixth Man" now reads as an actually distinct, lower tier for both use cases, not
  // just a relabel that happens to leave the number alone.
  if (tier === 'Sixth Man') return 65;
  const idx = OVERALL_TIER_FLOORS.findIndex(([, name]) => name === tier);
  const next = OVERALL_TIER_FLOORS[idx + 1];
  return next ? next[0] - 1 : Infinity;
}

/**
 * 2026-08-05, user's direct follow-up after seeing the tier cap ship: capping only the BADGE
 * left the number right next to it unchanged (Stockton's badge read "All-NBA" next to a "93" —
 * 93 is what MVP tier itself looks like, so the pair visibly contradicted each other and read as
 * broken, not as "capped"). This is the display-number counterpart to `overallTierForSpan`:
 * clamps the shown TAL down to the top of whatever tier it actually got capped to, so the number
 * and the badge always agree. Deliberately DISPLAY-ONLY, same as the tier itself — draft
 * value/sorting/`computeTalent` everywhere else keep using the real, uncapped number; the AI's
 * own "drafts Stockton too fast" complaint was already fixed separately and for real via
 * `eliteLowUsageDraftMalus` in aiDrafter.ts (an actual value change, not a display one). Turning
 * this into a real TAL change too would mean gating `computeTalent` itself on position/grade/FGA
 * — a much bigger, position-and-role-dependent formula this project has deliberately kept as a
 * pure per-span function (see talent.ts's own docstring on why a roster-context-aware version
 * was rejected); not done without being asked for specifically.
 *
 * 2026-08-08, user's own follow-up ("too many PG players at the top with a similar rating"):
 * the flat `Math.min(ctx.tal, tierCeiling(...))` below was a hard clip, same failure mode
 * `talent.ts`'s own `applyGradeCeiling` was just built to fix one layer down — auditing the
 * actual browse-pool view (not just raw TAL) found EIGHT real PG spans (Stockton, Westbrook,
 * Luka, Archibald, Arenas, Kyrie, Lillard, Terry Porter — real TAL 87-92) all displaying as the
 * identical "87" because `tierCaps` capped all of them to All-NBA and this clamp flattened every
 * one onto that tier's exact ceiling. Switched to the same soft-compression `applyGradeCeiling`
 * already uses: still strictly below the next tier's floor (so the badge and number can never
 * contradict each other — the original 2026-08-05 reason this clamp exists at all), just no
 * longer collapsing genuinely different players onto one number.
 */
/** The floor each tier's own band starts at, per `OVERALL_TIER_FLOORS` — the counterpart to
 * `tierCeiling` above, needed so `displayTalentForSpan` can floor a `NAMED_TIER_RAISES` span's
 * NUMBER to match its raised badge (see that map's own docstring: a raise that only changed the
 * badge, leaving the number below the tier's real floor, would read exactly as broken as the
 * badge/number mismatch `displayTalentForSpan`'s own history already had to fix once). Not
 * meaningful for 'GOAT' (a relabel, not a real floor on the ladder) — returns 0 there, but no
 * caller currently needs that case since `NAMED_TIER_RAISES` never targets GOAT. */
function tierFloor(tier: OverallTier): number {
  const entry = OVERALL_TIER_FLOORS.find(([, name]) => name === tier);
  return entry ? entry[0] : 0;
}

const PLAYOFF_VALIDATED_ALL_NBA_TAL_FLOOR = 82;

export function displayTalentForSpan(ctx: TierGateContext): number {
  const override = namedDisplayTal(ctx.playerName, ctx.spanLabel);
  if (override !== undefined) return override;
  const cappedTier = overallTierForSpan(ctx);
  const raw = Math.round(applyGradeCeiling(ctx.tal, tierCeiling(cappedTier)));
  // Only when a deliberate raise (a `NAMED_TIER_RAISES` entry, or the sustained real-value floor)
  // is actually what produced this span's displayed tier — every other span (the vast majority)
  // is unaffected. Both would otherwise leave the NUMBER below the badge's own floor, the exact
  // badge/number mismatch this function's history already had to fix once.
  const raisedByFloor =
    (ctx.realValueFloor === cappedTier && tierRank(overallTier(ctx.tal)) < tierRank(cappedTier)) ||
    (ctx.playoffValidatedAllNba === true &&
      cappedTier === 'All-NBA' &&
      tierRank(overallTier(ctx.tal)) < tierRank('All-NBA'));
  if (namedTierRaise(ctx.playerName, ctx.spanLabel) === cappedTier || raisedByFloor) {
    const floor = ctx.playoffValidatedAllNba && cappedTier === 'All-NBA'
      ? PLAYOFF_VALIDATED_ALL_NBA_TAL_FLOOR
      : tierFloor(cappedTier);
    return Math.max(raw, floor);
  }
  return raw;
}

/**
 * 2026-08-19, user's explicit ask ("CAP ma nie być tylko wizualny ale faktycznie funkcjonujący"
 * — the cap should not be just visual but actually functioning): full-pool scan found 242 spans
 * (117 distinct players, up to a 21-point gap — Brent Barry 86->65, Baron Davis 86->65) where
 * `computeTalent` (the number every real gameplay decision — rotation assignment, `talentScore`/
 * `benchDepthScore`/`fitScore`, most of `aiDrafter.ts`'s own bonus/malus checks) and
 * `displayTalentForSpan` (the number the badge shows, and the ONE thing `aiDrafter.ts`'s own main
 * pick-value formula already used) genuinely disagreed. Not a hypothetical inconsistency — it's
 * why Brent Barry's real AI-draft value (86) never matched what his own displayed grade (65)
 * implied he should be worth.
 *
 * `effectiveTalent` is now the one canonical "how good is this player, for every real gameplay
 * purpose" number — memoized (same shape as `computeTalent`'s own `talentCache`, since this is
 * called from the same hot rotation/draft loops) rather than recomputing `tierContextFor`'s own
 * several `computeTalent`/`computeOffensiveTalent`/`computeDefensiveTalent` lookups on every call
 * — those are already individually memoized, but the extra grade/tier-cap arithmetic on top of
 * them isn't free at draft-simulation scale. `computeTalent` itself stays exported and untouched
 * for the few callers that genuinely want the pre-tier-cap raw number (this function, `talent.ts`'s
 * own internal ceiling math, evidence/debug reporting) — this is deliberately the new default for
 * everything that makes a real, in-game decision.
 */
const effectiveTalentCache = new Map<string, number>();
export function effectiveTalent(span: PlayerSpan): number {
  const cached = effectiveTalentCache.get(span.id);
  if (cached !== undefined) return cached;
  const result = displayTalentForSpan(tierContextFor(span));
  effectiveTalentCache.set(span.id, result);
  return result;
}

/**
 * The GOAT tier's own "give them 100+" ask. First shipped showing the real uncapped number
 * (`rawUncappedTalent`, talent.ts — skips the soft-cap's asymptotic approach-to-100 and the
 * final clamp, e.g. Jordan's peak spans read 115-131 raw); user's own direct follow-up asked for
 * the literal string "100+" instead — "ładniej wizualnie się będzie prezentować" (looks nicer
 * visually) — a specific number like "131" reads as an odd, arbitrary figure rather than a
 * deliberate "beyond the scale" flourish. `rawUncappedTalent` is still what GATES this (only
 * genuinely above-100-raw spans show it — no GOAT-tier span is ever actually below 100 raw in
 * practice, since the tier itself requires "Greatest peak" first, but checking directly rather
 * than assuming keeps this honest if that ever changes).
 */
export function displayNumberForSpan(span: PlayerSpan, ctx: TierGateContext): number | string {
  if (overallTierForSpan(ctx) !== 'GOAT') return displayTalentForSpan(ctx);
  return rawUncappedTalent(span) > 100 ? '100+' : rawUncappedTalent(span);
}

/**
 * Builds a span's real `TierGateContext` — moved here from `DraftBoard.tsx` (2026-08-14, the
 * `ELITE_TALENT_FGA_PENALTY_DAMPENING`/Tatum investigation) so `aiDrafter.ts` (a pure engine
 * file) can compute a real tier-capped value for a draft candidate without importing from a
 * React component, which was the wrong dependency direction (engine importing UI). `DraftBoard.tsx`
 * re-exports this for its own and `DraftPoolBrowser.tsx`'s existing call sites — no behavior
 * change there, purely a move.
 */
export function tierContextFor(span: PlayerSpan): TierGateContext {
  const playoffBpm = playoffBpm2ForSpan(span);
  return {
    position: span.primaryPosition,
    tal: computeTalent(span),
    otal: computeOffensiveTalent(span),
    otalUncapped: computeUncappedOffensiveTalent(span),
    dtal: computeDefensiveTalent(span),
    fga: span.fga,
    playerName: span.playerName,
    spanLabel: span.spanLabel,
    // Same real, un-scaled playoff-collapse signal already feeding computeTalent's additive term
    // (talent.ts, via playoffPerformanceBonus) — see this file's own docstring on why the top of
    // the scale needs a tier cap instead of a bigger additive number (softCapTalent absorption).
    playoffCollapse: playoffPerformanceBonus(span),
    spacing: computeSpacing(span),
    apg: span.box.apg,
    talWithoutEliteDefenseBonus: computeTalentWithoutEliteDefenseBonus(span),
    talWithoutBridge: computeTalentWithoutBridge(span),
    realValueFloor: realValueTierFloor(span) ?? undefined,
    playoffValidatedAllNba:
      madeAllNbaInSpan(span.playerName, span.spanLabel) &&
      playoffBpm !== null &&
      playoffBpm.bpm >= 4 &&
      playoffBpm.reliability >= 0.5,
  };
}
