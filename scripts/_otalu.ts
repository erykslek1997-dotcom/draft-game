import { draftPool } from '../src/data/draftPool';
import { computeOffensiveTalent, computeUncappedOffensiveTalent } from '../src/engine/talent';
const L: [string,string][] = [['Stephen Curry','2014-16'],['John Stockton','1990-92'],['Magic Johnson','1989-91'],['Chris Paul','2015-17'],['Steve Nash','2005-07'],['LeBron James','2012-14'],['Nikola Jokic','2023-25'],['Michael Jordan','1989-91'],['Larry Bird','1985-87'],['Kawhi Leonard','2015-17'],['Kevin Garnett','2002-04'],['Kareem Abdul-Jabbar','1971-73'],['Klay Thompson','2014-16'],['Shaquille O\'Neal','1999-01']];
for (const [n,s] of L) { const p = draftPool.find(x=>x.playerName===n&&x.spanLabel===s); if(!p){console.log(n,'?');continue;} console.log(n.padEnd(20), computeOffensiveTalent(p), computeUncappedOffensiveTalent(p)); }
const all = draftPool.map(p=>computeUncappedOffensiveTalent(p)); console.log('>100:', all.filter(v=>v>100).length, 'of', all.length);
