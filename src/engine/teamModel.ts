import type { PlayerTeamFeature } from './insights';
import type { FitScoreResult } from './fit';
import type { DefensiveHuntabilityResult } from './defensiveHuntability';

/**
 * Team Model v1 thresholds. This module is deliberately diagnostic-only: it translates real
 * rotation, FGA, role-fit and shooting signals into team-level evidence for the insight engine.
 * Nothing here is consumed by TAL, Overall, simulation or the AI drafter.
 */
export const TEAM_MODEL_THRESHOLDS = {
  movementShooting: 0.78,
  movementMinutes: 14,
  lowFga: 8,
  lowFgaMinutes: 16,
  lowFgaImpact: 65,
  deadSlotMinutes: 4,
  deadSlotFga: 4,
  playoffRotationMinutes: 12,
  robustPlayoffRotationPlayers: 8,
  highFgaStar: 20,
  eliteCreation: 82,
  eliteDefensiveCoverage: 0.82,
  exposedStarterMinutes: 24,
} as const;

export interface TeamModelExtension {
  movementShootingStrength: number;
  movementShooterMinutes: number;
  movementShooterNames: string[];
  frontcourtSpacingStrength: number;
  frontcourtSpacerCount: number;
  naturalBigStarterCount: number;
  nonlinearNonSpacerPenalty: number;

  defensiveCoverageCapacity: number;
  defensiveCoverageConfirmedLayers: number;
  switchabilityScore: number;
  huntabilityMitigationScore: number;
  huntabilityExposureScore: number;
  defensiveWeakLinkSeverity: number;
  targetableRotationNames: string[];
  targetableStarterNames: string[];
  mitigatedSpecialistNames: string[];

  playoffRotationDepthScore: number;
  meaningfulPlayoffPlayerCount: number;
  lowFgaImpactCount: number;
  lowFgaImpactPlayers: string[];
  deadRosterSlotCount: number;
  deadRosterSlotPlayers: string[];
  deadRosterSlotFga: number;
}

export interface TeamModelSource {
  players: PlayerTeamFeature[];
  starters: PlayerTeamFeature[];
  bench: PlayerTeamFeature[];
  fit: FitScoreResult;
  huntability: DefensiveHuntabilityResult;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mean = (values: number[]) => values.length > 0
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

/** The nonlinear shape from the supplied Team Model spec. */
export function nonSpacerPenalty(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 0.10;
  if (count === 2) return 0.35;
  return Math.min(1, 0.65 + 0.15 * (count - 3));
}

/**
 * Context can soften, but never erase, the geometry cost. At present the project has reliable
 * evidence for movement shooting and frontcourt shooting; it does not have lineup-level passing,
 * post-gravity or offensive-rebounding tracking, so those proposed modifiers remain unfilled.
 */
export function contextualNonSpacerPenalty(
  count: number,
  movementShootingStrength: number,
  frontcourtSpacingStrength: number,
): number {
  const base = nonSpacerPenalty(count);
  if (count < 2) return base;
  const movementRelief = movementShootingStrength >= TEAM_MODEL_THRESHOLDS.movementShooting ? 0.08 : 0;
  const frontcourtRelief = frontcourtSpacingStrength >= 0.60 ? 0.07 : 0;
  return clamp01(base - movementRelief - frontcourtRelief);
}

export function buildTeamModelExtension(source: TeamModelSource): TeamModelExtension {
  const { players, starters, fit, huntability } = source;
  const movementShooters = players
    .filter((player) =>
      player.minutes > 0 &&
      (player.movementShooting ?? 0) >= TEAM_MODEL_THRESHOLDS.movementShooting
    )
    .sort((left, right) =>
      (right.movementShooting ?? 0) - (left.movementShooting ?? 0) || right.minutes - left.minutes
    );
  const movementShootingStrength = movementShooters[0]?.movementShooting ?? 0;
  const movementShooterMinutes = movementShooters.reduce((sum, player) => sum + player.minutes, 0);

  const frontcourt = starters.filter((player) => player.starterSlot === 'PF' || player.starterSlot === 'C');
  const frontcourtSpacingStrength = mean(frontcourt.map((player) => player.spacingImpact ?? 0));
  const frontcourtSpacerCount = frontcourt.filter((player) => player.isSpacingArchetype).length;
  const naturalBigStarterCount = frontcourt.filter((player) =>
    player.primaryPosition === 'PF' || player.primaryPosition === 'C'
  ).length;
  const hardNonSpacers = fit.inputs.hardNonSpacerCount;

  // Only the three defensive layers and switchability already measured by FIT v2 are used here.
  // Help, post and screen-navigation defense remain absent rather than receiving guessed values.
  const poa = fit.inputs.guardContainment / 100;
  const wing = fit.inputs.wingCoverage / 100;
  const rim = fit.inputs.rimProtection / 100;
  const switchabilityScore = fit.inputs.switchability / 100;
  const defensiveCoverageCapacity = clamp01(
    0.30 * poa + 0.30 * wing + 0.30 * rim + 0.10 * switchabilityScore,
  );
  const defensiveCoverageConfirmedLayers = [
    fit.inputs.guardContainmentConfirmed,
    fit.inputs.wingCoverageConfirmed,
    fit.inputs.rimProtectionConfirmed,
  ].filter(Boolean).length;
  const layerConfidence = defensiveCoverageConfirmedLayers / 3;
  // Coverage can reduce a weak defender's exposure by at most 45%; it can never make the player
  // disappear. Confirmed incumbent roles earn more mitigation than box-only inferred coverage.
  const huntabilityMitigationScore = Math.min(
    0.45,
    defensiveCoverageCapacity * (0.20 + 0.25 * layerConfidence),
  );
  const defensiveWeakLinkSeverity = clamp01(huntability.penalty / 20);
  const huntabilityExposureScore = clamp01(
    defensiveWeakLinkSeverity * (1 - huntabilityMitigationScore),
  );

  const starterIds = new Set(starters.map((player) => player.playerId));
  const playerById = new Map(players.map((player) => [player.playerId, player]));
  const targetableStarterNames = huntability.offenders
    .filter((offender) =>
      starterIds.has(offender.playerId) &&
      offender.minutes >= TEAM_MODEL_THRESHOLDS.exposedStarterMinutes
    )
    .map((offender) => offender.playerName);
  const mitigatedSpecialistNames = huntability.offenders
    .filter((offender) => {
      const player = playerById.get(offender.playerId);
      if (!player || starterIds.has(offender.playerId)) return false;
      const specialistValue =
        (player.overallImpact ?? 0) >= 55 && (
          (player.movementShooting ?? 0) >= TEAM_MODEL_THRESHOLDS.movementShooting ||
          Boolean(player.isSpacingArchetype) ||
          (player.offensiveImpact ?? 0) >= 70
        );
      return offender.minutes >= 8 && offender.minutes <= 24 && specialistValue;
    })
    .map((offender) => offender.playerName);

  const meaningfulPlayers = players.filter(
    (player) => player.minutes >= TEAM_MODEL_THRESHOLDS.playoffRotationMinutes,
  );
  const lowFgaImpactPlayers = players
    .filter((player) =>
      player.fga <= TEAM_MODEL_THRESHOLDS.lowFga &&
      player.minutes >= TEAM_MODEL_THRESHOLDS.lowFgaMinutes &&
      (player.overallImpact ?? 0) >= TEAM_MODEL_THRESHOLDS.lowFgaImpact
    )
    .sort((left, right) => (right.overallImpact ?? 0) - (left.overallImpact ?? 0));
  const deadRosterSlots = players
    .filter((player) => player.minutes <= TEAM_MODEL_THRESHOLDS.deadSlotMinutes)
    .sort((left, right) => left.minutes - right.minutes || left.fga - right.fga);

  return {
    movementShootingStrength,
    movementShooterMinutes,
    movementShooterNames: movementShooters.map((player) => player.playerName),
    frontcourtSpacingStrength,
    frontcourtSpacerCount,
    naturalBigStarterCount,
    nonlinearNonSpacerPenalty: contextualNonSpacerPenalty(
      hardNonSpacers,
      movementShootingStrength,
      frontcourtSpacingStrength,
    ),

    defensiveCoverageCapacity,
    defensiveCoverageConfirmedLayers,
    switchabilityScore,
    huntabilityMitigationScore,
    huntabilityExposureScore,
    defensiveWeakLinkSeverity,
    targetableRotationNames: huntability.offenders.map((offender) => offender.playerName),
    targetableStarterNames,
    mitigatedSpecialistNames,

    playoffRotationDepthScore: clamp01(
      meaningfulPlayers.length / TEAM_MODEL_THRESHOLDS.robustPlayoffRotationPlayers,
    ),
    meaningfulPlayoffPlayerCount: meaningfulPlayers.length,
    lowFgaImpactCount: lowFgaImpactPlayers.length,
    lowFgaImpactPlayers: lowFgaImpactPlayers.map((player) => player.playerName),
    deadRosterSlotCount: deadRosterSlots.length,
    deadRosterSlotPlayers: deadRosterSlots.map((player) => player.playerName),
    deadRosterSlotFga: deadRosterSlots.reduce((sum, player) => sum + player.fga, 0),
  };
}
