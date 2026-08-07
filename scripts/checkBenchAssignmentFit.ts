import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation } from '../src/engine/rotation';
import { isPositionEligible, STARTER_SLOTS } from '../src/engine/positions';

let totalBackupAssignments = 0;
let offPositionBackups = 0;
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

  for (const team of s.teams) {
    const { slots } = autoAssignRotation(team.roster);
    for (const slot of STARTER_SLOTS) {
      // index 0 is the primary; everything after is a backup assignment for this slot.
      for (const a of slots[slot].slice(1)) {
        const player = team.roster.find((p) => p.id === a.playerId)!;
        totalBackupAssignments++;
        if (!isPositionEligible(player, slot)) offPositionBackups++;
      }
    }
  }
}

console.log(`Total backup assignments checked: ${totalBackupAssignments}`);
console.log(`Off-position backup assignments: ${offPositionBackups} (${((offPositionBackups / totalBackupAssignments) * 100).toFixed(1)}%)`);
