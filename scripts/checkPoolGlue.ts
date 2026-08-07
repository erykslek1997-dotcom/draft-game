import { draftPool } from '../src/data/draftPool';
import { curatedPlayers } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import type { Position } from '../src/data/schema';

const poolNames = new Set(draftPool.map((p) => normalizePlayerName(p.playerName)));
const curatedNames = new Set(curatedPlayers.map((p) => normalizePlayerName(p.playerName)));
const missing = [...curatedNames].filter((n) => !poolNames.has(n));
console.log(`Curated players: ${curatedNames.size} | missing from pool: ${missing.length}`);
if (missing.length) console.log('MISSING:', missing.join(', '));

console.log('\n=== Cheap (<8 FGA) options by position, top 6 by talent each ===');
const ALL: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
for (const pos of ALL) {
  const cheap = draftPool
    .filter((p) => p.primaryPosition === pos && p.fga < 8)
    .sort((a, b) => computeTalent(b) - computeTalent(a));
  console.log(`\n${pos} — ${cheap.length} cheap spans available`);
  for (const p of cheap.slice(0, 6)) {
    console.log(`  ${p.playerName} (${p.spanLabel}) TAL=${computeTalent(p)} FGA=${p.fga} — ${p.offensiveArchetype} / ${p.defensiveRole}`);
  }
}
