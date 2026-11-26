import { draftPool } from '../src/data/draftPool';
import { skill } from '../src/engine/skills';
const ws = ['Larry Bird','Dominique Wilkins','Bernard King','Adrian Dantley','Alex English','George Gervin','Kevin McHale','Julius Erving','Rick Barry','Elgin Baylor','Jerry West','Chris Mullin','Kiki Vandeweghe'];
for (const n of ws) { const p = draftPool.filter((x) => x.playerName === n); const v = p.map((x) => skill(x, 'selfCreation')).filter((x): x is number => x !== null); if (v.length) console.log(n.padEnd(20), 'max', Math.max(...v), 'windows', v.join(' ')); }
