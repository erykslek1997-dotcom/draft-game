import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import d1d2d3AllowlistData from '../data/d1d2d3Allowlist.json';

/**
 * 2026-08-07, user explicit ask: separate from `buildDraftPool.ts`'s own (currently disabled)
 * `RESTRICT_TO_D1_D2_D3` flag, which either includes or excludes a player from the pool
 * entirely — this is a RUNTIME lookup for `aiDrafter.ts` to read the same 332-name list (three
 * real in-person "all-time draft" sessions the user ran with friends) as a draft-order
 * PREFERENCE instead: keep the full 572-player board, but have the AI reach for a real,
 * previously-human-drafted name first, before the rest of the wider auto-generated pool.
 *
 * Name-only (no span), matching the source list's own shape — the real in-person drafts picked
 * players, not specific 3-year spans, so every span of an allowlisted player counts as "on the
 * list," same as the allowlist already behaves in `buildDraftPool.ts`.
 */
const ALLOWLIST_NAMES = new Set((d1d2d3AllowlistData as string[]).map(normalizePlayerName));

export function isD1D2D3Player(span: PlayerSpan): boolean {
  return ALLOWLIST_NAMES.has(normalizePlayerName(span.playerName));
}
