import type { DefensiveRole, PlayerSpan } from './schema';

/**
 * Curated secondary defensive jobs. The incumbent `defensiveRole` remains the primary label;
 * these are only credible secondary responsibilities, never a replacement for it. Values below
 * 1 deliberately preserve the difference between a player's best job and a matchup he can still
 * handle well enough to support a lineup.
 */
const CURATED_SECONDARY_ROLES: Record<string, Partial<Record<DefensiveRole, number>>> = {
  'Jrue Holiday': { 'Point of Attack': 0.92, Chaser: 0.86 },
  'LeBron James': { 'Wing Stopper': 0.90, 'Point of Attack': 0.76 },
  'Paul George': { 'Wing Stopper': 0.94, Chaser: 0.86, Helper: 0.84 },
  'Klay Thompson': { Chaser: 0.90, 'Wing Stopper': 0.86 },
  'Andre Iguodala': { 'Wing Stopper': 0.94, 'Point of Attack': 0.82, Helper: 0.86 },
  'Shawn Marion': { 'Wing Stopper': 0.94, Helper: 0.90 },
  'Draymond Green': { 'Mobile Big': 0.94, Helper: 0.94, 'Point of Attack': 0.74 },
  'Evan Mobley': { 'Anchor Big': 0.92, Helper: 0.86 },
};

/** Relative credibility of a player performing `role` beyond their primary defensive tag. */
export function secondaryDefensiveRoleStrength(player: PlayerSpan, role: DefensiveRole): number {
  if (player.defensiveRole === role) return 1;
  return CURATED_SECONDARY_ROLES[player.playerName]?.[role] ?? 0;
}
