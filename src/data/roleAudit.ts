import type { DefensiveRole, OffensiveArchetype, PlayerSpan } from './schema';
import data from './roleAudit.json';

/** Primary labels replaced by the role audit (`src/engine/roleAudit.ts`), keyed by span id.
 * Built by `scripts/buildRoleAudit.ts`; only spans whose label changes are listed. */
const ROLE_AUDIT = data as Record<string, { d?: DefensiveRole; o?: OffensiveArchetype }>;

export function applyRoleAudit(span: PlayerSpan): PlayerSpan {
  const entry = ROLE_AUDIT[span.id];
  if (!entry) return span;
  return {
    ...span,
    defensiveRole: entry.d ?? span.defensiveRole,
    offensiveArchetype: entry.o ?? span.offensiveArchetype,
  };
}
