// Structural check: with a fixed 9-man roster across 5 starter slots, how often does a team end
// up with only 1 real-fit player at some position (making a real backup mathematically
// impossible on that specific roster, regardless of how the AI drafts)?
import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { STARTER_SLOTS, isRealPositionFit } from '../src/engine/positions';

const RUNS = 20;
let totalTeams = 0;
const soloPositionCounts: number[] = []; // per team: how many of the 5 slots have exactly 1 real fit

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
    totalTeams++;
    let soloCount = 0;
    for (const slot of STARTER_SLOTS) {
      const realFits = t.roster.filter((p) => isRealPositionFit(p, slot)).length;
      if (realFits <= 1) soloCount++;
    }
    soloPositionCounts.push(soloCount);
  }
}

const dist: Record<number, number> = {};
for (const c of soloPositionCounts) dist[c] = (dist[c] ?? 0) + 1;
console.log(`Total teams: ${totalTeams}`);
console.log('Distribution of "positions with <=1 real fit" per team:');
for (let i = 0; i <= 5; i++) {
  console.log(`  ${i} solo positions: ${dist[i] ?? 0} teams (${(((dist[i] ?? 0) / totalTeams) * 100).toFixed(1)}%)`);
}
const teamsWithAnySolo = soloPositionCounts.filter((c) => c > 0).length;
console.log(`Teams with AT LEAST 1 solo position: ${teamsWithAnySolo}/${totalTeams} (${((teamsWithAnySolo / totalTeams) * 100).toFixed(1)}%)`);
