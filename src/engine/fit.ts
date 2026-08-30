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
import { playmakingScoreForPlayer } from './playmakingLookup';
import { primaryStarters } from './rotation';
import { buildRoleFitContext, computeShadowRoleProfile } from './roleFitShadow';
import { isPlusShooter } from './shooting';
import { computeSpacing, isShootingAnomalyPlayer } from './spacing';
import { athleticismScoreForSpan } from './athleticismLookup';
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

export const FIT_WEIGHTS = {
  creationStructure: 0.35,
  spacingCompatibility: 0.30,
  defensiveRoleCoverage: 0.25,
  reboundingBalance: 0.05,
  sizeCoverage: 0.05,
} as const;

const ADDITIONAL_ROLE_CREDIT_FLOOR = 80;
const HARD_NON_SPACER_FLOOR = 30;
const FRONTCOURT_SPACING_FLOOR = 40;
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
  Helper: 85,
  'Mobile Big': 78,
  'Anchor Big': 50,
  'Low Activity': 20,
};

export interface FitScoreComponents {
  creationStructure: number;
  spacingCompatibility: number;
  defensiveRoleCoverage: number;
  reboundingBalance: number;
  sizeCoverage: number;
}

export interface FitScoreInputs {
  starterCount: number;
  onBallDemand: number;
  primaryCreationSignal: number;
  secondaryCreationSignal: number;
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
  defensiveWeakLinkPlayer: string | null;
  switchability: number;
  positionAdjustedReboundingPercentile: number;
  positionAdjustedHeightPercentile: number | null;
  positionAdjustedWeightPercentile: number | null;
  positionAdjustedAthleticismPercentile: number | null;
  functionalSizePercentile: number | null;
  additionalRoleCredits: string[];
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
    return Math.max(80, evidencedFit);
  }
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
  return Math.min(ADDITIONAL_ROLE_CREDIT_FLOOR, proposedScore);
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
        reboundingBalance: 0,
        sizeCoverage: 0,
      },
      inputs: {
        starterCount: starters.length,
        onBallDemand: 0,
        primaryCreationSignal: 0,
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
        defensiveWeakLinkPlayer: null,
        switchability: 0,
        positionAdjustedReboundingPercentile: 0,
        positionAdjustedHeightPercentile: null,
        positionAdjustedWeightPercentile: null,
        positionAdjustedAthleticismPercentile: null,
        functionalSizePercentile: null,
        additionalRoleCredits: [],
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

  const demandByPlayer = profiles.map((profile) => {
    const incumbent = HIGH_USAGE_ARCHETYPE_WEIGHT[profile.incumbentOffensiveRole] ?? 0;
    const proposed = profile.proposedOffensiveRoles
      .filter((fit) => fit.score >= ADDITIONAL_ROLE_CREDIT_FLOOR)
      .map((fit) => (HIGH_USAGE_ARCHETYPE_WEIGHT[fit.role] ?? 0) * (fit.score / 100));
    return Math.max(incumbent, ...proposed, 0);
  });
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
  const creationStructure = Math.round(
    primaryCreationScore * 0.40 +
      demandBalance(onBallDemand, primaryCreationSignal) * 0.30 +
      secondaryCreationScore * 0.15 +
      clamp((offBallComplementCount / 3) * 100) * 0.15,
  );
  if (primaryCreationSignal < 50) notes.push('No credible primary creation role in the starting five.');
  if (onBallDemand > 2.5) notes.push(`On-ball demand is crowded (${onBallDemand.toFixed(2)} weighted roles).`);

  const hardNonSpacerCount = starters.filter((player) => computeSpacing(player) < HARD_NON_SPACER_FLOOR).length;
  const plusShooterCount = starters.filter(isPlusShooter).length;
  const rimGravityScorerCount = starters.filter(isRimGravityScorer).length;
  const hasShootingAnomaly = starters.some(isShootingAnomalyPlayer);
  const frontcourt = starterEntries.filter((entry) => entry.slot === 'PF' || entry.slot === 'C').map((entry) => entry.player);
  const frontcourtNonSpacerCount = frontcourt.filter((player) => computeSpacing(player) < FRONTCOURT_SPACING_FLOOR).length;
  const spacingCompatibility = Math.round(
    geometryScore(hardNonSpacerCount) * 0.45 +
      rimSupportScore(rimGravityScorerCount, plusShooterCount, hasShootingAnomaly) * 0.35 +
      frontcourtGeometryScore(frontcourtNonSpacerCount) * 0.20,
  );
  if (hardNonSpacerCount >= 2) notes.push(`${hardNonSpacerCount} hard non-spacers compress the starting lineup.`);
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
      defensiveRoleScore(profile, ['Helper']) * 0.65,
    ),
  })).sort((a, b) => b.score - a.score || Number(b.confirmed) - Number(a.confirmed));
  const rimCandidates = profiles.map((profile, index) => ({
    player: starters[index],
    confirmed: profile.incumbentDefensiveRole === 'Anchor Big' || profile.incumbentDefensiveRole === 'Mobile Big',
    score: defensiveRoleScore(profile, ['Anchor Big', 'Mobile Big']),
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
  const defensiveRoleCoverage = Math.round(layerCoverage * 0.75 + defensiveWeakLinkResistance * 0.25);
  if (guardContainment < 45) notes.push('No reliable point-of-attack containment role.');
  if (wingCoverage < 45) notes.push('No reliable wing coverage role.');
  if (wingCoverage > 0 && !wingCandidates[0]?.confirmed) notes.push('Wing coverage is inferred from box activity, not a confirmed incumbent Wing Stopper role.');
  if (rimProtection < 45) notes.push('No reliable rim-protection role.');
  if (defensiveWeakLinkResistance < 50 && weakLinkCandidates[0]) {
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
    { value: SWITCHABILITY_ROLE_SCORE[player.defensiveRole], weight: 0.40 },
    { value: positionVersatilityScore(player), weight: 0.30 },
    { value: physicalProfiles[index].athleticism, weight: 0.20 },
    { value: physicalProfiles[index].functional, weight: 0.10 },
  ]) ?? 0);
  // A switching scheme is limited by both the lineup's general versatility and its least
  // switchable starter. This is starter-only and diagnostic; full-rotation D-TAL huntability
  // remains a separate production penalty rather than being relabeled as the same concept.
  const switchability = Math.round(mean(individualSwitchability) * 0.75 + Math.min(...individualSwitchability) * 0.25);
  if (reboundingBalance < 35) notes.push('The starting five is weak on the glass relative to its assigned positions.');
  if (sizeCoverage < 35) notes.push('The starting five lacks functional size relative to its assigned positions.');

  const components: FitScoreComponents = {
    creationStructure,
    spacingCompatibility,
    defensiveRoleCoverage,
    reboundingBalance,
    sizeCoverage,
  };
  const score = Math.round(
    components.creationStructure * FIT_WEIGHTS.creationStructure +
      components.spacingCompatibility * FIT_WEIGHTS.spacingCompatibility +
      components.defensiveRoleCoverage * FIT_WEIGHTS.defensiveRoleCoverage +
      components.reboundingBalance * FIT_WEIGHTS.reboundingBalance +
      components.sizeCoverage * FIT_WEIGHTS.sizeCoverage,
  );

  return {
    version: 'fit-v2',
    score,
    components,
    inputs: {
      starterCount: starters.length,
      onBallDemand,
      primaryCreationSignal,
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
      defensiveWeakLinkPlayer: weakLinkCandidates[0]?.player.playerName ?? null,
      switchability,
      positionAdjustedReboundingPercentile,
      positionAdjustedHeightPercentile,
      positionAdjustedWeightPercentile,
      positionAdjustedAthleticismPercentile,
      functionalSizePercentile,
      additionalRoleCredits,
    },
    notes,
  };
}
