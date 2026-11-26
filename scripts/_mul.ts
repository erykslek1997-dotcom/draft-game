import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { effectiveTalent } from '../src/engine/grades';
import { tierCalibrationFor } from '../src/engine/tierCalibration';
import { allStarSelectionsIn } from '../src/engine/allStarLookup';
import { spanEndYears } from '../src/engine/era';
for (const [n, w] of [['Chris Mullin','1996-98'],['Chris Mullin','1995-97'],['OG Anunoby','2024-26']]) {
  const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w)!;
  console.log(n, w, 'raw', computeTalent(p), 'display', effectiveTalent(p), 'table', JSON.stringify(tierCalibrationFor(n)), 'AS', allStarSelectionsIn(n, spanEndYears(w)));
}
