/**
 * 2026-09-30, engine calibration session 2 (the user: "takie fuckupy to były na poziomie gry 0.1" —
 * Gobert at SF, Kukoč 42 minutes on a 34-minute body, a Cigarette Butt on the floor): invariants of
 * the automatic rotation (`minuteAllocation.ts`) over every team of several seeded AI leagues.
 */
import { createDraft, autoFinishDraft } from '../src/engine/draft';
import { optimizeSpans } from '../src/engine/spanOptimizer';
import { autoAssignRotation, allAssignments, GAME_MINUTES, MAX_MINUTES_PER_PLAYER, isForcedStarSlot } from '../src/engine/rotation';
import { positionFitMultiplier, STARTER_SLOTS, CAP_LIMIT } from '../src/engine/positions';
import { maxSustainableMinutes } from '../src/engine/durability';
import { minuteProfileForSpan } from '../src/engine/rotationRoleMinutes';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

let teams = 0;
let slotShort = 0;
let overDurability = 0;
let twoAway = 0;
let overCeiling = 0;
const examples: string[] = [];
for (const seed of [101, 202, 303]) {
  const state = autoFinishDraft(createDraft(false, undefined, undefined, seed));
  for (const t of state.teams) {
    const roster = optimizeSpans(t.roster, CAP_LIMIT);
    const team = { ...t, roster, rotation: autoAssignRotation(roster) };
    teams++;
    const assignments = allAssignments(team);
    for (const slot of STARTER_SLOTS) {
      const total = assignments.filter((a) => a.slot === slot).reduce((sum, a) => sum + a.minutes, 0);
      if (total !== GAME_MINUTES) slotShort++;
    }
    const totals = new Map<string, number>();
    for (const a of assignments) {
      totals.set(a.player.id, (totals.get(a.player.id) ?? 0) + a.minutes);
    }
    // Two positions away is a violation only when someone who can play the slot still had minutes
    // left under his durability — a roster with every such player maxed out has no better option.
    for (const a of assignments) {
      // A must-start star started next to his position (rotation.ts forceStarsIntoLineup) is the
      // intended placement, not a two-away filler.
      if (a.minutes <= 0 || positionFitMultiplier(a.player, a.slot) > 0 || isForcedStarSlot(a.player, a.slot)) continue;
      const spare = roster.filter(
        (p) => positionFitMultiplier(p, a.slot) > 0 && (totals.get(p.id) ?? 0) < maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER),
      );
      if (spare.length > 0) {
        twoAway++;
        examples.push(`${a.player.playerName} (${a.player.primaryPosition}) at ${a.slot} ${a.minutes}m while ${spare.map((p) => p.playerName).join(', ')} had minutes left`);
      }
    }
    for (const p of roster) {
      const minutes = totals.get(p.id) ?? 0;
      if (minutes > maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER)) {
        overDurability++;
        examples.push(`${p.playerName} ${minutes}/${maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER)} durability`);
      }
      if (minutes > minuteProfileForSpan(p).ceiling) {
        // Avoidable only if a teammate who plays one of his slots was still under his own limits.
        const hisSlots = assignments.filter((a) => a.player.id === p.id && a.minutes > 0).map((a) => a.slot);
        const cover = roster.filter(
          (q) =>
            q.id !== p.id &&
            hisSlots.some((slot) => positionFitMultiplier(q, slot) > 0) &&
            (totals.get(q.id) ?? 0) < Math.min(minuteProfileForSpan(q).ceiling, maxSustainableMinutes(q, MAX_MINUTES_PER_PLAYER)),
        );
        if (cover.length > 0) {
          overCeiling++;
          examples.push(`${p.playerName} ${minutes}/${minuteProfileForSpan(p).ceiling} tier ceiling while ${cover.map((q) => q.playerName).join(', ')} had room`);
        }
      }
    }
  }
}
console.log(`${teams} teams · short slots ${slotShort} · over durability ${overDurability} · two positions away ${twoAway} · over tier ceiling ${overCeiling}`);
if (examples.length) console.log(examples.slice(0, 10).join('\n'));
check(slotShort === 0, 'every slot is filled to 48 minutes');
check(overDurability === 0, 'no player is played past his durability');
check(twoAway === 0, 'no player is played two positions from his own while someone who plays the slot has minutes left');
check(overCeiling === 0, 'no player is played past his tier ceiling while a teammate who plays his slot has room');
