import { generatedPlayers } from '../src/data/generatedPlayers';
import { curatedExpandedSpans } from '../src/data/curatedExpandedSpans';
import { normalizePlayerName } from '../src/data/schema';

const key = normalizePlayerName('Paul Pierce');
console.log('In generatedPlayers:', generatedPlayers.filter((p) => normalizePlayerName(p.playerName) === key).map((p) => `${p.spanLabel}:${p.primaryPosition}`));
console.log('In curatedExpandedSpans:', curatedExpandedSpans.filter((p) => normalizePlayerName(p.playerName) === key).map((p) => `${p.spanLabel}:${p.primaryPosition}`));
