import { draftPool } from '../src/data/draftPool';
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';

function cheapestPerPlayer(pool: typeof players) {
  const map = new Map<string, number>();
  for (const p of pool) {
    const key = normalizePlayerName(p.playerName);
    const cur = map.get(key);
    if (cur === undefined || p.fga < cur) map.set(key, p.fga);
  }
  return [...map.entries()].sort((a, b) => a[1] - b[1]);
}

for (const [label, pool] of [
  ['FULL', players],
  ['TRIMMED', draftPool],
] as const) {
  const sorted = cheapestPerPlayer(pool);
  const cheapest9 = sorted.slice(0, 9).reduce((s, [, fga]) => s + fga, 0);
  const cheapest36 = sorted.slice(0, 36).reduce((s, [, fga]) => s + fga, 0);
  console.log(`\n=== ${label} (${sorted.length} unique) ===`);
  console.log(`Cheapest 9 (one team's floor): ${cheapest9.toFixed(1)} FGA`);
  console.log(`Cheapest 36 (all 4 teams' floor): ${cheapest36.toFixed(1)} FGA vs 4x100.9 = 403.6`);
  console.log('Cheapest 12:', sorted.slice(0, 12).map(([n, f]) => `${n} ${f}`).join(', '));
  console.log(`Under 6 FGA: ${sorted.filter(([, f]) => f < 6).length} players`);
  console.log(`Under 10 FGA: ${sorted.filter(([, f]) => f < 10).length} players`);
}

// How good are the cheap options in the trimmed pool? A drafter needs real value there.
const cheapGood = draftPool
  .filter((p) => p.fga < 6)
  .sort((a, b) => computeTalent(b) - computeTalent(a))
  .slice(0, 12);
console.log('\n=== Best sub-6-FGA spans in trimmed pool ===');
for (const p of cheapGood) {
  console.log(`  ${p.playerName} (${p.spanLabel}) ${p.primaryPosition} TAL=${computeTalent(p)} FGA=${p.fga}`);
}
