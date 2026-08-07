import { players } from '../src/data/players';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { overallTierForSpan, displayTalentForSpan } from '../src/engine/grades';
import { normalizePlayerName } from '../src/data/schema';

const cases = [
  { name: 'John Stockton', span: '1994-96' },
  { name: 'Terry Porter', span: '1989-91' },
  { name: 'Clyde Drexler', span: '1988-90' },
  { name: 'James Harden', span: '2014-16' },
  { name: 'Julius Erving', span: '1981-83' },
  { name: 'Bobby Jones', span: '1976-78' },
];

for (const { name, span } of cases) {
  const key = normalizePlayerName(name);
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span)!;
  const ctx = {
    position: p.primaryPosition,
    tal: computeTalent(p),
    otal: computeOffensiveTalent(p),
    dtal: computeDefensiveTalent(p),
    fga: p.fga,
  };
  console.log(`${name.padEnd(16)} realTAL=${ctx.tal} displayedTAL=${displayTalentForSpan(ctx)} tier=${overallTierForSpan(ctx)}`);
}
