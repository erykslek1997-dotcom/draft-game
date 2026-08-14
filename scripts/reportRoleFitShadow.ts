/**
 * Produces an auditable, disconnected multi-role report from the existing player database.
 * Nothing is written to PlayerSpan, draftPool or any runtime lookup consumed by the game.
 */
import fs from 'fs';
import path from 'path';
import { players } from '../src/data/players';
import { provenanceForSpan } from '../src/data/provenance';
import type { DefensiveRole, OffensiveArchetype, RoleFitScore } from '../src/data/schema';
import { buildRoleFitContext, computeShadowRoleProfile } from '../src/engine/roleFitShadow';

const REPORT_DIR = path.resolve('reports');
const PROPOSALS_CSV = path.join(REPORT_DIR, 'role-fit-shadow-proposals.csv');
const SPANS_CSV = path.join(REPORT_DIR, 'role-fit-shadow-spans.csv');
const SUMMARY_JSON = path.join(REPORT_DIR, 'role-fit-shadow-summary.json');
const SUMMARY_MD = path.join(REPORT_DIR, 'role-fit-shadow-summary.md');

function csv(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function formatFits<Role extends string>(fits: RoleFitScore<Role>[]): string {
  return fits.map((fit) => `${fit.role} (${fit.score})`).join(' | ');
}

fs.mkdirSync(REPORT_DIR, { recursive: true });
const context = buildRoleFitContext(players);
const proposalRows: string[][] = [];
const spanRows: string[][] = [];
const offensiveProposals: OffensiveArchetype[] = [];
const defensiveProposals: DefensiveRole[] = [];
const pfOffensiveProposals: OffensiveArchetype[] = [];
const pfDefensiveProposals: DefensiveRole[] = [];
const uniquePlayers = new Set<string>();
let withheldManual = 0;
let withheldStocks = 0;

for (const span of players) {
  uniquePlayers.add(span.playerName);
  const provenance = provenanceForSpan(span);
  const stocksUnavailable = [...provenance.unavailableFields, ...provenance.estimatedFields]
    .some((field) => field === 'spg' || field === 'bpg');
  const stocksAvailable = !stocksUnavailable;
  const isManualPlaceholder = provenance.sourceKind === 'curated-manual';
  const warnings: string[] = [];
  if (isManualPlaceholder) {
    warnings.push('Additional roles withheld: source box line is hand-curated rather than verified.');
    withheldManual++;
  }
  if (!stocksAvailable) withheldStocks++;
  const measuredBox = provenance.boxStatus === 'measured' || provenance.boxStatus === 'mixed';
  const profile = computeShadowRoleProfile(span, context, {
    stocksAvailable,
    allowAdditionalRoles: !isManualPlaceholder,
    offenseConfidence: measuredBox ? 'medium' : 'low',
    defenseConfidence: measuredBox ? 'medium' : 'low',
    warnings,
  });

  spanRows.push([
    span.id,
    span.playerName,
    span.spanLabel,
    span.primaryPosition,
    span.secondaryPositions.join('|'),
    provenance.sourceKind,
    provenance.boxStatus,
    profile.incumbentOffensiveRole,
    formatFits(profile.proposedOffensiveRoles),
    profile.incumbentDefensiveRole,
    formatFits(profile.proposedDefensiveRoles),
    profile.warnings.join(' | '),
  ]);

  const addProposal = (
    side: 'offense' | 'defense',
    incumbent: OffensiveArchetype | DefensiveRole,
    fit: RoleFitScore<OffensiveArchetype | DefensiveRole>,
  ) => {
    proposalRows.push([
      span.id,
      span.playerName,
      span.spanLabel,
      span.primaryPosition,
      span.secondaryPositions.join('|'),
      side,
      incumbent,
      fit.role,
      String(fit.score),
      fit.confidence,
      fit.evidence.join(' | '),
      provenance.sourceKind,
      provenance.boxStatus,
    ]);
  };
  for (const fit of profile.proposedOffensiveRoles) {
    offensiveProposals.push(fit.role);
    if (span.primaryPosition === 'PF') pfOffensiveProposals.push(fit.role);
    addProposal('offense', profile.incumbentOffensiveRole, fit);
  }
  for (const fit of profile.proposedDefensiveRoles) {
    defensiveProposals.push(fit.role);
    if (span.primaryPosition === 'PF') pfDefensiveProposals.push(fit.role);
    addProposal('defense', profile.incumbentDefensiveRole, fit);
  }
}

const proposalHeader = [
  'player_id', 'player_name', 'span', 'primary_position', 'secondary_positions', 'side',
  'incumbent_role', 'proposed_additional_role', 'fit_score', 'confidence', 'evidence',
  'source_kind', 'box_status',
];
const spanHeader = [
  'player_id', 'player_name', 'span', 'primary_position', 'secondary_positions', 'source_kind',
  'box_status', 'incumbent_offense', 'proposed_offense', 'incumbent_defense',
  'proposed_defense', 'warnings',
];
fs.writeFileSync(PROPOSALS_CSV, [proposalHeader, ...proposalRows].map((row) => row.map(csv).join(',')).join('\n') + '\n');
fs.writeFileSync(SPANS_CSV, [spanHeader, ...spanRows].map((row) => row.map(csv).join(',')).join('\n') + '\n');

const summary = {
  version: 'role-fit-shadow-v1',
  generatedAt: new Date().toISOString(),
  dataScope: 'existing PlayerSpan fields, measured runtime zone totals, measured PBP-derived assisted/unassisted rates and user-validated qualitative historical movement evidence',
  runtimeIntegration: false,
  spansAudited: players.length,
  uniquePlayers: uniquePlayers.size,
  proposals: {
    total: proposalRows.length,
    offense: offensiveProposals.length,
    defense: defensiveProposals.length,
    offenseByRole: countBy(offensiveProposals),
    defenseByRole: countBy(defensiveProposals),
  },
  withheld: {
    manualBoxSpans: withheldManual,
    defensiveSpansMissingOfficialStocks: withheldStocks,
  },
  pfAudit: {
    offenseByAdditionalRole: countBy(pfOffensiveProposals),
    defenseByAdditionalRole: countBy(pfDefensiveProposals),
  },
  parameters: {
    additionalRoleThreshold: 72,
    maxAdditionalRolesPerSide: 2,
    comparisonPopulation: 'within primary position',
  },
  safeguards: [
    'Shadow profiles are separate objects and are never attached to PlayerSpan.',
    'No production module imports roleFitShadow.',
    'Manual placeholder box lines receive no proposed additional roles.',
    'Defensive additions are withheld when official STL/BLK data is unavailable.',
    'Off Screen proposals require measured 1996-97+ PBP assisted/unassisted data; pre-PBP spans are withheld.',
    'Movement Shooter is never inferred from box shape alone; it requires an incumbent tag or explicit historical evidence until Synergy data is imported.',
    'Off Screen remains low-confidence because standard PBP does not distinguish Spot Up from Off Screen.',
  ],
};
fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summary, null, 2) + '\n');

const markdown = `# Multi-role shadow report\n\n` +
  `Generated from the existing database without changing TAL, AI, rotations or game scoring.\n\n` +
  `- Version: \`${summary.version}\`\n` +
  `- Spans audited: ${summary.spansAudited.toLocaleString('en-US')}\n` +
  `- Unique players: ${summary.uniquePlayers.toLocaleString('en-US')}\n` +
  `- Additional offensive-role proposals: ${summary.proposals.offense.toLocaleString('en-US')}\n` +
  `- Additional defensive-role proposals: ${summary.proposals.defense.toLocaleString('en-US')}\n` +
  `- Manual-box spans withheld: ${summary.withheld.manualBoxSpans}\n` +
  `- Defensive spans withheld for missing official STL/BLK: ${summary.withheld.defensiveSpansMissingOfficialStocks}\n\n` +
  `## Method\n\n` +
  `Each fit score is a 0-100 weighted blend of within-position percentiles from existing FGA and box-score fields. ` +
  `Exact runtime zone totals are used for rim roles when at least 150 classified attempts exist; otherwise the report ` +
  `falls back to the recorded FG%, TS% and 3PA/FGA profile. A role is proposed at 72+, with at most two additions ` +
  `per side. Off Screen additionally requires measured PBP-derived unassisted-three data and at least 80% assisted makes. ` +
  `Movement Shooter is not inferred from box shape alone: it requires an incumbent tag or the small, user-validated historical evidence registry until Synergy data is imported. ` +
  `Off Screen remains low-confidence because standard PBP has no screen-action event and cannot fully separate Spot Up from Off Screen.\n\n` +
  `## Classifier corrections\n\n` +
  `- PF now has a hybrid branch that reads both perimeter and interior production; PF is no longer an alias for C.\n` +
  `- Box-only classification no longer emits Movement Shooter or Off Screen Shooter; shooting-shaped profiles fall back to Stationary Shooter until route evidence exists.\n` +
  `- Historical Movement proposals are limited to the explicit evidence registry and still require real recorded volume and accuracy.\n` +
  `- Off Screen Shooter now requires a perimeter position, 10-13 FGA, at least 5 3PA, 38% from three, a mixed 3PA/FGA diet and under 3.5 APG.\n` +
  `- The committed player database was not regenerated, so these classifier fixes do not alter current TAL, AI or results.\n\n` +
  `## Offensive proposals by role\n\n` +
  Object.entries(summary.proposals.offenseByRole).map(([role, count]) => `- ${role}: ${count}`).join('\n') +
  `\n\n## Defensive proposals by role\n\n` +
  Object.entries(summary.proposals.defenseByRole).map(([role, count]) => `- ${role}: ${count}`).join('\n') +
  `\n\n## PF shadow audit: offensive additions\n\n` +
  Object.entries(summary.pfAudit.offenseByAdditionalRole).map(([role, count]) => `- ${role}: ${count}`).join('\n') +
  `\n\n## PF shadow audit: defensive additions\n\n` +
  Object.entries(summary.pfAudit.defenseByAdditionalRole).map(([role, count]) => `- ${role}: ${count}`).join('\n') +
  `\n\n## Safeguards\n\n` + summary.safeguards.map((item) => `- ${item}`).join('\n') + '\n';
fs.writeFileSync(SUMMARY_MD, markdown);

console.log(`Audited ${players.length} spans / ${uniquePlayers.size} players.`);
console.log(`Proposed ${offensiveProposals.length} offensive and ${defensiveProposals.length} defensive additional roles.`);
console.log(`Wrote ${PROPOSALS_CSV}`);
console.log(`Wrote ${SPANS_CSV}`);
console.log(`Wrote ${SUMMARY_JSON}`);
console.log(`Wrote ${SUMMARY_MD}`);
