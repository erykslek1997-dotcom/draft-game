import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName, POSITIONS } from '../data/schema';
import { draftPool } from '../data/draftPool';

/**
 * 2026-08-09, user's explicit ask: a stable, whole-career position label per player — helps
 * recognize an unfamiliar name at a glance ("niektórych graczy nawet nie znam"), and (2026-08-09
 * follow-up) makes an out-of-position rotation assignment visible right next to the player's own
 * row, not just inferable from which slot header they're listed under. Deliberately computed
 * from the FULL pool (every one of a player's real spans), not from whatever subset happens to
 * still be undrafted/available right now — the Kyrie Irving/Stockton investigation earlier this
 * session found that "available spans" shrinks as a live draft progresses, which would make this
 * label drift mid-draft for exactly the reason it exists (a stable identity cue) if it read from
 * `available` instead. Computed once at module load, not per-render.
 *
 * Kept in its own module (not on `DraftBoard.tsx`, where the original version of this lived)
 * specifically so `ResultsScreen.tsx` can use it without statically pulling in `DraftBoard.tsx`'s
 * full component code — that file is lazy-loaded on purpose (see `DraftPoolBrowser`'s own lazy()
 * call in ResultsScreen.tsx) so a user who finishes a draft and never opens the pool browser
 * never downloads it; a naive `import { naturalPosition } from './DraftBoard'` here would have
 * silently defeated that.
 *
 * Majority `primaryPosition` across every real span is the base label; a second position joins
 * it ("PG/SG") only if it's a real, recurring pattern (>=20% of spans) — a single early- or
 * late-career outlier span shouldn't turn a career point guard into "PG/C."
 */
const SECONDARY_SHARE_THRESHOLD = 0.2;

const NATURAL_POSITION_BY_PLAYER: Map<string, string> = (() => {
  const spansByPlayer = new Map<string, PlayerSpan[]>();
  for (const span of draftPool) {
    const key = normalizePlayerName(span.playerName);
    const arr = spansByPlayer.get(key);
    if (arr) arr.push(span);
    else spansByPlayer.set(key, [span]);
  }
  const result = new Map<string, string>();
  for (const [key, spans] of spansByPlayer) {
    const counts = new Map<Position, number>();
    for (const span of spans) counts.set(span.primaryPosition, (counts.get(span.primaryPosition) ?? 0) + 1);
    const ranked = [...POSITIONS].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
    const [primary, secondary] = ranked;
    const secondaryShare = (counts.get(secondary) ?? 0) / spans.length;
    result.set(key, secondaryShare >= SECONDARY_SHARE_THRESHOLD ? `${primary}/${secondary}` : primary);
  }
  return result;
})();

/** Falls back to an empty string only if the lookup somehow has no entry, which shouldn't happen
 * for any real player name in the pool (every span has a `primaryPosition`). */
export function naturalPosition(playerName: string): string {
  return NATURAL_POSITION_BY_PLAYER.get(normalizePlayerName(playerName)) ?? '';
}
