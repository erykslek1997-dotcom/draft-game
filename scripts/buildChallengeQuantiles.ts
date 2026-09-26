/**
 * Bakes `src/data/challengeQuantiles.json` — the per-metric percentiles (0..100) that
 * `historicalChallenges.ts` resolves its "top X%" conditions against. 12 seeded full AI drafts
 * (192 rosters, auto rotations). Re-run after a scoring change moves any metric's scale:
 *   npx tsx scripts/buildChallengeQuantiles.ts
 */
import { writeFileSync } from 'node:fs';
import { autoFinishDraft, createDraft } from '../src/engine/draft';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { fitScore } from '../src/engine/fit';
import { seasonProfile } from '../src/engine/seasonProfile';
import { CHALLENGE_METRICS, challengeMetrics, type ChallengeMetric } from '../src/engine/historicalChallenges';

function seededRandom(seed: number) {
  let v = seed >>> 0;
  return () => {
    v += 0x6d2b79f5;
    let t = v;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const values = Object.fromEntries(CHALLENGE_METRICS.map((m) => [m, [] as number[]])) as Record<ChallengeMetric, number[]>;
const originalRandom = Math.random;
for (let seed = 7001; seed <= 7012; seed++) {
  Math.random = seededRandom(seed);
  const state = autoFinishDraft(createDraft(false));
  for (const drafted of state.teams) {
    const team = { ...drafted, rotation: drafted.rotation ?? autoAssignRotation(drafted.roster) };
    const breakdown = scoreTeam(team);
    const fit = fitScore(team);
    const metrics = challengeMetrics(team, breakdown, fit, seasonProfile(breakdown, fit));
    for (const m of CHALLENGE_METRICS) values[m].push(metrics[m]);
  }
}
Math.random = originalRandom;

const out = Object.fromEntries(CHALLENGE_METRICS.map((m) => {
  const sorted = [...values[m]].sort((a, b) => a - b);
  return [m, Array.from({ length: 101 }, (_, p) => Math.round(sorted[Math.round((p / 100) * (sorted.length - 1))] * 10) / 10)];
}));
writeFileSync(new URL('../src/data/challengeQuantiles.json', import.meta.url), JSON.stringify(out) + '\n');
process.stdout.write(`challengeQuantiles.json: ${values.offense.length} rosters\n`);
