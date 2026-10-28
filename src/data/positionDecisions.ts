import type { PlayerSpan, Position } from './schema';
import decisions from './positionDecisions.json';

/**
 * 2026-10-28, the user's position review (the user: "każda pozycja musi być dobrze przypisana, bo
 * różnie się liczy"): a span's position is the group it is rated against (TAL, O-TAL, D-TAL, tier
 * bars), and the tag the pool was built with is whatever his own era listed — the positionless
 * era files wings as fours, the 70s filed small playmakers as twos. `scripts/auditPositions.ts`
 * read every span's all-time position from height, weight and era-relative rates; the user went
 * through every player at TAL 55+ whose tag and read disagree (212 players) and picked each
 * window's position. This file is those picks, by span id, where they differ from the tag.
 *
 * The old tag stays as a secondary position, so nobody loses a slot he could play. Applied at
 * load (`draftPool.ts`), after the older one-off corrections there.
 */
const BY_ID = decisions as Record<string, Position>;

export function applyPositionDecision(span: PlayerSpan): PlayerSpan {
  const to = BY_ID[span.id];
  if (!to || to === span.primaryPosition) return span;
  return { ...span, primaryPosition: to, secondaryPositions: [span.primaryPosition, ...span.secondaryPositions.filter((p) => p !== to && p !== span.primaryPosition)] };
}
