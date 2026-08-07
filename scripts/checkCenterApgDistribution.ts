import { players } from '../src/data/players';

const centerApgs = players.filter((p) => p.primaryPosition === 'C' && p.fga >= 8).map((p) => p.box.apg);
centerApgs.sort((a, b) => a - b);
const mean = centerApgs.reduce((a, b) => a + b, 0) / centerApgs.length;
const median = centerApgs[Math.floor(centerApgs.length / 2)];
const p25 = centerApgs[Math.floor(centerApgs.length * 0.25)];
const p75 = centerApgs[Math.floor(centerApgs.length * 0.75)];
console.log(`n=${centerApgs.length} mean=${mean.toFixed(2)} median=${median.toFixed(2)} p25=${p25.toFixed(2)} p75=${p75.toFixed(2)}`);
