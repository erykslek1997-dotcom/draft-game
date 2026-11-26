import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { effectiveTalent, tierContextFor } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
for (const p of draftPool.filter((x) => x.playerName === 'Hassan Whiteside')) {
  const c = tierContextFor(p);
  console.log(p.spanLabel, 'raw', computeTalent(p), 'disp', Math.round(effectiveTalent(p)), 'O', computeOffensiveTalent(p), 'D', computeDefensiveTalent(p), 'rpg', p.box.rpg, 'bpg', p.box.bpg, 'min', c.minutes?.toFixed(1));
}
