import type { PlayerSpan } from '../data/schema';
import { effectiveTalent } from './grades';
import { autoAssignRotation } from './rotation';
import { scoreTeam } from './scoring';
import { optimizeSpans, spanOptionsFor } from './spanOptimizer';
import type { Rotation, Team } from './types';
import { cheapestGlueWindows, structuredRotation } from './structuredRoster';
import { STRUCTURED_AI } from './structuredMode';

/** A CPU team's rotation: the structured 8-man rotation (`structuredMode.ts`), or the classic one. */
export function aiRotation(roster: PlayerSpan[]): Rotation {
  return STRUCTURED_AI ? structuredRotation(roster) : autoAssignRotation(roster);
}

/**
 * An AI team's roster after the draft: `optimizeSpans` re-picks each player's window under the cap,
 * kept only when the team scores better for it. 2026-11-04: the optimizer maximises minute-weighted
 * TAL, not the team score, and on 160 all-AI teams it cost 0.4-0.5 Overall (80.17 -> 79.77).
 *
 * Then a local search on the team score itself (`WINDOW_SEARCH`): each player in turn tries his
 * other windows at his drafted position (no more than `maxDrop` TAL under his best), keeping any
 * that raises the score within the cap. A team score costs ~5 ms now, so a pass is under a second.
 */
export const WINDOW_SEARCH = { passes: 2, maxDrop: 6 };

export function finalizeAiRoster(team: Team, capLimit: number): PlayerSpan[] {
  // Structured: the windows drafted are the plan's; only the glue moves to his cheapest window.
  if (STRUCTURED_AI) return cheapestGlueWindows(team.roster);
  const score = (roster: PlayerSpan[]) => scoreTeam({ ...team, roster, rotation: autoAssignRotation(roster) }).overallExact;
  const optimized = optimizeSpans(team.roster, capLimit);
  let roster = team.roster;
  let best = score(roster);
  if (!optimized.every((p, i) => p.id === team.roster[i]?.id)) {
    const after = score(optimized);
    if (after > best) {
      roster = optimized;
      best = after;
    }
  }
  const options = roster.map((p) => {
    const all = spanOptionsFor(p.playerName).filter((o) => o.primaryPosition === team.roster.find((d) => d.playerName === p.playerName)?.primaryPosition);
    const top = Math.max(...all.map(effectiveTalent), effectiveTalent(p));
    return all.filter((o) => effectiveTalent(o) >= top - WINDOW_SEARCH.maxDrop);
  });
  for (let pass = 0; pass < WINDOW_SEARCH.passes; pass++) {
    let improved = false;
    for (let i = 0; i < roster.length; i++) {
      const others = roster.reduce((sum, p, j) => (j === i ? sum : sum + p.fga), 0);
      for (const option of options[i]) {
        if (option.id === roster[i].id || others + option.fga > capLimit + 1e-9) continue;
        const next = roster.map((p, j) => (j === i ? option : p));
        const value = score(next);
        if (value > best + 1e-6) {
          roster = next;
          best = value;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return roster;
}
