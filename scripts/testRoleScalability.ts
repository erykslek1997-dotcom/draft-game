import { draftPool } from '../src/data/draftPool';
import { roleScalabilityBreakdown } from '../src/engine/portabilityCorrection';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function bonusFor(playerName: string, spanLabel: string): number {
  const span = draftPool.find((candidate) => candidate.playerName === playerName && candidate.spanLabel === spanLabel);
  if (!span) throw new Error(`Missing calibration span: ${playerName}, ${spanLabel}`);
  return roleScalabilityBreakdown(span).total;
}

for (const [playerName, spanLabel] of [
  ['Klay Thompson', '2014-16'],
  ['Pau Gasol', '2009-11'],
  ['Marc Gasol', '2015-17'],
  ['Brook Lopez', '2022-24'],
]) {
  assert(bonusFor(playerName, spanLabel) > 0, `${playerName} ${spanLabel} clears a role-scalability gate`);
}

for (const [playerName, spanLabel] of [
  ['Reggie Miller', '1993-95'],
  ['Chris Webber', '2000-02'],
  ['DeMarcus Cousins', '2015-17'],
  ['Bob Lanier', '1972-74'],
]) {
  assert(bonusFor(playerName, spanLabel) === 0, `${playerName} ${spanLabel} remains outside the correction`);
}

const corrected = draftPool.map(roleScalabilityBreakdown).filter((breakdown) => breakdown.total > 0);
// Proportional, not an absolute count — the draft pool grew from ~6,075 to ~9,451 spans on
// 2026-09-04 (STARS_PER_POSITION 100 -> 200). At the old size this was `<= 100` (~1.6%); the
// correction is a targeted mechanism, so gate it on the share of the pool it touches instead.
assert(corrected.length / draftPool.length <= 0.02, 'role-scalability correction remains narrow across the pool');
assert(corrected.every((breakdown) => breakdown.total <= 3.5), 'every combined correction respects the 3.5-point cap');
console.log('Role-scalability tests complete.');
