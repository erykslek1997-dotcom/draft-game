import { autoAssignRotation } from '../src/engine/rotation';
import { draftPool } from '../src/data/draftPool';
import { STARTER_SLOTS } from '../src/engine/positions';

const magic = draftPool.find((p) => p.playerName === 'Magic Johnson')!;
const hakeem = draftPool.find((p) => p.playerName === 'Hakeem Olajuwon')!;

for (const n of [1, 2, 3, 4]) {
  const roster = [magic, hakeem, ...draftPool.slice(0, 10)].slice(0, n);
  const { slots } = autoAssignRotation(roster);
  const filled = STARTER_SLOTS.filter((s) => slots[s].length > 0);
  console.log(`roster size ${n}: slots with any assignment = [${filled.join(', ')}] (expected up to ${n} filled)`);
}
