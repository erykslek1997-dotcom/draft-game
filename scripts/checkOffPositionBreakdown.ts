import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { positionFitMultiplier } from '../src/engine/positions';

const RUNS = 20;
let totalStarters = 0;
const bySlot: Record<string, { total: number; offPos: number }> = {};
const byPlayerPos: Record<string, number> = {}; // off-position player's OWN primary position, tallied
const bySlotAndPlayerPos: Record<string, number> = {}; // e.g. "PF<-C" meaning a C plugged into PF slot

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
    const starters = primaryStarters({ ...t, rotation });
    for (const { slot, player } of starters) {
      totalStarters++;
      bySlot[slot] = bySlot[slot] ?? { total: 0, offPos: 0 };
      bySlot[slot].total++;
      if (positionFitMultiplier(player, slot) < 0.9) {
        bySlot[slot].offPos++;
        byPlayerPos[player.primaryPosition] = (byPlayerPos[player.primaryPosition] ?? 0) + 1;
        const key = `${slot}<-${player.primaryPosition}`;
        bySlotAndPlayerPos[key] = (bySlotAndPlayerPos[key] ?? 0) + 1;
      }
    }
  }
}

console.log(`Total starters: ${totalStarters}\n`);
console.log('Off-position rate by SLOT (which slot is being filled off-position):');
for (const [slot, { total, offPos }] of Object.entries(bySlot)) {
  console.log(`  ${slot}: ${offPos}/${total} (${((offPos / total) * 100).toFixed(1)}%)`);
}
console.log('\nOff-position starters by the PLAYER\'s own primary position (who is being misplaced):');
for (const [pos, count] of Object.entries(byPlayerPos).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pos}: ${count}`);
}
console.log('\nDetailed slot<-playerPos breakdown (sorted by frequency):');
for (const [key, count] of Object.entries(bySlotAndPlayerPos).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key}: ${count}`);
}
