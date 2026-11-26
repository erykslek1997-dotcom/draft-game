import { draftPool } from '../src/data/draftPool';
import { skill } from '../src/engine/skills';
for (const [n, w] of [['Jason Kidd','2005-07'],['Victor Oladipo','2016-18'],['Shawn Marion','2001-03'],['Kevin Garnett','2002-04'],['Victor Wembanyama','2024-26'],['Fred VanVleet','2016-18'],['Tracy McGrady','2001-03'],['Ray Allen','2000-02'],['Tim Duncan','2001-03']]) {
  const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w); console.log(n, w, p ? skill(p, 'selfCreation') : 'n/a');
}
