import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { computeTalent, computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { computeSpacing } from '../src/engine/spacing';
import { tierCalibrationFor } from '../src/engine/tierCalibration';
import { realSpan } from '../src/engine/realAdvancedLookup';
for (const [n, w] of [['John Stockton','1990-92'],['Magic Johnson','1989-91'],['Steve Nash','2005-07'],['Chris Paul','2015-17'],['Stephen Curry','2014-16'],['Isiah Thomas','1983-85'],['Jason Kidd','2001-03']]) {
  const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w); if (!p) { console.log(n, 'n/a'); continue; }
  const r = realSpan(p) as Record<string, number> | null;
  console.log(`${(n + ' ' + w).padEnd(26)} TAL ${Math.round(effectiveTalent(p))} raw ${computeTalent(p)} O ${computeOffensiveTalent(p)} D ${computeDefensiveTalent(p)} SPC ${computeSpacing(p)} 3PA ${p.box.threePA} 3P% ${(p.box.threePct*100).toFixed(1)} BPM ${r?.bpm?.toFixed?.(1)} table ${tierCalibrationFor(n)?.tier ?? '-'}`);
}
