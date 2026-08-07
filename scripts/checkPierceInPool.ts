import { draftPool } from '../src/data/draftPool';
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';

const key = normalizePlayerName('Paul Pierce');
console.log('In draftPool:');
for (const p of draftPool.filter((pp) => normalizePlayerName(pp.playerName) === key)) console.log(' ', p.spanLabel, p.primaryPosition);
console.log('In full players dataset:');
for (const p of players.filter((pp) => normalizePlayerName(pp.playerName) === key)) console.log(' ', p.spanLabel, p.primaryPosition);
