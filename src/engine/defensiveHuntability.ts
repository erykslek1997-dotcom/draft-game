import { computeDefensiveTalent } from './defensiveTalent';
import { allAssignments, GAME_MINUTES } from './rotation';
import type { Team } from './types';

const TARGETABLE_DTAL_CEILING = 60;
const MAX_HUNTABILITY_PENALTY = 20;

export interface DefensiveHuntabilityOffender {
  playerId: string;
  playerName: string;
  minutes: number;
  defensiveTalent: number;
  shortfall: number;
}

export interface DefensiveHuntabilityResult {
  penalty: number;
  resistance: number;
  targetableMinutes: number;
  offenders: DefensiveHuntabilityOffender[];
}

/**
 * Nonlinear playoff weak-link signal. A minutes-weighted average can hide one or two defenders
 * behind an elite rim protector; opponents cannot. This counts the volume and severity of every
 * below-60 D-TAL stint, so two huntable perimeter players stack while a 10-minute bench weakness
 * remains much cheaper than a 36-minute starter.
 */
export function defensiveHuntability(team: Team): DefensiveHuntabilityResult {
  const minutesByPlayer = new Map<string, number>();
  for (const assignment of allAssignments(team)) {
    minutesByPlayer.set(assignment.player.id, (minutesByPlayer.get(assignment.player.id) ?? 0) + assignment.minutes);
  }
  const offenders = team.roster.flatMap((player) => {
    const minutes = minutesByPlayer.get(player.id) ?? 0;
    const defensiveTalent = computeDefensiveTalent(player);
    const shortfall = Math.max(0, TARGETABLE_DTAL_CEILING - defensiveTalent);
    return minutes > 0 && shortfall > 0
      ? [{ playerId: player.id, playerName: player.playerName, minutes, defensiveTalent, shortfall }]
      : [];
  }).sort((left, right) => right.shortfall * right.minutes - left.shortfall * left.minutes);
  const shortfallMinutes = offenders.reduce((sum, offender) => sum + offender.shortfall * offender.minutes, 0);
  const penalty = Math.min(
    MAX_HUNTABILITY_PENALTY,
    (shortfallMinutes / (TARGETABLE_DTAL_CEILING * GAME_MINUTES)) * MAX_HUNTABILITY_PENALTY,
  );
  return {
    penalty,
    resistance: Math.round(100 - (penalty / MAX_HUNTABILITY_PENALTY) * 100),
    targetableMinutes: offenders.reduce((sum, offender) => sum + offender.minutes, 0),
    offenders,
  };
}

/** Existing real-team regression shrinks one D-TAL point by 0.277 DRTG. Using 0.20 here keeps
 * the nonlinear playoff adjustment smaller than that validated linear relationship. */
export const HUNTABILITY_DRTG_POINTS_PER_PENALTY = 0.20;
