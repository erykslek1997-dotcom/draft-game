import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { normalizedDefenseForFit } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';

const key = normalizePlayerName('Paul Pierce');
for (const span of ['2001-03', '2002-04']) {
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span)!;
  const asSF = { ...p, primaryPosition: 'SF' as const };
  console.log(`${span}: as-is (${p.primaryPosition}) normalizedDefenseForFit=${normalizedDefenseForFit(p).toFixed(1)} TAL=${computeTalent(p)}`);
  console.log(`${span}: forced SF          normalizedDefenseForFit=${normalizedDefenseForFit(asSF).toFixed(1)} TAL=${computeTalent(asSF)}`);
}
