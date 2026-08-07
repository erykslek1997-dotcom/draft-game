import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';

const key = normalizePlayerName('Paul Pierce');
const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === '2001-03')!;
console.log('--- as-is ---');
console.log('TAL', computeTalent(p));
console.log('--- forced SF (new object, different id) ---');
const asSF = { ...p, id: p.id + '-forcedSF', primaryPosition: 'SF' as const };
console.log('TAL', computeTalent(asSF));
