/**
 * Task 2 of the user's follow-up: the pool-curation gap found in compareHumanDraft.ts wasn't
 * random - the 38 human-drafted-but-not-in-pool players skew hard toward one profile ("3-and-D
 * wing" / switchable modern big: high POR, moderate TAL, cheap FGA, Stationary/Off-Screen
 * Shooter or Versatile/Stretch Big archetypes, Chaser/Wing Stopper/Mobile/Anchor Big defensive
 * roles). Confirmed directly against 11 of those names (all POR 51-91, TAL 44-62, FGA <13, all
 * absent from draftPool.json). This searches the FULL dataset (not just the 300-pool) for MORE
 * players matching that same profile who aren't currently in the pool - real candidates for
 * expanding buildDraftPool.ts's cheap-glue tier, not just the specific 38 names humans happened
 * to draft in one 135-pick sample.
 */
import { players } from '../src/data/players';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import { computePortability } from '../src/engine/portability';
import { spanEndYears } from '../src/engine/era';
import { writeFileSync } from 'fs';

const ROLE_ARCHETYPES = new Set(['Stationary Shooter', 'Off Screen Shooter', 'Movement Shooter', 'Versatile Big', 'Stretch Big']);
const ROLE_DEFENSE = new Set(['Chaser', 'Wing Stopper', 'Point of Attack', 'Mobile Big', 'Anchor Big', 'Helper']);
const MIN_POR = 65;
const MIN_TAL = 45;
const MAX_TAL = 70;
const MAX_FGA = 13;
const LOW_FGA_CEILING = 8.5;
// User: "throw away players before 1990 season" - drop spans whose entire covered window
// predates the modern 3-point-era role-player archetype (Stationary/Off Screen Shooter etc.
// only became common once teams actually spaced the floor).
const MIN_SEASON_END_YEAR = 1990;

const poolKeys = new Set(draftPool.map((p) => normalizePlayerName(p.playerName)));

const bestByName = new Map<string, { name: string; position: string; talent: number; por: number; fga: number; arch: string; role: string; span: string }>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  if (poolKeys.has(key)) continue; // already in the pool, not a gap
  const years = spanEndYears(p.spanLabel);
  if (years.length > 0 && Math.max(...years) < MIN_SEASON_END_YEAR) continue;
  const talent = computeTalent(p);
  const por = computePortability(p);
  if (talent < MIN_TAL || talent > MAX_TAL) continue;
  if (por < MIN_POR) continue;
  if (p.fga > MAX_FGA) continue;
  if (!ROLE_ARCHETYPES.has(p.offensiveArchetype) && !ROLE_DEFENSE.has(p.defensiveRole)) continue;
  const existing = bestByName.get(key);
  if (!existing || por > existing.por) {
    bestByName.set(key, {
      name: p.playerName, position: p.primaryPosition, talent, por, fga: p.fga,
      arch: p.offensiveArchetype, role: p.defensiveRole, span: p.spanLabel,
    });
  }
}

const results = [...bestByName.values()].sort((a, b) => b.por - a.por);
const lowFga = results.filter((r) => r.fga <= LOW_FGA_CEILING);
const moderateFga = results.filter((r) => r.fga > LOW_FGA_CEILING);

console.log(`Candidates found (not in pool, POR>=${MIN_POR}, TAL ${MIN_TAL}-${MAX_TAL}, FGA<=${MAX_FGA}, 1990+, role-player archetype/role): ${results.length}`);
console.log(`  Low-FGA (<=${LOW_FGA_CEILING}, cap-glue tier): ${lowFga.length}`);
console.log(`  Moderate-FGA (${LOW_FGA_CEILING}-${MAX_FGA}): ${moderateFga.length}`);

console.log('\n=== Low-FGA cap-glue candidates (top 25) ===');
for (const r of lowFga.slice(0, 25)) {
  console.log(`${r.name.padEnd(25)} ${r.position} TAL=${r.talent} POR=${r.por} FGA=${r.fga} arch=${r.arch} role=${r.role}`);
}
console.log('\n=== Moderate-FGA candidates (top 25) ===');
for (const r of moderateFga.slice(0, 25)) {
  console.log(`${r.name.padEnd(25)} ${r.position} TAL=${r.talent} POR=${r.por} FGA=${r.fga} arch=${r.arch} role=${r.role}`);
}

const lines = [
  'name,position,talent,portability,fga,archetype,defensive_role,best_span,tier',
  ...lowFga.map((r) => `${r.name},${r.position},${r.talent},${r.por},${r.fga},${r.arch},${r.role},${r.span},low_fga`),
  ...moderateFga.map((r) => `${r.name},${r.position},${r.talent},${r.por},${r.fga},${r.arch},${r.role},${r.span},moderate_fga`),
];
writeFileSync('scripts/rolePlayerGapCandidates.csv', lines.join('\n'));
console.log(`\nWrote scripts/rolePlayerGapCandidates.csv (${results.length} rows)`);
