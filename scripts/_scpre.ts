import { draftPool } from '../src/data/draftPool';
import { skill } from '../src/engine/skills';
for (const [n, w] of [['Magic Johnson','1989-91'],['Michael Jordan','1987-89'],['Larry Bird','1985-87'],['Isiah Thomas','1983-85'],['Oscar Robertson','1961-63']]) { const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w); console.log(n, w, p ? skill(p, 'selfCreation') : 'n/a'); }
