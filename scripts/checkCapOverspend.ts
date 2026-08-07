import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { CAP_LIMIT } from '../src/engine/positions';

const RUNS = 30;
let overCapTeamCount = 0;
let totalTeamCount = 0;
let maxOverage = 0;
let stuckDrafts = 0;
const overageSamples: number[] = [];

for (let run = 0; run < RUNS; run++) {
  let s = createDraft();
  let guard = 0;
  while (!s.complete && guard < 200) {
    const teamIdx = currentTeamIndex(s);
    const team = s.teams[teamIdx];
    let pick;
    if (team.isHuman) {
      const legal = players.filter((p) => !s.draftedIds.has(p.id) && isPickLegal(s, p.id)).sort((a, b) => computeTalent(b) - computeTalent(a));
      if (legal.length === 0) break;
      pick = legal[0];
      s = makePick(s, pick.id);
    } else {
      const next = resolveAiPickIfNeeded(s);
      if (!next) {
        stuckDrafts++;
        break;
      }
      s = next;
    }
    guard++;
  }
  if (guard >= 200) stuckDrafts++;

  for (const team of s.teams) {
    totalTeamCount++;
    const totalFga = team.roster.reduce((sum, p) => sum + p.fga, 0);
    const overage = totalFga - CAP_LIMIT;
    if (overage > 0) {
      overCapTeamCount++;
      overageSamples.push(overage);
      maxOverage = Math.max(maxOverage, overage);
    }
  }
}

console.log(`Runs: ${RUNS} | stuck/incomplete drafts: ${stuckDrafts}`);
console.log(`Teams over cap: ${overCapTeamCount} / ${totalTeamCount} (${((overCapTeamCount / totalTeamCount) * 100).toFixed(0)}%)`);
console.log(`Max overage: ${maxOverage.toFixed(1)} FGA`);
console.log(`Mean overage (when over): ${(overageSamples.reduce((a, b) => a + b, 0) / (overageSamples.length || 1)).toFixed(1)} FGA`);
