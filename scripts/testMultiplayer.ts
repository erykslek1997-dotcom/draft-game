import assert from 'node:assert/strict';
import { applyQuickServerPick, createQuickMultiplayerDraft, resolveQuickAutoPick, type QuickDraftState } from '../src/engine/quickDraft';

// Two friends in a room: each screen marks its own team as the human one, both replay the same log.
let a = createQuickMultiplayerDraft(77, 3);
let b = createQuickMultiplayerDraft(77, 11);
assert.equal(a.teams[3].name, b.teams[3].name, 'same teams on every screen');
assert.ok(a.teams[3].isHuman && !a.teams[11].isHuman && b.teams[11].isHuman);
const log: string[] = [];
let guard = 0;
while (!a.complete && guard++ < 100) {
  // Whoever is on the clock, the log takes the CPU's pick (a human may pick anything legal; the
  // CPU's choice is a fair stand-in for this check). Every 7th pick is junk: a tampered client.
  const next = resolveQuickAutoPick(a) as QuickDraftState;
  const id = log.length % 7 === 6 ? 'not-a-player' : next.history[next.history.length - 1].playerId;
  log.push(id);
  a = applyQuickServerPick(a, id);
  b = applyQuickServerPick(b, id);
}
assert.ok(a.complete && b.complete, 'the draft finishes');
assert.deepEqual(
  a.history.map((h) => h.playerId),
  b.history.map((h) => h.playerId),
  'both screens see the same board',
);
assert.equal(a.history.length, 80);
console.log('multiplayer replay ok');
