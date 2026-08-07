import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';
import { RIM_PROTECTOR_ROLES } from '../src/data/schema';

// Best (peak) span per distinct player, to avoid double counting many spans of the same guy
const bestByPlayer = new Map<string, (typeof players)[number]>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const existing = bestByPlayer.get(key);
  if (!existing || computeTalent(p) > computeTalent(existing)) bestByPlayer.set(key, p);
}

const byPos: Record<string, number[]> = {};
for (const p of bestByPlayer.values()) {
  (byPos[p.primaryPosition] ??= []).push(computeTalent(p));
}
console.log('Peak-TAL distribution by primary position (distinct players):');
for (const [pos, vals] of Object.entries(byPos)) {
  vals.sort((a, b) => b - a);
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const top16avg = vals.slice(0, 16).reduce((s, v) => s + v, 0) / Math.min(16, vals.length);
  console.log(`  ${pos}: n=${vals.length}  avg=${avg.toFixed(1)}  top16avg=${top16avg.toFixed(1)}  max=${vals[0]}`);
}

// How many rim protectors are C vs PF
const rimByPos: Record<string, number> = {};
for (const p of bestByPlayer.values()) {
  if (RIM_PROTECTOR_ROLES.includes(p.defensiveRole)) {
    rimByPos[p.primaryPosition] = (rimByPos[p.primaryPosition] ?? 0) + 1;
  }
}
console.log('\nRim protector role count by primary position (distinct players, best span):', rimByPos);
