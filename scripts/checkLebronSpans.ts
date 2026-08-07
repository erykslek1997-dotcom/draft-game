import { players } from '../src/data/players';
import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';

console.log('=== LeBron spans in full players.ts (curated + generated) ===');
const all = players.filter((p) => p.playerName === 'LeBron James').sort((a, b) => a.spanLabel.localeCompare(b.spanLabel));
for (const p of all) {
  console.log(
    `${p.spanLabel}  TAL=${computeTalent(p)}  FGA=${p.fga}  TS%=${(p.box.tsPct * 100).toFixed(1)}  PPG=${p.box.ppg}  APG=${p.box.apg}  archetype=${p.offensiveArchetype}  defRole=${p.defensiveRole}  inPool=${draftPool.some((d) => d.id === p.id)}`,
  );
}
