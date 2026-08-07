// Direct measure of the exact bug reported in feedback2.json (a center playing SF — 2 positions
// away): counts backup assignments where positionDistance(player.primaryPosition, slot) >= 2,
// which should only ever be reachable via rotation.ts's true last-resort tier now.
import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, allAssignments } from '../src/engine/rotation';
import { positionDistance } from '../src/engine/positions';
import type { Team } from '../src/engine/types';

const RUNS = 30;
let totalAssignments = 0;
let farOffPosition = 0;
let oneAwayOffPosition = 0;

for (let run = 0; run < RUNS; run++) {
  let s = createDraft();
  let guard = 0;
  while (!s.complete && guard < 200) {
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
    const rotation = autoAssignRotation(t.roster);
    const team: Team = { ...t, rotation };
    const assignments = allAssignments(team);
    for (const { slot, player } of assignments) {
      totalAssignments++;
      const dist = positionDistance(player.primaryPosition, slot);
      if (dist >= 2) farOffPosition++;
      else if (dist === 1) oneAwayOffPosition++;
    }
  }
}

console.log(`Total assignments checked: ${totalAssignments}`);
console.log(`2+ positions away (e.g. C at SF): ${farOffPosition} (${((farOffPosition / totalAssignments) * 100).toFixed(2)}%)`);
console.log(`1 position away (e.g. C at PF): ${oneAwayOffPosition} (${((oneAwayOffPosition / totalAssignments) * 100).toFixed(2)}%)`);
