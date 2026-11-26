import { draftPool } from '../src/data/draftPool';
import { dataUsageDemand } from '../src/engine/skills';
import { offBallValue } from '../src/engine/heliocentric';
const f = (n: string, s: string) => draftPool.find((x) => x.playerName === n && x.spanLabel === s)!;
for (const [n, s] of [['Stephen Curry','2014-16'],['Michael Jordan','1990-92'],['LeBron James','2011-13'],['Tim Duncan','2001-03'],["Shaquille O'Neal",'1999-01'],['Kobe Bryant','2006-08'],['Kevin Durant','2012-14'],['Nikola Jokic','2022-24'],['Giannis Antetokounmpo','2019-21'],['Larry Bird','1985-87'],['Magic Johnson','1989-91'],['Klay Thompson','2014-16'],['Steve Nash','2005-07'],['Russell Westbrook','2015-17'],['James Harden','2017-19']]) { const p = f(n, s); console.log(n.padEnd(22), 'use', (dataUsageDemand(p) ?? NaN).toFixed(2), 'offBall', offBallValue(p).toFixed(2)); }
