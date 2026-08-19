import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';

export const CAP_LIMIT = 100.9;

export const STARTER_SLOTS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
/**
 * 2026-08-15, user's explicit choice (weighed against the alternative "just raise CAP_LIMIT by
 * ~5" — this session's whole "wasted 9th roster spot" investigation showed the last bench pick
 * routinely ends up a near-0-FGA/0-minute player, ~25-44% of teams depending on which fix pass —
 * so structurally removing that spot instead of trying to make it more useful): 4 → 3. Every
 * other roster-size-dependent constant in this file (`ROSTER_SIZE` below) and downstream
 * (`aiDrafter.ts`'s `NEED_RAMP_ROSTER_SIZE`/`MARGINAL_VALUE_ROSTER_SIZE_CEILING`, `draft.ts`'s
 * `ROUNDS`) derives from this rather than hardcoding "9"/"8", so this one change is the actual
 * single source of truth for roster size.
 */
// 2026-08-19, user's prototype experiment (see aiDrafter.ts's own hard bench-redundancy-exclusion
// docstring, added the same day): reverting 3->4 to test whether the 2026-08-15 "wasted 9th spot"
// failure mode (see this constant's own docstring above) is actually fixed once the AI is
// structurally blocked from drafting a same-position bench duplicate, rather than accepting the
// smaller 8-man roster as the only fix. TEMPORARY prototype value — not yet validated against the
// full regression suite (128->144 picks ripples into hardcoded test fixtures and every calibrated
// anchor); measure with checkBenchPositionBalance.ts/checkBenchAbsurdities.ts first.
export const BENCH_SLOT_COUNT = 4;
export const ROSTER_SIZE = STARTER_SLOTS.length + BENCH_SLOT_COUNT; // 8
/** Lives here (not draft.ts) so it's available without a circular import wherever the
 * shared cap-legality math needs to know how many teams are contending for the same pool. */
export const TEAM_COUNT = 16;

const POSITION_ORDER: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export function positionDistance(a: Position, b: Position): number {
  return Math.abs(POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b));
}

/**
 * 2026-08-07, user-reported (playtest across ~10 teams: KCP/Novak/Diaw sliding down to PG,
 * Gobert/Claxton/Robinson/Mutombo sliding down to PF, PJ Brown/Horry sliding down to
 * SF/SG — all "down" in the sense below — while the earlier, already-known request "PG→SG→SF
 * should be free, the reverse should cost" stayed unimplemented). `positionDistance` above is
 * deliberately symmetric (it only measures how far apart two slots are), but the REAL fit cost
 * isn't: a ball-handling guard sliding out to a bigger, slower man's spot loses little (his own
 * skills — shooting, passing, quickness — still play), while a big sliding down to a guard spot
 * is missing the actual skill that position demands (ball-handling, quickness) that raw size
 * can't substitute for. "Up" here means toward the C end of PG→SG→SF→PF→C (increasing
 * POSITION_ORDER index), matching the user's own PG→SG→SF example exactly.
 */
export function isUpwardSlide(player: PlayerSpan, slot: Position): boolean {
  return POSITION_ORDER.indexOf(slot) > POSITION_ORDER.indexOf(player.primaryPosition);
}

/** The generic one-spot-away, not-explicitly-listed fallback (e.g. a small-ball 4 sliding to
 * center) used to be a single flat 0.75 regardless of direction — see `isUpwardSlide` above for
 * why that's wrong. Up stays close to an explicit secondary (0.9), since it's barely a
 * downgrade in realism; down drops meaningfully below the old flat value, a "real penalty" in
 * the user's own words, without going all the way to 0 (still eligible when nothing better
 * exists — same asymmetric-not-exclusionary shape as every other malus in this project, e.g.
 * `darkoDefenseMalus`'s lower cap vs. its bonus counterpart). */
const ADJACENT_UP_FALLBACK = 0.85;
const ADJACENT_DOWN_FALLBACK = 0.5;

/**
 * Explicit, repeatedly-requested named-player exceptions (first asked 2026-08-05 playtest
 * batch, reiterated 2026-08-07 as still outstanding): "Charles Barkley PF-only (never SF)",
 * "Paul Pierce always SF (never SG)." Both are a real GM's roster-construction judgment call
 * about a specific player, not a data correction — same shape as `computeTalent`'s own named
 * Curry shooting-gravity cap, the only other named-player special case in this codebase; every
 * other position-fit rule here is general, not per-player. Deliberately checked BEFORE
 * `primaryPosition`/`secondaryPositions` below and short-circuits entirely: Barkley actually
 * has two real spans (1989-91, 1990-92) where the auto-classifier's own `primaryPosition` reads
 * SF (checked directly against `draftPool.json`, same class of bug as Pierce's already-fixed SG
 * mistag — see `POSITION_OVERRIDES` in `players.ts`, which corrects those two spans' primary tag
 * back to PF for display/data consistency) — this lock makes the eligibility outcome correct
 * regardless of what any span's own data says, "never" meaning never, not just "discouraged."
 */
const HARD_POSITION_LOCKS: Record<string, Position> = {
  'charles barkley': 'PF',
  'paul pierce': 'SF',
};

export function hardLockedPosition(player: PlayerSpan): Position | null {
  return HARD_POSITION_LOCKS[normalizePlayerName(player.playerName)] ?? null;
}

/**
 * Multiplier applied to a player's talent when assigned to a given slot, or 0 if the
 * assignment isn't realistic at all. A `HARD_POSITION_LOCKS` entry overrides everything else
 * unconditionally. Otherwise: primary position 1.0, an explicitly listed secondary position 0.9,
 * a position one spot away on the PG-SG-SF-PF-C spectrum but not explicitly listed:
 * `ADJACENT_UP_FALLBACK`/`ADJACENT_DOWN_FALLBACK` depending on direction (see `isUpwardSlide`).
 * Two or more spots away and not explicitly listed — a true center at point guard, a point
 * guard at center — isn't a realistic assignment at all, hence 0 rather than a soft penalty.
 */
export function positionFitMultiplier(player: PlayerSpan, slot: Position): number {
  const lock = hardLockedPosition(player);
  if (lock) return slot === lock ? 1 : 0;
  if (slot === player.primaryPosition) return 1;
  if (player.secondaryPositions.includes(slot)) return 0.9;
  if (positionDistance(player.primaryPosition, slot) === 1) {
    return isUpwardSlide(player, slot) ? ADJACENT_UP_FALLBACK : ADJACENT_DOWN_FALLBACK;
  }
  return 0;
}

export function isPositionEligible(player: PlayerSpan, slot: Position): boolean {
  return positionFitMultiplier(player, slot) > 0;
}

/**
 * Stricter than `isPositionEligible`: true only for a player's actual primary position or an
 * explicitly listed secondary — excludes the generic "one spot away, not explicitly listed"
 * 0.75 fallback that `positionFitMultiplier` grants everyone regardless of whether they ever
 * really played that slot. That fallback is the right call for `autoAssignRotation`'s last-resort
 * backup fill (a real 9-man roster sometimes genuinely lacks depth, and someone stretched a
 * position is more realistic than nobody there at all) but the wrong signal for "does this
 * roster actually have a real fit here" — see `aiDrafter.ts`'s `assessNeeds`, the one caller
 * that needs this distinction.
 */
export function isRealPositionFit(player: PlayerSpan, slot: Position): boolean {
  return positionFitMultiplier(player, slot) >= 0.9;
}

export function totalFga(rosterFgas: number[]): number {
  return Math.round(rosterFgas.reduce((sum, fga) => sum + fga, 0) * 10) / 10;
}

export function capRemaining(rosterFgas: number[]): number {
  return Math.round((CAP_LIMIT - totalFga(rosterFgas)) * 10) / 10;
}

export function isPickCapLegal(currentFgas: number[], candidateFga: number): boolean {
  return totalFga([...currentFgas, candidateFga]) <= CAP_LIMIT;
}

/**
 * Precomputed, sorted (ascending by FGA) list of each distinct real player's cheapest
 * available span. Building this once per pick-decision and reusing it across every
 * candidate turns an O(n log n) "can we still fill the roster" check per candidate
 * (O(n^2 log n) total across a whole player pool) into one O(n log n) build plus an
 * O(slotsLeft) — effectively O(1), since slotsLeft <= 9 — check per candidate.
 */
export interface CheapestLookup {
  sorted: { normalizedName: string; fga: number }[];
}

export function buildCheapestLookup(pool: PlayerSpan[]): CheapestLookup {
  const cheapestPerPlayer = new Map<string, number>();
  for (const p of pool) {
    const key = normalizePlayerName(p.playerName);
    const current = cheapestPerPlayer.get(key);
    if (current === undefined || p.fga < current) cheapestPerPlayer.set(key, p.fga);
  }
  const sorted = [...cheapestPerPlayer.entries()]
    .map(([normalizedName, fga]) => ({ normalizedName, fga }))
    .sort((a, b) => a.fga - b.fga);
  return { sorted };
}

/** Extra FGA of headroom required, per remaining slot, on top of the literal cheapest-N-fit
 * math below. The lookahead only sees the pool as it exists *this instant* — it can't see
 * that every OTHER team also drafts from the same shrinking cheap tail before this team's
 * next turn, so "the N cheapest players available right now" routinely aren't still
 * available once actually needed. This margin hedges against that contention instead of
 * assuming the current cheapest options will patiently wait around, and scales with how many
 * other teams are actually competing for that tail — a fixed margin tuned for 4 teams would
 * be far too thin if the game later supports more. Per-other-team rate calibrated
 * (scripts/checkCapOverspend.ts) against how often simulated 4-team drafts finished over cap.
 * Exported (not folded into a module-level constant) so validation scripts simulating a
 * different team count — see scripts/validateMultiTeamDraft.ts — get an honestly-scaled
 * margin instead of silently reusing the real game's 4-team assumption. */
export const MARGIN_PER_CONTENDING_TEAM = 0.27;

function contentionMarginPerSlot(teamCount: number): number {
  return MARGIN_PER_CONTENDING_TEAM * (teamCount - 1);
}

/**
 * True if at least `slotsLeft` distinct players remain in `lookup` (optionally excluding
 * one, e.g. the candidate just picked) and the cheapest of them still fit under
 * `capRemaining`, after reserving a contention margin per slot (scaled to `teamCount`
 * contending teams — defaults to the real game's `TEAM_COUNT`). Scans at most
 * `slotsLeft + 1` entries from the front of the pre-sorted list, regardless of pool size.
 */
export function canFillFromLookup(
  lookup: CheapestLookup,
  slotsLeft: number,
  capRemaining: number,
  excludeNormalizedName?: string,
  teamCount: number = TEAM_COUNT,
): boolean {
  if (slotsLeft <= 0) return true;
  let sum = 0;
  let count = 0;
  for (const entry of lookup.sorted) {
    if (excludeNormalizedName && entry.normalizedName === excludeNormalizedName) continue;
    sum += entry.fga;
    count++;
    if (count === slotsLeft) break;
  }
  if (count < slotsLeft) return false;
  return sum <= capRemaining - contentionMarginPerSlot(teamCount) * slotsLeft + 1e-9;
}

/**
 * Simple one-shot version for callers with a small pool or infrequent calls (e.g. test
 * scripts). Builds a fresh lookup each call — avoid in hot per-candidate loops over a
 * large pool; use `buildCheapestLookup` + `canFillFromLookup` there instead.
 */
export function canFillRemainingSlots(pool: PlayerSpan[], slotsLeft: number, capRemaining: number): boolean {
  return canFillFromLookup(buildCheapestLookup(pool), slotsLeft, capRemaining);
}
