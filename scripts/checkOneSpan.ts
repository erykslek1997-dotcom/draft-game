import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';

const span = draftPool.find((p) => p.playerName === 'Ben Wallace' && p.spanLabel === '2010-12');
console.log(span);
if (span) console.log('talent:', computeTalent(span));
