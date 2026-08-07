import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';

const key = normalizePlayerName('Paul Pierce');
for (const span of ['2000-02', '2001-03', '2002-04', '2003-05']) {
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span)!;
  console.log(`=== ${span} => TAL ${computeTalent(p)} ===`);
}
