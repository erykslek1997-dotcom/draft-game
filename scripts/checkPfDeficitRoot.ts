import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { positionFitMultiplier, isRealPositionFit } from '../src/engine/positions';

const RUNS = 20;
let teamsWithPfOffPosition = 0;
let teamsWithZeroRealPfAnywhere = 0;
let teamsWithRealPfButNotStarting = 0;

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
    const pfStarter = starters.find((x) => x.slot === 'PF');
    if (!pfStarter) continue;
    if (positionFitMultiplier(pfStarter.player, 'PF') < 0.9) {
      teamsWithPfOffPosition++;
      const realPfCount = t.roster.filter((p) => isRealPositionFit(p, 'PF')).length;
      if (realPfCount === 0) {
        teamsWithZeroRealPfAnywhere++;
      } else {
        teamsWithRealPfButNotStarting++;
        console.log(`Run ${run}: team has ${realPfCount} real-PF-fit player(s) on roster but rotation still started ${pfStarter.player.playerName} (${pfStarter.player.primaryPosition}) at PF. Roster: ${t.roster.map(p => `${p.playerName}(${p.primaryPosition}${p.secondaryPositions.length ? '/' + p.secondaryPositions.join(',') : ''})`).join(', ')}`);
      }
    }
  }
}

console.log(`\nTeams with PF starter off-position: ${teamsWithPfOffPosition}`);
console.log(`  ...of which roster has ZERO real PF fit anywhere (genuine scarcity): ${teamsWithZeroRealPfAnywhere}`);
console.log(`  ...of which roster HAS a real PF fit but rotation didn't start them (assignment bug?): ${teamsWithRealPfButNotStarting}`);
