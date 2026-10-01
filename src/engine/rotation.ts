import type { PlayerSpan, Position } from '../data/schema';
import { positionCompetence, realSecondaryPositions, COMPETENCE_MULTIPLIER } from './positionCompetence';
import { STARTER_SLOTS, positionFitMultiplier, isPositionEligible, isRealPositionFit, isUpwardSlide, hardLockedPosition } from './positions';
// 2026-08-19: `computeTalent` import replaced with `effectiveTalent` (grades.ts) throughout —
// every real starter/backup assignment decision here now uses the same tier-capped number
// `aiDrafter.ts` and the displayed badge already use, closing a real raw-vs-display gap (see
// `effectiveTalent`'s own docstring for the full "why").
import { maxSustainableMinutes } from './durability';
import { allocateMinutes } from './minuteAllocation';
import { STARTER_STANDARD_TAL, isJustifiedRoleStarter } from './starterStandard';
import { overallTierForSpan, effectiveTalent } from './grades';
import { tierContextWithSixthMan } from './sixthMan';
import { minuteProfileForSpan } from './rotationRoleMinutes';
import { teamSpacingValue } from './midrangeGravity';
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
/** A backup stint below this reads as noise (`mergeTinyBackupSlivers`). */
const MIN_USEFUL_BENCH_MINUTES = 8;


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
const NON_NATURAL_PG_STARTER_SHARE = 0.94;
function starterFitMultiplier(player: PlayerSpan, slot: Position): number {
  // Named hard locks (Barkley PF-only, Pierce SF-only — see `positions.ts`) apply here too:
  // this search has its own separate fit function precisely so the visible starting five can be
  // stricter than the general backup-fill fallback, and a hard lock is the strictest case there
  // is — it would defeat the whole point if the starter search alone could still ignore it.
  const lock = hardLockedPosition(player);
  if (lock) return slot === lock ? 1 : 0;
  // 2026-09-25: graded competence (positionCompetence.ts) — a real second position costs a
  // marginal drop, and an adjacent slot only counts when the player can play it in an emergency.
  const competence = positionCompetence(player, slot);
  // 2026-10-01, the user (Ginóbili starting at PG over Chauncey Billups): the point guard spot goes
  // to a natural point guard when the roster has one of similar quality — a non-PG starts there
  // only when he is clearly better (about 6 TAL and up), otherwise he plays his own slot or comes
  // off the bench.
  if (slot === 'PG' && competence !== 'natural' && (competence === 'full' || competence === 'partial')) {
    return COMPETENCE_MULTIPLIER[competence] * NON_NATURAL_PG_STARTER_SHARE;
  }
  if (competence === 'natural' || competence === 'full' || competence === 'partial') return COMPETENCE_MULTIPLIER[competence];
  if (competence === 'emergency') {
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
      //
      // 2026-10-01, the user's starter standard (starterStandard.ts): a role player who both spaces
      // and defends belongs in the five whatever his tier label (Ingles 2017-19 is 'Sixth Man'), and
      // a sub-65 starter who misses the standard is valued down by his gap to it, the same price
      // Offense charges him — Charlie Ward (65) starts over Nate McMillan (61, no spacing), Ingles
      // over Bo Outlaw.
      const talent = effectiveTalent(player);
      const justifiedRole = isJustifiedRoleStarter(player);
      const belowStarterTier = !justifiedRole && !STARTER_ELIGIBLE_TIERS.has(overallTierForSpan(tierContextWithSixthMan(player)));
      const standardGap = talent < STARTER_STANDARD_TAL && !justifiedRole ? STARTER_STANDARD_TAL - talent : 0;
      v =
        maxSustainableMinutes(player, MAX_MINUTES_PER_PLAYER) <= 0 || belowStarterTier
          ? 0
          : Math.max(0, talent - standardGap) * starterFitMultiplier(player, slot);
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
  const swapped = bestScore === -Infinity ? null : spacingAwareStarterSwaps(best, roster, valueFor);
  const searched = swapped ?? { assignment: best, score: bestScore === -Infinity ? 0 : bestScore };
  const result = forceStarsIntoLineup(searched, roster, valueFor);
  if (bestPrimaryAssignmentCache.size >= BEST_PRIMARY_ASSIGNMENT_CACHE_CAP) bestPrimaryAssignmentCache.clear();
  bestPrimaryAssignmentCache.set(cacheKey, result);
  return result;
}

/**
 * 2026-09-30, engine calibration session 5 (the user, on San Diego starting Amen Thompson — spacing
 * 0 — ahead of Danny Green — 85 — next to Westbrook, Kawhi, Mobley and David Robinson): the search
 * above ranks starters by talent x position fit alone. A five that needs shooting (average team
 * spacing under `SWAP_SPACING_NEED`) now swaps a starter for a bench player at the same slot
 * when the talent given up is at most `SWAP_MAX_TALENT_LOSS` and the five's average spacing gains
 * at least `SWAP_MIN_SPACING_GAIN`. One swap per slot, the largest spacing gain first.
 */
const SWAP_SPACING_NEED = 60;
const SWAP_MAX_TALENT_LOSS = 5;
const SWAP_MIN_SPACING_GAIN = 8;
function spacingAwareStarterSwaps(
  best: Partial<Record<Position, PlayerSpan>>,
  roster: PlayerSpan[],
  valueFor: (player: PlayerSpan, slot: Position) => number,
): { assignment: Partial<Record<Position, PlayerSpan>>; score: number } | null {
  const lineup = { ...best };
  const lineupSpacing = () => {
    const five = STARTER_SLOTS.map((slot) => lineup[slot]).filter((p): p is PlayerSpan => p !== undefined);
    return five.length === 0 ? 0 : five.reduce((sum, p) => sum + teamSpacingValue(p), 0) / five.length;
  };
  let changed = false;
  for (let pass = 0; pass < STARTER_SLOTS.length; pass++) {
    const base = lineupSpacing();
    if (base >= SWAP_SPACING_NEED) break;
    const inLineup = new Set(STARTER_SLOTS.map((slot) => lineup[slot]?.id).filter(Boolean));
    let bestSwap: { slot: Position; player: PlayerSpan; gain: number } | null = null;
    for (const slot of STARTER_SLOTS) {
      const incumbent = lineup[slot];
      if (!incumbent) continue;
      for (const candidate of roster) {
        if (inLineup.has(candidate.id)) continue;
        const candidateValue = valueFor(candidate, slot);
        if (candidateValue <= 0 || valueFor(incumbent, slot) - candidateValue > SWAP_MAX_TALENT_LOSS) continue;
        const gain = (teamSpacingValue(candidate) - teamSpacingValue(incumbent)) / STARTER_SLOTS.length;
        if (gain >= SWAP_MIN_SPACING_GAIN && (!bestSwap || gain > bestSwap.gain)) bestSwap = { slot, player: candidate, gain };
      }
    }
    if (!bestSwap) break;
    lineup[bestSwap.slot] = bestSwap.player;
    changed = true;
  }
  if (!changed) return null;
  const score = STARTER_SLOTS.reduce((sum, slot) => sum + (lineup[slot] ? valueFor(lineup[slot]!, slot) : 0), 0);
  return { assignment: lineup, score };
}

/**
 * 2026-10-01, the user ("David Robinson nie może wchodzić z ławki, forsowanie greatest peak i mvp do
 * starting 5"): a GOAT / Greatest peak / MVP-tier player always starts. If the search left one on
 * the bench (two such centres, say), he takes the slot he plays that costs the lineup least,
 * displacing a lesser starter; with no such slot he starts at the neighbouring position anyway
 * (Robinson at PF beside another centre) — the one exception to "a classic centre can't play the
 * four", which the minute solver honours for a starter's home slot (minuteAllocation.ts).
 */
const MUST_START_TIERS = new Set(['GOAT', 'Greatest peak', 'MVP']);
/** How the rotation score reads a must-start star placed at a neighbouring position he can't
 * normally play — the same share the minute solver gives him there. */
export const FORCED_STAR_SLOT_FIT = 0.75;
/** True for a must-start star started at a slot he can't normally play (forceStarsIntoLineup). */
export function isForcedStarSlot(player: PlayerSpan, slot: Position): boolean {
  return (
    positionFitMultiplier(player, slot) <= 0 &&
    MUST_START_TIERS.has(overallTierForSpan(tierContextWithSixthMan(player))) &&
    Math.abs(STARTER_SLOTS.indexOf(slot) - STARTER_SLOTS.indexOf(player.primaryPosition)) === 1
  );
}
function forceStarsIntoLineup(
  searched: { assignment: Partial<Record<Position, PlayerSpan>>; score: number },
  roster: PlayerSpan[],
  valueFor: (player: PlayerSpan, slot: Position) => number,
): { assignment: Partial<Record<Position, PlayerSpan>>; score: number } {
  const mustStart = (p: PlayerSpan) =>
    MUST_START_TIERS.has(overallTierForSpan(tierContextWithSixthMan(p))) && maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER) > 0;
  const lineup = { ...searched.assignment };
  const starting = () => new Set(STARTER_SLOTS.map((slot) => lineup[slot]?.id).filter(Boolean));
  const benchedStars = roster.filter((p) => mustStart(p) && !starting().has(p.id)).sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
  if (benchedStars.length === 0) return searched;
  for (const star of benchedStars) {
    const open = STARTER_SLOTS.filter((slot) => !lineup[slot] || !mustStart(lineup[slot]!));
    const playable = open.filter((slot) => valueFor(star, slot) > 0);
    const adjacent = open.filter((slot) => Math.abs(STARTER_SLOTS.indexOf(slot) - STARTER_SLOTS.indexOf(star.primaryPosition)) === 1);
    const choices = playable.length > 0 ? playable : adjacent;
    if (choices.length === 0) continue;
    const cost = (slot: Position) => (lineup[slot] ? valueFor(lineup[slot]!, slot) : 0) - valueFor(star, slot);
    const slot = [...choices].sort((a, b) => cost(a) - cost(b))[0];
    lineup[slot] = star;
  }
  const score = STARTER_SLOTS.reduce((sum, slot) => sum + (lineup[slot] ? valueFor(lineup[slot]!, slot) : 0), 0);
  return { assignment: lineup, score };
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
      : realSecondaryPositions(p).includes(slot)
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
    (p, slot) => realSecondaryPositions(p).includes(slot) && canStart(p),
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
    // costs far less than a big playing on the perimeter. Never past 48 total for anyone, though
    // (RotationBuilder refuses that outright): if the starter is already maxed, the rest goes to
    // whoever fits best with room left.
    const hardRoom = (p: PlayerSpan) => GAME_MINUTES - (minutesUsed.get(p.id) ?? 0);
    give(slot, starter, Math.min(GAME_MINUTES - slotTotal(), hardRoom(starter)));
    const byFitThenLoad = [...roster].sort(
      (a, b) => fitRank(a, slot) - fitRank(b, slot) || (minutesUsed.get(a.id) ?? 0) - (minutesUsed.get(b.id) ?? 0),
    );
    for (const p of byFitThenLoad) {
      const need = GAME_MINUTES - slotTotal();
      if (need <= 0) break;
      give(slot, p, Math.min(need, hardRoom(p)));
    }
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

  // 2026-09-30: every slot's minutes are solved at once (`minuteAllocation.ts` — see its docstring
  // for why the old slot-by-slot fill and its repair passes were replaced). The designated starter
  // stays first in his slot's column.
  const slots = emptySlots();
  const grants = allocateMinutes(roster, primaryBySlot, GAME_MINUTES, MAX_MINUTES_PER_PLAYER);
  for (const slot of STARTER_SLOTS) {
    const starter = primaryBySlot[slot];
    const here = grants.filter((g) => g.slot === slot && g.minutes > 0);
    const starterGrant = starter ? here.find((g) => g.playerId === starter.id) : undefined;
    if (starterGrant) slots[slot].push({ playerId: starterGrant.playerId, minutes: starterGrant.minutes });
    for (const g of here.filter((g) => g !== starterGrant).sort((x, y) => y.minutes - x.minutes)) {
      slots[slot].push({ playerId: g.playerId, minutes: g.minutes });
    }
  }
  mergeTinyBackupSlivers(roster, slots, primaryBySlot);

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
