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

/**
 * 2026-09-11, user-reported live with a real example ("Kidd z Dallas za 8 fga jest sporo lepszy
 * niż np. Chalmers" — Jason Kidd's 2008-10 Dallas facilitator window, FGA 8.0, TAL 76, clearly
 * better than Mario Chalmers' own peak, TAL 65 — yet Kidd went undrafted across 4-5 of 5 full
 * simulated 16-team drafts, every seed). Root-caused via a full-draft trace: the gate above used
 * to key off the PLAYER's peak-span FGA (`peak.fga < threshold`) to decide whether to keep every
 * one of their career windows — so a genuine offensive hub in their PEAK season (Kidd's real peak,
 * 2000-02, is 14.1 FGA) had literally none of their other, cheaper, lower-usage windows in the
 * pool at all, even a span as team-friendly as an 8-FGA facilitator role. That's exactly backwards
 * from this file's own stated purpose above ("exactly the players a team reaches for when it
 * needs cap relief") — an aging star's efficient bench-role season is precisely that case, and it
 * was the one thing this gate could never keep.
 *
 * Fixed at the right granularity: the peak span is always kept (unchanged), and any OTHER span is
 * kept too if THAT SPAN's own FGA clears the bar — not gated by what the player did in their best
 * season. A "true role player" whose peak is already under the bar sees no change (every window
 * already qualified on its own). Confirmed working end-to-end (`scripts/_pgAudit*.ts`, deleted
 * after use): Kidd's 2008-10 span now shows up as a real, sometimes-winning candidate — e.g. one
 * full-draft trace has it ranked #1 of 276 available candidates and actually drafted, a result
 * that was structurally impossible before (the span didn't exist to be picked). Pool grows
 * 5186 -> 6596 spans (+27%), still far below the full 9451-span pool this was built to avoid.
 */
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
    const allSpans = spansByName.get(key) ?? [peak];
    if (peak.fga < LEAN_POOL_ALL_SPANS_FGA_MAX) {
      // A genuine role player by their own peak — unchanged from before this fix: every window
      // of theirs stays in, including any one-off higher-usage season, exactly as this file's
      // original behavior did (an occasional outlier season shouldn't disappear just because
      // this branch now also handles the hub case below).
      pool.push(...allSpans);
      continue;
    }
    // A genuine hub by their own peak — the fix: their peak still always survives (unchanged),
    // but now so does any of their OTHER windows that's itself under the bar, instead of losing
    // every non-peak season outright.
    const includedIds = new Set<string>([peak.id]);
    for (const span of allSpans) {
      if (span.fga < LEAN_POOL_ALL_SPANS_FGA_MAX) includedIds.add(span.id);
    }
    pool.push(...allSpans.filter((s) => includedIds.has(s.id)));
  }
  return pool;
}

export const leanDraftPool: PlayerSpan[] = buildLeanPool();
