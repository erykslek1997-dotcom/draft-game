import { draftPool } from '../src/data/draftPool';
import { teammateLift } from '../src/engine/teammateLift';
const L: [string,string][] = [['Stephen Curry','2014-16'],['Michael Jordan','1990-92'],['LeBron James','2011-13'],['Tim Duncan','2001-03'],["Shaquille O'Neal",'1999-01'],['John Stockton','1990-92'],['Magic Johnson','1989-91'],['Kawhi Leonard','2015-17'],['Kevin Garnett','2002-04'],['Kareem Abdul-Jabbar','1971-73']];
for (const [n,s] of L) { const p = draftPool.find(x=>x.playerName===n&&x.spanLabel===s)!; const l = teammateLift(p); console.log(n.padEnd(20), 'lift', (l.lift*100).toFixed(2), 'realMates', (l.realMates*100).toFixed(2), 'net', ((l.lift-l.realMates)*100).toFixed(2)); }
