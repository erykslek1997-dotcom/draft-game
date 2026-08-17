import { computeDefensiveTalent } from './defensiveTalent';
import { defensiveHuntability } from './defensiveHuntability';
import { allAssignments, primaryStarters } from './rotation';
import type { Team } from './types';
import type { DefensiveRole } from '../data/schema';

const WING_ROLES: DefensiveRole[] = ['Wing Stopper'];
const RIM_ROLES: DefensiveRole[] = ['Anchor Big', 'Mobile Big'];

const FULL_PROVIDER_MINUTES = 24;
const PROVIDER_START = 75;
const PROVIDER_FULL = 85;
const AVERAGE_START = 80;
const AVERAGE_FULL = 86;

/** Maximum extra separation reserved for a complete all-time defensive shell. */
export const MAX_ELITE_SHELL_DEFENSE_BONUS = 9;
/**
 * Maximum structural credit for fielding real POA + wing + rim providers even when the rest of
 * the rotation contains attackable players. This is deliberately separate from the elite-shell
 * ceiling: three excellent layers still matter, but they cannot erase weak-link minutes.
 */
export const MAX_THREE_LAYER_CORE_DEFENSE_BONUS = 12;
/** Only a small part of a partial core carries into the real-units DRTG projection. */
export const THREE_LAYER_CORE_DRTG_BLEND = 0.15;
/** All-time-roster extrapolation target for a complete no-weak-link defensive shell. */
export const ELITE_SHELL_DRTG_TARGET = 85;

export interface DefensiveCohesionResult {
  /** 0-100 completeness of a no-weak-link POA + wing + rim defensive shell. */
  eliteShell: number;
  /** Unrounded 0-1 value used when blending the ordinary-team projection toward its elite tier. */
  completeness: number;
  /** POA + wing + rim structure after a softer weak-link discount, before shell-quality gates. */
  threeLayerCore: number;
  /** Completeness used by DRTG: elite shell, or a tightly capped partial-core contribution. */
  drtgCompleteness: number;
  defenseScoreBonus: number;
  averageDefensiveTalent: number;
  poaProvider: string | null;
  wingProvider: string | null;
  rimProvider: string | null;
  poaStrength: number;
  wingStrength: number;
  rimStrength: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Measures the part an ordinary minutes-weighted D-TAL average cannot express: whether an
 * all-time rotation has a credible point-of-attack defender, primary wing stopper and rim
 * protector. A complete high-average, no-weak-link shell can reach the historical ceiling; a
 * rotation with those same three layers plus attackable players receives only bounded structural
 * credit. Incumbent roles only are accepted; box-only inferred shadow roles cannot unlock this
 * production bonus. A guard with an incumbent Wing Stopper role receives 90% POA transfer credit
 * — Harper/Jrue guarding the ball is a real role overlap, not an inferred box-score invention. A
 * 12-minute token specialist also cannot complete a layer — provider strength reaches full
 * availability at 24 assigned minutes.
 */
export function defensiveCohesion(team: Team): DefensiveCohesionResult {
  const assignments = allAssignments(team);
  if (assignments.length === 0) {
    return {
      eliteShell: 0,
      completeness: 0,
      threeLayerCore: 0,
      drtgCompleteness: 0,
      defenseScoreBonus: 0,
      averageDefensiveTalent: 0,
      poaProvider: null,
      wingProvider: null,
      rimProvider: null,
      poaStrength: 0,
      wingStrength: 0,
      rimStrength: 0,
    };
  }

  const minutesByPlayer = new Map<string, number>();
  for (const { player, minutes } of assignments) {
    minutesByPlayer.set(player.id, (minutesByPlayer.get(player.id) ?? 0) + minutes);
  }
  const assignedPlayers = team.roster
    .map((player) => {
      const minutes = minutesByPlayer.get(player.id) ?? 0;
      const defensiveTalent = computeDefensiveTalent(player);
      return {
        player,
        minutes,
        defensiveTalent,
        providerStrength: defensiveTalent * Math.min(1, minutes / FULL_PROVIDER_MINUTES),
      };
    })
    .filter(({ minutes }) => minutes > 0);

  const starters = primaryStarters(team).map((entry) => entry.player);
  const averageDefensiveTalent = starters.length > 0
    ? starters.reduce((sum, player) => sum + computeDefensiveTalent(player), 0) / starters.length
    : 0;

  function bestProvider(roles: DefensiveRole[], multiplierFor: (role: DefensiveRole) => number = () => 1) {
    return assignedPlayers
      .filter(({ player }) => roles.includes(player.defensiveRole))
      .map((entry) => ({ ...entry, effectiveStrength: entry.providerStrength * multiplierFor(entry.player.defensiveRole) }))
      .sort((left, right) => right.effectiveStrength - left.effectiveStrength)[0] ?? null;
  }

  const poa = assignedPlayers
    .filter(({ player }) =>
      player.defensiveRole === 'Point of Attack' ||
      player.defensiveRole === 'Chaser' ||
      (player.defensiveRole === 'Wing Stopper' && (player.primaryPosition === 'PG' || player.primaryPosition === 'SG')),
    )
    .map((entry) => ({
      ...entry,
      effectiveStrength: entry.providerStrength * (entry.player.defensiveRole === 'Point of Attack' ? 1 : 0.9),
    }))
    .sort((left, right) => right.effectiveStrength - left.effectiveStrength)[0] ?? null;
  const wing = bestProvider(WING_ROLES);
  const rim = bestProvider(RIM_ROLES);
  const poaStrength = poa?.effectiveStrength ?? 0;
  const wingStrength = wing?.effectiveStrength ?? 0;
  const rimStrength = rim?.effectiveStrength ?? 0;
  const providerReadiness = clamp01(
    (Math.min(poaStrength, wingStrength, rimStrength) - PROVIDER_START) /
      (PROVIDER_FULL - PROVIDER_START),
  );
  const averageReadiness = clamp01(
    (averageDefensiveTalent - AVERAGE_START) / (AVERAGE_FULL - AVERAGE_START),
  );
  // Full-rotation huntability attenuates the starter shell continuously instead of acting as a
  // cliff. Bench targets still cost their real minutes in `defensiveHuntability`, but 18 minutes
  // of Charlie Ward cannot erase an otherwise elite five-man defensive structure altogether.
  const resistanceReadiness = defensiveHuntability(team).resistance / 100;
  const completeness = Math.min(providerReadiness, averageReadiness) * resistanceReadiness;
  // A low starter average used to zero the entire structural bonus. That made a roster with
  // Jordan at POA, Roberson on wings and Gobert/Mobley behind them score exactly like a roster
  // with no coherent defensive spine. Keep the full no-weak-link shell gate above, but retain a
  // bounded amount of credit for three genuinely strong layers. The 50% floor applies only to
  // the structural bonus; every weak minute is still charged in `defensiveHuntability`.
  const threeLayerCore = providerReadiness * (0.5 + resistanceReadiness * 0.5);
  const eliteShellBonus = completeness * MAX_ELITE_SHELL_DEFENSE_BONUS;
  const threeLayerCoreBonus = threeLayerCore * MAX_THREE_LAYER_CORE_DEFENSE_BONUS;
  const drtgCompleteness = Math.max(
    completeness,
    threeLayerCore * THREE_LAYER_CORE_DRTG_BLEND,
  );

  return {
    eliteShell: Math.round(completeness * 100),
    completeness,
    threeLayerCore,
    drtgCompleteness,
    defenseScoreBonus: Math.max(eliteShellBonus, threeLayerCoreBonus),
    averageDefensiveTalent,
    poaProvider: poa?.player.playerName ?? null,
    wingProvider: wing?.player.playerName ?? null,
    rimProvider: rim?.player.playerName ?? null,
    poaStrength,
    wingStrength,
    rimStrength,
  };
}
