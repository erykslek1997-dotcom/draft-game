// User's diagnosis: too much of the 100.9 FGA cap goes to the 5 starters, leaving too little
// room for the 4 bench slots, forcing near-zero-FGA "cap glue" bench picks regardless of fit.
// Measures the real starters-vs-bench FGA split across simulated AI drafts.
import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, primaryStarters, benchWithMinutes } from '../src/engine/rotation';
import { CAP_LIMIT } from '../src/engine/positions';
import type { Team } from '../src/engine/types';

const RUNS = 15;
const starterFgaShares: number[] = [];
const benchFgaTotals: number[] = [];
const benchAvgFgaPerPlayer: number[] = [];
const totalTeamFga: number[] = [];
const capUnspent: number[] = [];
const cheapestBenchFga: number[] = [];

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
    if (t.isHuman) continue; // human has no cap, not relevant to this AI-side diagnosis
    const rotation = autoAssignRotation(t.roster);
    const team: Team = { ...t, rotation };
    const starters = primaryStarters(team);
    const bench = benchWithMinutes(team);
    const starterFga = starters.reduce((sum, s2) => sum + s2.player.fga, 0);
    const benchFga = bench.reduce((sum, b) => sum + b.player.fga, 0);
    const totalFga = starterFga + benchFga;
    starterFgaShares.push(starterFga / totalFga);
    benchFgaTotals.push(benchFga);
    benchAvgFgaPerPlayer.push(benchFga / bench.length);
    totalTeamFga.push(totalFga);
    capUnspent.push(CAP_LIMIT - totalFga);
    cheapestBenchFga.push(Math.min(...bench.map((b) => b.player.fga)));
  }
}

function stats(arr: number[]) {
  const sorted = [...arr].sort((a, b) => a - b);
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  return { avg, median, min: sorted[0], max: sorted[sorted.length - 1] };
}

console.log(`Teams checked: ${starterFgaShares.length}`);
console.log(`Cap limit: ${CAP_LIMIT}`);
console.log('Starter FGA share of total roster FGA:', stats(starterFgaShares));
console.log('Bench total FGA (4 players combined):', stats(benchFgaTotals));
console.log('Bench avg FGA per player:', stats(benchAvgFgaPerPlayer));
console.log('Total team FGA (spent):', stats(totalTeamFga));
console.log('Cap left UNSPENT at end of draft:', stats(capUnspent));
console.log('Cheapest single bench player (FGA) per team:', stats(cheapestBenchFga));
