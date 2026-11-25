import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeSpacing } from '../src/engine/spacing';
import { effectiveTalent } from '../src/engine/grades';
const out = draftPool.filter((p) => Number(p.spanLabel.slice(0, 4)) + 2 <= 1979 && effectiveTalent(p) >= 75).map((p) => `${p.playerName} ${p.spanLabel}|${computeSpacing(p)}|${effectiveTalent(p)}`);
console.log(out.join('\n'));
