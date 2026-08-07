import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { positionFitMultiplier, isRealPositionFit, STARTER_SLOTS } from '../src/engine/positions';
import type { Position } from '../src/data/schema';

const RUNS = 30;
const stats: Record<Position, { offPosition: number; zeroRealFitAnywhere: number; realFitButNotStarted: number }> = {
  PG: { offPosition: 0, zeroRealFitAnywhere: 0, realFitButNotStarted: 0 },
  SG: { offPosition: 0, zeroRealFitAnywhere: 0, realFitButNotStarted: 0 },
  SF: { offPosition: 0, zeroRealFitAnywhere: 0, realFitButNotStarted: 0 },
  PF: { offPosition: 0, zeroRealFitAnywhere: 0, realFitButNotStarted: 0 },
  C: { offPosition: 0, zeroRealFitAnywhere: 0, realFitButNotStarted: 0 },
};
const bugExamples: Record<Position, string[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };

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
    for (const slot of STARTER_SLOTS) {
      const starter = starters.find((x) => x.slot === slot);
      if (!starter) continue;
      if (positionFitMultiplier(starter.player, slot) < 0.9) {
        stats[slot].offPosition++;
        const realFitCount = t.roster.filter((p) => isRealPositionFit(p, slot)).length;
        if (realFitCount === 0) {
          stats[slot].zeroRealFitAnywhere++;
        } else {
          stats[slot].realFitButNotStarted++;
          if (bugExamples[slot].length < 5) {
            bugExamples[slot].push(
              `${starter.player.playerName}(${starter.player.primaryPosition}) started at ${slot} despite ${realFitCount} real fit(s) on roster: ${t.roster.map(p => `${p.playerName}(${p.primaryPosition}${p.secondaryPositions.length ? '/' + p.secondaryPositions.join(',') : ''})`).join(', ')}`
            );
          }
        }
      }
    }
  }
}

console.log(`Across ${RUNS} runs, ${RUNS * 16} teams checked:\n`);
for (const slot of STARTER_SLOTS) {
  const s = stats[slot];
  console.log(`${slot}: off-position=${s.offPosition}  (zero-real-fit-anywhere=${s.zeroRealFitAnywhere}, real-fit-but-not-started=${s.realFitButNotStarted})`);
}
console.log('\n=== Examples of "real fit exists but not started" per slot ===');
for (const slot of STARTER_SLOTS) {
  if (bugExamples[slot].length === 0) continue;
  console.log(`\n--- ${slot} ---`);
  for (const ex of bugExamples[slot]) console.log('  ' + ex);
}
