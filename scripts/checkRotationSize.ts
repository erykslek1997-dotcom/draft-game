/**
 * 2026-08-14, user's own question: across real 16-team drafts, how many teams actually use all
 * 9 rostered players in the rotation (some real minutes each) vs. how many leave one or more
 * players at 0 minutes (an effective 8-man or shorter rotation)? Runs several full drafts (not
 * just one) for a stable read, since any single draft's answer could be luck of the pool.
 */
import { createDraft, autoFinishDraft } from '../src/engine/draft';
import { optimizeSpans } from '../src/engine/spanOptimizer';
import { CAP_LIMIT } from '../src/engine/positions';
import { autoAssignRotation, totalMinutesForPlayer } from '../src/engine/rotation';

const DRAFTS = 20;
const rotationSizeCounts = new Map<number, number>(); // rotationSize (players with >0 min) -> count of teams

for (let d = 0; d < DRAFTS; d++) {
  const state = autoFinishDraft(createDraft(false));
  for (const t of state.teams) {
    const roster = optimizeSpans(t.roster, CAP_LIMIT);
    const rotation = autoAssignRotation(roster);
    const playingCount = roster.filter((p) => totalMinutesForPlayer(rotation, p.id) > 0).length;
    rotationSizeCounts.set(playingCount, (rotationSizeCounts.get(playingCount) ?? 0) + 1);
  }
}

const totalTeams = DRAFTS * 16;
console.log(`Across ${DRAFTS} full 16-team drafts (${totalTeams} teams total):\n`);
const sizes = [...rotationSizeCounts.keys()].sort((a, b) => b - a);
for (const size of sizes) {
  const count = rotationSizeCounts.get(size)!;
  console.log(`${size}-man rotation: ${count} teams (${((count / totalTeams) * 100).toFixed(1)}%)`);
}
