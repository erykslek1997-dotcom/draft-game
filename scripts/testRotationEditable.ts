/**
 * Regression test for a defect found during browser testing: once autoAssignRotation was
 * allowed to place an out-of-position player to keep a slot at 48 minutes, the rotation
 * editor's dropdowns — which only listed position-ELIGIBLE players — could no longer
 * represent that assignment. The slot showed "48 / 48 min" while the select rendered its
 * empty placeholder, and touching the dropdown would silently drop the assignment.
 *
 * Invariant: every player auto-fill assigns to a slot must appear among that slot's
 * selectable options, so what the engine produces is always editable in the UI.
 */
import { draftPool as players } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { STARTER_SLOTS, isPositionEligible } from '../src/engine/positions';
import type { PlayerSpan, Position } from '../src/data/schema';

/** Mirrors RotationBuilder.optionsFor — every rostered player, natural fits sorted first. */
function optionsFor(roster: PlayerSpan[], slot: Position) {
  return roster
    .map((player) => ({ player, eligible: isPositionEligible(player, slot) }))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible));
}

function randomRoster(size: number, pool = players) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const seen = new Set<string>();
  const roster: PlayerSpan[] = [];
  for (const p of shuffled) {
    if (seen.has(p.playerName)) continue;
    seen.add(p.playerName);
    roster.push(p);
    if (roster.length === size) break;
  }
  return roster;
}

let ok = true;
let outOfPositionAssignments = 0;
let slotsChecked = 0;

// Include deliberately lopsided rosters (all one position) — the worst case that exposed
// the bug, where most slots have no naturally eligible player at all.
const rosters: PlayerSpan[][] = [];
for (let i = 0; i < 200; i++) rosters.push(randomRoster(9));
for (const pos of STARTER_SLOTS) {
  const single = players.filter((p) => p.primaryPosition === pos);
  for (let i = 0; i < 20; i++) rosters.push(randomRoster(9, single));
}

for (const roster of rosters) {
  const { slots } = autoAssignRotation(roster);
  for (const slot of STARTER_SLOTS) {
    slotsChecked++;
    const selectable = new Set(optionsFor(roster, slot).map((o) => o.player.id));
    const total = slots[slot].reduce((sum, a) => sum + a.minutes, 0);
    if (total !== 48) {
      console.log(`FAIL: slot ${slot} totals ${total}, expected 48`);
      ok = false;
    }
    for (const a of slots[slot]) {
      const player = roster.find((p) => p.id === a.playerId)!;
      if (!isPositionEligible(player, slot)) outOfPositionAssignments++;
      if (!selectable.has(a.playerId)) {
        console.log(`FAIL: ${player.playerName} assigned to ${slot} but not selectable in the editor.`);
        ok = false;
      }
    }
  }
}

console.log(`Rosters tested: ${rosters.length} (incl. 100 single-position worst cases)`);
console.log(`Slots checked: ${slotsChecked} | all exactly 48 minutes: ${ok}`);
console.log(`Out-of-position assignments made (must be editable): ${outOfPositionAssignments}`);
console.log(`\nTest (every auto-filled assignment is representable in the editor)?`, ok, ok ? 'PASS' : 'FAIL');
if (!ok) process.exitCode = 1;
