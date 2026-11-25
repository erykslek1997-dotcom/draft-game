import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { defensiveTalentTrace, computeDefensiveTalentBase, computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { playoffImpactForSpan } from '../src/engine/playoffImpact';
for (const s of draftPool.filter((p) => p.playerName === 'Robert Horry')) {
  const t = defensiveTalentTrace(s) as any;
  console.log(s.spanLabel, 'final', computeDefensiveTalent(s), 'base', computeDefensiveTalentBase(s), 'po', playoffImpactForSpan(s).defense.toFixed(1), JSON.stringify(Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, Math.round((v as number) * 10) / 10]))));
}
