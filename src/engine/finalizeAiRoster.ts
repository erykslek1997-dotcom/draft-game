import type { PlayerSpan } from '../data/schema';
import { autoAssignRotation } from './rotation';
import { scoreTeam } from './scoring';
import { optimizeSpans } from './spanOptimizer';
import type { Team } from './types';

/**
 * An AI team's roster after the draft: `optimizeSpans` re-picks each player's window under the cap,
 * kept only when the team scores better for it. 2026-11-04: the optimizer maximises minute-weighted
 * TAL, not the team score, and on 160 all-AI teams it cost 0.4-0.5 Overall (80.17 -> 79.77).
 */
export function finalizeAiRoster(team: Team, capLimit: number): PlayerSpan[] {
  const optimized = optimizeSpans(team.roster, capLimit);
  if (optimized.every((p, i) => p.id === team.roster[i]?.id)) return team.roster;
  const before = scoreTeam({ ...team, rotation: autoAssignRotation(team.roster) }).overallExact;
  const after = scoreTeam({ ...team, roster: optimized, rotation: autoAssignRotation(optimized) }).overallExact;
  return after > before ? optimized : team.roster;
}
