/**
 * Writes a shadow-only calibration report. It does not change TAL.
 *
 * `shadowDeltaAdjustment` is deliberately diagnostic: a small, reliability-shrunk view of
 * playoff-vs-RS BPM movement, capped at +/-2. It makes the potential blast radius reviewable
 * before any postseason BPM term is allowed into production ratings.
 */
import { writeFileSync } from 'node:fs';
import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { playoffBpm2ForSpan } from '../src/engine/playoffBpm2Lookup';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const covered = draftPool
  .map((span) => ({ span, po: playoffBpm2ForSpan(span) }))
  .filter((entry): entry is { span: (typeof draftPool)[number]; po: NonNullable<ReturnType<typeof playoffBpm2ForSpan>> } => entry.po !== null);

const byPosition = new Map<string, number[]>();
for (const { span, po } of covered) {
  const values = byPosition.get(span.primaryPosition) ?? [];
  values.push(po.bpm);
  byPosition.set(span.primaryPosition, values);
}
for (const values of byPosition.values()) values.sort((a, b) => a - b);

function percentile(position: string, value: number): number {
  const values = byPosition.get(position) ?? [];
  if (values.length <= 1) return 50;
  let belowOrEqual = 0;
  for (const candidate of values) if (candidate <= value) belowOrEqual++;
  return ((belowOrEqual - 1) / (values.length - 1)) * 100;
}

const header = [
  'player', 'span', 'position', 'tal', 'playoff_bpm', 'playoff_obpm', 'playoff_dbpm',
  'bpm_delta_vs_rs', 'position_percentile', 'games', 'minutes', 'seasons', 'reliability',
  'shadow_delta_adjustment', 'data_statuses',
];
const lines = [header.join(',')];
for (const { span, po } of covered.sort((a, b) => a.span.playerName.localeCompare(b.span.playerName) || a.span.spanLabel.localeCompare(b.span.spanLabel))) {
  const shadowAdjustment = Math.max(-2, Math.min(2, po.bpmDeltaVsRs * po.reliability * 0.5));
  lines.push([
    span.playerName,
    span.spanLabel,
    span.primaryPosition,
    computeTalent(span),
    po.bpm.toFixed(3),
    po.obpm.toFixed(3),
    po.dbpm.toFixed(3),
    po.bpmDeltaVsRs.toFixed(3),
    percentile(span.primaryPosition, po.bpm).toFixed(1),
    po.games,
    po.minutes.toFixed(1),
    po.seasons,
    po.reliability.toFixed(3),
    shadowAdjustment.toFixed(3),
    po.dataStatuses.join('|'),
  ].map(csvCell).join(','));
}

const outputPath = 'reports/playoff-bpm-calibration.csv';
writeFileSync(outputPath, `${lines.join('\n')}\n`);
console.log(`Wrote ${outputPath}: ${covered.length}/${draftPool.length} spans (${(100 * covered.length / draftPool.length).toFixed(1)}% coverage).`);
