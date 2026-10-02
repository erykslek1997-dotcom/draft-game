/**
 * Writes src/data/roleAudit.json — the primary defensive role / offensive archetype the role audit
 * (`src/engine/roleAudit.ts`) assigns, for every draft-pool span whose label changes. Spans with a
 * manual override (`DEFENSIVE_ROLE_OVERRIDES` / `OFFENSIVE_ARCHETYPE_OVERRIDES` in players.ts, and
 * Draymond Green's hand-set Anchor Big) are left alone: the user's calls always win.
 *
 * 2026-10-02, user-approved top-200 list ("Akceptuję").
 *
 * D-TAL and spacing read the labels too, so the audit always runs against the UN-audited pool:
 * the JSON is emptied before any engine module loads. That keeps the build deterministic (a
 * second run gives the same file) instead of feeding its own output back in.
 *
 * Run: npx tsx scripts/buildRoleAudit.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DefensiveRole, OffensiveArchetype } from '../src/data/schema';

const OUTPUT = resolve(import.meta.dirname, '../src/data/roleAudit.json');
writeFileSync(OUTPUT, '{}\n');
await import('../src/engine/fit');
const { draftPoolBeforeRoleAudit } = await import('../src/data/draftPool');
const { DEFENSIVE_ROLE_OVERRIDES, OFFENSIVE_ARCHETYPE_OVERRIDES } = await import('../src/data/players');
const { normalizePlayerName } = await import('../src/data/schema');
const { auditedDefensiveRoles, auditedOffensiveArchetypes, roleAuditStats } = await import('../src/engine/roleAudit');
const { buildRoleFitContext, computeShadowRoleProfile } = await import('../src/engine/roleFitShadow');
const shadowContext = buildRoleFitContext(draftPoolBeforeRoleAudit);
const MEASURED_SHOOTER_MIN_SCORE = 70;

const key = (name: string, spanLabel: string) => `${normalizePlayerName(name)}|${spanLabel}`;
const defenseLocked = new Set(DEFENSIVE_ROLE_OVERRIDES.map((o) => key(o.name, o.spanLabel)));
const offenseLocked = new Set(OFFENSIVE_ARCHETYPE_OVERRIDES.map((o) => key(o.name, o.spanLabel)));
const DEFENSE_LOCKED_PLAYERS = new Set([normalizePlayerName('Draymond Green')]);

const out: Record<string, { d?: DefensiveRole; o?: OffensiveArchetype }> = {};
let defenseChanged = 0;
let offenseChanged = 0;
for (const span of [...draftPoolBeforeRoleAudit].sort((a, b) => a.id.localeCompare(b.id))) {
  const k = key(span.playerName, span.spanLabel);
  const shooterFit = computeShadowRoleProfile(span, shadowContext).offensiveFits.find(
    (fit) => (fit.role === 'Off Screen Shooter' || fit.role === 'Movement Shooter') && fit.score >= MEASURED_SHOOTER_MIN_SCORE,
  );
  const stats = roleAuditStats(span, shooterFit?.role);
  const entry: { d?: DefensiveRole; o?: OffensiveArchetype } = {};
  if (!defenseLocked.has(k) && !DEFENSE_LOCKED_PLAYERS.has(normalizePlayerName(span.playerName))) {
    const role = auditedDefensiveRoles(span, stats)[0];
    if (role !== span.defensiveRole) { entry.d = role; defenseChanged++; }
  }
  if (!offenseLocked.has(k)) {
    const archetype = auditedOffensiveArchetypes(span, stats)[0];
    if (archetype !== span.offensiveArchetype) { entry.o = archetype; offenseChanged++; }
  }
  if (entry.d || entry.o) out[span.id] = entry;
}
writeFileSync(OUTPUT, `${JSON.stringify(out, null, 0).replace(/},"/g, '},\n"')}\n`);
console.log(`roleAudit.json: ${Object.keys(out).length} spans (defense ${defenseChanged}, offense ${offenseChanged})`);
