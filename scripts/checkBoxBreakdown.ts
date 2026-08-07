import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';

for (const { name, span } of [
  { name: 'Bob McAdoo', span: '1973-75' },
  { name: 'Clyde Drexler', span: '1988-90' },
  { name: 'Terry Porter', span: '1989-91' },
  { name: 'Chris Paul', span: '2008-10' },
]) {
  const key = normalizePlayerName(name);
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span)!;
  console.log(`\n${name} ${span}:`);
  console.log(`  TAL=${computeTalent(p)} OTAL=${computeOffensiveTalent(p)} DTAL=${computeDefensiveTalent(p)}`);
  console.log(`  primaryPosition=${p.primaryPosition} secondary=${JSON.stringify(p.secondaryPositions)} archetype=${p.offensiveArchetype} defRole=${p.defensiveRole}`);
  console.log(`  FGA=${p.fga} box=${JSON.stringify(p.box)}`);
}
