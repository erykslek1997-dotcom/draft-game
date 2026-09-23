import { players } from '../data/players';
import { getBodyWeightLbs, getHeightInches } from '../data/heightLookup';
import {
  HIGH_USAGE_ARCHETYPE_WEIGHT,
  type DefensiveRole,
  type OffensiveArchetype,
  type PlayerSpan,
  type Position,
  type ShadowRoleProfile,
} from '../data/schema';
import { isRimGravityScorer } from './offensiveProfile';
import { pairwiseFitNotes, mismatchStructureScore, offensiveSystemOverloadPenalty } from './pairwiseFit';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { primaryStarters } from './rotation';
import { buildRoleFitContext, computeShadowRoleProfile } from './roleFitShadow';
import { isPlusShooter } from './shooting';
import { computeSpacing, isShootingAnomalyPlayer, spacingBreakdown, selfCreationRate, WALKING_GRAVITY_FLOOR } from './spacing';
import { buildSelfCreationYearMap, measuredSelfCreationForSpan } from './selfCreationLookup';
import { usageForSpan, type UsageSpanValue } from './usageLookup';
import { computeOffensiveTalent } from './talent';
import { athleticismScoreForSpan } from './athleticismLookup';
import { championshipStructureForRoster, type ChampionshipStructureResult } from './championshipArchetype';
import { defensiveHuntability } from './defensiveHuntability';
import { defensiveCohesion, MAX_DEFENSE_SCORE_BONUS } from './defensiveCohesion';
import { rimPressureTeam } from './rimPressure';
import { secondaryDefensiveRoleStrength } from '../data/defensiveRoleProfiles';
// Boolean predicate only (is this player a hard whole-career era override) — NOT a
// `computeDefensiveTalent` value; the module keeps its "no talent-number input" rule.
import { hasEraOverrideDefenseFloor } from './defensiveTalent';
import type { Team } from './types';

/**
 * `fitScore` — how well the starting five's roles actually complement each other. Answers
 * "how well do these five starters complement each other?" and deliberately avoids re-awarding
 * raw quality already owned by TAL/OFF/DEF elsewhere in `scoring.ts`:
 * - no `computeTalent` or `computeDefensiveTalent` input;
 * - no talent-per-FGA/cap-efficiency term;
 * - no average shooting-quality bonus (only lineup geometry and rim-gravity interactions);
 * - no rotation/minutes/position-fit penalty.
 *
 * 2026-08-19, promoted to the official Fit score (user's explicit ask, after this ran alongside
 * the old formula as "FIT v2 shadow" — a separate, non-consumed panel next to the real Fit score
 * — for direct side-by-side comparison across many real drafted rosters this session). The
 * previous formula (a hand-tuned point system: creation hierarchy, rim-gravity synergy,
 * continuous spacing, huntability-based team defense, rebounding, cap efficiency, rescaled
 * against empirically-calibrated achievable min/max) is retired; see git history
 * (`scoring.ts`'s old `fitScore`, deleted this same commit) for its own long, real calibration
 * chain if it's ever worth revisiting one of its ideas (cap efficiency in particular had a real,
 * validated 0.521 correlation with the human D1 vote — not reused here, since this module
 * deliberately stays a pure role-complementarity signal, not a talent/efficiency one; TAL/OFF/DEF
 * and `benchDepthScore` already own that ground on the Overall breakdown).
 *
 * Additional role proposals come from the existing role-fit shadow scorer. A curated incumbent
 * role establishes a credible 80-point floor (not automatic perfection); a proposed role is
 * admitted only at >=80, above that scorer's normal report threshold of 72. That lets genuinely
 * multi-role players cover a second responsibility without turning every noisy box-score
 * resemblance into full lineup versatility.
 */

/** Below this, the starting five's least-good defender is a real, playoff-huntable liability —
 * matches the bar `defensiveHuntability.ts`'s own `TARGETABLE_DTAL_CEILING` treats as attackable.
 * Above it, that same player is just "the least elite of five good starters," not actually weak —
 * a 2026-08-30 user-reported bug (batch feedback #10) had the UI always LABEL whoever scored
 * lowest as "weak link" regardless of this threshold (Chauncey Billups at 80, nowhere near
 * attackable, displayed as one) while this exact threshold already correctly gated the separate
 * prose note just below. Exported so the UI can gate the label the same way. */
export const HUNTABLE_WEAK_LINK_THRESHOLD = 50;

/** Spacing bottleneck applied to the final fit score below — exported alongside `FIT_WEIGHTS` so
 * a test recomputing "the documented component blend" can reproduce this term too, rather than
 * hardcoding a second copy of these numbers. See the constant's own use site for the rationale. */
export const SPACING_BOTTLENECK_FLOOR = 75;
export const SPACING_BOTTLENECK_MAX_PENALTY = 18;
export const SPACING_BOTTLENECK_SCALE = 0.65;

// 2026-09-04, the `scoreTeam` refactor (`overall = TAL·0.5 + FIT·0.5`, user's model): `fitScore`
// is now the whole "does this roster cohere" half, so it absorbs signals that used to live only
// in `defenseScore` (which no longer feeds `overall`). Two were measured on the D1 human vote
// (n=15) as real and previously unused/underweighted: `switchability` (Spearman +0.49 — computed
// as an input but never scored) and the `defensiveCohesion` shell bonus (+0.46 — only ever
// applied inside `defenseScore`). `huntResistance` folds in `defensiveHuntability` the same way.
// `creationStructure` drops from 0.30: it was the single most negatively-correlated component
// (−0.28) and structurally over-rewards raw creation presence (two lead guards who need the same
// touches read ~100), so its weight is cut rather than its internals reopened in this pass.
//
// 2026-09-04 (Phase 2): `rimPressureTeam` added — the paint-attack complement to
// `spacingCompatibility` (arc geometry). D1 +0.39 on its own, +0.02 on `overall`; closes the
// long-standing gap where a post-centric build (Twin Towers, Hakeem + A. Davis) read as pure
// negative offense. Weight comes off creation / spacing / championship.
/**
 * 2026-09-23, [[fit_score_defense_offense_weight_asymmetry]] follow-up ("a fresh D1 pass with the
 * CURRENT full component set"): measured each component's own standalone Spearman against the D1
 * human-vote set (n=15, `scripts/analyzeD1HumanVote.ts`), not the incremental deltas each one was
 * originally added against. Two real outliers: `defensiveRoleCoverage` — the single HIGHEST
 * weight in this whole table — measured -0.007 (dead weight on this sample), while
 * `defensiveCohesion` — the LOWEST defense-side weight — measured +0.493 (one of the strongest).
 * `spacingCompatibility` measured -0.311 (actively anti-correlated) and `creationStructure` -0.082
 * (near zero); `switchability` (+0.539) and `championshipStructure` (+0.339) were already solid.
 * Shifted weight AWAY from the three weak/negative components INTO the three strongest, capped at
 * 0.05 per component so no single move dominates: raw fitScore-vs-vote Spearman on D1 moved
 * 0.539 -> 0.621 with this exact reallocation (still sums to 1.0). Deliberately the CONSERVATIVE
 * of several swept candidates (an aggressive version reached 0.679, but n=15 is a small, noisy
 * sample this project has repeatedly found "hypersensitive" to reordering 1-2 teams — see the
 * Taylor-top-10 Spearman history in [[dtal_tal_bridge_shipped]] for the same lesson). Could not
 * cross-check against D1S2 (n=14, a stronger-correlating second human-vote round) — that dataset's
 * raw file isn't present in this environment, only summary numbers preserved in code comments
 * (`defensiveCohesion.ts`, `defensiveTalent.ts`) from a 2026-09-07 session. Full `npm test` +
 * `checkNeverDrafted`/AI-pick-regression green after this change; re-run both if either dataset
 * ever needs re-validating.
 */
export const FIT_WEIGHTS = {
  creationStructure: 0.10,
  spacingCompatibility: 0.08,
  defensiveRoleCoverage: 0.12,
  switchability: 0.18,
  huntResistance: 0.13,
  defensiveCohesion: 0.10,
  rimPressureTeam: 0.07,
  reboundingBalance: 0.02,
  sizeCoverage: 0.07,
  championshipStructure: 0.13,
} as const;

const ADDITIONAL_ROLE_CREDIT_FLOOR = 80;
const HARD_NON_SPACER_FLOOR = 30;
const FRONTCOURT_SPACING_FLOOR = 40;
/** Hoisted out of `fitScore`'s body (2026-09-16) and exported so `scoring.ts`'s `offenseScore`
 * blend can apply the SAME "elite playmaking engine" gate to its own raw-spacing term — see that
 * function's own docstring for why. Values and meaning unchanged from where they used to live
 * inline just above `hasGravityStarter`/`hasElitePrimaryCreator` below. */
export const ELITE_SCORING_GRAVITY_OTAL = 95;
export const ELITE_PRIMARY_CREATOR_THRESHOLD = 85;
const FUNCTIONAL_SIZE_WEIGHTS = {
  height: 0.40,
  weight: 0.25,
  athleticism: 0.20,
  rebounding: 0.15,
} as const;
const SWITCHABILITY_ROLE_SCORE: Record<DefensiveRole, number> = {
  'Point of Attack': 100,
  'Wing Stopper': 95,
  Chaser: 90,
  // A switch big holds up on the perimeter like a wing — that IS the archetype. Sits just below
  // the pure wing roles and well above `Mobile Big` (a big who moves) and `Anchor Big` (a big who
  // stays home).
  'Switch Big': 90,
  Helper: 85,
  'Mobile Big': 78,
  'Anchor Big': 50,
  'Post Defender': 35,
  'Low Activity': 20,
};

export interface FitScoreComponents {
  creationStructure: number;
  spacingCompatibility: number;
  defensiveRoleCoverage: number;
  /** Lineup switching capability, 0-100 — promoted from a diagnostic-only input on 2026-09-04
   * (the `scoreTeam` refactor). Mean of per-starter switchability, weakest-link weighted. */
  switchability: number;
  /** `100 − defensiveHuntability(team).penalty`-scaled, 0-100 — how resistant the rotation is to
   * repeated playoff matchup-hunting. Folded here from `defenseScore` in the same refactor. */
  huntResistance: number;
  /** `defensiveCohesion(team).defenseScoreBonus` on a 0-100 scale — the elite-shell / three-layer
   * / backline-foundation bonus, 0 for most rosters. Folded here from `defenseScore`. */
  defensiveCohesion: number;
  /** Team paint-attack pressure, 0-100 (`rimPressureTeam` in `rimPressure.ts`) — the offensive
   * complement to `spacingCompatibility`. Non-zero mainly for PF/C-anchored fives. */
  rimPressureTeam: number;
  reboundingBalance: number;
  sizeCoverage: number;
  championshipStructure: number;
}

export interface FitScoreInputs {
  starterCount: number;
  onBallDemand: number;
  primaryCreationSignal: number;
  secondaryCreationSignal: number;
  /** How dangerous this starting five is at hunting a mismatch on OFFENSE — best-player-weighted
   * blend of playmaking and self-creation (see `huntingPotentialFor`'s own docstring). Read by
   * `explainMatchup` against the OPPONENT's `defensiveWeakLinkResistance` below. */
  huntingPotential: number;
  /** Does the roster have real STRUCTURE to force and punish a defensive switch — a genuine
   * ball-screen initiator paired with a screener whose own gravity (roll or pop) creates a real
   * mismatch, surrounded by real spacing (`pairwiseFit.ts`'s `mismatchStructureScore`). Distinct
   * from `huntingPotential` on purpose: reads archetypes/pairing/shell, not individual skill. Read
   * by `offenseScoreComponents` (scoring.ts) as its own offenseScore dimension. */
  mismatchStructure: number;
  offBallComplementCount: number;
  hardNonSpacerCount: number;
  frontcourtNonSpacerCount: number;
  plusShooterCount: number;
  rimGravityScorerCount: number;
  guardContainment: number;
  guardContainmentProvider: string | null;
  guardContainmentConfirmed: boolean;
  wingCoverage: number;
  wingCoverageProvider: string | null;
  wingCoverageConfirmed: boolean;
  rimProtection: number;
  rimProtectionProvider: string | null;
  rimProtectionConfirmed: boolean;
  defensiveWeakLinkResistance: number;
  /** Points of lineup-level cover supplied by a strong POA/wing/rim shell. The player's own
   * defensive grade stays unchanged; this only measures how much the five can hide them. */
  defensiveWeakLinkCover: number;
  defensiveWeakLinkPlayer: string | null;
  /** Whether that lowest-scoring starter actually clears `HUNTABLE_WEAK_LINK_THRESHOLD` — the
   * UI should only call someone a "weak link" when this is true, not just because they're the
   * least-good of five otherwise strong starters. */
  defensiveWeakLinkIsHuntable: boolean;
  switchability: number;
  positionAdjustedReboundingPercentile: number;
  positionAdjustedHeightPercentile: number | null;
  positionAdjustedWeightPercentile: number | null;
  positionAdjustedAthleticismPercentile: number | null;
  functionalSizePercentile: number | null;
  additionalRoleCredits: string[];
  championshipArchetypes: ChampionshipStructureResult['archetypes'];
  primaryArchetype?: ChampionshipStructureResult['primaryArchetype'];
  secondaryArchetype?: ChampionshipStructureResult['secondaryArchetype'];
  archetypeReport?: ChampionshipStructureResult['archetypeReport'];
  playoffSuccessPrior: number;
  championshipFloor: number;
  championshipCeiling: number;
}

export interface FitScoreResult {
  version: 'fit-v2';
  score: number;
  components: FitScoreComponents;
  inputs: FitScoreInputs;
  notes: string[];
}

const clamp = (value: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, value));
const normalize = (value: number, lo: number, hi: number) => clamp(((value - lo) / (hi - lo)) * 100);
const mean = (values: number[]) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

function weightedAvailable(values: Array<{ value: number | null; weight: number }>): number | null {
  const available = values.filter((entry): entry is { value: number; weight: number } => entry.value !== null);
  const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight === 0) return null;
  return available.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
}

function positionVersatilityScore(player: PlayerSpan): number {
  const order: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
  const positions = [...new Set([player.primaryPosition, ...player.secondaryPositions])];
  const indices = positions.map((position) => order.indexOf(position));
  const span = Math.max(...indices) - Math.min(...indices);
  return clamp(35 + (positions.length - 1) * 22 + Math.max(0, span - 1) * 8);
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 50;
  let below = 0;
  while (below < sorted.length && sorted[below] < value) below++;
  let atOrBelow = below;
  while (atOrBelow < sorted.length && sorted[atOrBelow] <= value) atOrBelow++;
  return ((below + atOrBelow) / 2 / sorted.length) * 100;
}

const roleContext = buildRoleFitContext(players);
const roleProfileCache = new Map<string, ShadowRoleProfile>();
function shadowRoles(player: PlayerSpan): ShadowRoleProfile {
  const cached = roleProfileCache.get(player.id);
  if (cached) return cached;
  const profile = computeShadowRoleProfile(player, roleContext);
  roleProfileCache.set(player.id, profile);
  return profile;
}

/**
 * Read-only access for diagnostic adapters that need the exact same cached shadow profile as FIT.
 * Keeping the role scorer import and cache in this module preserves a single interpretation path;
 * callers receive evidence but cannot attach it to PlayerSpan or mutate production scoring.
 */
export function shadowRoleProfileForDiagnostics(player: PlayerSpan): ShadowRoleProfile {
  return shadowRoles(player);
}

function offensiveRoleScore(profile: ShadowRoleProfile, roles: OffensiveArchetype[]): number {
  if (roles.includes(profile.incumbentOffensiveRole)) return 100;
  return Math.max(
    0,
    ...profile.proposedOffensiveRoles
      .filter((fit) => fit.score >= ADDITIONAL_ROLE_CREDIT_FLOOR && roles.includes(fit.role))
      .map((fit) => fit.score),
  );
}

function defensiveRoleScore(profile: ShadowRoleProfile, roles: DefensiveRole[]): number {
  // A curated incumbent tag proves that the player can nominally perform the job, but not that
  // the lineup has elite coverage there. Start it at a credible 80 and let the shadow role-fit
  // evidence (position-scaled STL/BLK/RPG) raise it. Treating every incumbent tag as 100 made
  // defensive coverage average 98/100 across the 48-roster audit — effectively a constant, not
  // a useful compatibility signal.
  if (roles.includes(profile.incumbentDefensiveRole)) {
    const evidencedFit = profile.defensiveFits.find((fit) => fit.role === profile.incumbentDefensiveRole)?.score ?? 0;
    // `evidencedFit` is a position-scaled STL/BLK/RPG box score. For a pre-1974 anchor it is
    // structurally broken (no steals or blocks on record), so the 80 floor — meant as "credible,
    // not elite" — becomes a hard ceiling on a Russell/Wilt-tier rim layer. When the incumbent
    // role is a rim/wing job AND the player carries a whole-career era override
    // (`hasEraOverrideDefenseFloor`), raise the floor to 92: still short of the box-verified
    // elite scores, but no longer capping a confirmed all-time anchor at "credible".
    const player = players.find((candidate) => candidate.id === profile.playerId);
    const eraFloor =
      player &&
      hasEraOverrideDefenseFloor(player.playerName) &&
      (profile.incumbentDefensiveRole === 'Anchor Big' ||
        profile.incumbentDefensiveRole === 'Mobile Big' ||
        profile.incumbentDefensiveRole === 'Wing Stopper')
        ? 92
        : 0;
    return Math.max(80, evidencedFit, eraFloor);
  }
  // A curated Low Activity tag is stronger evidence than a stocks/rebounds resemblance to an
  // additional defensive job. Without this guard Magic could be shown simultaneously as an
  // inferred POA provider (80) and the lineup's 25-point weak link — an internally impossible
  // explanation. Low Activity players may still be evaluated in their incumbent role, but never
  // create a second coverage layer from box inference alone.
  if (profile.incumbentDefensiveRole === 'Low Activity') return 0;
  const player = players.find((candidate) => candidate.id === profile.playerId);
  const curatedSecondary = player
    ? Math.max(...roles.map((role) => secondaryDefensiveRoleStrength(player, role) * 80))
    : 0;
  const proposedScore = Math.max(
    0,
    ...profile.proposedDefensiveRoles
      .filter((fit) => fit.score >= ADDITIONAL_ROLE_CREDIT_FLOOR && roles.includes(fit.role))
      .map((fit) => fit.score),
  );
  // Every additional defensive role is inferred from position-scaled STL/BLK/RPG. That is
  // enough to say "credible secondary coverage," not enough to award an elite 92-97 as though
  // matchup/tracking data had confirmed the actual assignment. The 80 cap deliberately keeps
  // multi-role value alive while reserving elite layer scores for the player's incumbent,
  // manually/externally established role. T-Mac/KG being inferred as 97/92 Wing Stoppers from
  // box activity on the same lineup is the motivating false-positive.
  return Math.min(ADDITIONAL_ROLE_CREDIT_FLOOR, Math.max(proposedScore, curatedSecondary));
}

/**
 * Coverage by the three best specialists is not enough: a playoff defense also has to survive
 * the opponent hunting its weakest starter. The hand-curated `Low Activity` tag is intentionally
 * trusted over a box-score resemblance to POA/Helper here (Magic is the motivating example).
 * Every other curated defensive role receives the same credible-but-not-perfect 80 floor used
 * above, with real role-fit evidence allowed to raise it.
 */
function defensiveWeakLinkReliability(profile: ShadowRoleProfile): number {
  if (profile.incumbentDefensiveRole === 'Low Activity') return 25;
  return defensiveRoleScore(profile, [profile.incumbentDefensiveRole]);
}

const rpgBySlot = Object.fromEntries(
  (['PG', 'SG', 'SF', 'PF', 'C'] as Position[]).map((slot) => [
    slot,
    players.filter((player) => player.primaryPosition === slot).map((player) => player.box.rpg).sort((a, b) => a - b),
  ]),
) as Record<Position, number[]>;

const heightBySlot = Object.fromEntries(
  (['PG', 'SG', 'SF', 'PF', 'C'] as Position[]).map((slot) => [
    slot,
    players
      .filter((player) => player.primaryPosition === slot)
      .map((player) => getHeightInches(player.playerName))
      .filter((height): height is number => height !== undefined)
      .sort((a, b) => a - b),
  ]),
) as Record<Position, number[]>;

const weightBySlot = Object.fromEntries(
  (['PG', 'SG', 'SF', 'PF', 'C'] as Position[]).map((slot) => [
    slot,
    players
      .filter((player) => player.primaryPosition === slot)
      .map((player) => getBodyWeightLbs(player.playerName))
      .filter((weight): weight is number => weight !== undefined)
      .sort((a, b) => a - b),
  ]),
) as Record<Position, number[]>;

const athleticismBySlot = Object.fromEntries(
  (['PG', 'SG', 'SF', 'PF', 'C'] as Position[]).map((slot) => [
    slot,
    players
      .filter((player) => player.primaryPosition === slot)
      .map(athleticismScoreForSpan)
      .filter((score): score is number => score !== null)
      .sort((a, b) => a - b),
  ]),
) as Record<Position, number[]>;

function demandBalance(onBallDemand: number, primarySignal: number): number {
  if (onBallDemand <= 0.25) return primarySignal >= 85 ? 85 : 20;
  if (onBallDemand <= 2) return 100;
  if (onBallDemand <= 2.5) return 85;
  if (onBallDemand <= 3) return 60;
  return clamp(60 - (onBallDemand - 3) * 35);
}

/**
 * On-ball demand a starter's incumbent role actually imposes. `HIGH_USAGE_ARCHETYPE_WEIGHT`
 * (schema.ts) is tuned for guard/wing self-creators and leaves Post Scorer / Versatile Big /
 * Roll & Cut Big at 0 — so a two-hub post offense (KD + Embiid) read as `onBallDemand 1.5` and
 * four iso creators + Jokić read no differently than three. Kept local to fit.ts: the shared
 * constant has other consumers (aiDrafter's `usageWeight`/self-sufficient dampening,
 * insightMapper's `highUsageStarters`) that this reading should not move.
 *
 * Two additions over the raw weight:
 *  - Post Scorer gets a flat floor — the archetype IS "offensive focal point" by definition
 *    (Embiid, Hakeem, Shaq, prime Dwight, Kareem all carry a real post-up load).
 *  - Elite passing volume registers as a ball-dominant hub even without a scoring archetype
 *    (Jokić-as-Versatile-Big, Draymond, Horford) — but ONLY for players the weight table already
 *    rates below a lead guard (< 0.5). A Primary Ball Handler / Shot Creator / Slasher keeps
 *    their exact existing weight, so nothing calibrated on the old scale (e.g. the Nash+LeBron
 *    `onBallDemand <= 2` fixture) shifts.
 */
/**
 * 2026-09-05, user's explicit ask ("jeśli defense karze za gracza na którego można polować, to
 * powinno też oceniać czy zespół który atakuje ma potencjał na huntowanie w ataku" — if defense
 * penalizes a huntable player, it should also evaluate whether the ATTACKING team has real
 * hunting potential on offense): a huntable defender only actually gets exploited if the opponent
 * has the tools to force and punish the mismatch. The user's own example — a Doncic-level threat
 * is dangerous both off the pull-up (self-creation) AND as a passer (playmaking) — is exactly
 * `offenseScore`'s own `playmaking`/`selfCreation` dimensions (scoring.ts, same day), so this
 * reuses their exact shape (best-player-weighted, not a flat average — one elite dual threat
 * matters far more than five average ones) rather than inventing a new formula. Duplicated here
 * instead of imported from scoring.ts: `scoring.ts` already imports `fitScore` from this file, so
 * the reverse import would be circular (same reasoning as every other small duplicated helper in
 * this project — see `percentile()` in fit.ts/grades.ts/roleFitShadow.ts).
 *
 * First landed as an upgrade to `explainMatchup`'s existing (narrative-only, score-blind) weak-
 * link check, which used to compare a defender's resistance against `primaryCreationSignal` — a
 * playmaking-only signal that misses a pure self-creating scorer's own hunting threat entirely.
 */
const HUNTING_POTENTIAL_PLAYMAKING_DEFAULT = 35;
const huntingPotentialSelfCreationByYear = buildSelfCreationYearMap('unassistedFg');
// Same 2026-09-05 Post-Scorer proxy + primary-creator floor as scoring.ts's `starterSelfCreation`
// (see that function's docstring) — duplicated rather than imported, scoring.ts already imports
// `fitScore` from here so the reverse is a cycle.
const SC_USAGE_FLOOR = 11;
const SC_USAGE_FULL = 16;
const POST_SCORER_SELF_CREATION = 0.7;
const SELF_CREATION_PROXY_FLOOR_WEIGHT = 0.7;
const PRIMARY_CREATOR_ARCHETYPES: readonly OffensiveArchetype[] = ['Shot Creator', 'Primary Ball Handler'];
function huntingSelfCreationProxy(player: PlayerSpan): number {
  const base = selfCreationRate(player);
  if (base > 0 || player.offensiveArchetype !== 'Post Scorer') return base;
  const usage = clamp((player.fga - SC_USAGE_FLOOR) / (SC_USAGE_FULL - SC_USAGE_FLOOR), 0, 1);
  return POST_SCORER_SELF_CREATION * usage;
}
function huntingSelfCreationFor(player: PlayerSpan): number {
  const measured = measuredSelfCreationForSpan(player, huntingPotentialSelfCreationByYear);
  const proxy = huntingSelfCreationProxy(player);
  if (measured == null) return proxy * 100;
  const floor = PRIMARY_CREATOR_ARCHETYPES.includes(player.offensiveArchetype) ? proxy * SELF_CREATION_PROXY_FLOOR_WEIGHT : 0;
  return Math.max(measured, floor) * 100;
}
function huntingPotentialFor(starters: PlayerSpan[]): number {
  if (starters.length === 0) return 0;
  const playmakingValues = starters.map((p) => playmakingScoreForPlayer(p) ?? HUNTING_POTENTIAL_PLAYMAKING_DEFAULT);
  const bestPlaymaking = Math.max(...playmakingValues);
  const meanPlaymaking = playmakingValues.reduce((sum, v) => sum + v, 0) / playmakingValues.length;
  const playmakingComponent = bestPlaymaking * 0.6 + meanPlaymaking * 0.4;
  const selfCreationValues = starters.map(huntingSelfCreationFor);
  const bestSelfCreation = Math.max(...selfCreationValues);
  const meanSelfCreation = selfCreationValues.reduce((sum, v) => sum + v, 0) / selfCreationValues.length;
  const selfCreationComponent = bestSelfCreation * 0.55 + meanSelfCreation * 0.45;
  return Math.round(playmakingComponent * 0.5 + selfCreationComponent * 0.5);
}

const POST_SCORER_ON_BALL_FLOOR = 0.65;

/**
 * 2026-09-17, user-reported live, with real numbers: prime Kobe Bryant (2002-04, 21.1 real FGA)
 * and Paul Pierce's 2009-11 span (12.5 FGA, already his lower-usage third-option Celtics years
 * alongside Garnett/Allen/Rondo) both carry the `Shot Creator`/`Slasher` archetype tag, so both
 * got the flat `HIGH_USAGE_ARCHETYPE_WEIGHT` value with zero distinction between them — "Kobe w
 * prime z 22 fga ma taką samą wagę jak starszy Pierce". Checked the pool directly
 * (scripts/_fgaByArchetype.ts, deleted after use): median real FGA is 16.7 for Shot Creator vs.
 * 11.0 for Slasher — the archetypes themselves already imply systematically different usage
 * levels the flat weight discarded, on top of within-archetype spread (a given Slasher can be a
 * 9-FGA cutter or a 13-FGA go-to scorer).
 *
 * `fgaDemandScale` rescales the flat weight by the player's own real FGA against a reference
 * (18, roughly a genuine go-to star's volume — close to Shot Creator's own p75/p90 in the pool),
 * clamped to [0.4, 1.3] so a very low-volume tag-holder still registers SOME real demand and a
 * very high-volume one can't blow past a hard ceiling. A span sitting exactly at the reference
 * keeps its old weight unchanged; below it scales down, above it scales up — this is why the
 * Nash+LeBron `onBallDemand <= 2` fixture (testFit.ts) still holds: neither span's own FGA sits
 * far enough above their archetype's typical range to push the sum past the fixture's own bound.
 */
const FGA_DEMAND_REFERENCE = 18;
const FGA_DEMAND_MIN_SCALE = 0.4;
const FGA_DEMAND_MAX_SCALE = 1.3;
function fgaDemandScale(fga: number): number {
  return clamp(fga / FGA_DEMAND_REFERENCE, FGA_DEMAND_MIN_SCALE, FGA_DEMAND_MAX_SCALE);
}

/**
 * 2026-09-17, same day as the fga-scale patch above: the user pushed further ("Działaj nad
 * tematem assisted fg i usg") after real usage%/assisted-FG% turned out to exist per-game in
 * `PlayerStatisticsExtended.csv` (1996-2026 coverage — [[usg_possession_cap_plan]]'s "THIRD
 * consumer" note has the full data story). `usageForSpan` (usageLookup.ts) aggregates it
 * minutes-weighted per span. This replaces the archetype+fga-scale PROXY outright wherever real
 * data exists — it's not another adjustment layered on top, it's the actual thing the proxy was
 * always standing in for.
 *
 * Two real numbers combine: `usgPct` (true on-ball load, not an archetype guess) sets the raw
 * demand against `USAGE_DEMAND_FLOOR`/`CEILING` (14%/34% — checked against the real pool
 * distribution, scripts/_usageTest.ts deleted after use: p5=11.6%, median=17.4%, max=37.8%, so
 * these bracket a genuine "replacement-level to superstar" range, not arbitrary numbers).
 * `assistedFgPct` then scales that raw demand by how much of it the player actually EARNED
 * himself versus received from a teammate's pass — a high-usage post scorer or catch-and-shoot
 * option whose buckets are mostly assisted asks less of the OFFENSE's structure than the same
 * usage spent creating a shot from scratch. `SELF_CREATION_DEMAND_FLOOR` (0.5) keeps even a
 * fully-assisted high-usage span (a pure lob-and-putback big, say) registering real demand —
 * touches still have to go somewhere — rather than zeroing out.
 *
 * Validated directly on the user's own drafted roster (Billups/Kobe/Pierce/C.Robinson/Shaq): real
 * onBallDemand sums to ~2.13, comfortably under the "crowded" 2.5 line the flat/fga-scaled proxies
 * both put it well past (4.15 / 3.82) — Pierce's real 09-11 usage (23.6%) and Robinson's real
 * assisted rate (78.4%, mostly finishing) are exactly what the user argued they were: genuinely
 * lower-demand than the tags implied. Falls back to the archetype+fga-scale proxy for any span
 * this source doesn't cover (all pre-1996 spans, plus the ~3% of post-1996 games missing
 * usagePercentage).
 */
const USAGE_DEMAND_FLOOR = 0.14;
const USAGE_DEMAND_CEILING = 0.34;
const USAGE_DEMAND_MAX = 1.3;
const SELF_CREATION_DEMAND_FLOOR = 0.5;
const MIN_GAMES_FOR_REAL_USAGE = 15;

function realUsageDemand(usage: UsageSpanValue): number {
  const rawDemand = clamp((usage.usgPct - USAGE_DEMAND_FLOOR) / (USAGE_DEMAND_CEILING - USAGE_DEMAND_FLOOR), 0, USAGE_DEMAND_MAX);
  const selfCreation = 1 - usage.assistedFgPct;
  return rawDemand * (SELF_CREATION_DEMAND_FLOOR + (1 - SELF_CREATION_DEMAND_FLOOR) * selfCreation);
}

function starterOnBallDemand(profile: ShadowRoleProfile, span: PlayerSpan): number {
  const realUsage = usageForSpan(span);
  if (realUsage && realUsage.games >= MIN_GAMES_FOR_REAL_USAGE) {
    return realUsageDemand(realUsage);
  }

  const demandScale = fgaDemandScale(span.fga);
  const archetypeWeight = (HIGH_USAGE_ARCHETYPE_WEIGHT[profile.incumbentOffensiveRole] ?? 0) * demandScale;
  const postFloor = profile.incumbentOffensiveRole === 'Post Scorer' ? POST_SCORER_ON_BALL_FLOOR * demandScale : 0;
  // playmakingScoreForPlayer: 0-100, name-keyed peak, ~85 = "elite"; null when uncovered.
  // pm 84 → ~0.14, pm 90 → ~0.28, pm 99 → ~0.49 — tops out near a Primary Ball Handler's own
  // 0.5 so a distributor never out-demands a lead guard.
  const pm = playmakingScoreForPlayer(span);
  const playmakingDemand =
    archetypeWeight >= 0.5 || pm === null ? 0 : clamp((pm - 78) / 30, 0, 1) * 0.7;
  return Math.max(archetypeWeight, postFloor, playmakingDemand);
}

function geometryScore(hardNonSpacers: number): number {
  return [100, 82, 52, 22, 5, 0][Math.min(5, hardNonSpacers)];
}

function rimSupportScore(rimGravityScorers: number, plusShooters: number, hasAnomaly: boolean): number {
  if (rimGravityScorers === 0) return 100;
  if (hasAnomaly) return 100;
  return [0, 45, 80, 100][Math.min(3, plusShooters)];
}

function frontcourtGeometryScore(nonSpacers: number): number {
  return [100, 75, 25][Math.min(2, nonSpacers)];
}

export function fitScore(team: Team): FitScoreResult {
  const starterEntries = primaryStarters(team);
  const starters = starterEntries.map((entry) => entry.player);
  const notes: string[] = [];

  if (starters.length < 5) {
    return {
      version: 'fit-v2',
      score: 0,
      components: {
        creationStructure: 0,
        spacingCompatibility: 0,
        defensiveRoleCoverage: 0,
        switchability: 0,
        huntResistance: 0,
        defensiveCohesion: 0,
        rimPressureTeam: 0,
        reboundingBalance: 0,
        sizeCoverage: 0,
        championshipStructure: 0,
      },
      inputs: {
        starterCount: starters.length,
        onBallDemand: 0,
        primaryCreationSignal: 0,
        huntingPotential: 0,
        mismatchStructure: 0,
        secondaryCreationSignal: 0,
        offBallComplementCount: 0,
        hardNonSpacerCount: 0,
        frontcourtNonSpacerCount: 0,
        plusShooterCount: 0,
        rimGravityScorerCount: 0,
        guardContainment: 0,
        guardContainmentProvider: null,
        guardContainmentConfirmed: false,
        wingCoverage: 0,
        wingCoverageProvider: null,
        wingCoverageConfirmed: false,
        rimProtection: 0,
        rimProtectionProvider: null,
        rimProtectionConfirmed: false,
        defensiveWeakLinkResistance: 0,
        defensiveWeakLinkCover: 0,
        defensiveWeakLinkPlayer: null,
        defensiveWeakLinkIsHuntable: false,
        switchability: 0,
        positionAdjustedReboundingPercentile: 0,
        positionAdjustedHeightPercentile: null,
        positionAdjustedWeightPercentile: null,
        positionAdjustedAthleticismPercentile: null,
        functionalSizePercentile: null,
        additionalRoleCredits: [],
      championshipArchetypes: [],
      primaryArchetype: undefined,
      secondaryArchetype: undefined,
      archetypeReport: undefined,
      playoffSuccessPrior: 0,
      championshipFloor: 0,
        championshipCeiling: 0,
      },
      notes: ['Starting five is incomplete.'],
    };
  }

  const profiles = starters.map(shadowRoles);
  const additionalRoleCredits = profiles.flatMap((profile, index) => [
    ...profile.proposedOffensiveRoles
      .filter((fit) => fit.score >= ADDITIONAL_ROLE_CREDIT_FLOOR)
      .map((fit) => `${starters[index].playerName}: ${fit.role} ${fit.score}`),
    ...profile.proposedDefensiveRoles
      .filter((fit) => fit.score >= ADDITIONAL_ROLE_CREDIT_FLOOR)
      .map((fit) =>
        `${starters[index].playerName}: ${fit.role} ${ADDITIONAL_ROLE_CREDIT_FLOOR} credit (box signal ${fit.score})`,
      ),
  ]);

  // Demand describes the job a player actually occupies, not every job they are capable of
  // performing. Counting proposed roles here turned Klay Thompson's inferred Shot Creator
  // ability into the same ball requirement as a real primary scorer and made Nash + LeBron +
  // off-ball threats look crowded. Proposed roles still contribute to creationSignals below;
  // they simply no longer fabricate possessions a player's incumbent role does not demand.
  const demandByPlayer = profiles.map((profile, index) => starterOnBallDemand(profile, starters[index]));
  const onBallDemand = demandByPlayer.reduce((sum, value) => sum + value, 0);
  const creationSignals = profiles
    .map((profile, index) => {
      const measuredPlaymaking = playmakingScoreForPlayer(starters[index]) ?? 0;
      return Math.max(
        measuredPlaymaking,
        offensiveRoleScore(profile, ['Primary Ball Handler']),
        offensiveRoleScore(profile, ['Shot Creator']) * 0.8,
        offensiveRoleScore(profile, ['Secondary Ball Handler']) * 0.7,
      );
    })
    .sort((a, b) => b - a);
  const primaryCreationSignal = creationSignals[0] ?? 0;
  const secondaryCreationSignal = creationSignals[1] ?? 0;
  const offBallComplementCount = profiles.filter((profile, index) => {
    if (demandByPlayer[index] >= 0.75) return false;
    return offensiveRoleScore(profile, [
      'Off Screen Shooter',
      'Movement Shooter',
      'Stationary Shooter',
      'Stretch Big',
      'Athletic Finisher',
      'Roll & Cut Big',
    ]) >= ADDITIONAL_ROLE_CREDIT_FLOOR;
  }).length;
  const primaryCreationScore = normalize(primaryCreationSignal, 50, 85);
  const secondaryCreationScore = 40 + normalize(secondaryCreationSignal, 40, 75) * 0.6;
  // 2026-09-05, user's call ("powinno to liczyć w fit"): a five committed to 3+ co-primary
  // offensive systems (pairwiseFit pattern 5) genuinely lacks a playoff identity — dock it from
  // creationStructure rather than leaving it note-only.
  const systemOverloadPenalty = offensiveSystemOverloadPenalty(starters, demandByPlayer);
  const creationStructure = Math.round(
    Math.max(
      0,
      primaryCreationScore * 0.40 +
        demandBalance(onBallDemand, primaryCreationSignal) * 0.30 +
        secondaryCreationScore * 0.15 +
        clamp((offBallComplementCount / 3) * 100) * 0.15 -
        systemOverloadPenalty,
    ),
  );
  if (primaryCreationSignal < 50) notes.push('No credible primary creation role in the starting five.');
  if (onBallDemand > 2.5) notes.push(`On-ball demand is crowded (${onBallDemand.toFixed(2)} weighted roles).`);
  const starterSlots = starterEntries.map((entry) => entry.slot);
  notes.push(...pairwiseFitNotes(starters, starterSlots, demandByPlayer));
  const mismatchStructure = mismatchStructureScore(starters, starterSlots, demandByPlayer);

  const hardNonSpacerCount = starters.filter((player) => computeSpacing(player) < HARD_NON_SPACER_FLOOR).length;
  const plusShooterCount = starters.filter(isPlusShooter).length;
  const rimGravityScorerCount = starters.filter(isRimGravityScorer).length;
  const hasShootingAnomaly = starters.some(isShootingAnomalyPlayer);
  const frontcourt = starterEntries.filter((entry) => entry.slot === 'PF' || entry.slot === 'C').map((entry) => entry.player);
  const frontcourtNonSpacerCount = frontcourt.filter((player) => computeSpacing(player) < FRONTCOURT_SPACING_FLOOR).length;

  // An elite-gravity shooter makes help defense costly: collapsing onto him opens 4-on-3 the
  // non-shooters' own teammates can punish, so the raw hard-non-spacer count overstates how
  // cramped a compressed floor (2+ hard non-spacers) really is. Discount one non-spacer of
  // geometry cost, a second when the lineup can actually punish the rotation (a real secondary
  // creator, or a rim-gravity release valve). `spacingScore` in scoring.ts already carries an
  // equivalent multi-gravity floor; `spacingCompatibility` never picked it up. Only geometryScore
  // is softened — frontcourtGeometryScore still charges two non-shooting bigs, so a gravity
  // starter eases the penalty but never erases it.
  //
  // 2026-09-04, user-reported (D2 #2, Jordan+Haliburton+Malone+Howard): `spacingBreakdown` is
  // purely arc/3PT gravity, so peak Jordan (1989-91, O-TAL 100, minimal 3PA — the league barely
  // shot 3s yet) reads 16.8 points, under `WALKING_GRAVITY_FLOOR` (19), and never triggers this
  // discount despite being exactly the kind of scorer real defenses double-teamed and warped
  // around. `eliteScoringGravity` is a second, independent path to the same flag: an O-TAL >= 95
  // span (the ~59-span, all-time-great tier — Jordan/Harden/Luka/prime-LeBron-band; already-
  // covered arc shooters like Nash/Miller/Allen also clear it, so no double mechanism for them)
  // draws enough defensive attention on pure scoring gravity alone, independent of shot selection.
  const hasGravityStarter =
    starters.some((player) => spacingBreakdown(player).points >= WALKING_GRAVITY_FLOOR) ||
    starters.some((player) => computeOffensiveTalent(player) >= ELITE_SCORING_GRAVITY_OTAL);
  // 2026-09-12, user's own idea, live ("wybitny rozgrywający jest w stanie wykreować ofensywę
  // mimo słabego spacingu, co pozwala na zbieranie większej ilości defensywnego talentu" — an
  // elite playmaker can manufacture good offense despite weak spacing, which should let the roster
  // spend more of its budget on defensive talent instead): `hasGravityStarter` above is entirely
  // about drawing defensive ATTENTION (a shooting or scoring threat), which is one real way to
  // make a help defense pay for collapsing on a non-shooter — but not the only one. A genuine
  // elite-passing hub (Nash/Magic/Stockton-tier) makes the SAME defense pay a different way: he
  // finds the cutter/roller the help just left open, independent of whether he draws gravity
  // himself. First attempt at this folded the creator check only into `canPunishHelp` (the
  // discount's SECOND, larger tier) while leaving it gated behind `hasGravityStarter` for even the
  // first tier — measured directly against this exact fix's own motivating case (Nash + two
  // traditional bigs) and it changed nothing, because that five has no real gravity shooter at
  // all, so the whole branch stayed closed regardless. `hasElitePrimaryCreator` is instead its own,
  // independent path into the discount, not an amplifier nested under the gravity gate. `85`
  // reuses `primaryCreationScore`'s own normalization ceiling a few lines up — the same bar this
  // function already treats as "maxed-out primary creation" — rather than inventing a second,
  // separate threshold for the same underlying signal.
  const hasElitePrimaryCreator = primaryCreationSignal >= ELITE_PRIMARY_CREATOR_THRESHOLD;
  const canPunishHelp = secondaryCreationSignal >= 75 || hasElitePrimaryCreator || starters.some(isRimGravityScorer);
  // 2026-09-17, audit-found: this discount used to require `hardNonSpacerCount >= 2` to engage
  // at all, so a lineup with exactly ONE hard non-spacer (strictly better personnel) never got
  // it, while a lineup with TWO (strictly worse) could. Verified live: swapping a real lineup's
  // PG from Chris Paul (1 hard non-spacer, no discount, geometryScore(1)=82) to Ben Simmons
  // 2017-19 (a genuine zero-shooting liability, 2 hard non-spacers, discount fires, ->
  // geometryScore(0)=100) RAISED `spacingCompatibility` and the overall FIT score — adding a
  // worse shooter scored higher. Lowering the gate to `>= 1` lets the same elite-creator/gravity
  // rescue apply uniformly starting at one non-spacer, so a one-non-spacer five can reach at
  // least the same floor a two-non-spacer five with the same qualifying starter would — fewer
  // non-spacers can no longer score worse than more.
  const geometryNonSpacerCount =
    (hasGravityStarter || hasElitePrimaryCreator) && hardNonSpacerCount >= 1
      ? Math.max(0, hardNonSpacerCount - (canPunishHelp ? 2 : 1))
      : hardNonSpacerCount;

  const spacingCompatibility = Math.round(
    geometryScore(geometryNonSpacerCount) * 0.45 +
      rimSupportScore(rimGravityScorerCount, plusShooterCount, hasShootingAnomaly) * 0.35 +
      frontcourtGeometryScore(frontcourtNonSpacerCount) * 0.20,
  );
  if (geometryNonSpacerCount >= 2) notes.push(`${hardNonSpacerCount} hard non-spacers compress the starting lineup.`);
  if (rimGravityScorerCount > 0 && plusShooterCount < 2 && !hasShootingAnomaly) {
    notes.push('Rim gravity does not have enough shooting support.');
  }

  const guardCandidates = profiles.map((profile, index) => ({
    player: starters[index],
    confirmed: profile.incumbentDefensiveRole === 'Point of Attack' || profile.incumbentDefensiveRole === 'Chaser',
    score: Math.max(
      defensiveRoleScore(profile, ['Point of Attack']),
      defensiveRoleScore(profile, ['Chaser']) * 0.85,
    ),
  })).sort((a, b) => b.score - a.score || Number(b.confirmed) - Number(a.confirmed));
  const wingCandidates = profiles.map((profile, index) => ({
    player: starters[index],
    confirmed: profile.incumbentDefensiveRole === 'Wing Stopper',
    score: Math.max(
      defensiveRoleScore(profile, ['Wing Stopper']),
      // A switch big covers the wing on a switch — credited at a slight discount to a dedicated
      // wing stopper, same idea as the `Helper` fallback below.
      defensiveRoleScore(profile, ['Switch Big']) * 0.9,
      defensiveRoleScore(profile, ['Helper']) * 0.65,
    ),
  })).sort((a, b) => b.score - a.score || Number(b.confirmed) - Number(a.confirmed));
  const rimCandidates = profiles.map((profile, index) => ({
    player: starters[index],
    confirmed: profile.incumbentDefensiveRole === 'Anchor Big' || profile.incumbentDefensiveRole === 'Mobile Big',
    score: defensiveRoleScore(profile, ['Anchor Big', 'Mobile Big', 'Switch Big']),
  })).sort((a, b) => b.score - a.score || Number(b.confirmed) - Number(a.confirmed));
  const guardContainment = guardCandidates[0]?.score ?? 0;
  const wingCoverage = wingCandidates[0]?.score ?? 0;
  const rimProtection = rimCandidates[0]?.score ?? 0;
  const defensiveLayers = [guardContainment, wingCoverage, rimProtection];
  const weakLinkCandidates = profiles.map((profile, index) => ({
    player: starters[index],
    score: defensiveWeakLinkReliability(profile),
  })).sort((a, b) => a.score - b.score);
  const defensiveWeakLinkResistance = weakLinkCandidates[0]?.score ?? 0;
  const layerCoverage = mean(defensiveLayers) * 0.60 + Math.min(...defensiveLayers) * 0.40;
  // One weak defender still matters, but a lineup with credible POA, wing and rim answers can
  // cross-match and keep that player away from the primary action. The cover is continuous and
  // capped: it needs all three layers, and can recover only 60% of the gap to the shell itself.
  const shellHideability =
    clamp((mean(defensiveLayers) - 65) / 20, 0, 1) *
    clamp((Math.min(...defensiveLayers) - 50) / 20, 0, 1);
  const coveredWeakLinkResistance =
    defensiveWeakLinkResistance +
    (layerCoverage - defensiveWeakLinkResistance) * shellHideability * 0.60;
  const defensiveWeakLinkCover = Math.max(0, coveredWeakLinkResistance - defensiveWeakLinkResistance);
  const defensiveRoleCoverage = Math.round(layerCoverage * 0.75 + coveredWeakLinkResistance * 0.25);
  if (guardContainment < 45) notes.push('No reliable point-of-attack containment role.');
  if (wingCoverage < 45) notes.push('No reliable wing coverage role.');
  if (wingCoverage > 0 && !wingCandidates[0]?.confirmed) notes.push('Wing coverage is inferred from box activity, not a confirmed incumbent Wing Stopper role.');
  if (rimProtection < 45) notes.push('No reliable rim-protection role.');
  const isHuntableWeakLink = defensiveWeakLinkResistance < HUNTABLE_WEAK_LINK_THRESHOLD;
  if (isHuntableWeakLink && weakLinkCandidates[0]) {
    notes.push(`${weakLinkCandidates[0].player.playerName} is a huntable defensive weak link in the starting five.`);
  }

  const physicalProfiles = starterEntries.map((entry) => {
    const rebound = percentile(rpgBySlot[entry.slot], entry.player.box.rpg);
    const height = getHeightInches(entry.player.playerName);
    const weight = getBodyWeightLbs(entry.player.playerName);
    const athleticism = athleticismScoreForSpan(entry.player);
    const heightPercentile = height === undefined ? null : percentile(heightBySlot[entry.slot], height);
    const weightPercentile = weight === undefined ? null : percentile(weightBySlot[entry.slot], weight);
    const athleticismPercentile = athleticism === null ? null : percentile(athleticismBySlot[entry.slot], athleticism);
    return {
      rebound,
      height: heightPercentile,
      weight: weightPercentile,
      athleticism: athleticismPercentile,
      functional: weightedAvailable([
        { value: heightPercentile, weight: FUNCTIONAL_SIZE_WEIGHTS.height },
        { value: weightPercentile, weight: FUNCTIONAL_SIZE_WEIGHTS.weight },
        { value: athleticismPercentile, weight: FUNCTIONAL_SIZE_WEIGHTS.athleticism },
        { value: rebound, weight: FUNCTIONAL_SIZE_WEIGHTS.rebounding },
      ]),
    };
  });
  const reboundPercentiles = physicalProfiles.map((profile) => profile.rebound);
  const heightPercentiles = physicalProfiles.flatMap((profile) => profile.height === null ? [] : [profile.height]);
  const weightPercentiles = physicalProfiles.flatMap((profile) => profile.weight === null ? [] : [profile.weight]);
  const athleticismPercentiles = physicalProfiles.flatMap((profile) => profile.athleticism === null ? [] : [profile.athleticism]);
  const functionalSizePercentiles = physicalProfiles.flatMap((profile) => profile.functional === null ? [] : [profile.functional]);
  const positionAdjustedReboundingPercentile = mean(reboundPercentiles);
  const positionAdjustedHeightPercentile = heightPercentiles.length > 0 ? mean(heightPercentiles) : null;
  const positionAdjustedWeightPercentile = weightPercentiles.length > 0 ? mean(weightPercentiles) : null;
  const positionAdjustedAthleticismPercentile = athleticismPercentiles.length > 0 ? mean(athleticismPercentiles) : null;
  const functionalSizePercentile = functionalSizePercentiles.length > 0 ? mean(functionalSizePercentiles) : null;
  // Rebounding remains separately visible, but functional size now answers the broader basketball
  // question the label implies: positional height + real listed mass/strength + measured
  // athleticism + positional rebounding. Missing physical fields are omitted and the remaining
  // real signals are renormalized; no average body is fabricated.
  const reboundingBalance = Math.round(positionAdjustedReboundingPercentile);
  const sizeCoverage = Math.round(functionalSizePercentile ?? 50);
  const individualSwitchability = starters.map((player, index) => weightedAvailable([
    // A curated `Switch Big` secondary (defensiveRoleProfiles.ts) means "switches 1-5" even when
    // the primary tag is the more conservative Anchor/Mobile Big — take the better of the two.
    {
      value: Math.max(
        SWITCHABILITY_ROLE_SCORE[player.defensiveRole],
        secondaryDefensiveRoleStrength(player, 'Switch Big') > 0 ? SWITCHABILITY_ROLE_SCORE['Switch Big'] : 0,
      ),
      weight: 0.40,
    },
    { value: positionVersatilityScore(player), weight: 0.30 },
    { value: physicalProfiles[index].athleticism, weight: 0.20 },
    { value: physicalProfiles[index].functional, weight: 0.10 },
  ]) ?? 0);
  // A switching scheme is limited by both the lineup's general versatility and its least
  // switchable starter. Starter-only; full-rotation D-TAL huntability is the separate
  // `huntResistance` component below.
  const switchability = Math.round(mean(individualSwitchability) * 0.75 + Math.min(...individualSwitchability) * 0.25);
  if (reboundingBalance < 35) notes.push('The starting five is weak on the glass relative to its assigned positions.');
  if (sizeCoverage < 35) notes.push('The starting five lacks functional size relative to its assigned positions.');

  // 2026-09-04 (`scoreTeam` refactor): `defenseScore` no longer feeds `overall`, so the two
  // whole-rotation defensive-scheme signals it carried are read here instead. `huntResistance`
  // is `defensiveHuntability`'s own 0-100 resistance (100 = nothing to hunt); `defensiveCohesion`
  // rescales that module's own bonus (whichever of its four paths wins) to 0-100 — it stays 0 for
  // any roster without a genuinely complete or elite-anchored defensive shell.
  // 2026-09-12, code-review finding: this used to divide by `MAX_BACKLINE_FOUNDATION_DEFENSE_
  // BONUS` specifically (a comment here even still said "18," a value from an even earlier cut) —
  // stale the moment ANY sibling path's own cap became the larger one, most recently
  // `weakLinkOvercomeBonus`'s 28, which pushed this over 100 (up to ~467) and was shown raw to
  // the user in Team analysis. `MAX_DEFENSE_SCORE_BONUS` is the real, always-current ceiling.
  const huntResistance = defensiveHuntability(team).resistance;
  const cohesionBonusRaw = defensiveCohesion(team).defenseScoreBonus;
  const defensiveCohesionComponent = Math.round((cohesionBonusRaw / MAX_DEFENSE_SCORE_BONUS) * 100);
  const rimPressureTeamComponent = Math.round(rimPressureTeam(starters));

  const components: FitScoreComponents = {
    creationStructure,
    spacingCompatibility,
    defensiveRoleCoverage,
    switchability,
    huntResistance,
    defensiveCohesion: defensiveCohesionComponent,
    rimPressureTeam: rimPressureTeamComponent,
    reboundingBalance,
    sizeCoverage,
    championshipStructure: 0,
  };
  const championshipStructure = championshipStructureForRoster(starters, profiles, team.roster);
  components.championshipStructure = championshipStructure.score;
  notes.push(...championshipStructure.notes);
  const weightedScore = (Object.keys(FIT_WEIGHTS) as (keyof typeof FIT_WEIGHTS)[]).reduce(
    (sum, key) => sum + components[key] * FIT_WEIGHTS[key],
    0,
  );
  // Fit is not fully compensatory: excellent creation/defense cannot make a cramped half-court
  // geometry disappear. The weighted average previously let Spacing compatibility 66 coexist
  // with Fit 78, which overstated how portable the lineup actually was. This bounded bottleneck
  // begins below a genuinely healthy 75 and tops out at 18 points, so poor spacing matters
  // without zeroing every historically non-modern lineup.
  const spacingBottleneckPenalty = Math.min(
    SPACING_BOTTLENECK_MAX_PENALTY,
    Math.max(0, (SPACING_BOTTLENECK_FLOOR - spacingCompatibility) * SPACING_BOTTLENECK_SCALE),
  );
  const score = Math.round(clamp(weightedScore - spacingBottleneckPenalty));
  if (spacingBottleneckPenalty >= 2) {
    notes.push(`Spacing compatibility caps overall fit (-${Math.round(spacingBottleneckPenalty)}).`);
  }

  return {
    version: 'fit-v2',
    score,
    components,
    inputs: {
      starterCount: starters.length,
      onBallDemand,
      primaryCreationSignal,
      huntingPotential: huntingPotentialFor(starters),
      mismatchStructure,
      secondaryCreationSignal,
      offBallComplementCount,
      hardNonSpacerCount,
      frontcourtNonSpacerCount,
      plusShooterCount,
      rimGravityScorerCount,
      guardContainment,
      guardContainmentProvider: guardCandidates[0]?.player.playerName ?? null,
      guardContainmentConfirmed: guardCandidates[0]?.confirmed ?? false,
      wingCoverage,
      wingCoverageProvider: wingCandidates[0]?.player.playerName ?? null,
      wingCoverageConfirmed: wingCandidates[0]?.confirmed ?? false,
      rimProtection,
      rimProtectionProvider: rimCandidates[0]?.player.playerName ?? null,
      rimProtectionConfirmed: rimCandidates[0]?.confirmed ?? false,
      defensiveWeakLinkResistance,
      defensiveWeakLinkCover: Math.round(defensiveWeakLinkCover),
      defensiveWeakLinkPlayer: weakLinkCandidates[0]?.player.playerName ?? null,
      defensiveWeakLinkIsHuntable: isHuntableWeakLink,
      switchability,
      positionAdjustedReboundingPercentile,
      positionAdjustedHeightPercentile,
      positionAdjustedWeightPercentile,
      positionAdjustedAthleticismPercentile,
      functionalSizePercentile,
      additionalRoleCredits,
      championshipArchetypes: championshipStructure.archetypes,
      primaryArchetype: championshipStructure.primaryArchetype,
      secondaryArchetype: championshipStructure.secondaryArchetype,
      archetypeReport: championshipStructure.archetypeReport,
      playoffSuccessPrior: championshipStructure.playoffSuccessPrior,
      championshipFloor: championshipStructure.floor,
      championshipCeiling: championshipStructure.ceiling,
    },
    notes,
  };
}
