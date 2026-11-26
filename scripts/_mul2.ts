import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
const a = draftPool.find((x) => x.playerName === 'Chris Mullin' && x.spanLabel === '1996-98')!;
const b = draftPool.find((x) => x.playerName === 'OG Anunoby' && x.spanLabel === '2024-26')!;
console.log(process.env.TAL_DROP ?? 'none', 'Mullin', computeTalent(a), 'OG', computeTalent(b));
