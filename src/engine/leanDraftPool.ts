import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { buildPeakSpanByName } from './peakDraftPool';

/**
 * 2026-09-09, user's own refinement of the reverted `usePeakOnlyPool` experiment ("jakby dla
 * graczy low fga zrobić więcej spanów a resztę zostawić?"): a middle ground between the full
 * multi-span `draftPool` (9451 spans — every player × every career window) and the peak-only pool
 * (`peakDraftPool`, 1223 — one span per player).
 *
 * Why peak-only was reverted (see `draftExperiment.ts`): collapsing everyone to a single span
 * stripped out the sub-2-FGA "glue" windows that `isPickLegal`'s cap dead-end escape hatch relies
 * on, so a team with almost no FGA cap room left had nothing legal to draft and the escape hatch
 * forced a pick past the 100.9 cap (`testDraftRulesSlow` seed 29).
 *
 * This pool fixes that without going back to the full 9451: it keeps ONE span (the peak) for
 * every genuine offensive hub, but keeps ALL career windows for any player whose peak span is
 * under `LEAN_POOL_ALL_SPANS_FGA_MAX` shots a game — i.e. every role player, 3&D wing, defensive
 * specialist and low-usage big, exactly the players a team reaches for when it needs cap relief.
 * At the 12.0 threshold this is ~5200 spans (45% smaller than the full pool, so the AI's per-pick
 * candidate scan is meaningfully faster) and — verified in `scripts` — every one of the 44
 * players who owns a sub-2.5-FGA span still has all of their windows available, so the cap
 * dead-end can't be forced the way peak-only forced it.
 *
 * Load-bearing design choice is the same one `peakDraftPool.ts` documents: `draft.ts`/
 * `aiDrafter.ts`/`positions.ts` operate purely on `PlayerSpan[]` and never care where a span came
 * from, so swapping this list in changes nothing about cap math, AI valuation or lookahead — only
 * which spans exist to be picked.
 */
const LEAN_POOL_ALL_SPANS_FGA_MAX = 12.0;

function buildLeanPool(): PlayerSpan[] {
  const peakByName = buildPeakSpanByName();

  const spansByName = new Map<string, PlayerSpan[]>();
  for (const span of draftPool) {
    const key = normalizePlayerName(span.playerName);
    const arr = spansByName.get(key);
    if (arr) arr.push(span);
    else spansByName.set(key, [span]);
  }

  const pool: PlayerSpan[] = [];
  for (const [key, peak] of peakByName) {
    if (peak.fga < LEAN_POOL_ALL_SPANS_FGA_MAX) {
      pool.push(...(spansByName.get(key) ?? [peak]));
    } else {
      pool.push(peak);
    }
  }
  return pool;
}

export const leanDraftPool: PlayerSpan[] = buildLeanPool();
