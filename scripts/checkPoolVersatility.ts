import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import type { Position } from '../src/data/schema';

const uniquePlayers = new Map<string, { primaryPosition: Position; secondaryPositions: Position[] }>();
for (const p of draftPool) {
  const key = normalizePlayerName(p.playerName);
  const existing = uniquePlayers.get(key);
  // Use whichever span has the most secondary coverage as representative of the player's flexibility.
  if (!existing || p.secondaryPositions.length > existing.secondaryPositions.length) {
    uniquePlayers.set(key, { primaryPosition: p.primaryPosition, secondaryPositions: p.secondaryPositions });
  }
}

const ALL: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
for (const pos of ALL) {
  const atPos = [...uniquePlayers.values()].filter((p) => p.primaryPosition === pos);
  const withSecondary = atPos.filter((p) => p.secondaryPositions.length > 0);
  console.log(`${pos}: ${atPos.length} players, ${withSecondary.length} (${((withSecondary.length / atPos.length) * 100).toFixed(1)}%) have any secondary position`);
}

const totalWithSecondary = [...uniquePlayers.values()].filter((p) => p.secondaryPositions.length > 0).length;
console.log(`\nOverall: ${totalWithSecondary}/${uniquePlayers.size} pool players (${((totalWithSecondary / uniquePlayers.size) * 100).toFixed(1)}%) have any secondary position at all`);
