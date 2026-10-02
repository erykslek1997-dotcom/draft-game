/**
 * Writes src/data/roleAudit.json — for every draft-pool span, the primary defensive role / offensive
 * archetype the role audit (`src/engine/roleAudit.ts`) assigns (only where it changes), plus the
 * additional roles FIT credits: the span's other passing roles and its neighbouring windows'
 * primary roles. Spans with a manual override (`DEFENSIVE_ROLE_OVERRIDES` /
 * `OFFENSIVE_ARCHETYPE_OVERRIDES` in players.ts, and Draymond Green's hand-set Anchor Big) keep
 * that primary: the user's calls always win.
 *
 * 2026-10-02, user-approved top-200 list ("Akceptuję"), then "zrób" for the additional roles.
 *
 * D-TAL and spacing read the labels too, so the audit always runs against the UN-audited pool:
 * the JSON is emptied before any engine module loads. That keeps the build deterministic (a
 * second run gives the same file) instead of feeding its own output back in.
 *
 * Run: npx tsx scripts/buildRoleAudit.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DefensiveRole, OffensiveArchetype, PlayerSpan } from '../src/data/schema';

const OUTPUT = resolve(import.meta.dirname, '../src/data/roleAudit.json');
writeFileSync(OUTPUT, '{}\n');
await import('../src/engine/fit');
const { draftPoolBeforeRoleAudit } = await import('../src/data/draftPool');
const { DEFENSIVE_ROLE_OVERRIDES, OFFENSIVE_ARCHETYPE_OVERRIDES } = await import('../src/data/players');
const { normalizePlayerName } = await import('../src/data/schema');
const { auditedDefensiveRoles, auditedOffensiveArchetypes, roleAuditStats } = await import('../src/engine/roleAudit');
const { buildRoleFitContext, computeShadowRoleProfile } = await import('../src/engine/roleFitShadow');
const { AUDIT_DEFENSIVE_ROLES, AUDIT_OFFENSIVE_ARCHETYPES } = await import('../src/data/roleAudit');
const shadowContext = buildRoleFitContext(draftPoolBeforeRoleAudit);
const MEASURED_SHOOTER_MIN_SCORE = 70;

const key = (name: string, spanLabel: string) => `${normalizePlayerName(name)}|${spanLabel}`;
const defenseLocked = new Set(DEFENSIVE_ROLE_OVERRIDES.map((o) => key(o.name, o.spanLabel)));
const offenseLocked = new Set(OFFENSIVE_ARCHETYPE_OVERRIDES.map((o) => key(o.name, o.spanLabel)));
const DEFENSE_LOCKED_PLAYERS = new Set([normalizePlayerName('Draymond Green')]);
const FALLBACK_DEFENSE: DefensiveRole[] = ['Helper', 'Low Activity'];
const startYear = (span: PlayerSpan) => Number.parseInt(span.spanLabel.slice(0, 4), 10);

interface Audited { span: PlayerSpan; defense: DefensiveRole[]; offense: OffensiveArchetype[] }

// Pass 1: every span's audited roles, primary first (a manual override stays the primary).
const audited: Audited[] = [];
let defenseChanged = 0;
let offenseChanged = 0;
for (const span of [...draftPoolBeforeRoleAudit].sort((a, b) => a.id.localeCompare(b.id))) {
  const k = key(span.playerName, span.spanLabel);
  const shooterFit = computeShadowRoleProfile(span, shadowContext).offensiveFits.find(
    (fit) => (fit.role === 'Off Screen Shooter' || fit.role === 'Movement Shooter') && fit.score >= MEASURED_SHOOTER_MIN_SCORE,
  );
  const stats = roleAuditStats(span, shooterFit?.role);
  let defense = auditedDefensiveRoles(span, stats);
  let offense = auditedOffensiveArchetypes(span, stats);
  if (defenseLocked.has(k) || DEFENSE_LOCKED_PLAYERS.has(normalizePlayerName(span.playerName))) {
    defense = [span.defensiveRole, ...defense.filter((role) => role !== span.defensiveRole)];
  }
  if (offenseLocked.has(k)) offense = [span.offensiveArchetype, ...offense.filter((role) => role !== span.offensiveArchetype)];
  if (defense[0] !== span.defensiveRole) defenseChanged++;
  if (offense[0] !== span.offensiveArchetype) offenseChanged++;
  audited.push({ span, defense, offense });
}

// Pass 2: additional roles = the span's other passing roles plus its neighbouring windows'
// primary roles (smoothing across overlapping three-year windows). Helper / Low Activity are not
// roles anyone is credited for; pre-1973 defense has no steals/blocks, so it gets no additions.
const byPlayer = new Map<string, Audited[]>();
for (const entry of audited) byPlayer.set(entry.span.playerName, [...(byPlayer.get(entry.span.playerName) ?? []), entry]);

type Row = { d?: DefensiveRole; o?: OffensiveArchetype; x?: number[]; y?: number[] };
const out: Record<string, Row> = {};
let withAdditional = 0;
for (const { span, defense, offense } of audited) {
  const neighbours = (byPlayer.get(span.playerName) ?? []).filter((other) => Math.abs(startYear(other.span) - startYear(span)) === 1);
  const extraDefense =
    startYear(span) < 1973
      ? []
      : [...new Set([...defense.slice(1), ...neighbours.map((n) => n.defense[0])])].filter(
          (role) => role !== defense[0] && !FALLBACK_DEFENSE.includes(role),
        );
  const extraOffense = [...new Set([...offense.slice(1), ...neighbours.map((n) => n.offense[0])])].filter((role) => role !== offense[0]);
  const row: Row = {};
  if (defense[0] !== span.defensiveRole) row.d = defense[0];
  if (offense[0] !== span.offensiveArchetype) row.o = offense[0];
  if (extraDefense.length) row.x = extraDefense.map((role) => AUDIT_DEFENSIVE_ROLES.indexOf(role));
  if (extraOffense.length) row.y = extraOffense.map((role) => AUDIT_OFFENSIVE_ARCHETYPES.indexOf(role));
  if (row.x || row.y) withAdditional++;
  // Every audited span is listed, even with nothing to change, so the game knows it was audited.
  out[span.id] = row;
}
writeFileSync(OUTPUT, `${JSON.stringify(out, null, 0).replace(/},"/g, '},\n"')}\n`);
console.log(
  `roleAudit.json: ${Object.keys(out).length} spans (primary changed: defense ${defenseChanged}, offense ${offenseChanged}; with additional roles ${withAdditional})`,
);
