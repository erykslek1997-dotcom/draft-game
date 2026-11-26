import { draftPool } from '../src/data/draftPool';
import { dataUsageDemand } from '../src/engine/skills';
import { skill } from '../src/engine/skills';
const f = (n: string, s: string) => draftPool.find((x) => x.playerName === n && x.spanLabel === s)!;
for (const [n, s] of [['Stephen Curry','2014-16'],['Michael Jordan','1990-92'],['LeBron James','2011-13'],['Tim Duncan','2001-03'],["Shaquille O'Neal",'1999-01'],['Kevin Durant','2012-14'],['Larry Bird','1985-87'],['Klay Thompson','2014-16']]) { const p = f(n, s); console.log(n.padEnd(20), 'use', (dataUsageDemand(p) ?? 0.3).toFixed(2), 'spotUp', skill(p, 'spotUp')); }
