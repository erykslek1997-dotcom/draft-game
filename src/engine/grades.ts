import type { Position, PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { computeOffensiveTalent, computeDefensiveTalent, rawUncappedTalent } from './talent';
import { computeOffensivePortability, computeDefensivePortability } from './portability';

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

/** The value a span needs to clear for S — the 3rd-highest *distinct* value in the reference
 * population, so ties at the cutoff all earn S together rather than an arbitrary cut mid-tie. */
function computeSThreshold(values: number[]): number {
  const sorted = [...new Set(values)].sort((a, b) => b - a);
  return sorted[2] ?? sorted[sorted.length - 1] ?? 100;
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

export function offensiveGrade(value: number): Grade {
  if (offensiveSThreshold === null) {
    offensiveSThreshold = computeSThreshold(draftPool.map((p) => computeOffensiveTalent(p)));
  }
  return gradeForValue(value, offensiveSThreshold);
}

export function defensiveGrade(value: number): Grade {
  if (defensiveSThreshold === null) {
    defensiveSThreshold = computeSThreshold(draftPool.map((p) => computeDefensiveTalent(p)));
  }
  return gradeForValue(value, defensiveSThreshold);
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

export function offensivePortabilityGrade(value: number): Grade {
  if (offensivePortabilitySThreshold === null) {
    offensivePortabilitySThreshold = computeSThreshold(draftPool.map((p) => computeOffensivePortability(p)));
  }
  return gradeForValue(value, offensivePortabilitySThreshold);
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
  'Starter',
  'All-star',
  'All-NBA',
  'MVP',
  'Greatest peak',
  'GOAT',
];
function tierRank(t: OverallTier): number {
  return TIER_ORDER.indexOf(t);
}
function stricterTier(a: OverallTier, b: OverallTier): OverallTier {
  return tierRank(a) <= tierRank(b) ? a : b;
}

/** Low-volume floor for the guard-specific FGA gates below — under this, "the offense even
 * came through them" is itself in question, independent of how efficient the shots they did
 * take were. */
const TIER_GATE_LOW_FGA = 10;

/** 2026-08-07: the middle band between "barely playing offense" (TIER_GATE_LOW_FGA, 10) and a
 * genuine high-volume shooting guard — see the SG case's own comment (Manu Ginobili: 10.4-12.5
 * FGA on his best-rated spans). */
const SG_MODERATE_FGA_FLOOR = 13;

/** Position-specific downward tier caps, applied ascending so a player can trip more than one
 * (the most restrictive wins — see `stricterTier` fold below). Every threshold reuses the exact
 * letter-grade bands `offensiveGrade`/`defensiveGrade` already display, so the rule reads the
 * same way the user specified it ("PG below A- can't be MVP") rather than a re-derived number. */
function tierCaps(position: Position, otalGrade: Grade, dtalGrade: Grade, fga: number): OverallTier[] {
  const caps: OverallTier[] = [];
  switch (position) {
    case 'PG':
      // Real half-court shot creation (grade + volume) is the PG case for MVP+; missing either
      // caps at All-NBA. A weak offensive grade on top of that caps much lower, at Starter.
      if (!gradeAtLeast(otalGrade, 'A-') || fga < TIER_GATE_LOW_FGA) caps.push('All-NBA');
      if (!gradeAtLeast(otalGrade, 'C+')) caps.push('Starter');
      // 2026-08-05 follow-up: a genuinely bad defender (below C-) with only an ordinary (not
      // truly elite) offensive peak doesn't have the profile for MVP either — a real top-of-scale
      // offense is its own exemption, same shape as SG's below. Gated on A+ rather than strictly
      // 'S' — S is a *relative* cutoff (3rd-best in the current pool) that can drift as other
      // formula changes move the pool around, so pinning an exemption to it exactly is fragile;
      // A+ (a fixed 95+ floor) reads the same "truly elite" intent without that fragility.
      if (!gradeAtLeast(dtalGrade, 'C-') && !gradeAtLeast(otalGrade, 'A+')) caps.push('All-NBA');
      // 2026-08-07, user explicit ask ("boosts PGs too much"): the 2026-08-07 playmaking-skill
      // TAL bonus (playmakingThreeLevel.ts) lifts a lot of PG O-TAL grades a full band or more
      // (PG's own OFFENSE_TAL_PARAMS scale is one of the largest, so the same raw bonus swings
      // O-TAL further than it does for SF/PF/C) — which pushed several PGs (Magic's weaker-D
      // spans, Oscar's 1962-64) into "Greatest peak" purely on offense, with no equivalent
      // defense requirement at all for the top tier the way SG/SF/C already have one. New gate,
      // matching that same "real two-way case, not just offense" shape: below a genuine C+
      // defensive grade, cap at MVP — doesn't touch Stockton/CP3 (real plus defenders) or Magic's
      // better-defense spans, only the offense-only cases the complaint was about.
      if (!gradeAtLeast(dtalGrade, 'C+')) caps.push('MVP');
      break;
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
      if (!gradeAtLeast(dtalGrade, 'C')) caps.push('MVP');
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
      // 2026-08-07, user explicit ask, replaces the earlier literal-S requirement below: "Kobe
      // O-Tal at A with D-Tal with B = good enough for greatest peak" (his real 2002-04 span:
      // O-TAL A/91, D-TAL B/79) — "same with Wade" (2008-10: O-TAL A+/95, D-TAL A-/87). A real
      // A-grade offense (90+) plus a real B-grade defense (75+) is a genuine two-way peak case,
      // not just an elite-offense-with-decent-D one; the old S-only bar was too strict for
      // exactly this shape. `gradeAtLeast` on 'A' (not 'A-') is deliberate — the user's own
      // examples are both literally at the 'A' band, not the tier below it.
      if (!(gradeAtLeast(otalGrade, 'A') && gradeAtLeast(dtalGrade, 'B'))) caps.push('MVP');
      // 2026-08-07, user explicit ask ("drop Ray Allen to All-NBA because of defense"): the
      // `otalIsElite` bypass above already keeps a truly elite (A+) offense from being punished
      // down to All-star despite weak D — correct for a genuinely good-enough defender, but Ray
      // Allen's own defense is F-grade on literally every span (17-38 D-TAL) — a real, extreme
      // one-way profile the bypass wasn't meant to fully excuse from every cap. F-grade defense
      // alone caps at All-NBA regardless of how elite the offense is (the MVP-tier cap above
      // already independently blocks him from MVP+ too, since F is nowhere near a 'B' grade —
      // this rule is what stops the display from reading a contradictory "MVP-capped but somehow
      // still shows near-All-NBA-quality," making the ceiling honest at every tier, not just the
      // top one).
      if (dtalGrade === 'F') caps.push('All-NBA');
      // 2026-08-07, user explicit ask ("drop Manu to All-NBA because of low-FGA"): the existing
      // FGA<10 gate (Starter cap, above) is a hard floor for "barely playing offense at all," but
      // Manu's real volume (10.4-12.5 FGA on his best spans) clears that floor while still being
      // genuinely low for a rated-MVP-tier shooting guard — a real, distinct middle band the old
      // binary gate had no room for. Capped at All-NBA (not all the way to Starter) since he did
      // clear the harder floor.
      if (fga < SG_MODERATE_FGA_FLOOR) caps.push('All-NBA');
      break;
    }
    case 'SF':
      // 2026-08-07, user explicit ask, REPLACES the 2026-08-05 dual-sided version above ("SF
      // need over B to be MVP in SF" — offense-focused, no defense-only escape this time): a
      // real B+ offensive grade (80+) is now the floor just to clear All-NBA at all, regardless
      // of how elite the defense is. Named cases, all confirmed against real O-TAL: Pippen
      // (68-75 across his "MVP"-tier spans), Erving (66-72), Grant Hill (75), Kirilenko (63) —
      // none reach B+, all drop to All-NBA even though several have S/A+ defense. A pure
      // shutdown defender with only ordinary offense doesn't have the case for MVP+ under this
      // rule — a real, deliberate reversal of the prior "one elite side is enough" design.
      if (!gradeAtLeast(otalGrade, 'B+')) caps.push('All-NBA');
      // Second, higher bar for "Greatest peak" specifically ("drop Kawhi to MVP because of
      // offense" — his 2019-21 peak: O-TAL B+/84, D-TAL A-/86; B+ clears the All-NBA floor above
      // but not this one). A merely-good-not-elite offense (B+ but short of A-) caps at MVP —
      // real two-way volume at the very top still needs a genuinely elite offensive grade, not
      // just "good enough to clear All-NBA."
      if (!gradeAtLeast(otalGrade, 'A-')) caps.push('MVP');
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
      const dtalIsS = dtalGrade === 'S';
      if (!gradeAtLeast(otalGrade, 'A-') && !dtalIsS) caps.push('MVP');
      if (!gradeAtLeast(otalGrade, 'B-') && !dtalIsS) caps.push('All-NBA');
      // 2026-08-07, user explicit ask, TIGHTENED from B+ to A- ("drop Cousins to All-NBA — no
      // above B+ in any category"): his real 2016-18 span (O-TAL B+/80, D-TAL C-/59) was landing
      // exactly AT the old B+ floor, which the old `gradeAtLeast(..., 'B+')` check treats as
      // clearing it — the user's own framing ("no ABOVE B+") means B+ itself isn't enough, only
      // a real A- (85+) on either side is a standout trait worth MVP+. Same rule, higher bar.
      if (!gradeAtLeast(otalGrade, 'A-') && !gradeAtLeast(dtalGrade, 'A-')) caps.push('All-NBA');
      // 2026-08-07, same batch, a second and separate defense floor ("drop Sabonis to All-NBA —
      // only D in defense"): his real D-TAL never exceeds D grade in ANY span (18-48, mostly F);
      // his OTAL is genuinely elite (A/A+, 92-97) which clears the A- rule directly above on
      // offense alone, so that rule can't catch him. An F-grade defense (well below even a mere
      // D) is checked as its own independent floor — no amount of elite offense buys a center out
      // of a truly bottom-of-the-scale defensive grade, matching the same "F caps regardless of
      // the other side" shape just added to SG's Ray Allen rule. Checked for collateral: this also
      // caps a handful of Jokić's own weaker-defense spans (his DTAL swings F-to-C- across his
      // career) — a real, disclosed side effect, not hidden; his genuinely stronger-D spans
      // (DTAL C- or better) are untouched and still reach Greatest peak.
      if (dtalGrade === 'F') caps.push('All-NBA');
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
 */
const GOAT_NAMES: ReadonlySet<string> = new Set(['Michael Jordan', 'LeBron James', 'Stephen Curry'].map(normalizePlayerName));

/** The tier-badge function every UI call site should use instead of the raw `overallTier` —
 * same output for anyone who clears every gate for their position, strictly lower (never
 * higher) for anyone who doesn't. `overallTier` itself stays exported and untouched, since
 * scoring.ts and any non-per-player context has no single (position, O-TAL, D-TAL, FGA) tuple
 * to gate on. */
export function overallTierForSpan(ctx: TierGateContext): OverallTier {
  const base = overallTier(ctx.tal);
  const otalGrade = offensiveGrade(ctx.otal);
  const dtalGrade = defensiveGrade(ctx.dtal);
  const caps = tierCaps(ctx.position, otalGrade, dtalGrade, ctx.fga);
  const capped = caps.reduce((tier, cap) => stricterTier(tier, cap), base);
  // GOAT is a RAISE, deliberately the only exception to this function's own "caps only ever
  // lower a tier" rule (see every other case above) — gated on already having earned "Greatest
  // peak" on the real merits first, so it can never manufacture a top tier out of nothing.
  if (capped === 'Greatest peak' && ctx.playerName && GOAT_NAMES.has(normalizePlayerName(ctx.playerName))) {
    return 'GOAT';
  }
  return capped;
}

/** The top of each tier's own band — one below the next tier's floor, so a capped player's
 * displayed number can never read as high as a real, uncapped member of the tier above. The
 * top two tiers ('Greatest peak', 'GOAT') have no ceiling of their own (nothing to cap
 * against) — GOAT isn't in `OVERALL_TIER_FLOORS` at all (TAL itself never earns it, see above),
 * so it needs its own explicit case rather than falling through the floor lookup. */
function tierCeiling(tier: OverallTier): number {
  if (tier === 'GOAT') return Infinity;
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
 */
export function displayTalentForSpan(ctx: TierGateContext): number {
  const cappedTier = overallTierForSpan(ctx);
  return Math.min(ctx.tal, tierCeiling(cappedTier));
}

/**
 * The GOAT tier's own "give them 100+" ask — `ctx.tal` is always exactly ≤100 by construction
 * (`computeTalent`'s own hard clamp), so there's no real number above 100 to show without a
 * second, separate source: `rawUncappedTalent` (talent.ts) recomputes the same formula but skips
 * the soft-cap's asymptotic approach-to-100 and the final clamp, exposing what the real internal
 * spread actually is (Jordan's peak spans run well past 100 raw). Needs the full `span` (box
 * stats etc.), not just the reduced `TierGateContext` — takes both rather than trying to
 * reconstruct one from the other. Only ever shows the raw number for GOAT-tier spans; every
 * other tier keeps reading the real, clamped number via `displayTalentForSpan` above.
 */
export function displayNumberForSpan(span: PlayerSpan, ctx: TierGateContext): number {
  return overallTierForSpan(ctx) === 'GOAT' ? rawUncappedTalent(span) : displayTalentForSpan(ctx);
}
