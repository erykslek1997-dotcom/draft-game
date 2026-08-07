import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import type { Position } from '../src/data/schema';

const uniqueNames = new Set(draftPool.map((p) => normalizePlayerName(p.playerName)));
console.log(`Unique players in pool: ${uniqueNames.size}`);
console.log(`Total span entries in pool: ${draftPool.length}`);

const byPosition = new Map<Position, Set<string>>();
for (const p of draftPool) {
  const key = normalizePlayerName(p.playerName);
  const set = byPosition.get(p.primaryPosition) ?? new Set();
  set.add(key);
  byPosition.set(p.primaryPosition, set);
}
for (const [pos, set] of byPosition.entries()) {
  console.log(`${pos}: ${set.size} unique players`);
}

const topByTalent = [...draftPool].sort((a, b) => computeTalent(b) - computeTalent(a)).slice(0, 15);
console.log('--- top 15 spans by talent ---');
for (const p of topByTalent) {
  console.log(`${p.playerName} (${p.spanLabel}) ${p.primaryPosition} - talent ${computeTalent(p)}`);
}

const spansPerPlayer = new Map<string, number>();
for (const p of draftPool) {
  const key = normalizePlayerName(p.playerName);
  spansPerPlayer.set(key, (spansPerPlayer.get(key) ?? 0) + 1);
}
const counts = [...spansPerPlayer.values()];
console.log(`Avg spans/player: ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(2)}`);
console.log(`Max spans for one player: ${Math.max(...counts)}`);
