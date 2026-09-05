import { DETECTORS, SUPPRESSION_GROUPS, EXPLICIT_SUPPRESSION, type DetectorId } from '../src/engine/insights';

/**
 * 2026-09-05: added after a real (harmless but real) drift was found by manual inspection — 7
 * DetectorId values were referenced in SUPPRESSION_GROUPS/EXPLICIT_SUPPRESSION (and exist in the
 * DetectorId type union) but no detector with that id was ever implemented in DETECTORS, so those
 * references could never match anything real. Cleaned up in insights.ts the same day; this test
 * exists so that class of drift is caught automatically instead of needing another manual sweep.
 *
 * Deliberately does NOT flag "detector X explicitly suppresses detector Y that's already in the
 * same suppressionGroup" as an error — measured directly: in every existing case, the explicit
 * suppression target already scores strictly lower via dedupeGroups' own severity/relevance math
 * (e.g. ELITE_STARTING_SPACING vs GOOD_STARTING_SPACING share the same computed severity but
 * ELITE's relevance is fixed higher), so the explicit suppression is a redundant-but-harmless
 * belt-and-suspenders guard, not a bug. This test only fails on things that are unambiguously
 * wrong regardless of score values.
 */

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const byId = new Map(DETECTORS.map((d) => [d.id, d]));

// 1. Every id referenced in SUPPRESSION_GROUPS or EXPLICIT_SUPPRESSION must be a real, implemented
// detector — not just a name that exists in the DetectorId type union.
const phantomRefs: string[] = [];
for (const [group, ids] of Object.entries(SUPPRESSION_GROUPS)) {
  for (const id of ids) {
    if (!byId.has(id)) phantomRefs.push(`SUPPRESSION_GROUPS["${group}"] references unimplemented id "${id}"`);
  }
}
for (const [key, ids] of Object.entries(EXPLICIT_SUPPRESSION) as [DetectorId, DetectorId[] | undefined][]) {
  if (!byId.has(key)) phantomRefs.push(`EXPLICIT_SUPPRESSION key "${key}" is not an implemented detector`);
  for (const id of ids ?? []) {
    if (!byId.has(id)) phantomRefs.push(`EXPLICIT_SUPPRESSION["${key}"] references unimplemented id "${id}"`);
  }
}
check(phantomRefs.length === 0, `no suppression config references an unimplemented detector id${phantomRefs.length ? `:\n  - ${phantomRefs.join('\n  - ')}` : ''}`);

// 2. A detector's own `suppressionGroup` must round-trip: the group must exist in
// SUPPRESSION_GROUPS, and that group's array must actually list the detector back.
const groupMismatches: string[] = [];
for (const d of DETECTORS) {
  if (!d.suppressionGroup) continue;
  const groupList = SUPPRESSION_GROUPS[d.suppressionGroup];
  if (!groupList) { groupMismatches.push(`${d.id} declares suppressionGroup "${d.suppressionGroup}", which does not exist in SUPPRESSION_GROUPS`); continue; }
  if (!groupList.includes(d.id)) groupMismatches.push(`${d.id} declares suppressionGroup "${d.suppressionGroup}" but is missing from that group's own array`);
}
check(groupMismatches.length === 0, `every detector's suppressionGroup round-trips with SUPPRESSION_GROUPS${groupMismatches.length ? `:\n  - ${groupMismatches.join('\n  - ')}` : ''}`);

// 3. A suppression group should not mix 'strength' and 'concern' detectors — dedupeGroups picks
// one score-based winner per group, which only makes sense within one semantic side.
const mixedGroups: string[] = [];
for (const [group, ids] of Object.entries(SUPPRESSION_GROUPS)) {
  const types = new Set(ids.map((id) => byId.get(id)?.type).filter(Boolean));
  if (types.size > 1) mixedGroups.push(`"${group}" mixes types: ${ids.map((id) => `${id}(${byId.get(id)?.type})`).join(', ')}`);
}
check(mixedGroups.length === 0, `no suppression group mixes strengths and concerns${mixedGroups.length ? `:\n  - ${mixedGroups.join('\n  - ')}` : ''}`);

// 4. No detector suppresses itself, and no two detectors suppress each other (either would make
// both permanently unable to co-exist regardless of which one is actually more relevant per team).
const cycles: string[] = [];
for (const d of DETECTORS) {
  if (d.suppresses?.includes(d.id)) cycles.push(`${d.id} suppresses itself`);
  for (const target of d.suppresses ?? []) {
    if (byId.get(target)?.suppresses?.includes(d.id)) cycles.push(`${d.id} <-> ${target} mutually suppress each other`);
  }
}
check(cycles.length === 0, `no detector self-suppresses or mutually suppresses another${cycles.length ? `:\n  - ${cycles.join('\n  - ')}` : ''}`);

console.log(`\nDetector integrity checks complete. ${DETECTORS.length} detectors, ${Object.keys(SUPPRESSION_GROUPS).length} suppression groups, ${Object.keys(EXPLICIT_SUPPRESSION).length} explicit suppression entries.`);
