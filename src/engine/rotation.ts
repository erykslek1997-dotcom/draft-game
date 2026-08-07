import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, positionFitMultiplier, isPositionEligible, positionDistance, isUpwardSlide, hardLockedPosition } from './positions';
import { computeTalent } from './talent';
import { maxSustainableMinutes } from './durability';
import { overallTier } from './grades';
import type { Rotation, SlotAssignment, Team } from './types';

export const GAME_MINUTES = 48;
/** Exported so `scoring.ts`'s Curry spacing floor can treat a normal starter workload as "fully
 * playing," rather than measuring against the unrealistic 48-minute ceiling nobody actually
 * reaches. */
export const STARTER_MINUTES = 36;
/** No NBA player realistically plays a full 48 minutes — this is the ceiling for any single
 * player at a single slot, starter or backup, even in a "no realistic backup" fallback. */
export const MAX_MINUTES_PER_PLAYER = 40;
/** A real bench player realistically covers at most a couple of positions in one game, not four or five. */
const MAX_DISTINCT_BACKUP_SLOTS = 2;

/** 2026-08-07, user's explicit rule — see `valueFor`'s use below. */
const STARTER_ELIGIBLE_TIERS = new Set(['Greatest peak', 'MVP', 'All-NBA', 'All-star', 'Starter']);

function emptySlots(): Record<Position, SlotAssignment[]> {
  const slots = {} as Record<Position, SlotAssignment[]>;
  for (const slot of STARTER_SLOTS) slots[slot] = [];
  return slots;
}

/**
 * Exact best assignment of primary starters (36 min each): with only 5 slots and at most
 * 9 players, a full search over every way to assign 5 distinct players to the 5 slots is
 * cheap (well under 9*8*7*6*5 = 15,120 leaves) and guarantees the true best total score —
 * no heuristic (even a good one like most-constrained-slot-first) can fully avoid the
 * occasional case where committing a strong player to a slot they merely fit well strands
 * a later slot with nobody eligible left for it, even though a better global arrangement
 * existed. Backtracking search sidesteps that entirely.
 *
 * Every slot also has an explicit "leave it empty" branch, not just "assign whoever's left" —
 * without it, a roster with fewer than 5 players (e.g. an in-progress draft, 1-4 players in)
 * would force its players into whichever slots the search reaches first in iteration order
 * (PG, then SG, ...) regardless of real fit, and could never even complete the recursion to
 * register a scored candidate at all once it ran out of players before reaching the 5th slot
 * — silently returning an empty assignment instead of the best partial one.
 */
/**
 * 2026-08-06, user-reported (playtest: centers visibly starting at PF instead of a real, on-
 * roster PF). Root-caused, not guessed (`scripts/checkPfDeficitRoot.ts`): it wasn't a drafting
 * or database-scarcity problem — most affected teams (46 of 68 measured cases) HAD a real PF-fit
 * player on the roster the whole time. The actual cause is `bestPrimaryAssignment`'s own exact
 * search: it maximizes total score using the SHARED `positionFitMultiplier` (0.75 for the
 * generic "one spot away" fallback), which is steep enough to matter for backups but not steep
 * enough to stop a redundant elite big from outscoring a genuinely-fitting bench role player —
 * e.g. a Hall-of-Fame center (TAL~85) at PF via the 0.75 fallback (score 63.75) beats a real-fit
 * journeyman PF (TAL~35) at the natural 1.0 (score 35), even though the fit is worse. That's a
 * reasonable trade for a BACKUP fill (see `positionFitMultiplier`'s own docstring — "someone
 * stretched a position is more realistic than nobody there"), but wrong for the primary STARTER,
 * which is what's actually visible and what the user's "not just the best players" fit-first
 * design goal is about.
 *
 * Scoped narrowly: only this search's own value function uses the steeper fallback penalty —
 * `positionFitMultiplier` itself (shared by backup-fill, the judge's fit scoring, and
 * `aiDrafter.ts`'s need assessment) is completely untouched, so nothing downstream of THIS
 * function's actual output changes except "who ends up starting where," which should only ever
 * get MORE realistic, never less.
 *
 * 2026-08-07 follow-up, same user-reported pattern as `positions.ts`'s `isUpwardSlide` (a real
 * PG/SG sliding out to a bigger slot — Hoiberg starting over a benched Stockton was one of the
 * clearest reported cases — losing to a genuinely worse but naturally-slotted player because the
 * flat 0.2 fallback punished the slide regardless of direction). Split the same way: sliding up
 * (PG→SG→SF→PF→C) is barely a downgrade for a starter search, so it gets real room to let a
 * clearly better player's talent win; sliding down (a big at a guard slot — Gobert/Claxton/
 * Robinson/Mutombo at PF, KCP/Novak/Diaw at PG in the same report) is the actually-unrealistic
 * case the original 0.75→0.2 fix was diagnosed around, so it stays steep — slightly steeper than
 * before, since the old flat 0.2 was itself a compromise between these two now-separated cases.
 *
 * The up value needed a second look after the first pass (0.35) still didn't flip the reported
 * Hoiberg/Stockton case: TAL47*1.0 (Hoiberg, natural SG) beat TAL93*0.35=32.55 (Stockton sliding
 * up to SG) — the user's own word for an up-slide was "free," and a merely-larger-than-before
 * multiplier isn't the same claim as "free" when the talent gap is this wide (Stockton would
 * need a slide multiplier >=0.505 just to break even against Hoiberg's specific number, checked
 * directly rather than assumed). Raised to 0.7 — comfortably clears that break-even point with
 * real margin for a genuine star, while staying below an explicit secondary position (0.9), so a
 * confirmed real secondary still means strictly more than an assumed one-spot-up fallback. Kept
 * as its own local constant, not raised to match `positions.ts`'s `ADJACENT_UP_FALLBACK` (0.85)
 * — that one feeds `isRealPositionFit` (>=0.9 gate) indirectly through `positionFitMultiplier`,
 * where going that high would start counting the fallback itself as "real" fit and reopen the
 * already-fixed "fallback masks the very gap it exists to patch" bug in `aiDrafter.ts`'s
 * `assessNeeds`; `starterFitMultiplier` here is local to this search only, so no such coupling
 * exists and it can be set purely on its own merits.
 */
const STARTER_FALLBACK_UP_MULTIPLIER = 0.7;
const STARTER_FALLBACK_DOWN_MULTIPLIER = 0.12;
function starterFitMultiplier(player: PlayerSpan, slot: Position): number {
  // Named hard locks (Barkley PF-only, Pierce SF-only — see `positions.ts`) apply here too:
  // this search has its own separate fit function precisely so the visible starting five can be
  // stricter than the general backup-fill fallback, and a hard lock is the strictest case there
  // is — it would defeat the whole point if the starter search alone could still ignore it.
  const lock = hardLockedPosition(player);
  if (lock) return slot === lock ? 1 : 0;
  if (slot === player.primaryPosition) return 1;
  if (player.secondaryPositions.includes(slot)) return 0.9;
  if (positionDistance(player.primaryPosition, slot) === 1) {
    return isUpwardSlide(player, slot) ? STARTER_FALLBACK_UP_MULTIPLIER : STARTER_FALLBACK_DOWN_MULTIPLIER;
  }
  return 0;
}

/**
 * Now returns the winning assignment's total value alongside the assignment itself — used by
 * `projectedStarterValue` below (2026-08-07, `aiDrafter.ts`'s rotation-aware drafting), which
 * needs bit-identical scoring (`starterFitMultiplier`, the DNP zeroing, everything) to answer
 * "would this candidate actually start" using the SAME ground truth `autoAssignRotation` itself
 * uses, not an independent approximation that could disagree with what actually happens at
 * rotation-build time.
 */
function bestPrimaryAssignment(
  roster: PlayerSpan[],
): { assignment: Partial<Record<Position, PlayerSpan>>; score: number } {
  let best: Partial<Record<Position, PlayerSpan>> = {};
  let bestScore = -Infinity;
  const used = new Set<string>();
  const current: Partial<Record<Position, PlayerSpan>> = {};

  // `computeTalent(player) * positionFitMultiplier(player, slot)` depends only on the (player,
  // slot) pair, never on the rest of the partial assignment — so it's constant across every
  // branch of the search below. Precomputed once here (roster.length * STARTER_SLOTS.length
  // calls, at most 45 for a 9-man roster) instead of recomputed at every recursive node: the
  // search visits on the order of tens of thousands of nodes for a 9-player/5-slot tree (see
  // the docstring above), and `computeTalent` is not itself free — it chains through several
  // real-data corrections (DARKO, hidden-value/portability regressions, defensive accolades),
  // each with its own lazily-built cache. Redoing that per node measured at 1.6-2.1s for a
  // single `autoAssignRotation` call once those caches were warm — pure waste, since nothing
  // about the value changes between nodes. This cache is scoped to one `bestPrimaryAssignment`
  // call (module-level state would go stale the moment `computeTalent`'s own inputs change).
  const valueByPlayerSlot = new Map<string, number>();
  function valueFor(player: PlayerSpan, slot: Position): number {
    const key = `${player.id}|${slot}`;
    let v = valueByPlayerSlot.get(key);
    if (v === undefined) {
      // A DNP-tier (durability cap 0) player contributes zero real minutes at ANY slot, no
      // matter how high their TAL — without this check the exact search below would still
      // rank them by pure talent and could hand them a primary slot they can literally never
      // play, wasting it, when a much lower-rated but actually-playable teammate exists.
      // Zeroing their value ties them with "leave this slot empty" (score+0 either way), and
      // since the search tries "skip" before any player, ties resolve to skip — the DNP
      // player is left in the bench pool instead, where the backup-fill loop's own cap check
      // (`minutesUsed < maxSustainableMinutes`, 0 < 0 is false) already correctly excludes
      // them from ever being picked there either.
      // 2026-08-07, user's explicit rule: "Starter" is the FLOOR overall tier that can occupy a
      // starting-five slot at all — Role Player/Bench Warmer/Cigarette Butt tier talent can only
      // ever be a backup, never the primary, regardless of position fit. Zeroed the same way the
      // DNP check above does (ties with "leave this slot empty," and skip wins ties), so a
      // below-tier player never displaces a genuine empty-slot outcome — the bench-fill loop
      // (untouched, no tier gate there) is exactly where this population belongs.
      const belowStarterTier = !STARTER_ELIGIBLE_TIERS.has(overallTier(computeTalent(player)));
      v =
        maxSustainableMinutes(player, MAX_MINUTES_PER_PLAYER) <= 0 || belowStarterTier
          ? 0
          : computeTalent(player) * starterFitMultiplier(player, slot);
      valueByPlayerSlot.set(key, v);
    }
    return v;
  }

  function search(slotIdx: number, score: number) {
    if (slotIdx === STARTER_SLOTS.length) {
      if (score > bestScore) {
        bestScore = score;
        best = { ...current };
      }
      return;
    }
    const slot = STARTER_SLOTS[slotIdx];

    // Leave this slot unfilled and move on — always explored, so players are only ever
    // assigned where they actually help, never forced into an early slot just because the
    // roster doesn't have enough people to reach the end of the iteration order.
    search(slotIdx + 1, score);

    for (const player of roster) {
      if (used.has(player.id)) continue;
      used.add(player.id);
      current[slot] = player;
      search(slotIdx + 1, score + valueFor(player, slot));
      used.delete(player.id);
      delete current[slot];
    }
  }

  search(0, 0);
  return { assignment: best, score: bestScore === -Infinity ? 0 : bestScore };
}

/** Total value (`computeTalent * starterFitMultiplier`, summed) of the true best starting five
 * `autoAssignRotation` would build for this exact roster — the real ground truth for "how good
 * is this roster's starting lineup," not an approximation. Used by `aiDrafter.ts`'s
 * `marginalStarterValue` to ask whether drafting a candidate actually improves the roster's
 * projected starting five, rather than just adding raw talent that might end up buried on the
 * bench behind a better-fitting incumbent. */
export function projectedStarterValue(roster: PlayerSpan[]): number {
  return bestPrimaryAssignment(roster).score;
}

/**
 * Primaries come from an exact search (see `bestPrimaryAssignment`); a second pass then
 * greedily picks the best-fitting remaining player as a 12-minute backup for each slot —
 * the same bench player can end up backing up more than one slot (e.g. a combo guard
 * covering both PG and SG), same as a real rotation. Backups aren't solved exactly (the
 * minutes-cap and distinct-slot-cap constraints make that more involved), but a greedy
 * pass here only affects who's the *backup*, not the more visually obvious starters.
 */
export function autoAssignRotation(roster: PlayerSpan[]): Rotation {
  const primaryBySlot = bestPrimaryAssignment(roster).assignment;
  const assignedIds = new Set(Object.values(primaryBySlot).map((p) => p!.id));
  const remainingPlayers = roster.filter((p) => !assignedIds.has(p.id));

  // A durability-fragile primary starter is capped below STARTER_MINUTES here (see
  // `maxSustainableMinutes`) — the shortfall isn't lost, it flows straight into `minutesNeeded`
  // below and gets picked up by the normal backup-filling loop, same as any other gap.
  const slots = emptySlots();
  for (const slot of STARTER_SLOTS) {
    const primary = primaryBySlot[slot];
    if (primary) {
      const grant = Math.min(STARTER_MINUTES, maxSustainableMinutes(primary, MAX_MINUTES_PER_PLAYER));
      slots[slot].push({ playerId: primary.id, minutes: grant });
    }
  }

  const minutesUsed = new Map<string, number>(remainingPlayers.map((p) => [p.id, 0]));
  const slotsBackedUp = new Map<string, number>(remainingPlayers.map((p) => [p.id, 0]));

  /**
   * Every slot has to add up to a full 48 minutes — somebody is on the floor at that spot
   * for the whole game. Finding that somebody goes through progressively looser tiers,
   * only dropping to the next once the previous one has nobody left with capacity:
   *  0. A position-eligible bench player, under the normal distinct-slot cap (the ordinary
   *     case — a real backup who isn't already stretched across too many other slots).
   *  1. Still position-eligible (real primary/secondary, or one spot away — never someone
   *     genuinely out of position), but the distinct-slot cap is relaxed: a versatile combo
   *     player already covering 2 other slots can cover a 3rd real fit before we resort to
   *     someone with zero fit at all.
   *  2. Truly last resort: any bench player, position ignored entirely. On a 9-man roster
   *     there sometimes simply isn't a second natural center (or point guard) left with
   *     capacity anywhere, and somebody covering out of position is more realistic than
   *     nobody playing those minutes. Self-penalizing rather than free — `positionFitMultiplier`
   *     returns a reduced or zero value for an unrealistic slot, so those minutes contribute
   *     little or no talent to the team's score.
   *
   * 2026-08-05 fix: tier 1 used to drop position eligibility entirely (identical to tier 2
   * minus the slot cap), not just relax the distinct-slot cap as the comment always claimed —
   * confirmed via user feedback surfacing 2-positions-away assignments (a center at SF) that
   * should only ever have been reachable via the true last-resort tier 2, not the "still
   * realistic" tier 1. `positionDistance`-based sorting below already prefers the closest match
   * within whichever tier is active, but that only picks the *best* of the tier's candidates —
   * it can't stop a too-loose tier from admitting a bad one when nothing better is left in it.
   */
  // 2026-08-07, user-reported (live playtest, a human-drafted roster with zero real bench
  // guards): tier 2 ("any bench player, position ignored entirely") used to fire BEFORE the
  // "extend the primary starter's own minutes" fallback below — it was the true last resort,
  // reached only once every OTHER player was already at their own cap. That ordering means a
  // wing gets stretched to backup PG for 12 real minutes even when the actual PG starter had
  // real headroom left under his own durability cap the whole time — a real GM plays his
  // healthy starter 40 minutes before he plays a small forward at point guard. Split out as its
  // own named tier so the primary-extension fallback (still below, in the main loop) can be
  // tried in between: realistic bench fits first, then "play the starter more," and only THEN
  // (if the starter is himself durability-capped) a position-blind bench fallback.
  const REALISTIC_TIERS = [
    (p: PlayerSpan, slot: Position) =>
      isPositionEligible(p, slot) && (slotsBackedUp.get(p.id) ?? 0) < MAX_DISTINCT_BACKUP_SLOTS,
    (p: PlayerSpan, slot: Position) => isPositionEligible(p, slot),
  ];
  const LAST_RESORT_TIER = () => true;

  // Slots are resolved most-constrained-first (fewest real eligible backups left), not in a
  // fixed PG-through-C order. A fixed order lets an early slot in the iteration greedily
  // spend a versatile bench player (e.g. a combo guard) who was actually the *only* realistic
  // option for a later slot, forcing that later slot into an off-position fill it didn't
  // need to take. Recomputed after each slot is resolved, since assigning a player can use up
  // capacity (minutes cap, distinct-slot cap) that a still-unresolved slot was relying on.
  const unresolvedSlots = new Set<Position>(STARTER_SLOTS);
  while (unresolvedSlots.size > 0) {
    let slot: Position = unresolvedSlots.values().next().value!;
    let fewestOptions = Infinity;
    for (const candidateSlot of unresolvedSlots) {
      const usedHere = new Set(slots[candidateSlot].map((a) => a.playerId));
      const optionCount = remainingPlayers.filter(
        (p) =>
          !usedHere.has(p.id) &&
          (minutesUsed.get(p.id) ?? 0) < maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER) &&
          isPositionEligible(p, candidateSlot) &&
          (slotsBackedUp.get(p.id) ?? 0) < MAX_DISTINCT_BACKUP_SLOTS,
      ).length;
      if (optionCount < fewestOptions) {
        fewestOptions = optionCount;
        slot = candidateSlot;
      }
    }
    unresolvedSlots.delete(slot);

    const usedInSlot = new Set(slots[slot].map((a) => a.playerId));
    let minutesNeeded = GAME_MINUTES - slots[slot].reduce((sum, a) => sum + a.minutes, 0);

    // Fill with as many contributors as it takes, not just one: once the 40-minute per-player
    // cap has other claims on a backup, a 2nd or 3rd picks up the remainder.
    //
    // 2026-08-07, user-reported rigidity (three independent cases: "why doesn't McMillan just
    // play 18 minutes" instead of PJ Brown getting a token slot; Charles Jones getting a 6-min
    // sliver instead of Horry; Mason/"Anthony" starting at PF while Kirilenko sits underused):
    // the loop below used to cap every single grant at a flat `BACKUP_MINUTES` (12), even when
    // the best-fitting candidate had far more real capacity left AND the slot needed more than
    // 12 more minutes (e.g. a durability-capped starter leaves >12 to cover). That forced a
    // genuinely good backup to be "used up" in exactly-12-minute slices and pushed the loop to
    // reach for a SECOND, often much worse-fitting contributor to cover the rest — the comment
    // immediately above already says a 2nd/3rd contributor should only appear once the first
    // one's OWN durability cap forces it, but the flat 12 cap forced it far more often than
    // that. Removed: a single strong-fit candidate can now absorb the slot's whole remaining
    // need up to their real capacity, and the loop only reaches for another contributor when
    // that capacity is actually exhausted — matching what the comment already claimed.
    function fillFromTier(tierAllows: (p: PlayerSpan, slot: Position) => boolean) {
      while (minutesNeeded > 0) {
        const candidates = remainingPlayers.filter(
          (p) =>
            !usedInSlot.has(p.id) &&
            (minutesUsed.get(p.id) ?? 0) < maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER) &&
            tierAllows(p, slot),
        );

        let best: PlayerSpan | null = null;
        let bestKey: [number, number] = [-Infinity, Infinity];
        for (const player of candidates) {
          // 2026-08-07, user-reported real-data bug: Joe Ingles (explicit PF secondary, mult
          // 0.9, TAL 60 -> value 54) lost a PF backup slot to Chris Andersen (natural PF, mult
          // 1.0, TAL 41 -> value 41) — a worse player by a real margin — purely because the OLD
          // key sorted by raw position distance FIRST, value second, so any distance-0 candidate
          // auto-beat a distance-1 one no matter the value gap. `positionFitMultiplier` already
          // encodes realism correctly (1.0 primary / 0.9 secondary / 0.85 upward-adjacent / 0.5
          // downward-adjacent / 0 two-plus-away, gated out upstream by `tierAllows` before this
          // even runs) — value (talent x that multiplier) is now the PRIMARY sort key, matching
          // how every other position-fit decision in this engine already works (`starterFitMultiplier`
          // in `bestPrimaryAssignment`, `positionFitMultiplier` in `fitScore`). Raw distance is
          // now only a tiebreak for a genuine value tie, so it still prefers the more natural fit
          // when two candidates are otherwise equal, without ever letting "closer" override a
          // real value gap.
          const key: [number, number] = [
            computeTalent(player) * Math.max(positionFitMultiplier(player, slot), 0.01),
            positionDistance(player.primaryPosition, slot),
          ];
          if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
            bestKey = key;
            best = player;
          }
        }
        if (!best) break;

        const capacity = maxSustainableMinutes(best, MAX_MINUTES_PER_PLAYER) - (minutesUsed.get(best.id) ?? 0);
        const grant = Math.min(minutesNeeded, capacity);
        slots[slot].push({ playerId: best.id, minutes: grant });
        minutesUsed.set(best.id, (minutesUsed.get(best.id) ?? 0) + grant);
        slotsBackedUp.set(best.id, (slotsBackedUp.get(best.id) ?? 0) + 1);
        usedInSlot.add(best.id);
        minutesNeeded -= grant;
      }
    }

    for (const tierAllows of REALISTIC_TIERS) {
      fillFromTier(tierAllows);
      if (minutesNeeded <= 0) break;
    }

    if (minutesNeeded > 0) {
      // 2026-08-07 reorder (see REALISTIC_TIERS/LAST_RESORT_TIER comment above): try playing
      // the primary starter more, up to THEIR OWN durability cap, before ever reaching for a
      // position-blind bench fallback. A real GM plays a healthy star 40 minutes before he
      // plays a small forward at point guard — this is now tried strictly before, not after,
      // the "any bench player" tier below.
      const primaryEntry = slots[slot][0];
      const primaryPlayer = primaryBySlot[slot];
      if (primaryEntry && primaryPlayer) {
        const cap = maxSustainableMinutes(primaryPlayer, MAX_MINUTES_PER_PLAYER);
        const extra = Math.max(0, Math.min(minutesNeeded, cap - primaryEntry.minutes));
        primaryEntry.minutes += extra;
        minutesNeeded -= extra;
      }
    }

    if (minutesNeeded > 0) {
      // True last resort: position ignored entirely. Only reached now if extending the
      // primary couldn't fully cover the gap either (he's durability-capped too) — a genuinely
      // threadbare-at-this-position roster, where the least-bad remaining option really is
      // someone stretched two-plus positions away for however many minutes are left.
      fillFromTier(LAST_RESORT_TIER);
    }

    if (minutesNeeded > 0) {
      // Nothing left anywhere, including the primary — leave the slot short rather than
      // silently overworking someone past their own cap to hide it (same as before this change).
    }
  }

  return { slots };
}

export function totalMinutesForPlayer(rotation: Rotation | null, playerId: string): number {
  if (!rotation) return 0;
  let total = 0;
  for (const slot of STARTER_SLOTS) {
    for (const a of rotation.slots[slot] ?? []) {
      if (a.playerId === playerId) total += a.minutes;
    }
  }
  return total;
}

export interface ResolvedSlotAssignment {
  slot: Position;
  player: PlayerSpan;
  minutes: number;
}

function resolve(roster: PlayerSpan[], assignments: SlotAssignment[], slot: Position): ResolvedSlotAssignment[] {
  return assignments
    .map((a) => {
      const player = roster.find((p) => p.id === a.playerId);
      return player ? { slot, player, minutes: a.minutes } : null;
    })
    .filter((x): x is ResolvedSlotAssignment => x !== null);
}

export function allAssignments(team: Team): ResolvedSlotAssignment[] {
  if (!team.rotation) return [];
  return STARTER_SLOTS.flatMap((slot) => resolve(team.roster, team.rotation!.slots[slot] ?? [], slot));
}

/** The highest-minutes player at each slot — the "starter" used for fit/role checks. */
export function primaryStarters(team: Team): ResolvedSlotAssignment[] {
  if (!team.rotation) return [];
  const result: ResolvedSlotAssignment[] = [];
  for (const slot of STARTER_SLOTS) {
    const resolved = resolve(team.roster, team.rotation.slots[slot] ?? [], slot);
    if (resolved.length === 0) continue;
    const top = resolved.reduce((best, cur) => (cur.minutes > best.minutes ? cur : best));
    result.push(top);
  }
  return result;
}

/** Every rostered player who isn't the primary starter at some slot, including 0-minute deep bench. */
export function benchWithMinutes(team: Team): { player: PlayerSpan; minutes: number }[] {
  const primaryIds = new Set(primaryStarters(team).map((s) => s.player.id));
  return team.roster
    .filter((p) => !primaryIds.has(p.id))
    .map((p) => ({ player: p, minutes: totalMinutesForPlayer(team.rotation, p.id) }));
}
