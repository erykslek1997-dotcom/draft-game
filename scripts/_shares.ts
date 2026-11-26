import { draftPool } from '../src/data/draftPool';
import { ballShare } from '../src/engine/ballHandling';
import { offBallValue } from '../src/engine/heliocentric';
const f = (n: string, s: string) => draftPool.find((x) => x.playerName === n && x.spanLabel === s)!;
for (const [n, s] of [['John Stockton','1990-92'],['Magic Johnson','1989-91'],['Stephen Curry','2014-16'],['LeBron James','2011-13'],['Chris Paul','2013-15'],['Michael Jordan','1990-92'],['Dwyane Wade','2008-10'],['Kawhi Leonard','2015-17'],['Larry Bird','1985-87'],['Jason Kidd','2001-03'],['Steve Nash','2005-07'],['Russell Westbrook','2015-17'],['James Harden','2017-19'],['Kobe Bryant','2006-08'],['Klay Thompson','2014-16']]) { const p = f(n, s); console.log(n.padEnd(18), ballShare(p).toFixed(3), offBallValue(p).toFixed(2), p.offensiveArchetype); }
