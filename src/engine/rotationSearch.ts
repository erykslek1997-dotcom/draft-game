import { envVar } from './env';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS } from './rosterConstants';
import { autoAssignRotation, MAX_MINUTES_PER_PLAYER } from './rotation';
import { positionFitMultiplier } from './positions';
import { playableMinutesCap } from './rotationRoleMinutes';
import { scoreTeam } from './scoring';
import type { Rotation, Team } from './types';

/**
 * 2026-11-25 (Wednesday item 5; the user's Marion SF 19 / PF 17 + Majerle 29 beat the auto rotation's
 * Hayes 17 at PF, 87.4 vs 86.5): starting from the auto rotation, move minutes `STEP` at a time
 * between two players at one slot while the team's Overall goes up — any player who can play the slot
 * (positionFitMultiplier >= `MIN_FIT`), within his minute ceiling. Greedy, at most `MAX_ROUNDS` moves.
 */
const STEP = 6;
const MIN_FIT = 0.8;
const MAX_ROUNDS = 8;

export function searchedRotation(roster: PlayerSpan[], base: Rotation = autoAssignRotation(roster)): Rotation {
  let n = 0;
  const team = (rotation: Rotation): Team => ({ id: `search-${n++}`, name: '', draftSlot: 0, isHuman: true, roster, rotation });
  let best = clone(base);
  let bestScore = scoreTeam(team(best)).overallExact;
  const ceiling = new Map(roster.map((p) => [p.id, playableMinutesCap(p, MAX_MINUTES_PER_PLAYER)]));
  const minutesOf = (r: Rotation, id: string) => STARTER_SLOTS.reduce((m, s) => m + r.slots[s].filter((a) => a.playerId === id).reduce((x, a) => x + a.minutes, 0), 0);
  const starterOf = (r: Rotation, slot: Position) => r.slots[slot][0]?.playerId;
  const fits = (p: PlayerSpan, slot: Position) => positionFitMultiplier(p, slot) >= MIN_FIT;
  const byId = new Map(roster.map((p) => [p.id, p]));
  const add = (r: Rotation, slot: Position, id: string, m: number) => {
    const a = r.slots[slot].find((x) => x.playerId === id);
    if (a) a.minutes += m; else r.slots[slot].push({ playerId: id, minutes: m });
    r.slots[slot] = r.slots[slot].filter((x) => x.minutes > 0);
  };
  const startersAt = (r: Rotation) => new Set(STARTER_SLOTS.map((slot) => r.slots[slot][0]?.playerId).filter(Boolean) as string[]);
  const start = clone(best);
  const legal = (r: Rotation) => [...startersAt(start)].every((id) => minutesOf(r, id) >= minutesOf(start, id))
    && STARTER_SLOTS.every((slot) => { const [h, ...rest] = r.slots[slot]; return h && rest.every((x) => x.minutes <= h.minutes); })
    // A minute ceiling binds only on minutes added (the auto rotation itself may sit past one).
    && roster.every((p) => minutesOf(r, p.id) <= Math.max(ceiling.get(p.id) ?? MAX_MINUTES_PER_PLAYER, minutesOf(best, p.id)));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let move: { r: Rotation; score: number } | null = null;
    const consider = (r: Rotation) => {
      if (!legal(r)) return;
      const score = scoreTeam(team(r)).overallExact;
      if (score > (move?.score ?? bestScore) + 0.05) move = { r, score };
    };
    for (const slot of STARTER_SLOTS) {
      // 1. A backup's minutes at a slot go to another player who can play it.
      for (const from of best.slots[slot].slice(1)) {
        if (from.minutes < STEP) continue;
        for (const to of roster) {
          if (to.id === from.playerId || !fits(to, slot)) continue;
          const r = clone(best); add(r, slot, from.playerId, -STEP); add(r, slot, to.id, STEP); consider(r);
        }
      }
      // 2. The slot's starter slides STEP minutes to another slot (taking a backup's there), and a
      //    player who can play his own slot takes those minutes (Marion SF -> PF, Majerle in at SF).
      const sid = starterOf(best, slot);
      const starter = sid ? byId.get(sid) : undefined;
      if (!starter) continue;
      for (const other of STARTER_SLOTS) {
        if (other === slot || !fits(starter, other)) continue;
        for (const backup of best.slots[other].slice(1)) {
          if (backup.minutes < STEP || backup.playerId === starter.id) continue;
          for (const sub of roster) {
            if (sub.id === starter.id || !fits(sub, slot)) continue;
            const r = clone(best);
            add(r, other, backup.playerId, -STEP); add(r, other, starter.id, STEP);
            add(r, slot, starter.id, -STEP); add(r, slot, sub.id, STEP);
            consider(r);
          }
        }
      }
    }
    if (!move) break;
    best = (move as { r: Rotation; score: number }).r;
    bestScore = (move as { r: Rotation; score: number }).score;
  }
  // The starter stays first; the backups by minutes.
  for (const slot of STARTER_SLOTS) { const [h, ...rest] = best.slots[slot]; best.slots[slot] = [h, ...rest.sort((x, y) => y.minutes - x.minutes)]; }
  return best;
}

function clone(r: Rotation): Rotation {
  return { slots: Object.fromEntries(STARTER_SLOTS.map((s) => [s, r.slots[s].map((a) => ({ ...a }))])) as Rotation['slots'] };
}

/** The player's auto rotation: searched (`ROT_SEARCH`, on unless '0'), else the plain auto rotation. */
export function playerAutoRotation(roster: PlayerSpan[]): Rotation {
  return envVar('ROT_SEARCH') !== '0' ? searchedRotation(roster) : autoAssignRotation(roster);
}
