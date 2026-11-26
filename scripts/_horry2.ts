import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeTalent, computeOffensiveTalent } from '../src/engine/talent';
import { effectiveTalent } from '../src/engine/grades';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { apbrRapmForSpan } from '../src/engine/apbrRapmLookup';
for (const p of draftPool.filter((x) => x.playerName === 'Robert Horry')) { const r = apbrRapmForSpan(p); console.log(p.spanLabel, 'raw', computeTalent(p), 'disp', Math.round(effectiveTalent(p)), 'O', computeOffensiveTalent(p), 'D', computeDefensiveTalent(p), 'ppg', p.box.ppg, 'fga', (p as any).box.fga ?? '', 'RAPM', r ? r.net.toFixed(2) : '-'); }
