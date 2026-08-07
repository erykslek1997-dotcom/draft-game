import { players } from '../src/data/players';
import { portabilityBonus } from '../src/engine/portabilityCorrection';
import { computePortability } from '../src/engine/portability';

const bonuses = players.map((p) => ({ p, b: portabilityBonus(p) })).filter((x) => x.b > 0).sort((a, b) => b.b - a.b);
console.log('total spans with nonzero bonus:', bonuses.length, '/', players.length);
for (const { p, b } of bonuses.slice(0, 20)) {
  console.log(p.playerName, p.spanLabel, 'bonus', b.toFixed(2), 'POR', computePortability(p));
}
