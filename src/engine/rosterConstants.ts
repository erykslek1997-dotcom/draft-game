import type { Position } from '../data/schema';

export const CAP_LIMIT = 100.9;

export const STARTER_SLOTS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
/**
 * The single source of truth for roster size — every roster-size-dependent constant here
 * (`ROSTER_SIZE` below) and downstream (`aiDrafter.ts`'s `NEED_RAMP_ROSTER_SIZE` /
 * `MARGINAL_VALUE_ROSTER_SIZE_CEILING`, `draft.ts`'s `ROUNDS`) derives from this, never a
 * hardcoded 9/8.
 *
 * History: briefly cut 4 → 3 (2026-08-15) after a "wasted 9th roster spot" investigation showed
 * the last bench pick routinely landing on a near-0-FGA / 0-minute player. Restored to 4
 * (2026-08-19) once the AI was structurally blocked from drafting a same-position bench duplicate
 * (see `aiDrafter.ts`'s bench-redundancy-exclusion); 2026-08-30 confirmed as the active, verified
 * configuration — the full suite passes at 16 teams × 9 rounds (cap, backup-quality, rotation,
 * scoring, season and playoff regressions). Team Model v1 also models when the ninth slot may
 * legitimately sit outside a robust eight-man playoff rotation.
 */
export const BENCH_SLOT_COUNT = 4;
export const ROSTER_SIZE = STARTER_SLOTS.length + BENCH_SLOT_COUNT; // 9
/** Lives here (not draft.ts) so it's available without a circular import wherever the
 * shared cap-legality math needs to know how many teams are contending for the same pool. */
export const TEAM_COUNT = 16;
