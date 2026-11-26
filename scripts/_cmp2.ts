import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent, spacingGrade } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { computeSpacing } from '../src/engine/spacing';
for (const [n, w] of [['OG Anunoby','2021-23'],['Chris Mullin','1996-98']]) {
  const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w)!;
  console.log(`${n} ${w}: TAL ${Math.round(effectiveTalent(p))} O ${computeOffensiveTalent(p)} D ${computeDefensiveTalent(p)} SPC ${computeSpacing(p)} ${spacingGrade(computeSpacing(p), p)} price ${p.fga} | ppg ${p.box.ppg} TS ${(p.box.tsPct*100).toFixed(1)} 3PA ${p.box.threePA} 3P% ${(p.box.threePct*100).toFixed(1)}`);
}
