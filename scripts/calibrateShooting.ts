import { players } from '../src/data/players';
import { shootingGravity } from '../src/engine/shooting';

const withGravity = players
  .filter((p) => p.box.threePA > 0)
  .map((p) => ({ id: p.id, gravity: shootingGravity(p) }))
  .sort((a, b) => b.gravity - a.gravity);

console.log('--- Top 20 shooting gravity ---');
for (const p of withGravity.slice(0, 20)) console.log(p.id, p.gravity.toFixed(2));

console.log('\n--- Bottom 10 (still >0 3PA) ---');
for (const p of withGravity.slice(-10)) console.log(p.id, p.gravity.toFixed(2));

console.log('\nCount with 3PA > 0:', withGravity.length);
console.log('Median gravity:', withGravity[Math.floor(withGravity.length / 2)].gravity.toFixed(2));
