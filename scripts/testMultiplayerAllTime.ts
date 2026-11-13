import assert from 'node:assert/strict';
import { applyServerPick, createMultiplayerDraft, resolveAutoPick, type DraftState } from '../src/engine/draft';

// Two friends in an All-Time room: one screen makes the CPU picks, every screen replays the log.
let a = createMultiplayerDraft(31, 2);
let b = createMultiplayerDraft(31, 9);
assert.equal(a.teams[2].name, b.teams[2].name);
const log: string[] = [];
let guard = 0;
while (!a.complete && guard++ < 200) {
  const next = resolveAutoPick(a) as DraftState;
  // Every 11th pick is junk (a tampered client), every 13th takes a player already gone.
  const id = log.length % 11 === 10 ? 'nobody' : log.length % 13 === 12 ? log[0] : next.history[next.history.length - 1].playerId;
  log.push(id);
  a = applyServerPick(a, id);
  b = applyServerPick(b, id);
}
assert.ok(a.complete && b.complete);
assert.equal(a.history.length, 144);
assert.deepEqual(a.history, b.history, 'every screen sees the same board');
console.log('all-time multiplayer replay ok');
