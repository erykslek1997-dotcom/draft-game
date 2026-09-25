import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';

/**
 * 2026-09-25, user ("Pressey sf liczony jako pg"): a player whose draft/rotation position stays
 * as tagged, but whose RATINGS (O-TAL, D-TAL, TAL, grades and tier gates) are computed as if he
 * were tagged at another position. Paul Pressey was a point forward: tagged SF, he was measured
 * against wings and read All-NBA; against point guards he reads All-star, matching his real
 * role. Same idea as `POSITION_CORRECTION_AS_SF` in talent.ts (Magic/LeBron), but for the whole
 * rating pipeline rather than one multiplier.
 *
 * Applied at the exported rating entry points only (talent.ts, defensiveTalent.ts, grades.ts's
 * `tierContextFor`), so fit, spacing, rotation and draft eligibility keep the real tag.
 */
// Keyed by name; `from` scopes it to the spans carrying that tag (Pressey's SG-tagged spans rate
// as SG as before — only his point-forward SF windows move).
const RATE_AS_POSITION: ReadonlyMap<string, { from: Position; to: Position }> = new Map([
  [normalizePlayerName('Paul Pressey'), { from: 'SF', to: 'PG' }],
]);

const ratingSpanCache = new Map<string, PlayerSpan>();

export function ratingSpan(span: PlayerSpan): PlayerSpan {
  const rule = RATE_AS_POSITION.get(normalizePlayerName(span.playerName));
  if (!rule || span.primaryPosition !== rule.from) return span;
  const position = rule.to;
  const cached = ratingSpanCache.get(span.id);
  if (cached) return cached;
  const rated: PlayerSpan = {
    ...span,
    primaryPosition: position,
    secondaryPositions: [...span.secondaryPositions.filter((p) => p !== position), span.primaryPosition],
  };
  ratingSpanCache.set(span.id, rated);
  return rated;
}
