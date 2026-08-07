import { draftPool as players } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { STARTER_SLOTS } from '../src/engine/positions';

function randomRoster(size: number) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const seen = new Set<string>();
  const roster = [];
  for (const p of shuffled) {
    if (seen.has(p.playerName)) continue;
    seen.add(p.playerName);
    roster.push(p);
    if (roster.length === size) break;
  }
  return roster;
}

const RUNS = 500;
let totalSlots = 0;
let shortSlots = 0;
let threeOrMoreContributors = 0;
const shortfallExamples: string[] = [];

for (let i = 0; i < RUNS; i++) {
  const roster = randomRoster(9);
  const { slots } = autoAssignRotation(roster);
  for (const slot of STARTER_SLOTS) {
    totalSlots++;
    const total = slots[slot].reduce((sum, a) => sum + a.minutes, 0);
    if (slots[slot].length >= 3) threeOrMoreContributors++;
    if (total < 48) {
      shortSlots++;
      if (shortfallExamples.length < 10) {
        const names = slots[slot].map((a) => roster.find((p) => p.id === a.playerId)!.playerName);
        shortfallExamples.push(`Run ${i} ${slot}: ${total}min — ${names.join(', ')}`);
      }
    }
  }
}

console.log(`Total slots checked: ${totalSlots}`);
console.log(`Slots short of 48 minutes: ${shortSlots} (${((shortSlots / totalSlots) * 100).toFixed(1)}%)`);
console.log(`Slots that needed 3+ contributors: ${threeOrMoreContributors}`);
console.log('--- shortfall examples ---');
for (const e of shortfallExamples) console.log(e);
