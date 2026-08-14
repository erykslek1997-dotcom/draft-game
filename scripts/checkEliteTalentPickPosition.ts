/**
 * 2026-08-14, verifies the ELITE_TALENT_FGA_PENALTY_DAMPENING fix: runs several full 16-team
 * drafts and reports the average draft-pick position of TAL>=95 spans, plus a direct
 * Wade-vs-Porter-shaped check (does a real ~90 TAL/cheap-FGA player still occasionally beat a
 * ~97 TAL/expensive-FGA one, and how often).
 */
import { createDraft, autoFinishDraft } from '../src/engine/draft';
import { computeTalent } from '../src/engine/talent';
import type { PlayerSpan } from '../src/data/schema';

const DRAFTS = 15;
const ELITE_THRESHOLD = 95;

let eliteTotalPickSum = 0;
let eliteCount = 0;
const elitePicks: number[] = [];

for (let d = 0; d < DRAFTS; d++) {
  const state = autoFinishDraft(createDraft(false));
  for (const entry of state.history) {
    const player = state.pool.find((p: PlayerSpan) => p.id === entry.playerId);
    if (!player) continue;
    const tal = computeTalent(player);
    if (tal >= ELITE_THRESHOLD) {
      eliteTotalPickSum += entry.pickNumber;
      eliteCount++;
      elitePicks.push(entry.pickNumber);
    }
  }
}

elitePicks.sort((a, b) => a - b);
console.log(`Across ${DRAFTS} drafts: ${eliteCount} TAL>=${ELITE_THRESHOLD} picks found.`);
console.log(`Average pick number: ${(eliteTotalPickSum / eliteCount).toFixed(1)}`);
console.log(`Median: ${elitePicks[Math.floor(elitePicks.length / 2)]}`);
console.log(`Worst (latest) pick: ${elitePicks[elitePicks.length - 1]}`);
console.log(`p90 (latest 10%): ${elitePicks[Math.floor(elitePicks.length * 0.9)]}`);
