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

// Years swapped live: the same log of picks and swaps gives the same board on every screen.
import { applySwap, replayRoom } from '../src/engine/draft';
import { spanOptionsFor } from '../src/engine/spanOptimizer';
{
  const base = createMultiplayerDraft(31, 2);
  const first = a.history.find((h) => h.teamId === 't2')!;
  const name = a.teams[2].roster[0].playerName;
  const cheaper = spanOptionsFor(name).filter((o) => o.fga < a.teams[2].roster[0].fga).sort((x, y) => x.fga - y.fga)[0];
  const atPick = a.history.indexOf(first) + 1;
  const swaps = cheaper ? [{ atPick, slot: 2, playerName: name, spanId: cheaper.id }] : [];
  const x = replayRoom(createMultiplayerDraft(31, 2), log, swaps);
  const y = replayRoom(createMultiplayerDraft(31, 9), log, swaps);
  assert.deepEqual(x.teams.map((t) => t.roster.map((p) => p.id)), y.teams.map((t) => t.roster.map((p) => p.id)));
  if (cheaper) assert.equal(x.teams[2].roster[0].id, cheaper.id, 'the swap went in');
  // A swap to dearer years is ignored everywhere.
  const dear = spanOptionsFor(name).sort((p, q) => q.fga - p.fga)[0];
  if (dear.fga > a.teams[2].roster[0].fga) assert.equal(applySwap(base, { atPick: 0, slot: 2, playerName: name, spanId: dear.id }), base);
  console.log('all-time live year swaps ok', cheaper ? '(swapped)' : '(no cheaper years)');
}
