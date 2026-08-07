import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { isPositionEligible, STARTER_SLOTS } from '../src/engine/positions';

const RUNS = 15;
let slotChecks = 0;
let understaffedSlots = 0; // fewer than 2 total eligible players on the roster for this slot

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
    for (const slot of STARTER_SLOTS) {
      slotChecks++;
      const eligibleCount = team.roster.filter((p) => isPositionEligible(p, slot)).length;
      if (eligibleCount < 2) understaffedSlots++;
    }
  }
}

console.log(`Slots checked: ${slotChecks}`);
console.log(`Slots with fewer than 2 eligible roster players (structurally can't avoid an off-position backup): ${understaffedSlots} (${((understaffedSlots / slotChecks) * 100).toFixed(1)}%)`);
