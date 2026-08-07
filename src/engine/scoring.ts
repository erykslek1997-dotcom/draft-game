import { HIGH_USAGE_ARCHETYPE_WEIGHT, RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../data/schema';
import type { Position } from '../data/schema';
import type { Team } from './types';
import { positionFitMultiplier, STARTER_SLOTS, isUpwardSlide } from './positions';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent, computeDefensiveImpact } from './talent';
import { isPlusShooter } from './shooting';
import {
  computeSpacing,
  isShootingAnomalyPlayer,
  spacingBreakdown,
  SHOOTING_ANOMALY_TEAM_SPACING_FLOOR,
  WALKING_GRAVITY_FLOOR,
} from './spacing';
import { computeOffensivePortability } from './portability';
import { isRimGravityScorer, isSelfSufficientEngine } from './offensiveProfile';
import { maxSustainableMinutes } from './durability';
import { overallTier, type OverallTier } from './grades';
import {
  allAssignments,
  benchWithMinutes,
  primaryStarters,
  totalMinutesForPlayer,
  GAME_MINUTES,
  MAX_MINUTES_PER_PLAYER,
  STARTER_MINUTES,
} from './rotation';

/** Talent points per FGA a "normal" cap-legal roster produces — calibrated (scripts/calibrate.ts)
 * against the actual in-game draft pool, FGA-weighted. Recalibrated after the position/usage-
 * adjusted TS% baseline and continuous defensive role weight changed computeTalent's scale. */
const BASELINE_EFFICIENCY = 4.05;

/** Minimum defensive-impact score (box-score activity + rebounding + role weight) required,
 * on top of the role tag itself, for a starter to actually count as a rim protector or
 * perimeter stopper — a generous role label alone shouldn't paper over weak real production. */
const RIM_PROTECTOR_IMPACT_THRESHOLD = 18;
const PERIMETER_DEFENDER_IMPACT_THRESHOLD = 10;

function isStrongRimProtector(player: { defensiveRole: string }): boolean {
  return (
    RIM_PROTECTOR_ROLES.includes(player.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number]) &&
    computeDefensiveImpact(player as Parameters<typeof computeDefensiveImpact>[0]) >= RIM_PROTECTOR_IMPACT_THRESHOLD
  );
}

function isStrongPerimeterDefender(player: { defensiveRole: string }): boolean {
  return (
    PERIMETER_DEFENDER_ROLES.includes(player.defensiveRole as (typeof PERIMETER_DEFENDER_ROLES)[number]) &&
    computeDefensiveImpact(player as Parameters<typeof computeDefensiveImpact>[0]) >= PERIMETER_DEFENDER_IMPACT_THRESHOLD
  );
}

/** Stricter bar than the general isStrongRimProtector/isStrongPerimeterDefender gates above,
 * used only for the "complete defensive shell" bonus below. Found directly: a Luka/Reggie
 * Miller/Mike Miller/AD/Jokić lineup earned the shell bonus because two of Reggie Miller's
 * specific early-career spans (1987-89, 1993-95) are auto-tagged "Chaser" — a real
 * PERIMETER_DEFENDER_ROLE — off elevated box activity in those particular seasons, clearing the
 * general 10-point bar (10.8/12.2) despite Reggie Miller's real reputation never being a plus
 * defender. Raising the *general* threshold to exclude this isn't safe: real perimeter
 * specialists' own weaker-tagged spans overlap the same range (Bruce Bowen 7.8, Tony Allen
 * 12.2 at their worst-tagged spans) and depend on general fit-gap detection elsewhere in this
 * function, which should stay lenient. The "complete shell" bonus is a smaller, optional +5 —
 * a stricter bar here only means a specific low-defImpact span of an otherwise-real defender
 * doesn't independently earn the bonus, not that the player stops counting as a rim/perimeter
 * defender everywhere else. */
const SHELL_RIM_PROTECTOR_IMPACT_THRESHOLD = 24;
const SHELL_PERIMETER_DEFENDER_IMPACT_THRESHOLD = 15;

function isShellRimProtector(player: { defensiveRole: string }): boolean {
  return (
    RIM_PROTECTOR_ROLES.includes(player.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number]) &&
    computeDefensiveImpact(player as Parameters<typeof computeDefensiveImpact>[0]) >= SHELL_RIM_PROTECTOR_IMPACT_THRESHOLD
  );
}

function isShellPerimeterDefender(player: { defensiveRole: string }): boolean {
  return (
    PERIMETER_DEFENDER_ROLES.includes(player.defensiveRole as (typeof PERIMETER_DEFENDER_ROLES)[number]) &&
    computeDefensiveImpact(player as Parameters<typeof computeDefensiveImpact>[0]) >= SHELL_PERIMETER_DEFENDER_IMPACT_THRESHOLD
  );
}

/** Combined starters' raw rpg, below which a starting five is a real rebounding liability —
 * e.g. an all-guard lineup. Calibrated against the actual pool's real per-position mean rpg
 * (scripts/checkReboundingBaseline.ts): PG/SG ~3.9, SF ~5.3, PF ~7.6, C ~9.5, so a normal
 * one-per-position starting five nets ~30 combined; 25 sits comfortably below that (so a
 * balanced five is never falsely flagged) but well above an all-guard five's ~19-20. Previously
 * nothing in fitScore checked team rebounding at all — an all-PG roster paid no penalty for it. */
const STARTER_REBOUNDING_FLOOR = 25;

/** Points deducted per minute a player is pushed past their durability-safe cap
 * (`maxSustainableMinutes`), in `rotationScore`. 0.8 means a single Walking-Glass-tier player
 * (cap 22) forced to a full 40 minutes — 18 over — costs ~14 points on its own, a real but not
 * score-annihilating hit, similar magnitude to the +7 bench-covers-a-gap bonuses nearby. */
const DURABILITY_OVERWORK_PENALTY_PER_MINUTE = 0.8;
/** Caps the total penalty so a wildly abusive rotation (e.g. three fragile players all pushed
 * to 40+) can't single-handedly drag `rotationScore` to 0 — it's still one term among several. */
const DURABILITY_OVERWORK_MAX_PENALTY = 25;

/**
 * 2026-08-01, user-supplied table ("rotation minutes value.xlsx"): how many minutes a player at
 * a given OVERALL tier (`grades.ts`'s `overallTier`, keyed off TAL — not durability) should
 * ideally play ("optimal") and, for the three star tiers, the floor below which they're being
 * meaningfully under-used ("minimal"). MVP uses the same numbers as Greatest peak per the
 * user's explicit "MVP same as greatest peak" — the source table only had a row for the latter.
 * Below Starter there's no minimal floor (a bench/role player being under-played isn't a
 * rotation mistake the way benching a star is).
 */
const OVERALL_TIER_MINUTES_TARGET: Record<OverallTier, { optimal: number; minimal: number | null }> = {
  'Greatest peak': { optimal: 36, minimal: 32 },
  MVP: { optimal: 36, minimal: 32 },
  'All-NBA': { optimal: 34, minimal: 24 },
  'All-star': { optimal: 32, minimal: 24 },
  Starter: { optimal: 24, minimal: null },
  'Role Player': { optimal: 16, minimal: null },
  'Bench Warmer': { optimal: 8, minimal: null },
  'Cigarette Butt': { optimal: 0, minimal: null },
};

/** Average per-player closeness-to-optimal (0-1) scaled up to this many points, added to
 * `rotationScore`. Kept modest and comparable to the existing +7 gap-covering bonuses and the
 * -25 max overwork penalty nearby, rather than letting this one mechanic dominate the score. */
const OPTIMAL_MINUTES_BONUS_SCALE = 10;
/** Flat deduction per star-tier player whose actual minutes fall below their (durability-
 * capped) minimal floor — a real rotation mistake (benching a star), distinct from the closeness
 * bonus above, which only rewards/tolerates deviation, not specifically punishes under-use. */
const UNDERPLAYED_STAR_PENALTY = 5;

/**
 * "Cap minutes applied to greatest peak, optimal minutes gives a bonus to rotation, scale cap
 * minutes to the rest" — user's own spec, three pieces:
 * 1. A durability cap still applies to a Greatest-peak/MVP-tier player exactly like anyone else
 *    (no exemption for being a star) — `effectiveOptimal`/`effectiveMinimal` below are both
 *    clamped to the player's own `maxSustainableMinutes`, so a fragile superstar isn't penalized
 *    for missing a 36-minute target their own durability never let them reach.
 * 2. When a player's target gets clamped down by durability, the "lost" optimal-minutes budget
 *    doesn't just vanish — it scales UP the remaining (non-durability-capped) players' own
 *    targets proportionally, since the team still needs real bodies covering ~240 total
 *    game-minutes regardless of any one player's ceiling.
 * 3. The actual bonus rewards closeness between a player's real assigned minutes and their
 *    (redistributed) target, plus a flat penalty for leaving a star under their minimal floor.
 */
function optimalMinutesRotationBonus(team: Team): { bonus: number; notes: string[] } {
  const rows = team.roster.map((player) => {
    const tier = overallTier(computeTalent(player));
    const target = OVERALL_TIER_MINUTES_TARGET[tier];
    const cap = maxSustainableMinutes(player, MAX_MINUTES_PER_PLAYER);
    const effectiveOptimal = Math.min(target.optimal, cap);
    const effectiveMinimal = target.minimal === null ? null : Math.min(target.minimal, cap);
    return {
      player,
      tier,
      target,
      cap,
      effectiveOptimal,
      durabilityCapped: effectiveOptimal < target.optimal,
      effectiveMinimal,
      actual: totalMinutesForPlayer(team.rotation, player.id),
    };
  });

  const shortfall = rows.reduce((sum, r) => (r.durabilityCapped ? sum + (r.target.optimal - r.effectiveOptimal) : sum), 0);
  const uncappedTotalOptimal = rows.reduce((sum, r) => (r.durabilityCapped ? sum : sum + r.target.optimal), 0);
  const redistributionScale = uncappedTotalOptimal > 0 ? 1 + shortfall / uncappedTotalOptimal : 1;

  const notes: string[] = [];
  let closenessSum = 0;
  let closenessCount = 0;
  let starPenalty = 0;

  for (const r of rows) {
    const scaledOptimal = r.durabilityCapped ? r.effectiveOptimal : r.target.optimal * redistributionScale;
    if (scaledOptimal > 0) {
      const closeness = Math.max(0, 1 - Math.abs(r.actual - scaledOptimal) / scaledOptimal);
      closenessSum += closeness;
      closenessCount += 1;
    }
    if (r.effectiveMinimal !== null && r.actual < r.effectiveMinimal) {
      starPenalty += UNDERPLAYED_STAR_PENALTY;
      notes.push(`${r.player.playerName} (${r.tier}) underplayed: ${r.actual}/${r.effectiveMinimal} min minimum.`);
    }
  }

  const bonus = closenessCount > 0 ? Math.round((closenessSum / closenessCount) * OPTIMAL_MINUTES_BONUS_SCALE) - starPenalty : 0;
  return { bonus, notes };
}

export interface ScoreBreakdown {
  talentScore: number;
  offenseScore: number;
  defenseScore: number;
  spacingScore: number;
  fitScore: number;
  rotationScore: number;
  overall: number;
  notes: string[];
}

/**
 * `offenseScore`/`defenseScore`/`spacingScore` (all: minutes-weighted team average of a
 * per-player 0-100 metric) never actually reach their nominal 0-100 range in practice — the
 * cap/position rules that make a legal 9-man roster mean even the best-possible-for-that-one-
 * thing team can't hit 100, and the worst-possible team doesn't necessarily bottom out at 0
 * either. User-diagnosed (2026-08-05) and measured directly with a dedicated
 * best-possible/worst-possible-roster search (`scripts/calibrateExtremeTeamScores.ts` — no fit,
 * no talent, no need signal, purely maximizing/minimizing one metric under the real cap/position
 * rules, several attempts to hedge against greedy-fill-order artifacts): offense capped at raw
 * 78 (never near 100) with a real floor of 21, defense reached 94/8, spacing reached 94/0. These
 * three constants stretch each raw average linearly so the *actual* worst/best achievable team
 * read as 0/100 the way the display always implied. **Re-run that script and update these
 * anchors whenever the pool or the underlying OTAL/DTAL/SPC formulas change** — stale anchors
 * quietly drift the displayed 0-100 range away from what's actually achievable again.
 */
const OFFENSE_SCORE_ANCHORS = { worst: 21, best: 78 };
const DEFENSE_SCORE_ANCHORS = { worst: 8, best: 94 };
const SPACING_SCORE_ANCHORS = { worst: 0, best: 94 };

function rescaleToFullRange(raw: number, anchors: { worst: number; best: number }): number {
  const scaled = ((raw - anchors.worst) / (anchors.best - anchors.worst)) * 100;
  return Math.max(0, Math.min(100, scaled));
}

export function talentScore(team: Team): number {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return 0;
  const weighted = assignments.reduce(
    (sum, { slot, player, minutes }) => sum + computeTalent(player) * positionFitMultiplier(player, slot) * minutes,
    0,
  );
  return Math.round(weighted / totalMinutes);
}

/** Minutes-weighted team average of O-TAL / D-TAL, the same shape as `talentScore` but reading
 * off the split offense/defense components instead of the blended number — purely informational
 * (matches how O-TAL/D-TAL are already informational-only at the per-player level), so they
 * don't feed `overall`. */
export function offenseScore(team: Team): number {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return 0;
  const weighted = assignments.reduce(
    (sum, { slot, player, minutes }) => sum + computeOffensiveTalent(player) * positionFitMultiplier(player, slot) * minutes,
    0,
  );
  return Math.round(rescaleToFullRange(weighted / totalMinutes, OFFENSE_SCORE_ANCHORS));
}

export function defenseScore(team: Team): number {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return 0;
  const weighted = assignments.reduce(
    (sum, { slot, player, minutes }) => sum + computeDefensiveTalent(player) * positionFitMultiplier(player, slot) * minutes,
    0,
  );
  return Math.round(rescaleToFullRange(weighted / totalMinutes, DEFENSE_SCORE_ANCHORS));
}

/**
 * Minutes-weighted team spacing, 0-100 — "how well-spaced is this team's floor across a game."
 * Informational like `offenseScore`/`defenseScore`; spacing's effect on `overall` still runs
 * through `fitScore`'s plus-shooter checks, not through this number.
 *
 * Deliberately NOT multiplied by `positionFitMultiplier`, unlike the other three team averages.
 * That factor models a player being less effective out of position, and a jump shot isn't: a
 * shooter slotted at SF instead of SG spaces the floor exactly as well.
 *
 * The shooting-anomaly floor (`SHOOTING_ANOMALY_TEAM_SPACING_FLOOR`, currently Curry only) is
 * applied over **his share of a normal starter's workload**, not a flat override and not
 * measured against the full 48-minute game — `STARTER_MINUTES` (36) is what a real starter
 * actually plays in this engine, so a starter given his normal allocation gets the floor at full
 * strength immediately, not at 75% of it. (Originally measured against 48 and correctly caught
 * that nobody in this rotation model ever plays a full game — the user's own correction:
 * "85 Curry spacing should be in effect at 36 minutes (real starter minutes).") It can only ever
 * raise the number, and at 0 minutes it does nothing at all.
 *
 * **A second real gravity threat solves the problem outright.** The user's own rule (2026-07-30,
 * after a real Curry+Reggie Miller(+Pippen) roster still read only ~80): "Curry + one walking
 * gravity should be 100 spacing, let alone Curry + 2 walking gravity players." The single-player
 * floor above can't reach that on its own — it only guarantees CURRY's minutes clear 85, still
 * blended against whatever the rest of the roster actually is for his time off the floor, which
 * a couple of non-shooting bigs can hold well under 100 even with Miller himself starting.
 * `MULTI_GRAVITY_TEAM_SPACING` is a flat override, not another share-weighted blend, once a
 * shooting-anomaly player AND at least one other real (minutes > 0) span clearing
 * `WALKING_GRAVITY_FLOOR` both share the roster — two genuine floor-warpers is not a partial
 * fix, it's the spacing question being closed, regardless of who else is out there.
 */
const MULTI_GRAVITY_TEAM_SPACING = 100;

export function spacingScore(team: Team): number {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return 0;

  const base = assignments.reduce((sum, { player, minutes }) => sum + computeSpacing(player) * minutes, 0) / totalMinutes;

  const anomalyMinutes = assignments
    .filter(({ player }) => isShootingAnomalyPlayer(player))
    .reduce((sum, { minutes }) => sum + minutes, 0);
  const anomalyShare = Math.max(0, Math.min(1, anomalyMinutes / STARTER_MINUTES));

  const hasSecondGravityThreat = assignments.some(
    ({ player, minutes }) =>
      minutes > 0 && !isShootingAnomalyPlayer(player) && spacingBreakdown(player).points >= WALKING_GRAVITY_FLOOR,
  );
  if (anomalyMinutes > 0 && hasSecondGravityThreat) return MULTI_GRAVITY_TEAM_SPACING;

  const floored = Math.max(base, SHOOTING_ANOMALY_TEAM_SPACING_FLOOR);
  const withCurryFloor = base * (1 - anomalyShare) + floored * anomalyShare;
  return Math.round(rescaleToFullRange(withCurryFloor, SPACING_SCORE_ANCHORS));
}

export function fitScore(team: Team): { score: number; notes: string[]; raw: number } {
  const starters = primaryStarters(team).map((e) => e.player);
  const notes: string[] = [];
  let score = 70;

  const usageWeight = starters.reduce((sum, p) => sum + (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0), 0);
  // 2026-08-07: `isSelfSufficientEngine` (offensiveProfile.ts, Nash-type — elite playmaking, no
  // dominant shot zone) generates real offense alone even when his own archetype tag reads as
  // low/no on-ball-usage weight (a facilitation-heavy hub isn't "Shot Creator"/"Slasher" in the
  // redundancy sense) — without this check a genuine Nash/Stockton-caliber hub can still trip the
  // "no go-to shot creator" penalty below despite objectively not needing one.
  const hasSelfSufficientEngine = starters.some(isSelfSufficientEngine);
  if (usageWeight === 0) {
    if (hasSelfSufficientEngine) {
      notes.push('A self-sufficient offensive engine covers creation alone — no redundant isolation usage needed.');
    } else {
      score -= 15;
      notes.push('No go-to shot creator among starters — offense will stall in isolation situations.');
    }
  } else if (usageWeight > 3) {
    score -= 20;
    notes.push('Starters are redundant — too much isolation usage competing for the same shots.');
  } else if (usageWeight > 2) {
    score -= 10;
    notes.push('Starters will compete for touches.');
  } else {
    notes.push('Clean creation hierarchy among starters.');
  }

  // Ball-dominance / "needs the ball to be useful" — 2026-08-07, user-diagnosed gap: the
  // usageWeight check above only sees `HIGH_USAGE_ARCHETYPE_WEIGHT`'s narrow ISO/creation
  // archetype list (Shot Creator/Slasher/Primary+Secondary Ball Handler), which reads Post
  // Scorer/Roll & Cut Big as a flat 0 — completely invisible even for a classic ball-dominant
  // post player (Elton Brand, Amar'e Stoudemire) who never touches the redundancy check at all.
  // `computeOffensivePortability` (portability.ts) already answers the broader, archetype-
  // agnostic version of this question continuously (self-creation reliance + extreme usage-ratio
  // penalty), so it's reused here rather than growing the archetype map. Thresholds are the real
  // draft-pool O-POR percentiles (`scripts/_tmpPercentiles.ts`-style check, not guessed):
  // p10=29 / p25=37 / p50=48 / p75=59 / p90=67 — p50 is the neutral point, and the p50-p10/p90-p50
  // gaps are both ~19, so a single symmetric span works for both sides.
  const OPOR_NEUTRAL = 48;
  const OPOR_SPAN = 19;
  const BALL_DOMINANCE_MAX_PENALTY = 30;
  const OFF_BALL_TRAVEL_MAX_BONUS = 10;
  const avgStarterOPor = starters.reduce((sum, p) => sum + computeOffensivePortability(p), 0) / starters.length;
  if (avgStarterOPor < OPOR_NEUTRAL) {
    const deficitRatio = Math.min(1, (OPOR_NEUTRAL - avgStarterOPor) / OPOR_SPAN);
    const penalty = Math.round(deficitRatio * BALL_DOMINANCE_MAX_PENALTY);
    score -= penalty;
    if (penalty >= 5) notes.push('Starters need the ball to be effective — little value when someone else has it.');
  } else {
    const excessRatio = Math.min(1, (avgStarterOPor - OPOR_NEUTRAL) / OPOR_SPAN);
    const bonus = Math.round(excessRatio * OFF_BALL_TRAVEL_MAX_BONUS);
    score += bonus;
    if (bonus >= 4) notes.push('Starters generate real value even without the ball in their hands.');
  }

  const plusShooters = starters.filter(isPlusShooter);
  // The shooting anomaly counts as a solved spacing problem on his own, not as one of five plus
  // shooters — same rule as `spacingScore`'s floor, applied to the penalty side. Without this a
  // Curry-plus-four-non-shooters five still paid the "only 1 plus shooter (spacing risk)" -8,
  // which is the exact reading the floor exists to reject.
  const hasShootingAnomaly = starters.some(isShootingAnomalyPlayer);
  if (hasShootingAnomaly) {
    notes.push(`${starters.find(isShootingAnomalyPlayer)!.playerName} alone sets the defense's starting point — spacing is not this team's problem.`);
  } else if (plusShooters.length === 0) {
    score -= 15;
    notes.push('No plus shooters among starters — the floor will be cramped.');
  } else if (plusShooters.length === 1) {
    score -= 8;
    notes.push('Only 1 plus shooter among starters (spacing risk).');
  } else {
    // 2026-08-07: used to be a flat 0 for "2 or more" — a genuinely 5-shooter five scored
    // identically to a team that barely cleared the bar with 2, which is exactly why a real
    // 5-way-shooting roster couldn't separate itself toward 100. Continuous credit for the
    // actual count above the "covered" floor of 2 (2 -> 0, 3 -> +3, 4 -> +6, 5 -> +9).
    const bonus = (plusShooters.length - 2) * 3;
    score += bonus;
    notes.push(`${plusShooters.length} shooters/floor-spacers among starters.`);
  }

  // Rim-gravity synergy — 2026-08-07, the user's own (a)/(c) framework (offensiveProfile.ts):
  // a rim-dominant scorer's whole value depends on real shooters punishing the help defense he
  // draws. Distinct from and stacks with the generic no-shooter penalty above — a rim-gravity
  // scorer with zero shooters around him is a WORSE fit failure than a merely shooter-less team
  // in general, not just the same one twice.
  const rimGravityStarters = starters.filter(isRimGravityScorer);
  const RIM_GRAVITY_WASTED_PENALTY_PER_PLAYER = 7;
  const MAX_RIM_GRAVITY_WASTED_PENALTY = 14;
  if (rimGravityStarters.length > 0) {
    if (!hasShootingAnomaly && plusShooters.length === 0) {
      const penalty = Math.min(MAX_RIM_GRAVITY_WASTED_PENALTY, rimGravityStarters.length * RIM_GRAVITY_WASTED_PENALTY_PER_PLAYER);
      score -= penalty;
      notes.push(`${rimGravityStarters.map((p) => p.playerName).join('/')} draws real rim gravity with nobody to punish the help defense.`);
    } else if (hasShootingAnomaly || plusShooters.length >= 2) {
      score += 5;
      notes.push('Shooters properly surround the roster\'s rim-gravity scorer(s).');
    }
  }

  // Real team spacing, continuous — 2026-08-07, the user's own first-named reason for the BAD
  // example roster ("nieistniejący spacing" — spacing that doesn't exist at all, not just "no
  // plus shooter"). The binary plus-shooter check above can't distinguish a team that's merely
  // short of the plus-shooter bar from one where literally every starter reads 0 on
  // `computeSpacing` — checked directly, the user's own BAD example is the latter (all five
  // starters score exactly 0). Anchored on real draft-pool per-player SPACING percentiles: p50=40
  // (neutral), p10=0/p90=85 — asymmetric spans on purpose, matching the asymmetric real
  // distribution (a quarter of the whole pool reads 0).
  const SPACING_TAL_NEUTRAL = 40;
  const SPACING_PENALTY_SPAN = 40; // neutral - p10
  const SPACING_BONUS_SPAN = 45; // p90 - neutral
  const SPACING_MAX_PENALTY = 26;
  const SPACING_MAX_BONUS = 12;
  const avgStarterSpacing = starters.reduce((sum, p) => sum + computeSpacing(p), 0) / starters.length;
  if (avgStarterSpacing < SPACING_TAL_NEUTRAL) {
    const deficitRatio = Math.min(1, (SPACING_TAL_NEUTRAL - avgStarterSpacing) / SPACING_PENALTY_SPAN);
    const penalty = Math.round(deficitRatio * SPACING_MAX_PENALTY);
    score -= penalty;
    if (penalty >= 10) notes.push('Team spacing is essentially non-existent across the starting five.');
  } else {
    const excessRatio = Math.min(1, (avgStarterSpacing - SPACING_TAL_NEUTRAL) / SPACING_BONUS_SPAN);
    const bonus = Math.round(excessRatio * SPACING_MAX_BONUS);
    score += bonus;
  }

  const hasRimProtector = starters.some(isStrongRimProtector);
  if (!hasRimProtector) {
    score -= 15;
    notes.push('No rim protector among starters.');
  } else {
    notes.push('Rim protection covered among starters.');
  }

  const hasPerimeterDefender = starters.some(isStrongPerimeterDefender);
  if (!hasPerimeterDefender) {
    score -= 10;
    notes.push('No plus perimeter defender among starters.');
  } else {
    notes.push('Perimeter defense covered among starters.');
  }

  if (
    starters.some(isShellRimProtector) &&
    starters.some(isShellPerimeterDefender) &&
    starters.some((p) => p.defensiveRole === 'Helper')
  ) {
    score += 5;
    notes.push('Complete defensive shell: rim + perimeter + helper coverage.');
  }

  // Real team-defense quality, continuous — 2026-08-07. The two binary checks above only ask
  // "does at least one starter carry a rim/perimeter tag," which a single genuine individual
  // defender can satisfy for a team whose defense isn't actually good as a whole (the same
  // "individual vs. team defense" gap this project already found and fixed once in
  // `aiDrafter.ts`'s `avgDefensivePortability`). Add-only (never a second penalty on top of the
  // binary checks, which already correctly punish a team with zero real defenders) — this
  // specifically rewards a genuinely elite defensive five the binary checks can't distinguish
  // from a merely-adequate one. Anchored on real draft-pool D-TAL percentiles: p50=53 (neutral),
  // p90=85 — the same "check real data" discipline as the O-POR term above.
  const DTAL_NEUTRAL = 53;
  const DTAL_ELITE_SPAN = 32; // p90 - p50
  const TEAM_DEFENSE_MAX_BONUS = 10;
  const avgStarterDTal = starters.reduce((sum, p) => sum + computeDefensiveTalent(p), 0) / starters.length;
  if (avgStarterDTal > DTAL_NEUTRAL) {
    const excessRatio = Math.min(1, (avgStarterDTal - DTAL_NEUTRAL) / DTAL_ELITE_SPAN);
    const bonus = Math.round(excessRatio * TEAM_DEFENSE_MAX_BONUS);
    score += bonus;
    if (bonus >= 5) notes.push('Genuinely elite team defense across the starting five, not just one tagged defender.');
  }

  // Self-sufficient engine + real two-way complements — 2026-08-07, the user's (d) framework:
  // a Nash-type doesn't need more offensive talent, he needs teammates who defend and finish.
  // Small, capped credit (distinct from the general team-defense bonus above, which fires
  // regardless of WHY the defense is good) for pairing a self-sufficient engine with starters
  // who carry real defensive value.
  if (hasSelfSufficientEngine) {
    const others = starters.filter((p) => !isSelfSufficientEngine(p));
    const avgOthersDTal = others.length > 0 ? others.reduce((sum, p) => sum + computeDefensiveTalent(p), 0) / others.length : 0;
    if (avgOthersDTal > DTAL_NEUTRAL) {
      score += 3;
      notes.push('Two-way complements around the self-sufficient offensive engine, not redundant offense.');
    }
  }

  const totalStarterRpg = starters.reduce((sum, p) => sum + p.box.rpg, 0);
  if (totalStarterRpg < STARTER_REBOUNDING_FLOOR) {
    score -= 10;
    notes.push('Starting five is a rebounding liability — thin at the glass on both ends.');
  } else {
    notes.push('Starting five rebounds well enough to hold its own on the glass.');
  }

  const allPlayers = team.roster;
  const totalTalent = allPlayers.reduce((sum, p) => sum + computeTalent(p), 0);
  const totalFga = allPlayers.reduce((sum, p) => sum + p.fga, 0);
  const efficiency = totalFga > 0 ? totalTalent / totalFga : 0;
  const efficiencyDelta = ((efficiency - BASELINE_EFFICIENCY) / BASELINE_EFFICIENCY) * 40;
  const efficiencyAdj = Math.max(-10, Math.min(15, Math.round(efficiencyDelta)));
  score += efficiencyAdj;
  if (efficiencyAdj > 3) {
    notes.push('Efficient cap usage: strong talent-per-shot value from your role players.');
  } else if (efficiencyAdj < -3) {
    notes.push('Inefficient cap usage: too much of the cap spent on redundant high-usage scorers.');
  }

  // 2026-08-07 rework: analytically summing each term's own min/max (the previous approach —
  // "worst case sums every penalty, best case sums every bonus") assumes a realistic roster can
  // actually trip every penalty or clear every bonus AT ONCE, which the user's own two named
  // acceptance-test rosters showed isn't true in practice — a real bad-fit five doesn't
  // necessarily fail every single check (e.g. Ben Simmons individually clears the perimeter-
  // defense check even on a team the user correctly calls poorly fit). `ACHIEVABLE_MIN`/
  // `ACHIEVABLE_MAX` are instead **empirically calibrated** (`scripts/calibrateFitScoreRange.ts`,
  // same discipline as `OFFENSE_SCORE_ANCHORS`/etc. above) against real worst/best-constructible
  // rosters under the ACTUAL mechanics above, not a hand-summed analytical bound. Recalibrate
  // (rerun that script, paste its printed anchors here) after changing any term's magnitude.
  const ACHIEVABLE_MIN = -44;
  const ACHIEVABLE_MAX = 133;
  const rescaled = ((score - ACHIEVABLE_MIN) / (ACHIEVABLE_MAX - ACHIEVABLE_MIN)) * 100;

  return { score: Math.max(0, Math.min(100, Math.round(rescaled))), notes, raw: score };
}

export function rotationScore(team: Team): { score: number; notes: string[] } {
  const starters = primaryStarters(team);
  const notes: string[] = [];
  if (starters.length < STARTER_SLOTS.length) {
    return { score: 0, notes: ['Lineup incomplete.'] };
  }

  const avgMultiplier =
    starters.reduce((sum, { slot, player }) => sum + positionFitMultiplier(player, slot), 0) / starters.length;
  let score = Math.round(avgMultiplier * 100);

  const offPosition = starters.filter(({ slot, player }) => positionFitMultiplier(player, slot) < 0.9);
  if (offPosition.length > 0) {
    notes.push(
      `${offPosition.length} starter(s) out of natural position: ${offPosition
        .map(({ player, slot }) => `${player.playerName} at ${slot}`)
        .join(', ')}.`,
    );
  } else {
    notes.push('All starters in natural or realistic secondary positions.');
  }

  const bench = benchWithMinutes(team).map((b) => b.player);
  const startersRoles = starters.map((s) => s.player.defensiveRole);

  const spacingGap = !starters.some((s) => isPlusShooter(s.player));
  if (spacingGap && bench.some(isPlusShooter)) {
    score += 7;
    notes.push('Bench brings shooting the starting five lacks.');
  }

  const rimGap = !startersRoles.some((r) => RIM_PROTECTOR_ROLES.includes(r));
  if (rimGap && bench.some((p) => RIM_PROTECTOR_ROLES.includes(p.defensiveRole))) {
    score += 7;
    notes.push('Bench brings rim protection the starting five lacks.');
  }

  // `autoAssignRotation` never produces this — every path through it checks
  // `maxSustainableMinutes` before granting minutes, so a durability cap is never exceeded by
  // the auto-fill. This can only fire when a human has manually pushed a fragile player's total
  // minutes past their safe ceiling in RotationBuilder, which (like the human's FGA cap) is
  // allowed, not blocked — it costs rotation score instead of being an illegal state.
  //
  // Scaled by how far over the cap a player is pushed, not just a flat per-player count: 1-2
  // minutes over a rounded cap is a rounding-adjacent nudge and shouldn't read the same as
  // deliberately playing a Load-Management-tier player well past their limit.
  const overworked = team.roster
    .map((p) => ({
      player: p,
      minutes: totalMinutesForPlayer(team.rotation, p.id),
      cap: maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER),
    }))
    .filter(({ minutes, cap }) => minutes > cap);
  if (overworked.length > 0) {
    const totalOverage = overworked.reduce((sum, { minutes, cap }) => sum + (minutes - cap), 0);
    const penalty = Math.min(DURABILITY_OVERWORK_MAX_PENALTY, Math.round(totalOverage * DURABILITY_OVERWORK_PENALTY_PER_MINUTE));
    score -= penalty;
    notes.push(
      `Overworked for their durability: ${overworked
        .map(({ player, minutes, cap }) => `${player.playerName} (${minutes}/${cap} safe min)`)
        .join(', ')}.`,
    );
  }

  const { bonus: optimalBonus, notes: optimalNotes } = optimalMinutesRotationBonus(team);
  score += optimalBonus;
  notes.push(...optimalNotes);

  // 2026-08-07, user's explicit rule: playing BELOW your natural position (toward the
  // perimeter) is realistically bad and costs real rotation value — even for bench minutes,
  // not just starters ("nawet na ławce"). Upward slides (PG->SG, SF->PF, etc.) stay free, same
  // asymmetry `positions.ts`'s `isUpwardSlide` already established for the starter-search talent
  // multiplier — this is the same real-basketball claim ("a big missing the guard skill set")
  // showing up as an explicit score cost instead of just a softer talent discount. A center off
  // position at all is the extreme, flat case; the penalty tapers going down the ladder for the
  // other positions ("i tak w dół" — PF at SF costs less than a full center misuse, and so on).
  // Explicit secondary positions are real, curated fits, not a fallback stretch, so they're
  // exempt even when technically "downward" (e.g., a big whose actual secondary is one spot down).
  const DOWNWARD_POSITION_PENALTY: Record<Position, number> = { C: 50, PF: 25, SF: 12, SG: 6, PG: 0 };
  const downwardOffenders: string[] = [];
  let downwardPenalty = 0;
  for (const { slot, player, minutes } of allAssignments(team)) {
    if (minutes <= 0) continue;
    if (player.primaryPosition === slot) continue;
    if (player.secondaryPositions.includes(slot)) continue;
    if (isUpwardSlide(player, slot)) continue;
    const penalty = DOWNWARD_POSITION_PENALTY[player.primaryPosition];
    if (penalty > 0) {
      downwardPenalty += penalty;
      downwardOffenders.push(`${player.playerName} (${player.primaryPosition}) at ${slot} (${minutes}m)`);
    }
  }
  if (downwardPenalty > 0) {
    score -= downwardPenalty;
    notes.push(`Playing below natural position: ${downwardOffenders.join(', ')}.`);
  }

  // 2026-08-07, user's explicit rule: each overall tier has a real minutes ceiling, not just an
  // "optimal" target — Starter 32 / Role Player 24 / Bench Warmer 16 / Cigarette Butt 8 (the
  // top four tiers are already effectively uncapped here, since their own optimal+8 would clear
  // `MAX_MINUTES_PER_PLAYER`). Checked against TOTAL minutes across every slot a player appears
  // in (`totalMinutesForPlayer`, already sums across slots) — a player split 24/12 across two
  // real positions is 36 total minutes on his OWN tier's budget, not evaluated per slot.
  const TIER_MAX_MINUTES: Record<OverallTier, number> = {
    'Greatest peak': MAX_MINUTES_PER_PLAYER,
    MVP: MAX_MINUTES_PER_PLAYER,
    'All-NBA': MAX_MINUTES_PER_PLAYER,
    'All-star': MAX_MINUTES_PER_PLAYER,
    Starter: 32,
    'Role Player': 24,
    'Bench Warmer': 16,
    'Cigarette Butt': 8,
  };
  const TIER_OVERAGE_PENALTY_PER_MINUTE = 1;
  const MAX_TIER_OVERAGE_PENALTY = 25;
  let tierOveragePenalty = 0;
  const tierOverageOffenders: string[] = [];
  for (const p of team.roster) {
    const minutes = totalMinutesForPlayer(team.rotation, p.id);
    if (minutes <= 0) continue;
    const tier = overallTier(computeTalent(p));
    const cap = TIER_MAX_MINUTES[tier];
    if (minutes > cap) {
      tierOveragePenalty += (minutes - cap) * TIER_OVERAGE_PENALTY_PER_MINUTE;
      tierOverageOffenders.push(`${p.playerName} (${tier}) ${minutes}/${cap}m`);
    }
  }
  if (tierOveragePenalty > 0) {
    const penalty = Math.min(MAX_TIER_OVERAGE_PENALTY, Math.round(tierOveragePenalty));
    score -= penalty;
    notes.push(`Over their tier's real minutes ceiling: ${tierOverageOffenders.join(', ')}.`);
  }

  // 2026-08-07, user's explicit rule: a genuinely weak starter (TAL<55 — below even "Starter"
  // tier's own floor of 60, so only reachable if a slot's real options were all this thin) drags
  // the WHOLE team's rotation value, not just his own slot — halved outright, not a small
  // deduction. Largely a belt-and-suspenders backstop now that `bestPrimaryAssignment` (rotation.ts)
  // already refuses to start anyone below Starter tier when a real alternative or an empty slot
  // is available — this only fires in the genuine edge case none exists.
  const WEAK_STARTER_TAL_THRESHOLD = 55;
  const hasWeakStarter = starters.some(({ player }) => computeTalent(player) < WEAK_STARTER_TAL_THRESHOLD);
  if (hasWeakStarter) {
    score = Math.round(score * 0.5);
    notes.push('Weak starter (TAL<55) present — whole team rotation value halved.');
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), notes };
}

/**
 * 2026-08-05, explicit user request: `offenseScore`/`defenseScore`/`spacingScore` now feed
 * `overall` — previously deliberately informational-only ("don't feed overall", see the
 * comments on those three functions above, left as historical context rather than edited to
 * avoid erasing the record of that earlier decision). Reopened specifically because those three
 * scores were just fixed to actually span their full 0-100 range (`rescaleToFullRange` above) —
 * before that fix they'd have been unusable as a scoring input (offense topped out at a raw 78,
 * which would've silently capped any team's contribution from this term well under its nominal
 * share no matter how good the roster).
 *
 * Averaged **equally** into one `teamQuality` term, not weighted toward any one of the three —
 * the user's own stated goal ("two-way shooterami" should score highest, second only to
 * genuine greatest-peak talent) is exactly what an equal average rewards: a player/roster
 * excellent at only one of offense/defense/spacing tops out that one axis but drags the other
 * two toward the middle, while a genuine two-way shooter roster scores well on all three
 * simultaneously and wins the average outright. Weighting any single axis higher would blunt
 * exactly that effect.
 *
 * `overall`'s existing three weights (talent 0.4 / fit 0.45 / rotation 0.15) are scaled down
 * proportionally by 0.75 (0.3 / 0.35 / 0.15 — rotation held rather than also cut 25%, since it's
 * measuring something distinct — legal/sensible minutes deployment — that has nothing to do with
 * *which* players were drafted, so diluting it to make room for a roster-construction signal
 * doesn't make sense the way diluting talent/fit does) to make room for `teamQuality` at 0.2,
 * keeping the total at 1.0 (0.3+0.35+0.15+0.2). Not a re-derivation from scratch — `fitScore`
 * still carries the largest single weight, since it's the project's actual "does this roster
 * make basketball sense" judge and this change doesn't reopen that.
 */
const TALENT_WEIGHT = 0.3;
const FIT_WEIGHT = 0.35;
const ROTATION_WEIGHT = 0.15;
const TEAM_QUALITY_WEIGHT = 0.2;

export function scoreTeam(team: Team): ScoreBreakdown {
  const talent = talentScore(team);
  const offense = offenseScore(team);
  const defense = defenseScore(team);
  const spacing = spacingScore(team);
  const fit = fitScore(team);
  const rotation = rotationScore(team);
  const teamQuality = (offense + defense + spacing) / 3;
  const overall = Math.round(
    talent * TALENT_WEIGHT + fit.score * FIT_WEIGHT + rotation.score * ROTATION_WEIGHT + teamQuality * TEAM_QUALITY_WEIGHT,
  );
  return {
    talentScore: talent,
    offenseScore: offense,
    defenseScore: defense,
    spacingScore: spacing,
    fitScore: fit.score,
    rotationScore: rotation.score,
    overall,
    notes: [...fit.notes, ...rotation.notes],
  };
}

export function rankTeams(teams: Team[]): { team: Team; breakdown: ScoreBreakdown; rank: number }[] {
  const scored = teams.map((team) => ({ team, breakdown: scoreTeam(team) }));
  scored.sort((a, b) => b.breakdown.overall - a.breakdown.overall);
  return scored.map((entry, index) => ({ ...entry, rank: index + 1 }));
}
