import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { playoffImpactForSpan } from '../src/engine/playoffImpact';
import { computeTalent } from '../src/engine/talent';
for (const [n, w] of [['Tyrese Haliburton','2023-25'],['Reggie Miller','1993-95'],['LeBron James','2012-14'],['Paul George','2012-14']]) {
  const s = draftPool.find((p) => p.playerName === n && p.spanLabel === w)!;
  console.log(n, w, JSON.stringify(playoffImpactForSpan(s)));
}
