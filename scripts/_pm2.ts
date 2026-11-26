import { draftPool } from '../src/data/draftPool';
import { skill } from '../src/engine/skills';
import { reviewRuleHits } from '../src/engine/reviewRules';
const w = (n: string, s: string) => draftPool.find((x) => x.playerName === n && x.spanLabel === s)!;
const five = [w('Magic Johnson','1989-91'), w('John Stockton','1990-92'), w('Larry Bird','1985-87'), w('Kevin Garnett','2002-04'), w('Kareem Abdul-Jabbar','1971-73')];
for (const p of five) console.log(p.playerName, 'spotUp', skill(p, 'spotUp'));
console.log(JSON.stringify(reviewRuleHits(five)));
