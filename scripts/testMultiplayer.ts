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

// The Duel: two teams, ten picks, a 40-player board, the same on both screens.
let d1 = createQuickMultiplayerDraft(5, 0, 2);
let d2 = createQuickMultiplayerDraft(5, 1, 2);
assert.equal(d1.teams.length, 2);
assert.equal(d1.pool!.size, 40);
const duelLog: string[] = [];
guard = 0;
while (!d1.complete && guard++ < 20) {
  const next = resolveQuickAutoPick(d1) as QuickDraftState;
  const id = next.history[next.history.length - 1].playerId;
  assert.ok(d1.pool!.has(id), 'picks stay on the board');
  duelLog.push(id);
  d1 = applyQuickServerPick(d1, id);
  d2 = applyQuickServerPick(d2, id);
}
assert.ok(d1.complete && d2.complete);
assert.equal(d1.history.length, 10);
assert.deepEqual(d1.history.map((h) => h.teamId), ['t0', 't1', 't1', 't0', 't0', 't1', 't1', 't0', 't0', 't1'], 'snake 1-2-2-1');
assert.deepEqual(d1.history, d2.history);
console.log('duel replay ok');
