import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { isPositionEligible } from '../src/engine/positions';
import type { Team } from '../src/engine/types';

let offPositionBenchCount = 0;
let totalBenchCount = 0;
const RUNS = 15;

for (let run = 0; run < RUNS; run++) {
  let s = createDraft();
  let guard = 0;
  while (!s.complete && guard < 100) {
    const teamIdx = currentTeamIndex(s);
    if (s.teams[teamIdx].isHuman) {
      const legal = players.filter((p) => !s.draftedIds.has(p.id) && isPickLegal(s, p.id)).sort((a, b) => computeTalent(b) - computeTalent(a));
      if (legal.length === 0) break;
      s = makePick(s, legal[0].id);
    } else {
      const next = resolveAiPickIfNeeded(s);
      if (!next) break;
      s = next;
    }
    guard++;
  }

  for (const t of s.teams) {
    const team: Team = { ...t, rotation: autoAssignRotation(t.roster) };
    const starterIds = new Set(primaryStarters(team).map((x) => x.player.id));
    const bench = team.roster.filter((p) => !starterIds.has(p.id));
    for (const b of bench) {
      totalBenchCount++;
      // A bench player counts as "reasonably placed" if they're eligible for at least one
      // starter slot on this specific roster's rotation (i.e. they could realistically back
      // someone up) — check against every starter slot's position.
      const anyFit = ['PG', 'SG', 'SF', 'PF', 'C'].some((slot) => isPositionEligible(b, slot as never));
      if (!anyFit) offPositionBenchCount++;
    }
  }
}

console.log(`Total bench players checked: ${totalBenchCount}`);
console.log(`Bench players with ZERO position eligibility anywhere: ${offPositionBenchCount} (${((offPositionBenchCount / totalBenchCount) * 100).toFixed(1)}%)`);
