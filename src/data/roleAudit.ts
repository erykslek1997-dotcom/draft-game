import type { DefensiveRole, OffensiveArchetype, PlayerSpan } from './schema';
import data from './roleAudit.json';

/** Index tables for the compact `x` / `y` lists in roleAudit.json — append only. */
export const AUDIT_DEFENSIVE_ROLES: DefensiveRole[] = [
  'Point of Attack', 'Chaser', 'Helper', 'Wing Stopper', 'Mobile Big', 'Switch Big', 'Anchor Big', 'Post Defender', 'Low Activity',
];
export const AUDIT_OFFENSIVE_ARCHETYPES: OffensiveArchetype[] = [
  'Primary Ball Handler', 'Secondary Ball Handler', 'Shot Creator', 'Slasher', 'Athletic Finisher', 'Off Screen Shooter',
  'Movement Shooter', 'Stationary Shooter', 'Versatile Big', 'Post Scorer', 'Stretch Big', 'Roll & Cut Big',
];

/** Built by `scripts/buildRoleAudit.ts`, keyed by span id: `d` / `o` replace the primary labels
 * (only where the audit changes them); `x` / `y` are the additional defensive / offensive roles
 * the span also qualifies for (its own gates plus its neighbouring windows' primary roles), as
 * indexes into the tables above. */
type Entry = { d?: DefensiveRole; o?: OffensiveArchetype; x?: number[]; y?: number[] };
const ROLE_AUDIT = data as Record<string, Entry>;

export function applyRoleAudit(span: PlayerSpan): PlayerSpan {
  const entry = ROLE_AUDIT[span.id];
  if (!entry || (!entry.d && !entry.o)) return span;
  return {
    ...span,
    defensiveRole: entry.d ?? span.defensiveRole,
    offensiveArchetype: entry.o ?? span.offensiveArchetype,
  };
}

/** The audit's additional roles for a span, or null when the span was not audited (outside the pool). */
export function auditAdditionalRoles(spanId: string): { defense: DefensiveRole[]; offense: OffensiveArchetype[] } | null {
  const entry = ROLE_AUDIT[spanId];
  if (!entry) return null;
  return {
    defense: (entry.x ?? []).map((index) => AUDIT_DEFENSIVE_ROLES[index]),
    offense: (entry.y ?? []).map((index) => AUDIT_OFFENSIVE_ARCHETYPES[index]),
  };
}
