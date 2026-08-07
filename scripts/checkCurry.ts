import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { shootingGravity, isPlusShooter } from '../src/engine/shooting';

const curry = players.filter((p) => p.playerName === 'Stephen Curry');
for (const c of curry) {
  console.log(c.spanLabel, 'TAL', computeTalent(c), 'gravity', shootingGravity(c).toFixed(2), 'plusShooter', isPlusShooter(c));
}
