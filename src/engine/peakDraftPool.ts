import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { computeTalent } from './talent';

/**
 * 2026-08-03, user's own ask (in Polish): draft the PLAYER first, choose which specific span
 * (career window) to actually roster afterward. This is the Phase 1 pool — one entry per real
 * player (328, down from `draftPool.json`'s 3113 spans), each represented by their single
 * highest-TAL ("peak") span.
 *
 * Load-bearing design choice: `draft.ts`/`aiDrafter.ts`/`positions.ts` all operate purely on
 * `PlayerSpan[]` and never care WHERE a span came from — so handing them this peak-only list
 * instead of the full multi-span pool makes Phase 1 behave EXACTLY like today's one-step draft
 * (same cap-legality math, same AI valuation, same dead-end/lookahead checks), with zero changes
 * to any of that machinery. The peak span's own FGA is what the cap-legality checks react to,
 * which is what closes the loophole a naive "cheapest possible span" version would have opened
 * (see the design discussion: without this, a team could draft 9 max-TAL players ignoring FGA
 * entirely, then dump them all into their cheapest spans in Phase 2 — using the PEAK span's real
 * cost in Phase 1 means the same real cap pressure exists at draft time as today).
 *
 * Phase 2 (`spanOptimizer.ts`) is what actually lets a team reconsider which span of an
 * already-drafted player to rostered, once the whole 9-player picture is known.
 */
function buildPeakPool(): PlayerSpan[] {
  // Keyed by NORMALIZED name, not the raw string — the same reason every other name-matching
  // lookup in this project does (normalizePlayerName), so e.g. "Nikola Jokić" and "Nikola Jokic"
  // spellings from different data sources collapse into one Phase 1 pool entry instead of
  // silently letting the same real player appear twice under two different spellings.
  const bestByPlayer = new Map<string, PlayerSpan>();
  for (const span of draftPool) {
    const key = normalizePlayerName(span.playerName);
    const current = bestByPlayer.get(key);
    if (!current || computeTalent(span) > computeTalent(current)) {
      bestByPlayer.set(key, span);
    }
  }
  return [...bestByPlayer.values()];
}

export const peakDraftPool: PlayerSpan[] = buildPeakPool();
