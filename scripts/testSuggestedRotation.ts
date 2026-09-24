/**
 * `suggestBasicRotation` (the Team tab's pre-filled rotation) must always be SUBMITTABLE as-is:
 * every slot has a starter and exactly 48 minutes, and nobody plays more than 48 minutes in total
 * — RotationBuilder refuses anything else. Checked on deliberately awkward rosters (stars plus the
 * cheapest fillers, the shape a star-hungry human draft ends in) and on fully random ones.
 */
import { activeDraftPool } from '../src/engine/draft';
import { suggestBasicRotation } from '../src/engine/rotation';
import { STARTER_SLOTS } from '../src/engine/positions';
import type { PlayerSpan } from '../src/data/schema';

let failures = 0;
const byName = new Map<string, PlayerSpan>();
for (const p of activeDraftPool) if (!byName.has(p.playerName)) byName.set(p.playerName, p);
const uniquePlayers = [...byName.values()];

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

function check(roster: PlayerSpan[], label: string) {
  const rotation = suggestBasicRotation(roster);
  const perPlayer = new Map<string, number>();
  for (const slot of STARTER_SLOTS) {
    const total = rotation.slots[slot].reduce((sum, a) => sum + a.minutes, 0);
    if (!rotation.slots[slot][0] || total !== 48) {
      failures++;
      console.error(`FAIL: ${label} — ${slot} has ${total}/48`);
    }
    for (const a of rotation.slots[slot]) perPlayer.set(a.playerId, (perPlayer.get(a.playerId) ?? 0) + a.minutes);
  }
  for (const [id, minutes] of perPlayer) {
    if (minutes > 48) {
      failures++;
      console.error(`FAIL: ${label} — ${id} plays ${minutes} minutes`);
    }
  }
}

for (let i = 0; i < 300; i++) {
  const shuffled = [...uniquePlayers].sort(() => rnd() - 0.5);
  check([...shuffled.filter((p) => p.fga > 17).slice(0, 5), ...shuffled.filter((p) => p.fga < 3).slice(0, 4)], `stars+fillers #${i}`);
  check(shuffled.slice(0, 9), `random #${i}`);
}

if (failures > 0) {
  console.error(`\n${failures} suggested-rotation failure(s).`);
  process.exitCode = 1;
} else {
  console.log('PASS: suggested rotation is always submittable (600 rosters).');
}
