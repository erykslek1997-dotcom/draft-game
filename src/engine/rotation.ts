import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, positionFitMultiplier, isPositionEligible, isRealPositionFit, positionDistance, isUpwardSlide, hardLockedPosition } from './positions';
// 2026-08-19: `computeTalent` import replaced with `effectiveTalent` (grades.ts) throughout —
// every real starter/backup assignment decision here now uses the same tier-capped number
// `aiDrafter.ts` and the displayed badge already use, closing a real raw-vs-display gap (see
// `effectiveTalent`'s own docstring for the full "why").
import { maxSustainableMinutes } from './durability';
import { overallTierForSpan, effectiveTalent } from './grades';
import { tierContextWithSixthMan } from './sixthMan';
import { minuteProfileForSpan } from './rotationRoleMinutes';
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
/** See the 2026-08-15 comment on its one use site (`fillFromTier` below) for the full case. */
const UNUSED_REAL_FIT_BACKUP_BOOST = 1.15;
/** A 9th man who is actually rotation-caliber should not become an accidental DNP solely because
 * the greedy slot fill spent all minutes on earlier candidates. This is deliberately below a
 * normal 12-minute backup role: it protects a real role without forcing a weak player into a
 * full rotation workload. */
const MIN_USEFUL_BENCH_MINUTES = 8;
const USEFUL_BENCH_TALENT_FLOOR = 55;
const USEFUL_BENCH_DONOR_TALENT_GAP = 12;

/**
 * 2026-08-15, user-reported (recurring pattern across several real drafts, most recently David
 * Wesley — a pure PG — playing real minutes at SF/PF/C, then Kyle Lowry — also a pure PG — playing
 * 8 real minutes at Center): `positionFitMultiplier` returns exactly 0 for any candidate 2+
 * positions away with no explicit secondary, and this tier's own value formula floored that 0 to
 * one FLAT 0.01 regardless of how far 2+ actually was — a PG at C (distance 4, the worst possible
 * fit in this game) got the exact same floor as an SF at C (distance 2, meaningfully closer to
 * realistic) — so pure raw talent decided among last-resort candidates with zero regard for HOW
 * unrealistic each one actually was. Gives the floor real, distance-decreasing weight instead —
 * still a "value decides, not raw distance" tier by design (matching this function's own
 * established philosophy for the near cases, see the 2026-08-07 comment below), a big enough
 * talent gap can still win, this only stops equally-flat-zero candidates from being compared as if
 * they were equally unrealistic. distance 2 -> 0.10, distance 3 -> 0.055, distance 4 -> 0.01.
 */
function lastResortFloor(distance: number): number {
  return Math.max(0.01, 0.19 - distance * 0.045);
}

/** 2026-08-07, user's explicit rule — see `valueFor`'s use below.
 * 2026-08-15 CRITICAL FIX, same-day regression from the Sixth Man fix just above this file's own
 * history: `belowStarterTier` used to check the RAW `overallTier(computeTalent(player))`
 * (grades.ts), which — per that function's own documented behavior — "never actually returns"
 * 'GOAT' (a display-only tier only `overallTierForSpan`'s per-span upgrade can produce). Switching
 * to the span-aware `overallTierForSpan` to fix Sixth Man immediately exposed that this set was
 * never updated for the one tier ABOVE 'Greatest peak' — Jordan 1990-92 (TAL98, GOAT) and Curry
 * 2014-16 (TAL97, GOAT) both got silently zeroed out of `bestPrimaryAssignment` entirely and
 * benched, despite being the highest-TAL players on their own rosters. 'GOAT' added — it was
 * always meant to mean "even better than Greatest peak," never "ineligible to start." */
const STARTER_ELIGIBLE_TIERS = new Set(['GOAT', 'Greatest peak', 'MVP', 'All-NBA', 'All-star', 'Starter']);

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
 *
 * 2026-08-15 follow-up, user-reported (real diagnostics: Chris Mullin TAL70 sliding up SF->PF
 * beat Dāvis Bertāns TAL50, a real-fit native PF, entirely burying him at 0 minutes; same shape
 * with Mike Miller TAL66 over P.J. Tucker TAL45). The flat 0.7 up-slide multiplier was tuned
 * specifically against the Stockton/Hoiberg gap (TAL90 vs TAL50, a genuine star) and works
 * correctly there — but the SAME flat multiplier also lets a merely-good off-position player
 * (TAL70, nowhere near a real star) beat a weak-but-real specialist, which was never the intent
 * ("a genuine talent gap should still win," not "any positive talent gap should win"). Split by
 * the sliding candidate's own talent: elite (`STARTER_UP_SLIDE_ELITE_TALENT_FLOOR`, 85 — the same
 * "genuine star, not just good" magnitude this file's neighbors already use, e.g.
 * `aiDrafter.ts`'s various 85-96 elite gates) keeps the original 0.7 that Stockton (TAL~90) needs
 * and comfortably clears; below that floor, the steeper `STARTER_FALLBACK_UP_MULTIPLIER_ORDINARY`
 * applies instead. Solved directly, not guessed: fixing BOTH real cases requires the ordinary
 * multiplier < min(45/70, 50/70) = 0.643 (Tucker/Miller is the tighter constraint); 0.55 leaves
 * real margin below that on both, the same "don't sit right at the edge" philosophy
 * `ELITE_TALENT_FGA_PENALTY_DAMPENING` (aiDrafter.ts) already uses for an analogous problem.
 */
const STARTER_FALLBACK_UP_MULTIPLIER = 0.7;
const STARTER_FALLBACK_UP_MULTIPLIER_ORDINARY = 0.55;
const STARTER_UP_SLIDE_ELITE_TALENT_FLOOR = 85;
const STARTER_FALLBACK_DOWN_MULTIPLIER = 0.12;
/**
 * 2026-08-15, user-reported (real diagnostics: "główny problem to że Duncan gra z ławki" — Tim
 * Duncan 2005-07, TAL89, real EXPLICIT PF secondary, lost the PF starting job to Bobby Jones
 * (TAL81, real primary) by 89*0.9=80.1 vs 81*1.0=81 — a 0.9-point margin, decided almost entirely
 * by the discount itself rather than any real basketball judgment). First tried raising the
 * discount (0.9->0.95); the user's own same-session follow-up asked the sharper question
 * directly — "does a confirmed real secondary even need a penalty at all?" A CONFIRMED,
 * explicitly-tagged secondary position is not the same claim as the fallback cases below (an
 * ASSUMED one-spot slide, no real tag at all) — it's real, validated data saying this player
 * genuinely plays this position too. `aiDrafter.ts`'s own need-assessment (`isRealPositionFit`)
 * already treats primary and secondary as equally "real" with no weight difference at all for
 * depth-counting purposes — this search was the one place still second-guessing confirmed data
 * with an arbitrary discount. Dropped to full parity with primary (1.0): a real secondary now
 * means exactly what the tag claims, no residual penalty for being "merely" secondary.
 */
function starterFitMultiplier(player: PlayerSpan, slot: Position): number {
  // Named hard locks (Barkley PF-only, Pierce SF-only — see `positions.ts`) apply here too:
  // this search has its own separate fit function precisely so the visible starting five can be
  // stricter than the general backup-fill fallback, and a hard lock is the strictest case there
  // is — it would defeat the whole point if the starter search alone could still ignore it.
  const lock = hardLockedPosition(player);
  if (lock) return slot === lock ? 1 : 0;
  if (slot === player.primaryPosition || player.secondaryPositions.includes(slot)) return 1;
  if (positionDistance(player.primaryPosition, slot) === 1) {
    if (!isUpwardSlide(player, slot)) return STARTER_FALLBACK_DOWN_MULTIPLIER;
    return effectiveTalent(player) >= STARTER_UP_SLIDE_ELITE_TALENT_FLOOR
      ? STARTER_FALLBACK_UP_MULTIPLIER
      : STARTER_FALLBACK_UP_MULTIPLIER_ORDINARY;
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
/**
 * 2026-09-09, user-reported ("gra działa wolno" on the draft): `pickForAi`'s bench rounds
 * (`aiDrafter.ts`, roster size >= 5) call `autoAssignRotation` / `projectedStarterValue` — both
 * of which route through this exact search — 40-80 times per pick (a `playable` scan followed by
 * an overlapping `qualityReserve` re-scan over the same `[...roster, candidate]` rosters).
 * Profiled: `pickForAi` cost jumps ~350ms -> ~2500ms at roster size 5, i.e. this search runs
 * tens of thousands of nodes per call and is re-run for rosters it has already solved verbatim.
 * The result is a pure function of the roster (talent/fit lookups it reads are all individually
 * memoized and stable within a session), so memoize by the roster's id sequence. The returned
 * `assignment` is a fresh object every caller only reads — safe to share. Key is order-sensitive
 * on purpose: a different order is a cache miss that recomputes exactly as before (zero behavior
 * change), and every real repeat (`pickForAi`'s two passes, a display re-render of the same
 * roster) passes the same order.
 */
const bestPrimaryAssignmentCache = new Map<string, { assignment: Partial<Record<Position, PlayerSpan>>; score: number }>();
const BEST_PRIMARY_ASSIGNMENT_CACHE_CAP = 20000;

/** 2026-09-11: exported (was module-private) so `quickDraft.ts`'s Szybka 5 mode can reuse this
 * exact optimal starter-slot search directly — it needs "which of my 5 drafted players fits which
 * slot best" without the minutes-distribution half of `autoAssignRotation` below, which is wrong
 * for a bare 5-man roster (see Best Five's own `lineupTeam` docstring: it "leaves sub-Starter-tier
 * slots empty and overworks the rest" there). Pure export, zero behavior change to any existing
 * caller — the function body is untouched. */
export function bestPrimaryAssignment(
  roster: PlayerSpan[],
): { assignment: Partial<Record<Position, PlayerSpan>>; score: number } {
  const cacheKey = roster.map((p) => p.id).join('|');
  const cached = bestPrimaryAssignmentCache.get(cacheKey);
  if (cached) return cached;

  let best: Partial<Record<Position, PlayerSpan>> = {};
  let bestScore = -Infinity;
  let bestPrimaryMatches = -Infinity;
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
      //
      // 2026-08-15, user-reported (real diagnostic: Dana Barros — a real Sixth Man profile,
      // literally the named example `sixthMan.ts`'s own docstring is motivated by — starting at
      // PG for 36 minutes). Root cause: this used the RAW numeric `overallTier(computeTalent(...))`
      // (grades.ts), which never returns 'Sixth Man' at all — that relabel only exists on the
      // span-aware `overallTierForSpan`/`tierContextWithSixthMan` path (sixthMan.ts), which this
      // exact-search never consulted. So the whole point of the tag — "real offense, not a
      // two-way starting case" — had zero effect on whether the search would start him anyway.
      // Switched to the span-aware version so 'Sixth Man' is excluded from `STARTER_ELIGIBLE_
      // TIERS` exactly like every other below-Starter tier already is.
      const belowStarterTier = !STARTER_ELIGIBLE_TIERS.has(overallTierForSpan(tierContextWithSixthMan(player)));
      v =
        maxSustainableMinutes(player, MAX_MINUTES_PER_PLAYER) <= 0 || belowStarterTier
          ? 0
          : effectiveTalent(player) * starterFitMultiplier(player, slot);
      valueByPlayerSlot.set(key, v);
    }
    return v;
  }

  // Admissible branch-and-bound bound. `slotMax[i]` = the highest value ANY roster player could
  // bring to slot i, ignoring whether they are already used elsewhere — using a player at another
  // slot can only *lower* what is available here, so this never underestimates a real completion.
  // `suffixMax[i]` sums that from slot i to the end: the most additional score any completion from
  // slot i onward could possibly reach. A branch whose running `score + suffixMax[slotIdx]` cannot
  // clear the best complete lineup found so far (by a real margin, not a float ULP) can contain
  // no better *or equal* lineup, so it is pruned — the `primaryMatches` tiebreak at a genuine
  // exact tie is never pruned because the cut is strict-with-margin. Cuts the ~30k-node search
  // for a 9-man roster by roughly an order of magnitude; the returned assignment is identical
  // (2026-09-09, draft-speed pass — profiled `pickForAi` bench rounds at ~2.5s/pick, ~90% of it
  // here).
  const slotMax = STARTER_SLOTS.map((slot) => {
    let m = 0;
    for (const player of roster) {
      const v = valueFor(player, slot);
      if (v > m) m = v;
    }
    return m;
  });
  const suffixMax: number[] = new Array(STARTER_SLOTS.length + 1).fill(0);
  for (let i = STARTER_SLOTS.length - 1; i >= 0; i--) suffixMax[i] = suffixMax[i + 1] + slotMax[i];
  const PRUNE_MARGIN = 1e-6;

  function search(slotIdx: number, score: number, primaryMatches: number) {
    if (bestScore > -Infinity && score + suffixMax[slotIdx] < bestScore - PRUNE_MARGIN) return;
    if (slotIdx === STARTER_SLOTS.length) {
      // Explicit secondary positions remain full-value, exactly as `starterFitMultiplier`
      // promises. When two complete lineups have IDENTICAL value, however, prefer the one that
      // places more players at their primary position. This is a pure tiebreak, not a secondary-
      // position penalty: Wembanyama(C/PF)+Webber(PF/C) should display as Wemby C / Webber PF,
      // rather than the reversed but numerically identical arrangement determined by iteration
      // order alone.
      if (score > bestScore || (score === bestScore && primaryMatches > bestPrimaryMatches)) {
        bestScore = score;
        bestPrimaryMatches = primaryMatches;
        best = { ...current };
      }
      return;
    }
    const slot = STARTER_SLOTS[slotIdx];

    // Leave this slot unfilled and move on — always explored, so players are only ever
    // assigned where they actually help, never forced into an early slot just because the
    // roster doesn't have enough people to reach the end of the iteration order.
    search(slotIdx + 1, score, primaryMatches);

    for (const player of roster) {
      if (used.has(player.id)) continue;
      used.add(player.id);
      current[slot] = player;
      search(slotIdx + 1, score + valueFor(player, slot), primaryMatches + Number(player.primaryPosition === slot));
      used.delete(player.id);
      delete current[slot];
    }
  }

  search(0, 0, 0);
  const result = { assignment: best, score: bestScore === -Infinity ? 0 : bestScore };
  if (bestPrimaryAssignmentCache.size >= BEST_PRIMARY_ASSIGNMENT_CACHE_CAP) bestPrimaryAssignmentCache.clear();
  bestPrimaryAssignmentCache.set(cacheKey, result);
  return result;
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
/**
 * 2026-09-09, draft-speed pass: `pickForAi`'s bench rounds call this 40+ times per pick over
 * `[...roster, candidate]` rosters — including a second `qualityReserve` scan over the same
 * rosters — and it was profiled as the remaining hot path once `bestPrimaryAssignment` was
 * memoized (~30ms per call for the greedy backup-fill, ~47ms with the exact search on top).
 * The output is a pure function of the roster (id sequence), so cache it. Callers only ever
 * READ the returned `Rotation` (grep-verified: no `.slots[...].push` / minute reassignment
 * outside this file — the rotation editor builds a fresh object from its own row state), but to
 * keep the cache defensively immune to a future mutating caller, each hit returns a shallow
 * clone of the slot arrays (5 slots x ~2 entries — trivial next to the solve it skips).
 */
const autoAssignRotationCache = new Map<string, Rotation>();
const AUTO_ASSIGN_ROTATION_CACHE_CAP = 20000;

function cloneRotation(rotation: Rotation): Rotation {
  const slots = {} as Record<Position, SlotAssignment[]>;
  for (const slot of STARTER_SLOTS) slots[slot] = rotation.slots[slot].map((a) => ({ ...a }));
  return { slots };
}

/**
 * 2026-09-24, user's own call: the human's Team-tab rotation used to start completely empty
 * (10+ dropdowns/minute boxes before "Submit Team" even enabled), after the earlier one-click
 * optimal auto-fill was removed for doing the thinking for the player. This is the middle ground
 * the user asked for — a complete, legal starting point that is deliberately NOT optimized: it
 * never compares players by talent or fit, so the player still has real decisions left to make
 * and the UI says as much next to it.
 *
 * Starters: the earliest-drafted player at his natural position for each slot, then listed
 * secondary positions, then other real fits, then anyone eligible, then anyone left.
 *
 * Same-day follow-up ("wzmocnij lekko sugestię rotacji" — the first version averaged ~72/100
 * Rotation vs ~91 for `autoAssignRotation`, bottoming out near 10 on unbalanced rosters): two
 * rules the game already enforces, still no talent comparison —
 * - minutes respect each player's own ceiling (durability-safe minutes and the tier minutes cap
 *   `rotationScore` penalizes past): a starter gets up to 36, and whatever he can't cover passes
 *   to the next contributor instead of being played anyway;
 * - backups come by positional fit first (natural or listed position, then an upward slide such
 *   as a PG at SG), so nobody is sent DOWN the lineup (a big at a guard spot) while a real fit is
 *   still available. Earliest-drafted wins within the same fit level.
 * Only when the roster simply can't cover a slot within those limits does it stretch someone.
 */
const DOWNWARD_GRACE_MINUTES: Record<Position, number> = { C: 0, PF: 4, SF: 8, SG: 12, PG: 12 };

export function suggestBasicRotation(roster: PlayerSpan[]): Rotation {
  const slots = emptySlots();
  const used = new Set<string>();
  const minutesUsed = new Map<string, number>();
  const backupSlotsUsed = new Map<string, number>();
  const ceilingOf = (p: PlayerSpan) =>
    Math.min(MAX_MINUTES_PER_PLAYER, maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER), minuteProfileForSpan(p).ceiling);
  const spare = (p: PlayerSpan) => Math.max(0, ceilingOf(p) - (minutesUsed.get(p.id) ?? 0));
  const give = (slot: Position, p: PlayerSpan, minutes: number) => {
    if (minutes <= 0) return;
    const existing = slots[slot].find((a) => a.playerId === p.id);
    if (existing) existing.minutes += minutes;
    else slots[slot].push({ playerId: p.id, minutes });
    minutesUsed.set(p.id, (minutesUsed.get(p.id) ?? 0) + minutes);
  };
  /** 0 natural, 1 listed secondary, 2 upward slide, 3 eligible stretch, 4 anything else. */
  const fitRank = (p: PlayerSpan, slot: Position) =>
    p.primaryPosition === slot
      ? 0
      : p.secondaryPositions.includes(slot)
        ? 1
        : isUpwardSlide(p, slot) && isPositionEligible(p, slot)
          ? 2
          : isPositionEligible(p, slot)
            ? 3
            : 4;

  // A starter should be able to play starter-ish minutes at all — a Salary Glue piece (tier
  // minutes cap 0) at his natural position still loses the slot to a real fit who can.
  const canStart = (p: PlayerSpan) => ceilingOf(p) >= 24;
  // Filled tier by tier across ALL slots (every natural-position starter first, then listed
  // secondaries, …), not slot by slot — otherwise an early slot grabs a player by his secondary
  // position (LeBron at PG) and leaves a later slot to a player who can't really start there.
  const starterTiers: ((p: PlayerSpan, slot: Position) => boolean)[] = [
    (p, slot) => p.primaryPosition === slot && canStart(p),
    (p, slot) => p.secondaryPositions.includes(slot) && canStart(p),
    (p, slot) => isRealPositionFit(p, slot) && canStart(p),
    (p, slot) => p.primaryPosition === slot,
    (p, slot) => isRealPositionFit(p, slot),
    (p, slot) => isPositionEligible(p, slot),
    () => true,
  ];
  const starterBySlot = new Map<Position, PlayerSpan>();
  for (const fits of starterTiers) {
    for (const slot of STARTER_SLOTS) {
      if (starterBySlot.has(slot)) continue;
      const pick = roster.find((p) => !used.has(p.id) && fits(p, slot));
      if (!pick) continue;
      used.add(pick.id);
      starterBySlot.set(slot, pick);
    }
  }
  for (const slot of STARTER_SLOTS) {
    const starter = starterBySlot.get(slot);
    if (starter) give(slot, starter, Math.min(STARTER_MINUTES, spare(starter)));
  }

  const bench = roster.filter((p) => !used.has(p.id));
  const otherStartersAny = (starter: PlayerSpan) => [...starterBySlot.values()].filter((p) => p.id !== starter.id);
  for (const slot of STARTER_SLOTS) {
    const starter = starterBySlot.get(slot);
    if (!starter) continue;
    const slotTotal = () => slots[slot].reduce((sum, a) => sum + a.minutes, 0);
    // Order of who covers the rest of the slot, all without sending anyone down the lineup:
    // bench players who fit (natural, listed, or an upward slide), then this slot's own starter up
    // to his ceiling, then other starters' leftover minutes — draft order within a fit level
    // (Array.prototype.sort is stable).
    const fittingBench = bench
      .filter((p) => fitRank(p, slot) <= 2)
      .sort((a, b) => fitRank(a, slot) - fitRank(b, slot));
    const otherStarters = [...starterBySlot.values()]
      .filter((p) => p.id !== starter.id && fitRank(p, slot) <= 2)
      .sort((a, b) => fitRank(a, slot) - fitRank(b, slot));
    for (const p of fittingBench) {
      const need = GAME_MINUTES - slotTotal();
      if (need <= 0) break;
      if ((backupSlotsUsed.get(p.id) ?? 0) >= MAX_DISTINCT_BACKUP_SLOTS) continue;
      const minutes = Math.min(need, spare(p));
      if (minutes <= 0) continue;
      give(slot, p, minutes);
      backupSlotsUsed.set(p.id, (backupSlotsUsed.get(p.id) ?? 0) + 1);
    }
    give(slot, starter, Math.min(GAME_MINUTES - slotTotal(), spare(starter)));
    for (const p of otherStarters) {
      const need = GAME_MINUTES - slotTotal();
      if (need <= 0) break;
      give(slot, p, Math.min(need, spare(p)));
    }
    // Still short: a brief stint one spot down the lineup is normal basketball (a SG running the
    // point for a few minutes) and `rotationScore` doesn't charge for it within a per-position
    // grace window — mirrored here (scoring.ts's DOWNWARD_POSITION_GRACE_MINUTES; not imported,
    // scoring.ts already imports this module). Centers get none.
    for (const p of [...bench, ...otherStartersAny(starter)]) {
      const need = GAME_MINUTES - slotTotal();
      if (need <= 0) break;
      if (fitRank(p, slot) !== 3) continue;
      const already = slots[slot].find((a) => a.playerId === p.id)?.minutes ?? 0;
      const minutes = Math.min(need, spare(p), DOWNWARD_GRACE_MINUTES[p.primaryPosition] - already);
      if (minutes <= 0) continue;
      give(slot, p, minutes);
    }
    // Nobody left who fits: the slot's own starter plays through his ceiling — a minutes overage
    // costs far less than a big playing on the perimeter.
    give(slot, starter, GAME_MINUTES - slotTotal());
  }
  return { slots };
}

export function autoAssignRotation(roster: PlayerSpan[]): Rotation {
  const cacheKey = roster.map((p) => p.id).join('|');
  const cached = autoAssignRotationCache.get(cacheKey);
  if (cached) return cloneRotation(cached);
  const result = autoAssignRotationUncached(roster);
  if (autoAssignRotationCache.size >= AUTO_ASSIGN_ROTATION_CACHE_CAP) autoAssignRotationCache.clear();
  autoAssignRotationCache.set(cacheKey, result);
  return cloneRotation(result);
}

function autoAssignRotationUncached(roster: PlayerSpan[]): Rotation {
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
      const grant = Math.min(
        minuteProfileForSpan(primary).optimal,
        maxSustainableMinutes(primary, MAX_MINUTES_PER_PLAYER),
      );
      slots[slot].push({ playerId: primary.id, minutes: grant });
    }
  }

  // 2026-08-15 addition — see the new tier below (between "extend this slot's own primary" and
  // the true position-blind last resort) for the full case. Tracks each primary starter's TOTAL
  // minutes granted so far across every slot they end up covering, starting from their own
  // initial grant above — needed because a starter can now be extended into a second slot, and
  // both extensions have to respect the SAME real `maxSustainableMinutes` cap together, not each
  // independently re-checking against the full cap as if the other grant didn't exist.
  const starterMinutesUsed = new Map<string, number>();
  for (const slot of STARTER_SLOTS) {
    const primary = primaryBySlot[slot];
    if (primary) starterMinutesUsed.set(primary.id, slots[slot][0]?.minutes ?? 0);
  }

  const minutesUsed = new Map<string, number>(remainingPlayers.map((p) => [p.id, 0]));
  const slotsBackedUp = new Map<string, number>(remainingPlayers.map((p) => [p.id, 0]));

  /**
   * Every slot has to add up to a full 48 minutes — somebody is on the floor at that spot
   * for the whole game. Finding that somebody goes through progressively looser tiers,
   * only dropping to the next once the previous one has nobody left with capacity:
   *  0. A real primary/secondary-position bench player, under the normal distinct-slot cap.
   *  1. Still position-eligible (including a one-spot fallback), under the normal slot cap.
   *  2. Position-eligible with the distinct-slot cap relaxed.
   *  3. Truly last resort: any bench player, position ignored entirely. On a 9-man roster
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
      isRealPositionFit(p, slot) && (slotsBackedUp.get(p.id) ?? 0) < MAX_DISTINCT_BACKUP_SLOTS,
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
          (minutesUsed.get(p.id) ?? 0) <
            Math.min(maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER), minuteProfileForSpan(p).ceiling) &&
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
    function fillFromTier(
      tierAllows: (p: PlayerSpan, slot: Position) => boolean,
      respectRoleCeiling: boolean = true,
    ) {
      while (minutesNeeded > 0) {
        const candidates = remainingPlayers.filter(
          (p) =>
            // Normally one grant per player per slot — but the role-ceiling-ignoring true
            // last-resort pass must be able to top an already-used contributor back up to their
            // REAL durability, since the earlier ceiling-respecting pass may have granted them
            // only a fraction of it (found via `testRotationEditable.ts`'s single-position
            // worst-case sweep: a slot could go short of 48 with real spare durability sitting
            // unused on someone already granted a role-ceiling-limited sliver).
            (respectRoleCeiling ? !usedInSlot.has(p.id) : true) &&
            (minutesUsed.get(p.id) ?? 0) <
              Math.min(
                maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER),
                respectRoleCeiling ? minuteProfileForSpan(p).ceiling : MAX_MINUTES_PER_PLAYER,
              ) &&
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
          // 2026-08-15, user-reported (real diagnostics: P.J. Tucker and Dāvis Bertāns — real,
          // single-position PFs, drafted specifically for that slot — reduced to literally 0
          // total minutes anywhere on the roster, because a higher-raw-talent off-position player
          // (a natural SF stretched up to PF) outscored them for BOTH the primary starter slot
          // (`bestPrimaryAssignment`, deliberately untouched here — its own `STARTER_FALLBACK_UP_
          // MULTIPLIER` exists to let a genuine talent gap win an up-slide, fixing a different
          // real case, Stockton benched behind Hoiberg — lowering it globally to fix THIS problem
          // would reopen that one) AND this backup slot too, leaving the real specialist with
          // nothing at all. Scoped narrowly to backup-fill only: a real-fit (>=0.9 multiplier)
          // candidate who still has ZERO minutes anywhere gets a modest value boost in THIS
          // comparison — enough to win a close call against a similar-value off-position
          // alternative (Bertans TAL50 real-fit vs. Anunoby TAL63 stretched up at 0.85 was ~7%
          // apart), not enough to block a genuinely much stronger off-position teammate from
          // earning real minutes when the gap is actually large.
          const rawValue = effectiveTalent(player) * Math.max(positionFitMultiplier(player, slot), lastResortFloor(positionDistance(player.primaryPosition, slot)));
          const isUnusedRealFit = positionFitMultiplier(player, slot) >= 0.9 && (minutesUsed.get(player.id) ?? 0) === 0;
          const key: [number, number] = [
            isUnusedRealFit ? rawValue * UNUSED_REAL_FIT_BACKUP_BOOST : rawValue,
            positionDistance(player.primaryPosition, slot),
          ];
          if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
            bestKey = key;
            best = player;
          }
        }
        if (!best) break;

        const roleCeiling = respectRoleCeiling ? minuteProfileForSpan(best).ceiling : MAX_MINUTES_PER_PLAYER;
        const capacity =
          Math.min(maxSustainableMinutes(best, MAX_MINUTES_PER_PLAYER), roleCeiling) -
          (minutesUsed.get(best.id) ?? 0);
        const grant = Math.min(minutesNeeded, capacity);
        // Top up an existing grant (possible only when re-selection was allowed above) instead
        // of pushing a duplicate entry for the same player in the same slot.
        const existingEntry = slots[slot].find((a) => a.playerId === best.id);
        if (existingEntry) existingEntry.minutes += grant;
        else slots[slot].push({ playerId: best.id, minutes: grant });
        minutesUsed.set(best.id, (minutesUsed.get(best.id) ?? 0) + grant);
        if (!existingEntry) {
          slotsBackedUp.set(best.id, (slotsBackedUp.get(best.id) ?? 0) + 1);
          usedInSlot.add(best.id);
        }
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
        // Real durability only, not the role-tier ceiling: this is the last-resort path (see
        // the "true last resort" comment on the position-blind fallback below, which this same
        // reasoning already applies to) — a healthy starter with spare real capacity must never
        // be blocked from covering a shortfall just because his TIER's typical ceiling is lower,
        // or a slot can go short at 48 minutes even though a durability-legal player was sitting
        // right there (found via `testRotationEditable.ts`'s single-position worst-case sweep).
        const cap = maxSustainableMinutes(primaryPlayer, MAX_MINUTES_PER_PLAYER);
        const extra = Math.max(0, Math.min(minutesNeeded, cap - primaryEntry.minutes));
        primaryEntry.minutes += extra;
        minutesNeeded -= extra;
        if (extra > 0) starterMinutesUsed.set(primaryPlayer.id, (starterMinutesUsed.get(primaryPlayer.id) ?? 0) + extra);
      }
    }

    // 2026-08-15, user-reported (real diagnostics: Dikembe Mutombo — a true center, zero
    // position fit at PG — ending up as a last-resort PG backup while Michael Jordan, this same
    // roster's own SG starter with real adjacent-fallback eligibility at PG and real spare
    // durability, sat completely untouched). Root cause: `remainingPlayers` above excludes EVERY
    // primary starter from ever backing up a DIFFERENT slot, no matter how realistic the fit or
    // how much capacity they have left — confirmed directly against the user's own earlier manual
    // rotation correction this same session (Anthony Davis splitting his real 34-minute cap 26
    // PF + 8 C instead of all 34 going to PF alone, freeing PF's shortfall for a real bench
    // alternative and covering C with his own real secondary). Tried strictly between this slot's
    // own primary-extension (above) and the true position-blind last resort (below) — a healthy,
    // realistically-fitting starter from elsewhere is still more realistic than someone with zero
    // fit at all, matching the exact ordering the primary-extension fix above already established
    // for the same-slot case. Sorted by real value (talent x fit), same shape as `fillFromTier`'s
    // own candidate ranking, so the best-fitting available starter is tried first.
    if (minutesNeeded > 0) {
      const eligibleStarters = STARTER_SLOTS.filter((s) => s !== slot)
        .map((s) => primaryBySlot[s])
        .filter((p): p is PlayerSpan => !!p && isPositionEligible(p, slot))
        .sort((a, b) => effectiveTalent(b) * positionFitMultiplier(b, slot) - effectiveTalent(a) * positionFitMultiplier(a, slot));
      for (const starter of eligibleStarters) {
        if (minutesNeeded <= 0) break;
        const used = starterMinutesUsed.get(starter.id) ?? 0;
        // Same last-resort reasoning as the primary-extension block above: real durability only.
        const capacity = maxSustainableMinutes(starter, MAX_MINUTES_PER_PLAYER) - used;
        if (capacity <= 0) continue;
        const grant = Math.min(minutesNeeded, capacity);
        slots[slot].push({ playerId: starter.id, minutes: grant });
        starterMinutesUsed.set(starter.id, used + grant);
        minutesNeeded -= grant;
      }
    }

    if (minutesNeeded > 0) {
      // True last resort: position ignored entirely. Only reached now if extending the
      // primary couldn't fully cover the gap either (he's durability-capped too) — a genuinely
      // threadbare-at-this-position roster, where the least-bad remaining option really is
      // someone stretched two-plus positions away for however many minutes are left.
      fillFromTier(LAST_RESORT_TIER, false);
    }

    if (minutesNeeded > 0) {
      // Nothing left anywhere, including the primary — leave the slot short rather than
      // silently overworking someone past their own cap to hide it (same as before this change).
    }
  }

  rebalanceCrossSlotMinutes(roster, slots, primaryBySlot, starterMinutesUsed, minutesUsed, slotsBackedUp, remainingPlayers);
  consolidateOffPositionFillers(roster, slots, primaryBySlot, starterMinutesUsed, minutesUsed, slotsBackedUp);
  mergeTinyBackupSlivers(roster, slots, primaryBySlot);
  ensureUsefulBenchMinutes(roster, slots, primaryBySlot);

  return { slots };
}

/**
 * 2026-09-12, user-reported live, two real examples: a PF backup need split Duncan-38/George-8/
 * Wallace-2 instead of concentrating George+Wallace's shared SF/PF coverage onto just one of them;
 * an SG backup need split Miller-6/Reeves-2/Hardaway-2, the last two both off-position PGs each
 * contributing a token sliver. Root cause: `fillFromTier`'s greedy loop grants each candidate only
 * up to THEIR OWN remaining capacity before reaching for a second contributor — when the best-fit
 * candidate's spare room happens to fall just short of the slot's full remaining need, the last
 * couple of minutes fall to a second teammate instead, producing a tiny stint that reads as noise
 * rather than a role.
 *
 * A bounded, pure LATERAL swap, not a capacity change for anyone: for a bench-level sliver entry
 * below `MIN_USEFUL_BENCH_MINUTES` (excluding only THIS SLOT's own starter — see the in-loop
 * comment on why a global starter check was wrong), find whichever other player in the SAME slot
 * fits it best-or-equal-to the sliver (real data rarely ties exactly — George's real secondary PF,
 * 0.9, vs Wallace's fallback-only 0.85 — so `>=`, not a near-equality check, is what actually
 * matches the reported case) who ALSO already shares a real, positive-minute "home" slot with the
 * sliver holder (both real examples have this shape — Wallace/George both real-fit SF, Reeves/
 * Hardaway presumably both real-fit PG). Move the whole sliver onto that teammate in THIS slot,
 * and give the sliver holder the same number of minutes back in their shared home slot, taken from
 * the teammate there — both players' own totals (and both slots' totals) are exactly unchanged, so
 * no durability/cap check can be violated by this move; it only ever reduces how many distinct
 * fillers a slot carries. Verified directly against the exact reported PF shape (a unit probe,
 * deleted after use): Duncan-38/George-8/Wallace-2 -> Duncan-38/George-10, SF George-20/Wallace-28
 * — matches the user's own proposed fix exactly.
 */
function mergeTinyBackupSlivers(
  roster: PlayerSpan[],
  slots: Record<Position, SlotAssignment[]>,
  primaryBySlot: Partial<Record<Position, PlayerSpan>>,
): void {
  // 2026-09-12, code-review fix (efficiency), same shape as `consolidateOffPositionFillers`'s own
  // `rosterById` a few lines above — avoids an O(n) `roster.find(...)` linear scan per lookup on
  // this same hot path.
  const rosterById = new Map(roster.map((p) => [p.id, p]));
  for (const slot of STARTER_SLOTS) {
    // 2026-09-12 fix (measured against the exact reported shape via a direct unit probe, not
    // guessed): the first version excluded any player who is a starter AT ANY SLOT from either
    // role here — but the real motivating case (Paul George: SF starter, ALSO an 8-minute PF
    // filler) is exactly a starter-elsewhere-but-bench-here player, and excluding him globally
    // left no eligible partner at all, so nothing ever merged. The only row that must stay
    // untouched is THIS slot's own starter (`primaryBySlot[slot]`) — a starter's role at a
    // DIFFERENT slot is just an ordinary bench-level entry here, exactly like anyone else's.
    const ownStarterId = primaryBySlot[slot]?.id;
    for (const entry of [...slots[slot]]) {
      if (entry.minutes <= 0 || entry.minutes >= MIN_USEFUL_BENCH_MINUTES || entry.playerId === ownStarterId) continue;
      const sliverPlayer = rosterById.get(entry.playerId);
      if (!sliverPlayer || isRealPositionFit(sliverPlayer, slot)) continue;
      const sliverFit = positionFitMultiplier(sliverPlayer, slot);

      // 2026-09-12 fix, same direct-probe measurement as the starter check above: the real
      // motivating case has George (REAL secondary PF, multiplier 0.9) and Wallace (fallback-only
      // PF, 0.85) — a genuine, if small, fit gap, not an exact tie. Requiring near-equal fit
      // (`Math.abs(diff) < 0.01`) never matched real data at all; `>=` picks the best-or-equal
      // fit teammate instead, which is also just the more correct goal — concentrate the slot's
      // need on whoever fits it best, not merely on whoever happens to tie the sliver exactly.
      // 2026-09-12, code-review fix: `a.minutes > 0` added — without it, a same-slot partner
      // already zeroed out earlier in THIS SAME pass (a prior sliver, not yet pruned since
      // pruning was deferred — see below) could still be picked as the new "partner," reviving a
      // dead entry instead of routing onto a genuinely still-active teammate.
      const partnerEntry = slots[slot]
        .filter((a) => a.playerId !== sliverPlayer.id && a.playerId !== ownStarterId && a.minutes > 0)
        .map((a) => ({ a, p: rosterById.get(a.playerId) }))
        .filter((x): x is { a: SlotAssignment; p: PlayerSpan } => !!x.p && positionFitMultiplier(x.p, slot) >= sliverFit)
        .sort(
          (x, y) =>
            positionFitMultiplier(y.p, slot) - positionFitMultiplier(x.p, slot) || y.a.minutes - x.a.minutes,
        )[0];
      if (!partnerEntry) continue;

      // A real, positive-minute slot both already share — the "home" position this swap moves
      // minutes through, keeping both players' own totals unchanged.
      const homeSlot = STARTER_SLOTS.find(
        (s) =>
          s !== slot &&
          slots[s].some((a) => a.playerId === sliverPlayer.id && a.minutes > 0) &&
          slots[s].some((a) => a.playerId === partnerEntry.p.id && a.minutes > 0),
      );
      if (!homeSlot) continue;
      const sliverHomeEntry = slots[homeSlot].find((a) => a.playerId === sliverPlayer.id)!;
      const partnerHomeEntry = slots[homeSlot].find((a) => a.playerId === partnerEntry.p.id)!;
      const m = entry.minutes;
      if (partnerHomeEntry.minutes < m) continue;

      partnerEntry.a.minutes += m;
      partnerHomeEntry.minutes -= m;
      sliverHomeEntry.minutes += m;
      entry.minutes = 0;
    }
  }
  // 2026-09-12, code-review fix: pruning used to happen per-slot, immediately after that slot's
  // own inner loop — but a swap's `partnerHomeEntry`/`sliverHomeEntry` can belong to a DIFFERENT
  // slot (`homeSlot`) that the outer loop already finished and pruned earlier (STARTER_SLOTS order
  // is fixed; a later slot's merge can zero out an entry in an EARLIER one). If that zeroed entry
  // was the home slot's own starter row (index 0), the stale zero-minute row survived uncleaned,
  // and `primaryStarters()`'s `resolved.find(entry => entry.minutes > 0) ?? resolved[0]` fallback
  // would skip it and report a different, wrong player as that slot's starter. Pruning every slot
  // once, only after every slot's swaps are all done, means it no longer matters which order the
  // slots were processed in or which slot a swap's home leg landed in.
  for (const slot of STARTER_SLOTS) {
    slots[slot] = slots[slot].filter((a) => a.minutes > 0);
  }
}

/**
 * 2026-09-12, user-reported live, two independent real examples in the same shape: a bench
 * small forward split thin across two off-position slots at once (SG AND PF, or SG AND a second
 * off-position spot) while a much closer fit for one of those two sat idle — in one case the
 * roster's own PG starter (adjacent to SG, distance 1) had real spare capacity nobody offered
 * that slot; in the other, freeing the wing from one of his two off-position slots would have
 * left him spare distinct-slot budget for the OTHER, closer one instead of forcing a true
 * position-blind last resort (a different natural SF) onto it. Root cause: the greedy, slot-by-
 * slot fill above resolves each slot independently and can spend a versatile bench player's
 * limited `MAX_DISTINCT_BACKUP_SLOTS` budget on a mediocre fit before a much closer use of that
 * SAME player is even discovered later in the loop — locking them out of a slot they'd have fit
 * better, and forcing THAT slot down to a worse, unrelated fallback.
 *
 * A bounded, per-slot POST-PROCESS cleanup, not a fresh global re-optimization (same philosophy
 * as `rebalanceCrossSlotMinutes` just above): for each slot's current WORST-fitting bench filler,
 * look across the whole roster — starters included, since a starter's genuinely idle capacity is
 * real, exactly how `rebalanceCrossSlotMinutes` already treats it — for anyone who fits this slot
 * meaningfully better and has real spare room, and shift as many of the worst filler's minutes
 * onto them as that spare room allows. Repeats per slot until no more improving swap exists there
 * (bounded by the slot's own entry count, so this always terminates). Scoped to BENCH fillers
 * only (a starter already playing off-position elsewhere, via the `eligibleStarters` fallback
 * tier above, is left untouched) — deliberately narrow, so this pass only ever relieves a bench
 * assignment, never re-perturbs a starter's own allocation the way the trim-and-backfill half of
 * `rebalanceCrossSlotMinutes` does.
 */
function consolidateOffPositionFillers(
  roster: PlayerSpan[],
  slots: Record<Position, SlotAssignment[]>,
  primaryBySlot: Partial<Record<Position, PlayerSpan>>,
  starterMinutesUsed: Map<string, number>,
  minutesUsed: Map<string, number>,
  slotsBackedUp: Map<string, number>,
): void {
  const starterIds = new Set(
    Object.values(primaryBySlot)
      .filter((p): p is PlayerSpan => !!p)
      .map((p) => p.id),
  );
  // 2026-09-12, code-review fix (efficiency): was `roster.find((p) => p.id === entry.playerId)`
  // — an O(n) linear scan repeated for every entry on every guard-loop iteration, on a pass that
  // itself runs on `autoAssignRotation`'s documented hot path (40-80x per AI draft pick).
  const rosterById = new Map(roster.map((p) => [p.id, p]));

  const usedFor = (playerId: string): number =>
    starterIds.has(playerId) ? starterMinutesUsed.get(playerId) ?? 0 : minutesUsed.get(playerId) ?? 0;
  const capFor = (player: PlayerSpan): number =>
    Math.min(maxSustainableMinutes(player, MAX_MINUTES_PER_PLAYER), minuteProfileForSpan(player).ceiling);

  for (const slot of STARTER_SLOTS) {
    // 2026-09-12, code-review fix (efficiency): `positionFitMultiplier`/`capFor` depend only on
    // (player, slot) — both fixed for this whole slot's while-loop below — so both are computed
    // once per player here instead of being re-derived from scratch (durability + tier-minute-
    // profile lookups included) on every one of the loop's iterations. Only `usedFor` (the
    // running minutes total, via `usedFor`/the live maps) actually changes iteration to
    // iteration, so it's still read fresh each time.
    const fitAndCapById = new Map(roster.map((p) => [p.id, { fit: positionFitMultiplier(p, slot), cap: capFor(p) }]));
    let guard = 0;
    while (guard++ <= slots[slot].length) {
      const offPositionEntries = slots[slot]
        .map((entry) => ({ entry, filler: rosterById.get(entry.playerId) }))
        .filter(
          (x): x is { entry: SlotAssignment; filler: PlayerSpan } =>
            !!x.filler && x.entry.minutes > 0 && !starterIds.has(x.filler.id) && !isRealPositionFit(x.filler, slot),
        )
        .sort((a, b) => fitAndCapById.get(a.filler.id)!.fit - fitAndCapById.get(b.filler.id)!.fit);
      const worst = offPositionEntries[0];
      if (!worst) break;
      const { entry, filler } = worst;
      const fillerFit = fitAndCapById.get(filler.id)!.fit;

      const alternative = roster
        .filter((p) => p.id !== filler.id)
        .map((p) => {
          const { fit, cap } = fitAndCapById.get(p.id)!;
          return { p, fit, spare: cap - usedFor(p.id) };
        })
        .filter(
          ({ p, fit, spare }) =>
            fit > fillerFit &&
            spare > 0.5 &&
            (starterIds.has(p.id) ||
              slots[slot].some((a) => a.playerId === p.id) ||
              (slotsBackedUp.get(p.id) ?? 0) < MAX_DISTINCT_BACKUP_SLOTS),
        )
        .sort((a, b) => effectiveTalent(b.p) * b.fit - effectiveTalent(a.p) * a.fit)[0];
      if (!alternative) break;

      const shift = Math.min(entry.minutes, alternative.spare);
      if (shift <= 0) break;

      entry.minutes -= shift;
      if (starterIds.has(filler.id)) {
        starterMinutesUsed.set(filler.id, Math.max(0, (starterMinutesUsed.get(filler.id) ?? 0) - shift));
      } else {
        minutesUsed.set(filler.id, Math.max(0, (minutesUsed.get(filler.id) ?? 0) - shift));
        if (entry.minutes <= 0) slotsBackedUp.set(filler.id, Math.max(0, (slotsBackedUp.get(filler.id) ?? 0) - 1));
      }

      const existingAlt = slots[slot].find((a) => a.playerId === alternative.p.id);
      if (existingAlt) existingAlt.minutes += shift;
      else {
        slots[slot].push({ playerId: alternative.p.id, minutes: shift });
        if (!starterIds.has(alternative.p.id)) {
          slotsBackedUp.set(alternative.p.id, (slotsBackedUp.get(alternative.p.id) ?? 0) + 1);
        }
      }
      if (starterIds.has(alternative.p.id)) {
        starterMinutesUsed.set(alternative.p.id, (starterMinutesUsed.get(alternative.p.id) ?? 0) + shift);
      } else {
        minutesUsed.set(alternative.p.id, (minutesUsed.get(alternative.p.id) ?? 0) + shift);
      }
    }
    slots[slot] = slots[slot].filter((a) => a.minutes > 0);
  }
}

/**
 * Give a genuinely useful, naturally-fitting ninth man a small real role when the greedy fill
 * left him at zero. This is a redistribution only: every affected slot remains at 48 minutes,
 * and a player who is clearly worse than the donor is not artificially forced onto the floor.
 */
function ensureUsefulBenchMinutes(
  roster: PlayerSpan[],
  slots: Record<Position, SlotAssignment[]>,
  primaryBySlot: Partial<Record<Position, PlayerSpan>>,
): void {
  const starterIds = new Set(Object.values(primaryBySlot).filter((player): player is PlayerSpan => !!player).map((player) => player.id));
  const totalMinutes = (playerId: string) => STARTER_SLOTS.reduce(
    (sum, slot) => sum + slots[slot].filter((entry) => entry.playerId === playerId).reduce((slotSum, entry) => slotSum + entry.minutes, 0),
    0,
  );

  const candidates = roster
    .filter((player) => player.fga >= 2 && !starterIds.has(player.id) && effectiveTalent(player) >= USEFUL_BENCH_TALENT_FLOOR && totalMinutes(player.id) === 0)
    .sort((a, b) => effectiveTalent(b) - effectiveTalent(a));

  for (const candidate of candidates) {
    const candidateCap = Math.min(maxSustainableMinutes(candidate, MAX_MINUTES_PER_PLAYER), minuteProfileForSpan(candidate).ceiling);
    const needed = Math.min(MIN_USEFUL_BENCH_MINUTES, candidateCap);
    if (needed < 6) continue;

    const donors = STARTER_SLOTS
      .filter((slot) => isRealPositionFit(candidate, slot))
      .flatMap((slot) => slots[slot].map((entry) => ({ slot, entry, donor: roster.find((player) => player.id === entry.playerId) })))
      .filter((item): item is { slot: Position; entry: SlotAssignment; donor: PlayerSpan } => !!item.donor && item.donor.id !== candidate.id)
      .map((item) => {
        const donorIsStarter = starterIds.has(item.donor.id);
        const donorFloor = donorIsStarter ? 24 : 6;
        const surrenderable = Math.max(0, Math.min(item.entry.minutes, totalMinutes(item.donor.id) - donorFloor));
        return { ...item, donorIsStarter, surrenderable };
      })
      .filter((item) => item.surrenderable > 0 && effectiveTalent(candidate) >= effectiveTalent(item.donor) - USEFUL_BENCH_DONOR_TALENT_GAP)
      .sort((a, b) =>
        Number(!isRealPositionFit(b.donor, b.slot)) - Number(!isRealPositionFit(a.donor, a.slot)) ||
        Number(a.donorIsStarter) - Number(b.donorIsStarter) ||
        b.surrenderable - a.surrenderable,
      );

    const donor = donors[0];
    if (!donor) continue;
    const grant = Math.min(needed, donor.surrenderable);
    donor.entry.minutes -= grant;
    const existing = slots[donor.slot].find((entry) => entry.playerId === candidate.id);
    if (existing) existing.minutes += grant;
    else slots[donor.slot].push({ playerId: candidate.id, minutes: grant });
  }
}

/**
 * 2026-08-16, user-reported (real diagnostics across ~8 rosters, all the same shape: Anthony
 * Davis maxed at 34 PF while C's real backup gap went to two off-position players instead of him;
 * Kawhi Leonard maxed at SG while SF got a worse filler than his own real SF tag; Tim Duncan/Kawhi/
 * Mason all the same). Root-caused, not guessed: measured directly
 * (`scripts/_checkRealFitButStillOffPosition.ts`, deleted after use, 4x16 teams) that for PF/SF/SG
 * specifically, 15.6-27.3% of teams that DO have a real second position-fit player on the roster
 * STILL get an off-position filler for that slot's backup minutes anyway — well above the 0-9.4%
 * explained by genuinely thin real-fit depth (checked separately, ruling out "the pool is just too
 * small" as the main cause). The gap: the greedy, slot-by-slot fill above locks in a real-fit
 * starter's full grant on whichever of their TWO real positions gets resolved first, and — unlike
 * the "extend a starter using SPARE capacity" tier a few lines up — never reconsiders that
 * allocation once made, even when the starter's OWN unused real secondary tag sits right there.
 *
 * This is a bounded, single-pass POST-PROCESS rebalance, not a full joint re-optimization (that
 * would risk reopening `bestPrimaryAssignment`'s own exact-search territory for backups too,
 * intentionally out of scope — see that function's own docstring on why backups are deliberately
 * NOT solved exactly). For every primary starter with a real secondary position, it looks at
 * whether that secondary slot currently has a genuinely off-position (not `isRealPositionFit`)
 * filler, and tries two things, cheapest first:
 *
 * 1. Use the starter's own already-idle capacity (real spare room under their durability cap they
 *    simply weren't granted yet) to take over some of those off-position minutes directly — a pure
 *    win, no other player's allocation has to move.
 * 2. If the starter has NO idle capacity left (the Anthony Davis case — fully spent on their own
 *    primary slot), TRIM some of their primary-slot minutes and backfill the vacated primary
 *    minutes with a real-fit alternative who has spare capacity (Jalen Williams for AD's PF slot,
 *    matching the user's own manual correction exactly) — only ever applied when a real backfill
 *    exists; if none does, the starter's allocation is left untouched and the off-position filler
 *    stays exactly as the greedy pass left it (no worse than before).
 *
 * Each starter/secondary-slot pair is only rebalanced once (no iteration to a fixed point) —
 * bounded, predictable cost, and the common real cases (one dual-tagged starter, one off-position
 * filler) resolve in a single pass; a rarer multi-hop case is left as the greedy result, same as
 * before this fix existed, not a regression.
 *
 * Measured effect of this FIRST version (`scripts/_checkRebalanceEffect.ts`, deleted after use,
 * same 4x16-team methodology as the diagnosis above): SG's "2+ real fits yet still off-position"
 * rate dropped 15.6%->6.3%, PF 27.3%->17.9%, SF 19.0%->17.5%, severe backups held at 12.5% of
 * teams (no worse than before). **Superseded by the multi-filler follow-up inside the loop
 * below**, which pushed severe backups down further to 4.7% — see that comment for the current
 * numbers. Full regression suite (`npx tsc -b`, `npm test`, including
 * `testRotationEditable.ts`'s "every auto-filled assignment is representable in the editor"
 * check) stayed clean at every step.
 */
function rebalanceCrossSlotMinutes(
  roster: PlayerSpan[],
  slots: Record<Position, SlotAssignment[]>,
  primaryBySlot: Partial<Record<Position, PlayerSpan>>,
  starterMinutesUsed: Map<string, number>,
  minutesUsed: Map<string, number>,
  slotsBackedUp: Map<string, number>,
  remainingPlayers: PlayerSpan[],
): void {
  for (const primarySlot of STARTER_SLOTS) {
    const starter = primaryBySlot[primarySlot];
    if (!starter) continue;
    for (const secondarySlot of starter.secondaryPositions) {
      if (secondarySlot === primarySlot) continue;
      const secondaryAssignments = slots[secondarySlot];

      // 2026-08-16 follow-up, user-reported: the first version above only ever displaced the
      // SINGLE worst off-position filler, even when the starter had enough real trimmable
      // capacity to also clear a second, smaller one in the same slot (Jalen Williams's residual
      // 2-minute stint at C survived a first pass that only budgeted for Cedric Maxwell's 6).
      // Re-measured after this extension (`scripts/_checkRebalanceEffect.ts`, deleted after use,
      // same 4x16-team methodology): severe (not even loosely eligible) backups dropped 12.5%->
      // 4.7% of teams — the single biggest jump of the whole rebalance effort, since most real
      // rosters that had ONE off-position filler cleared by the single-filler version still had a
      // second, smaller one left over exactly like the AD/Hakeem/Jalen Williams motivating case.
      // Now collects EVERY off-position filler in the slot, worst-fit first, and spends the
      // starter's available capacity (idle first, then trim-with-backfill) across as many of them
      // as it reaches — same single-pass-per-starter bound as before (still no fixed-point
      // iteration), just no longer artificially capped at clearing only one.
      const offPositionEntries = secondaryAssignments
        .map((a, idx) => ({ a, idx, filler: roster.find((p) => p.id === a.playerId) }))
        .filter(
          (e): e is { a: SlotAssignment; idx: number; filler: PlayerSpan } =>
            !!e.filler && e.a.playerId !== starter.id && e.a.minutes > 0 && !isRealPositionFit(e.filler, secondarySlot),
        )
        .sort((x, y) => positionFitMultiplier(x.filler, secondarySlot) - positionFitMultiplier(y.filler, secondarySlot));
      if (offPositionEntries.length === 0) continue;
      const totalOffPositionMinutes = offPositionEntries.reduce((sum, e) => sum + e.a.minutes, 0);

      const starterTotalUsed = starterMinutesUsed.get(starter.id) ?? 0;
      const starterCap = Math.min(
        maxSustainableMinutes(starter, MAX_MINUTES_PER_PLAYER),
        minuteProfileForSpan(starter).ceiling,
      );
      let idleRemaining = Math.max(0, starterCap - starterTotalUsed);

      let trimRemaining = 0;
      let backfillPlayer: PlayerSpan | null = null;
      const primaryAssignment = slots[primarySlot].find((a) => a.playerId === starter.id);
      if (idleRemaining < totalOffPositionMinutes && primaryAssignment && primaryAssignment.minutes > 0) {
        // Deliberately NOT excluding players already backing up `primarySlot` — an existing
        // real-fit backup there (Cedric Maxwell, already at PF for 14m in the motivating case) is
        // exactly who should absorb MORE minutes when the starter's own grant is trimmed, not
        // just a brand-new name; the same player can also legitimately be one of the fillers being
        // displaced from the secondary slot AND the backfill for the primary slot at once —
        // reabsorbing him at his OWN real-fit slot instead of an off-position one is the whole
        // point. `existingBackfill` in the apply step below already handles adding to their
        // current assignment instead of duplicating it.
        const backfillCandidates = remainingPlayers
          .filter((p) => isRealPositionFit(p, primarySlot))
          .map((p) => ({
            p,
            spare:
              Math.min(maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER), minuteProfileForSpan(p).ceiling) -
              (minutesUsed.get(p.id) ?? 0),
          }))
          .filter((x) => x.spare > 0)
          .sort(
            (a, b) =>
              effectiveTalent(b.p) * positionFitMultiplier(b.p, primarySlot) - effectiveTalent(a.p) * positionFitMultiplier(a.p, primarySlot),
          );
        if (backfillCandidates.length > 0) {
          const best = backfillCandidates[0];
          trimRemaining = Math.min(totalOffPositionMinutes - idleRemaining, primaryAssignment.minutes, best.spare);
          if (trimRemaining > 0) backfillPlayer = best.p;
        }
      }

      let idleUsed = 0;
      let trimUsed = 0;
      for (const entry of offPositionEntries) {
        const budget = idleRemaining + trimRemaining;
        if (budget <= 0) break;
        const amount = Math.min(entry.a.minutes, budget);
        const fromIdle = Math.min(amount, idleRemaining);
        const fromTrim = amount - fromIdle;
        idleRemaining -= fromIdle;
        trimRemaining -= fromTrim;
        idleUsed += fromIdle;
        trimUsed += fromTrim;

        entry.a.minutes -= amount;
        minutesUsed.set(entry.filler.id, Math.max(0, (minutesUsed.get(entry.filler.id) ?? 0) - amount));
        if (entry.a.minutes <= 0) {
          slotsBackedUp.set(entry.filler.id, Math.max(0, (slotsBackedUp.get(entry.filler.id) ?? 0) - 1));
        }
      }
      // Splice out any zeroed-out entries from the real (not the mapped copy) assignments array,
      // highest index first so earlier splices don't shift the indices still to be removed.
      for (const entry of [...offPositionEntries].sort((a, b) => b.idx - a.idx)) {
        if (entry.a.minutes <= 0) secondaryAssignments.splice(entry.idx, 1);
      }

      const totalShift = idleUsed + trimUsed;
      if (totalShift <= 0) continue;

      // Grant the starter those minutes in their real secondary slot instead.
      const existingStarterInSecondary = secondaryAssignments.find((a) => a.playerId === starter.id);
      if (existingStarterInSecondary) existingStarterInSecondary.minutes += totalShift;
      else secondaryAssignments.push({ playerId: starter.id, minutes: totalShift });
      // Net change to the starter's own TOTAL usage is only the idle portion — the trimmed
      // portion is a lateral move (removed from their primary grant below, added here), not new
      // total minutes for them.
      starterMinutesUsed.set(starter.id, starterTotalUsed + idleUsed);

      if (backfillPlayer && trimUsed > 0) {
        const starterPrimaryAssignment = slots[primarySlot].find((a) => a.playerId === starter.id)!;
        starterPrimaryAssignment.minutes -= trimUsed;
        const existingBackfill = slots[primarySlot].find((a) => a.playerId === backfillPlayer.id);
        if (existingBackfill) existingBackfill.minutes += trimUsed;
        else slots[primarySlot].push({ playerId: backfillPlayer.id, minutes: trimUsed });
        minutesUsed.set(backfillPlayer.id, (minutesUsed.get(backfillPlayer.id) ?? 0) + trimUsed);
        slotsBackedUp.set(backfillPlayer.id, (slotsBackedUp.get(backfillPlayer.id) ?? 0) + 1);
      }
    }
  }
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

/**
 * The first assignment at each slot is the designated starter.
 *
 * `autoAssignRotation` deliberately writes the primary selected by the exact starter search
 * first, and `RotationBuilder` exposes that same first row as `-- starter --`. Later rotation
 * rebalancing can move part of that player's workload to a real secondary position without
 * changing their lineup status. Re-deriving the starter from the largest single-slot minutes
 * therefore misclassified cases such as Paul George (22 SF + 8 PF) behind a 26-minute SF
 * backup. Keep the stored lineup identity authoritative; use the first valid positive-minute
 * assignment as a defensive fallback for malformed/imported rotations.
 */
export function primaryStarters(team: Team): ResolvedSlotAssignment[] {
  if (!team.rotation) return [];
  const result: ResolvedSlotAssignment[] = [];
  for (const slot of STARTER_SLOTS) {
    const resolved = resolve(team.roster, team.rotation.slots[slot] ?? [], slot);
    if (resolved.length === 0) continue;
    const designated = resolved.find((entry) => entry.minutes > 0) ?? resolved[0];
    result.push(designated);
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
