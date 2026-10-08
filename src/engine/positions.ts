import type { PlayerSpan, Position } from '../data/schema';
import { positionCompetence, positionCompetenceScore, COMPETENCE_MULTIPLIER, PARTIAL_SCORE } from './positionCompetence';
import { normalizePlayerName } from '../data/schema';

// The roster constants live in a data-free module so the menu can read them without pulling the
// position-competence data (and through it the whole player pool) into its first download.
import { CAP_LIMIT, TEAM_COUNT } from './rosterConstants';
export { BENCH_SLOT_COUNT, CAP_LIMIT, ROSTER_SIZE, STARTER_SLOTS, TEAM_COUNT } from './rosterConstants';

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
 * unconditionally. Otherwise it follows the player's graded competence (`positionCompetence.ts`):
 * natural 1.0, then continuous in the competence score (see below) down to
 * `ADJACENT_UP_FALLBACK`/`ADJACENT_DOWN_FALLBACK` depending on direction (see `isUpwardSlide`),
 * and 0 for a closed position — a slot the player can't realistically play, not a soft penalty.
 */
export function positionFitMultiplier(player: PlayerSpan, slot: Position): number {
  const lock = hardLockedPosition(player);
  if (lock) return slot === lock ? 1 : 0;
  // 2026-09-25: graded per player (`positionCompetence.ts`) instead of "listed secondary 0.9,
  // any adjacent slot 0.85/0.5". A real second position now costs only a marginal drop, and an
  // adjacent slot a player can't really play is no longer free to fill.
  // 2026-10-01, the user ("bramki zamykające"): the competence score is continuous, so is the fit.
  // Anchors: score 0.9 → 0.975 (a real second position), 0.6 → 0.945, the partial line → 0.92,
  // and 0.25 and below → the old emergency fallback, linear in between — no step anywhere.
  const score = positionCompetenceScore(player, slot);
  if (score >= 1) return 1;
  if (score <= 0) return 0;
  const emergency = isUpwardSlide(player, slot) ? ADJACENT_UP_FALLBACK : ADJACENT_DOWN_FALLBACK;
  return interpolate(score, [
    [EMERGENCY_SCORE, emergency],
    [PARTIAL_SCORE, PARTIAL_LINE_FIT],
    [0.6, COMPETENCE_MULTIPLIER.partial],
    [0.9, COMPETENCE_MULTIPLIER.full],
  ]);
}

const EMERGENCY_SCORE = 0.25;
const PARTIAL_LINE_FIT = 0.92;

function interpolate(x: number, points: Array<[number, number]>): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
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
  // 2026-10-01: the fit is continuous now, so read the competence band (natural, full, partial).
  if (positionFitMultiplier(player, slot) <= 0) return false;
  const competence = positionCompetence(player, slot);
  return competence === 'natural' || competence === 'full' || competence === 'partial';
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
 * other teams are actually competing for that tail.
 *
 * 2026-08-19, user-reported and confirmed real (not the pool-size-average check that first
 * looked at this and wrongly cleared it — see this file's own git history): at 0.27, a real
 * reproduced late-draft state (2 slots left, ~17 FGA remaining) reserved 8.1 FGA of pure margin
 * for those 2 slots — MORE than the entire remaining cap after picking a clearly-affordable,
 * well-known player (Russell Westbrook, cheapest span 10.4 FGA, real cheapest-2-fill cost for
 * the other two slots only 2.0 FGA) — making him illegal despite genuine real room. Root cause:
 * 0.27 was calibrated for a 4-team draft (`scripts/checkCapOverspend.ts`) and just linearly
 * scaled up via `(teamCount-1)` for 16 teams, never re-validated at that scale. Re-measured
 * directly instead of guessing: at 0.1, 8 full simulated 16-team drafts (128 teams) finished
 * with ZERO teams over cap — strictly safer than 0.27's own baseline (which itself only showed
 * ~0 real overage) — while actually freeing up the real mid-tier of the pool this margin was
 * wrongly walling off. User's own explicit call on any remaining edge-case risk: a human who
 * spends recklessly enough to strand themselves anyway is accepted risk, not something this
 * margin needs to fully insure against — the existing tier-3 "cheapest player even over cap"
 * escape hatch in `isPickLegal`/draft.ts remains the real backstop regardless of this constant.
 * Exported (not folded into a module-level constant) so validation scripts simulating a
 * different team count — see scripts/validateMultiTeamDraft.ts — get an honestly-scaled
 * margin instead of silently reusing the real game's 16-team assumption. */
export const MARGIN_PER_CONTENDING_TEAM = 0.1;

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
