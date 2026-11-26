import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { effectiveTalent } from '../src/engine/grades';
for (const [n, w] of [['Dennis Rodman','1989-91'],['Ben Wallace','2002-04'],['Tony Allen','2011-13'],['Alex Caruso','2022-24'],['Bruce Bowen','2005-07']]) {
  const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w)!;
  console.log(n, w, 'computeTalent', computeTalent(p), 'effective', Math.round(effectiveTalent(p)));
}
