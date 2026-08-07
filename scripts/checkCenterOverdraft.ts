import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';

const RUNS = 20;
const draftedByPos: Record<string, number> = {};
let totalPicks = 0;

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
    for (const p of t.roster) {
      draftedByPos[p.primaryPosition] = (draftedByPos[p.primaryPosition] ?? 0) + 1;
      totalPicks++;
    }
  }
}

console.log(`Total picks across ${RUNS} runs: ${totalPicks} (avg per run: ${(totalPicks / RUNS).toFixed(1)}, expect 144)`);
console.log('Drafted-player count by primaryPosition (all 9 roster spots, not just starters):');
for (const [pos, count] of Object.entries(draftedByPos).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pos}: ${count}  (avg ${(count / RUNS).toFixed(1)}/run, ${((count / totalPicks) * 100).toFixed(1)}%)`);
}
console.log('\nFor reference, an even split across 16 teams x 9 slots = 5 starters + 4 bench would be 144/5 ~ 28.8/position if perfectly even, but starters alone need exactly 16 per position (one per team).');
