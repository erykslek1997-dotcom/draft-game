import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeTalent, computeOffensiveTalentBase } from '../src/engine/talent';
import { effectiveTalent } from '../src/engine/grades';
for (const [n, w] of [['Victor Wembanyama','2023-25'],['Alex Caruso','2022-24'],['Norm Van Lier','1975-77']]) {
  const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w)!;
  process.stdout.write(`${n} ${w} raw ${computeTalent(p)} disp ${Math.round(effectiveTalent(p))} Obase ${computeOffensiveTalentBase(p)} | `);
}
console.log();
