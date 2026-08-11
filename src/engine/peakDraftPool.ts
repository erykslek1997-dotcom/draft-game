import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from './talent';

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
/** How "two-way balanced" a span is, for breaking exact TAL ties below — the weaker of its two
 * normalized halves, same anchoring `twoWaySynergyBonus` (talent.ts) already uses for the same
 * "genuinely balanced beats one-sided" idea. */
function twoWayBalance(span: PlayerSpan): number {
  return Math.min(computeOffensiveTalent(span), computeDefensiveTalent(span));
}

function buildPeakPool(): PlayerSpan[] {
  // Keyed by NORMALIZED name, not the raw string — the same reason every other name-matching
  // lookup in this project does (normalizePlayerName), so e.g. "Nikola Jokić" and "Nikola Jokic"
  // spellings from different data sources collapse into one Phase 1 pool entry instead of
  // silently letting the same real player appear twice under two different spellings.
  //
  // 2026-08-08, user's v0.2 rating batch: an exact TAL tie between a player's own spans used to
  // fall back to array order (whichever span this loop reached first) — found via Embiid, whose
  // real peak by any reasonable read (2020-22, genuinely two-way: 92 O-TAL/76 D-TAL) was being
  // silently passed over for a later, more offense-only-leaning tied span (2023-25, 99 O-TAL/71
  // D-TAL) purely because of iteration order, never even reaching the AI as an option. Added a
  // real tiebreak: on an exact TAL tie, prefer the more two-way-balanced span (higher
  // `twoWayBalance`, same "weaker of the two sides" idea `twoWaySynergyBonus` already uses
  // elsewhere) over array order. Checked the full blast radius before shipping
  // (`scripts/_v02_tiebreak_audit.ts`, deleted after use): 75 players have an exact peak-TAL tie
  // pool-wide, 26 of them get a different (always more-balanced, never a wild swing) pick under
  // this rule — Embiid included, now correctly landing on 2020-22.
  const bestByPlayer = new Map<string, PlayerSpan>();
  for (const span of draftPool) {
    const key = normalizePlayerName(span.playerName);
    const current = bestByPlayer.get(key);
    if (!current) {
      bestByPlayer.set(key, span);
      continue;
    }
    const currentTal = computeTalent(current);
    const spanTal = computeTalent(span);
    if (spanTal > currentTal || (spanTal === currentTal && twoWayBalance(span) > twoWayBalance(current))) {
      bestByPlayer.set(key, span);
    }
  }
  return [...bestByPlayer.values()];
}

export const peakDraftPool: PlayerSpan[] = buildPeakPool();
