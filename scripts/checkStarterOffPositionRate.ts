// Direct measure of the exact thing feedback_1.json complained about repeatedly: a STARTER
// (bestPrimaryAssignment's pick) landing on a generic ±1-distance fallback fit (multiplier
// 0.75, i.e. "positionFitMultiplier < 0.9") rather than their real primary/secondary position.
// Run before and after the assessNeeds isRealPositionFit fix to see the actual before/after delta.
import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { positionFitMultiplier } from '../src/engine/positions';

const RUNS = 15;
let totalStarters = 0;
let offPositionStarters = 0;
let teamsWithAnyOffPositionStarter = 0;
let totalTeams = 0;

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
    const rotation = autoAssignRotation(t.roster);
    const starters = primaryStarters({ ...t, rotation });
    let teamHasOffPosition = false;
    for (const { slot, player } of starters) {
      totalStarters++;
      if (positionFitMultiplier(player, slot) < 0.9) {
        offPositionStarters++;
        teamHasOffPosition = true;
      }
    }
    if (teamHasOffPosition) teamsWithAnyOffPositionStarter++;
  }
}

console.log(`Total starters checked: ${totalStarters}`);
console.log(`Off-position starters (generic ±1 fallback, multiplier<0.9): ${offPositionStarters} (${((offPositionStarters / totalStarters) * 100).toFixed(1)}%)`);
console.log(`Teams with >=1 off-position starter: ${teamsWithAnyOffPositionStarter}/${totalTeams} (${((teamsWithAnyOffPositionStarter / totalTeams) * 100).toFixed(1)}%)`);
