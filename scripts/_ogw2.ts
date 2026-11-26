import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { effectiveTalent } from '../src/engine/grades';
for (const p of draftPool.filter((x) => x.playerName === 'OG Anunoby')) console.log(p.spanLabel, 'computeTalent', computeTalent(p), 'display', effectiveTalent(p));
