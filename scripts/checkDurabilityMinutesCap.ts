/**
 * End-to-end check for the durability-minutes mechanism (2026-07-30, per the user's own design:
 * "it should affect minutes that player can play — if durability is low, lower minutes; if
 * exceeded, rotation penalty"):
 *
 *  1. autoAssignRotation must never exceed a player's own maxSustainableMinutes.
 *  2. A fragile primary starter must get fewer than STARTER_MINUTES automatically, with the
 *     shortfall picked up by a backup.
 *  3. Manually overriding past the cap (RotationBuilder-style) must NOT be blocked (matches the
 *     project's "human plays with no hard cap" philosophy) but must cost rotationScore.
 *  4. Slots should still resolve to (at or very near) 48 minutes for realistic rosters — the cap
 *     is a soft constraint that shifts WHO plays, not a hole in the rotation.
 */
import { players } from '../src/data/players';
import { computeDurability, maxSustainableMinutes, durabilityBreakdown } from '../src/engine/durability';
import { autoAssignRotation, totalMinutesForPlayer, MAX_MINUTES_PER_PLAYER, GAME_MINUTES } from '../src/engine/rotation';
import { scoreTeam, rotationScore } from '../src/engine/scoring';
import { STARTER_SLOTS } from '../src/engine/positions';
import type { Team } from '../src/engine/types';
import type { PlayerSpan } from '../src/data/schema';
import draftPoolData from '../src/data/draftPool.json';

function worst(name: string): PlayerSpan {
  const spans = players.filter((p) => p.playerName === name);
  return spans.reduce((a, b) => (computeDurability(b) < computeDurability(a) ? b : a));
}
function pick(name: string): PlayerSpan {
  const spans = players.filter((p) => p.playerName === name);
  return spans.reduce((a, b) => (computeDurability(b) > computeDurability(a) ? b : a));
}
function makeTeam(roster: PlayerSpan[]): Team {
  return { id: 't', name: 'Test', draftSlot: 1, isHuman: true, roster, rotation: autoAssignRotation(roster) };
}

console.log('=== 1. never exceeds cap, across the real draft pool (1000 random 9-man rosters) ===');
const pool = draftPoolData as PlayerSpan[];
let violations = 0;
let slotsShortOf48 = 0;
let totalSlots = 0;
for (let i = 0; i < 1000; i++) {
  const roster: PlayerSpan[] = [];
  const used = new Set<string>();
  while (roster.length < 9) {
    const p = pool[Math.floor(Math.random() * pool.length)];
    if (used.has(p.id)) continue;
    used.add(p.id);
    roster.push(p);
  }
  const rotation = autoAssignRotation(roster);
  for (const p of roster) {
    const total = totalMinutesForPlayer(rotation, p.id);
    const cap = maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER);
    if (total > cap) {
      violations++;
      if (violations <= 5) console.log(`  VIOLATION: ${p.playerName} ${p.spanLabel} got ${total} min, cap ${cap} (DUR ${computeDurability(p)})`);
    }
  }
  for (const slot of STARTER_SLOTS) {
    totalSlots++;
    const sum = rotation.slots[slot].reduce((s, a) => s + a.minutes, 0);
    if (sum < GAME_MINUTES) slotsShortOf48++;
  }
}
console.log(`cap violations: ${violations} of 9000 player-assignments`);
console.log(`slots short of 48 minutes: ${slotsShortOf48} of ${totalSlots} (${((slotsShortOf48 / totalSlots) * 100).toFixed(2)}%) — expected to be rare/zero given the 20-min floor leaves real headroom`);

console.log('\n=== 2. fragile primary starter gets fewer auto minutes, shortfall covered by a backup ===');
const walton = worst('Bill Walton'); // DUR ~4, cap ~21
const backups = ['A.C. Green', 'Robert Horry', 'Shane Battier', 'Bruce Bowen', 'P.J. Tucker',
  'Danny Green', 'Raja Bell', 'Udonis Haslem'].map(pick);
const team = makeTeam([walton, ...backups]);
const waltonMin = totalMinutesForPlayer(team.rotation, walton.id);
const waltonCap = maxSustainableMinutes(walton, MAX_MINUTES_PER_PLAYER);
console.log(`  Bill Walton (DUR ${computeDurability(walton)}): cap ${waltonCap}m, auto-assigned ${waltonMin}m — ${waltonMin <= waltonCap ? 'PASS (within cap)' : 'FAIL'}`);
const cSlotTotal = team.rotation!.slots.C.reduce((s, a) => s + a.minutes, 0);
console.log(`  C slot total: ${cSlotTotal}/${GAME_MINUTES} — ${team.rotation!.slots.C.length} contributor(s): ${team.rotation!.slots.C.map((a) => `${a.playerId}:${a.minutes}`).join(', ')}`);

console.log('\n=== 3. manual override past the cap is allowed but costs rotationScore ===');
const durable = pick('A.C. Green'); // high DUR, cap = MAX_MINUTES_PER_PLAYER
const manualTeam = makeTeam([durable, ...players.filter((p) => p.playerName !== 'A.C. Green').slice(0, 8)]);
// hand-override: force `walton` into the roster at 44 minutes (well past his ~21 cap)
const abusiveRoster = [walton, ...backups];
const abusiveTeam: Team = { id: 'abuse', name: 'Abuse', draftSlot: 1, isHuman: true, roster: abusiveRoster, rotation: null };
abusiveTeam.rotation = autoAssignRotation(abusiveRoster);
const before = rotationScore(abusiveTeam);
// manually push Walton to 44, taking it from wherever the backup was
abusiveTeam.rotation.slots.C = [{ playerId: walton.id, minutes: 44 }, { playerId: backups[0].id, minutes: 4 }];
const after = rotationScore(abusiveTeam);
console.log(`  auto (within cap):    rotationScore ${before.score}`);
console.log(`  manual (Walton at 44): rotationScore ${after.score}`);
console.log(`  notes: ${after.notes.filter((n) => n.includes('durability') || n.includes('Overworked')).join(' | ') || '(none — CHECK)'}`);
console.log(after.score < before.score ? '  PASS — penalty applied' : '  FAIL — no penalty despite exceeding cap');
console.log(after.score >= 0 ? `  penalty did not go negative/unbounded: PASS` : 'FAIL');

console.log('\n=== 4. overall unaffected (rotationScore still only 15% weight, unchanged shape) ===');
const b1 = scoreTeam(abusiveTeam);
console.log(`  overall=${b1.overall} talent=${b1.talentScore} rotation=${b1.rotationScore} durability=${b1.durabilityScore}`);
console.log(`  recompute: ${Math.round(b1.talentScore * 0.4 + b1.fitScore * 0.45 + b1.rotationScore * 0.15)} (matches: ${Math.round(b1.talentScore * 0.4 + b1.fitScore * 0.45 + b1.rotationScore * 0.15) === b1.overall})`);

console.log('\n=== 5. distribution of maxSustainableMinutes across the draft pool ===');
const caps = pool.map((p) => maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER)).sort((a, b) => a - b);
const q = (p: number) => caps[Math.floor(p * (caps.length - 1))];
console.log(`min ${caps[0]} p10 ${q(0.1)} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} max ${caps[caps.length - 1]}`);
console.log(`spans capped below STARTER_MINUTES (36): ${caps.filter((c) => c < 36).length} of ${caps.length} (${((caps.filter((c) => c < 36).length / caps.length) * 100).toFixed(1)}%)`);
