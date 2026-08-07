import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick } from '../src/engine/draft';
import { computeTalent } from '../src/engine/talent';
import { draftPool as players } from '../src/data/draftPool';

console.log('Total players in pool:', players.length, '| unique:', new Set(players.map((p) => p.playerName)).size);

let s = createDraft();
let guard = 0;
while (!s.complete && guard < 100) {
  const teamIdx = currentTeamIndex(s);
  if (s.teams[teamIdx].isHuman) {
    // human auto-picks highest talent legal option for this smoke test
    const { isPickLegal } = await import('../src/engine/draft');
    const legal = players.filter((p) => !s.draftedIds.has(p.id) && isPickLegal(s, p.id)).sort((a, b) => computeTalent(b) - computeTalent(a));
    if (legal.length === 0) break;
    s = makePick(s, legal[0].id);
  } else {
    const next = resolveAiPickIfNeeded(s);
    if (!next) break;
    s = next;
  }
  guard++;
}

console.log('Draft complete:', s.complete, '| picks made:', s.history.length);
for (const team of s.teams) {
  const talents = team.roster.map(computeTalent).sort((a, b) => b - a);
  const totalFga = team.roster.reduce((sum, p) => sum + p.fga, 0);
  console.log(`\n${team.name}: FGA=${totalFga.toFixed(1)} talents=[${talents.join(', ')}]`);
  for (const p of team.roster) {
    console.log(`  ${p.playerName} (${p.spanLabel}) TAL=${computeTalent(p)} FGA=${p.fga}`);
  }
}
