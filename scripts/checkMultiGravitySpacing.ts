import { players } from '../src/data/players';
import { spacingScore } from '../src/engine/scoring';
import { computeSpacing } from '../src/engine/spacing';
import { autoAssignRotation } from '../src/engine/rotation';
import type { Team } from '../src/engine/types';
import type { PlayerSpan } from '../src/data/schema';

/**
 * Standing check for the 2026-07-30 multi-gravity spacing override: "Curry + one walking gravity
 * should be 100 spacing, let alone Curry + 2 walking gravity players" — the user's own rule,
 * reported against a real Curry + Reggie Miller(+ pre-fix Pippen) roster that read only ~80.
 */
const pick = (name: string) => {
  const spans = players.filter((p) => p.playerName === name);
  if (!spans.length) throw new Error('missing ' + name);
  return spans.reduce((a, b) => (computeSpacing(b) > computeSpacing(a) ? b : a));
};
function team(roster: PlayerSpan[]): Team {
  const t: Team = { id: 't', name: 'x', draftSlot: 1, isHuman: true, roster, rotation: null };
  t.rotation = autoAssignRotation(roster);
  return t;
}

let failures = 0;
function expect(label: string, actual: number, want: number) {
  const ok = actual === want;
  if (!ok) failures++;
  console.log(`${label.padEnd(60)} got ${actual}  want ${want}  ${ok ? 'ok' : 'FAIL'}`);
}

const bigs = ['Anthony Davis', 'Rudy Gobert', 'Draymond Green'].map(pick);
const filler = pick('Dennis Rodman');

// The reported case: Curry + Miller starting alongside non-shooting bigs.
expect(
  'Curry + Reggie Miller + 3 non-shooters',
  spacingScore(team([pick('Stephen Curry'), pick('Reggie Miller'), ...bigs, filler])),
  100,
);

// Second gravity threat as a BENCH player still counts (roster composition, not just starters).
expect(
  'Curry starts, Billups (Walking gravity) comes off the bench',
  spacingScore(team([pick('Stephen Curry'), ...bigs, pick('Chauncey Billups'), filler, pick('P.J. Tucker')])),
  100,
);

// Curry alone (no second gravity threat) must still hit the single-player floor exactly — at a
// normal 36-minute starter workload the floor is now fully bound (share measured against
// STARTER_MINUTES, not the unrealistic 48-minute game nobody actually plays).
expect(
  'Curry + 4 true non-shooters (no second threat) — full floor at 36 real minutes',
  spacingScore(team([pick('Stephen Curry'), pick('Ben Simmons'), pick('Rudy Gobert'), pick('Dennis Rodman'), pick('Jason Kidd')])),
  85,
);

// A second Walking-gravity player WITHOUT Curry must NOT trigger the override — it's specifically
// about the anomaly player, not "any two elite shooters."
const noCurry = spacingScore(team([pick('Reggie Miller'), pick('Chauncey Billups'), ...bigs, filler]));
console.log(`Reggie Miller + Billups, no Curry (must NOT be 100)`.padEnd(60), 'got', noCurry, noCurry < 100 ? 'ok' : 'FAIL');
if (noCurry >= 100) failures++;

console.log(`\n${failures === 0 ? 'PASS' : `FAIL: ${failures} mismatch(es)`}`);
