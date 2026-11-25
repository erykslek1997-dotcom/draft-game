import { draftPool } from '../src/data/draftPool';
import { computeSpacing } from '../src/engine/spacing';
import { spacingGrade, effectiveTalent } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { positionFitMultiplier } from '../src/engine/positions';
for (const [n, w] of [['OG Anunoby','2021-23'],['Robert Horry','2001-03'],['Nenê','2009-11']]) {
  const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w)!;
  console.log(n, 'TAL', effectiveTalent(p), 'O', computeOffensiveTalent(p), 'spc', computeSpacing(p), spacingGrade(computeSpacing(p), p), 'fitPF', positionFitMultiplier(p, 'PF'));
}
