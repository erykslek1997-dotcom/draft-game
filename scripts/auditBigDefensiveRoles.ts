import { draftPool } from '../src/data/draftPool';
import legacyDraftPoolData from '../src/data/draftPool.json';
import type { DefensiveRole, PlayerSpan } from '../src/data/schema';
import { buildRoleFitContext, computeShadowRoleProfile } from '../src/engine/roleFitShadow';
import { athleticismScoreForSpan } from '../src/engine/athleticismLookup';
import { getBodyWeightLbs, getHeightInches } from '../src/data/heightLookup';

const ROLE_THRESHOLD = 70;
const roles: DefensiveRole[] = ['Anchor Big', 'Mobile Big', 'Post Defender', 'Helper'];
const context = buildRoleFitContext(draftPool);
const legacyRoleById = new Map((legacyDraftPoolData as PlayerSpan[]).map((span) => [span.id, span.defensiveRole]));
const bigs = draftPool.filter((span) =>
  span.primaryPosition === 'PF' || span.primaryPosition === 'C' ||
  span.secondaryPositions.includes('PF') || span.secondaryPositions.includes('C'),
);

interface AuditRow {
  player: string;
  span: string;
  position: string;
  incumbent: DefensiveRole;
  legacy: DefensiveRole;
  height: number | null;
  weight: number | null;
  athleticism: number | null;
  spg: number;
  bpg: number;
  rpg: number;
  anchor: number;
  mobile: number;
  post: number;
  helper: number;
  qualifies: string;
}

function roleKey(role: DefensiveRole): 'anchor' | 'mobile' | 'post' | 'helper' {
  if (role === 'Anchor Big') return 'anchor';
  if (role === 'Mobile Big') return 'mobile';
  if (role === 'Post Defender') return 'post';
  return 'helper';
}

function row(span: PlayerSpan): AuditRow {
  const profile = computeShadowRoleProfile(span, context);
  const score = (role: DefensiveRole) => profile.defensiveFits.find((fit) => fit.role === role)?.score ?? 0;
  const scored = roles.map((role) => [role, score(role)] as const);
  return {
    player: span.playerName,
    span: span.spanLabel,
    position: [span.primaryPosition, ...span.secondaryPositions].join('/'),
    incumbent: span.defensiveRole,
    legacy: legacyRoleById.get(span.id) ?? span.defensiveRole,
    height: getHeightInches(span.playerName) ?? null,
    weight: getBodyWeightLbs(span.playerName) ?? null,
    athleticism: athleticismScoreForSpan(span) === null ? null : Math.round(athleticismScoreForSpan(span)!),
    spg: span.box.spg,
    bpg: span.box.bpg,
    rpg: span.box.rpg,
    anchor: score('Anchor Big'),
    mobile: score('Mobile Big'),
    post: score('Post Defender'),
    helper: score('Helper'),
    qualifies: scored.filter(([, value]) => value >= ROLE_THRESHOLD).map(([role]) => role).join(' + ') || 'none',
  };
}

const rows = bigs.map(row);
const migrations = rows.filter((entry) => entry.legacy !== entry.incumbent);
const incumbentMismatch = rows.filter((entry) =>
  (entry.incumbent === 'Anchor Big' && entry.anchor < ROLE_THRESHOLD) ||
  (entry.incumbent === 'Mobile Big' && entry.mobile < ROLE_THRESHOLD),
);
const protectedHistoricalMismatch = incumbentMismatch.filter((entry) => Number.parseInt(entry.span.slice(0, 4), 10) < 1973);
const protectedMissingDataMismatch = incumbentMismatch.filter((entry) =>
  Number.parseInt(entry.span.slice(0, 4), 10) >= 1973 &&
  (entry.height === null || (entry.incumbent === 'Mobile Big' && entry.athleticism === null)),
);
console.log(`Big spans audited: ${rows.length}`);
for (const role of roles) {
  const key = roleKey(role);
  console.log(`${role}: ${rows.filter((entry) => entry[key] >= ROLE_THRESHOLD).length}`);
}
console.log(`Multi-role (2+): ${rows.filter((entry) => [entry.anchor, entry.mobile, entry.post].filter((score) => score >= ROLE_THRESHOLD).length >= 2).length}`);
console.log(`All three: ${rows.filter((entry) => entry.anchor >= ROLE_THRESHOLD && entry.mobile >= ROLE_THRESHOLD && entry.post >= ROLE_THRESHOLD).length}`);
console.log(`Missing height/weight: ${rows.filter((entry) => entry.height === null || entry.weight === null).length}`);
console.log(`Missing athleticism: ${rows.filter((entry) => entry.athleticism === null).length}`);
console.log(`Legacy Anchor/Mobile labels below measured threshold: ${incumbentMismatch.length}`);
console.log(`  protected pre-tracking spans: ${protectedHistoricalMismatch.length}`);
console.log(`  protected missing-data spans: ${protectedMissingDataMismatch.length}`);
console.log(`  unexplained remaining: ${incumbentMismatch.length - protectedHistoricalMismatch.length - protectedMissingDataMismatch.length}`);
console.log(`Legacy primary tags overwritten: ${migrations.length}`);
const transitionCounts = new Map<string, number>();
for (const entry of migrations) {
  const transition = `${entry.legacy} -> ${entry.incumbent}`;
  transitionCounts.set(transition, (transitionCounts.get(transition) ?? 0) + 1);
}
console.table([...transitionCounts].map(([transition, count]) => ({ transition, count })).sort((a, b) => b.count - a.count));
for (const transition of transitionCounts.keys()) {
  const examples = migrations
    .filter((entry) => `${entry.legacy} -> ${entry.incumbent}` === transition)
    .slice(0, 8)
    .map((entry) => `${entry.player} ${entry.span}`);
  console.log(`${transition}: ${examples.join(' · ')}`);
}

const auditControls = [
  'Hakeem Olajuwon', 'David Robinson', 'Dikembe Mutombo', "Shaquille O'Neal",
  'Tim Duncan', 'Kevin Garnett', 'Anthony Davis', 'Bam Adebayo', 'Draymond Green',
  'Rudy Gobert', 'Evan Mobley', 'Nerlens Noel', 'Ben Wallace', 'Nikola Jokic',
  'Shawn Marion', 'Andrei Kirilenko', 'Kevin Durant',
];
const representativeRows = auditControls.flatMap((player) => {
  const candidates = rows.filter((entry) => entry.player === player);
  return candidates.sort((a, b) => (b.anchor + b.mobile + b.post) - (a.anchor + a.mobile + a.post)).slice(0, 1);
});
console.log('\nRepresentative audit controls (best multi-role span)');
console.table(representativeRows);

if (process.argv.includes('--summary')) process.exit(0);

for (const role of roles) {
  const key = roleKey(role);
  console.log(`\nTop ${role}`);
  console.table([...rows].sort((a, b) => b[key] - a[key]).slice(0, 20));
}

console.log('\nAll-three-role spans');
console.table(rows.filter((entry) => entry.anchor >= ROLE_THRESHOLD && entry.mobile >= ROLE_THRESHOLD && entry.post >= ROLE_THRESHOLD).slice(0, 50));

console.log('\nIncumbent Anchor/Mobile labels that do not meet the measured threshold');
console.table(incumbentMismatch.slice(0, 50));
