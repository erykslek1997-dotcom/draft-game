/**
 * Bakes `src/data/teamStyleQuantiles.json` — the per-feature distribution `historicalComps.ts`
 * reads its percentiles from. 12 seeded full AI drafts (192 rosters, auto rotations), 21 knots
 * (every 5th percentile). Re-run after a scoring change moves the feature scales:
 *   npx tsx scripts/buildTeamStyleQuantiles.ts
 */
import { writeFileSync } from 'node:fs';
import { autoFinishDraft, createDraft } from '../src/engine/draft';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { fitScore } from '../src/engine/fit';
import { STYLE_FEATURES, teamStyleFeatures, type StyleFeature } from '../src/engine/historicalComps';

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

const values = Object.fromEntries(STYLE_FEATURES.map((f) => [f, [] as number[]])) as Record<StyleFeature, number[]>;
const originalRandom = Math.random;
for (let seed = 7001; seed <= 7012; seed++) {
  Math.random = seededRandom(seed);
  const state = autoFinishDraft(createDraft(false));
  for (const drafted of state.teams) {
    const team = { ...drafted, rotation: drafted.rotation ?? autoAssignRotation(drafted.roster) };
    const features = teamStyleFeatures(team, scoreTeam(team), fitScore(team));
    for (const f of STYLE_FEATURES) values[f].push(features[f]);
  }
}
Math.random = originalRandom;

const out = Object.fromEntries(STYLE_FEATURES.map((f) => {
  const sorted = [...values[f]].sort((a, b) => a - b);
  return [f, Array.from({ length: 21 }, (_, i) => Math.round(sorted[Math.min(sorted.length - 1, Math.round((i / 20) * (sorted.length - 1)))] * 10) / 10)];
}));
writeFileSync(new URL('../src/data/teamStyleQuantiles.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`teamStyleQuantiles.json: ${values.offense.length} rosters`);
for (const f of STYLE_FEATURES) console.log(`  ${f}: ${out[f].join(' ')}`);
