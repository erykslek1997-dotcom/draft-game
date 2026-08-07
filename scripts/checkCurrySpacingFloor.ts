import { players } from '../src/data/players';
import { draftPool } from '../src/data/draftPool';
import { spacingScore, fitScore } from '../src/engine/scoring';
import { computeSpacing } from '../src/engine/spacing';
import { autoAssignRotation, totalMinutesForPlayer } from '../src/engine/rotation';
import { STARTER_SLOTS } from '../src/engine/positions';
import type { Team } from '../src/engine/types';
import type { PlayerSpan } from '../src/data/schema';

/** The Curry team-spacing floor: during his minutes a team's spacing can't read below 85. */
const pick = (name: string, pool: PlayerSpan[] = players) => {
  const spans = pool.filter((p) => p.playerName === name);
  if (!spans.length) throw new Error('missing ' + name);
  return spans.reduce((a, b) => (computeSpacing(b) > computeSpacing(a) ? b : a));
};

function team(roster: PlayerSpan[], label: string) {
  const t: Team = { id: 't', name: label, draftSlot: 1, isHuman: true, roster, rotation: null };
  t.rotation = autoAssignRotation(roster);
  return t;
}

// Four non-shooters + Curry: the case the rule exists for.
const nonShooters = ['Ben Simmons', 'Rudy Gobert', 'Dennis Rodman', 'Jason Kidd'].map((n) => pick(n));
const curry = pick('Stephen Curry');
const withCurry = team([...nonShooters, curry], 'with Curry');
const withoutCurry = team([...nonShooters, pick('Tony Allen')], 'without Curry');

for (const t of [withoutCurry, withCurry]) {
  const mins = totalMinutesForPlayer(t.rotation, curry.id);
  const raw =
    t.roster.reduce((s, p) => s + computeSpacing(p) * totalMinutesForPlayer(t.rotation, p.id), 0) /
    (STARTER_SLOTS.length * 48);
  const fit = fitScore(t);
  console.log(
    t.name.padEnd(15),
    'spacingScore', String(spacingScore(t)).padStart(3),
    '| unfloored', raw.toFixed(1).padStart(5),
    '| Curry minutes', String(mins).padStart(2),
    '| fit', fit.score,
  );
  console.log('   spacing note:', fit.notes.find((n) => /spac|shooter|cramped/i.test(n)) ?? '(none)');
}

// Boundary: Curry at 0 minutes must change nothing; at 48 the floor must bind fully.
const rosterFive = [...nonShooters, curry];
for (const curryMinutes of [0, 12, 24, 36, 48]) {
  const t = team(rosterFive, 'x');
  const slots = t.rotation!.slots;
  for (const slot of STARTER_SLOTS) {
    const entries = slots[slot];
    const idx = entries.findIndex((e) => e.playerId === curry.id);
    if (idx === -1) continue;
    entries[idx] = { playerId: curry.id, minutes: curryMinutes };
    const filler = entries.find((e) => e.playerId !== curry.id);
    if (filler) filler.minutes = 48 - curryMinutes;
    else if (curryMinutes < 48) entries.push({ playerId: nonShooters[0].id, minutes: 48 - curryMinutes });
  }
  console.log(`Curry ${String(curryMinutes).padStart(2)} min -> spacingScore ${spacingScore(t)}`);
}

// Sanity: a genuinely well-spaced team without Curry must be unaffected by the rule.
const shooters = ['Klay Thompson', 'Reggie Miller', 'Dirk Nowitzki', 'Karl-Anthony Towns', 'Damian Lillard'].map((n) => pick(n));
const spaced = team(shooters, 'all shooters');
console.log('\nall-shooters team (no Curry) spacingScore:', spacingScore(spaced));
console.log('pool has Curry:', draftPool.some((p) => p.playerName === 'Stephen Curry'));
