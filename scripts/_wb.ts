import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { effectiveTalent } from '../src/engine/grades';
for (const p of draftPool.filter((x) => x.playerName === 'Victor Wembanyama' || (x.playerName === 'Hassan Whiteside' && x.spanLabel === '2014-16'))) console.log(p.playerName, p.spanLabel, 'raw', computeTalent(p), 'disp', Math.round(effectiveTalent(p)));
