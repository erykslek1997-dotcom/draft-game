/**
 * Task 3 of the user's follow-up: a systematic "who's undervalued" scan across the FULL dataset
 * (not just the human-draft-matched names from compareHumanDraft.ts), using the same real-value
 * residual historicalApmCorrection.ts uses for the in-formula bonus - here shown uncapped and
 * unfiltered by era-split regression choice, purely as a ranked diagnostic list, restricted to
 * talent >= 40 for signal robustness (same threshold validateAgainstRapm.ts uses).
 */
import { players } from '../src/data/players';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import { blendedRealValueForSpan } from '../src/engine/blendedRealValueLookup';
import { writeFileSync } from 'fs';

const MEANINGFUL_TALENT = 40;
const poolKeys = new Set(draftPool.map((p) => normalizePlayerName(p.playerName)));

function fitLinearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  const cov = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  const varX = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  return { slope: cov / varX, intercept: meanY - (cov / varX) * meanX };
}

const modernPoints: { x: number; y: number }[] = [];
const prePoints: { x: number; y: number }[] = [];
const perSpan: { span: typeof players[number]; talent: number; real: { value: number; isModernEra: boolean } }[] = [];
for (const span of players) {
  const real = blendedRealValueForSpan(span);
  if (!real) continue;
  const talent = computeTalent(span);
  perSpan.push({ span, talent, real });
  (real.isModernEra ? modernPoints : prePoints).push({ x: talent, y: real.value });
}
const modernReg = fitLinearRegression(modernPoints);
const preReg = fitLinearRegression(prePoints);

const bestResidualByName = new Map<string, { name: string; position: string; talent: number; residual: number; realValue: number; span: string; inPool: boolean }>();
for (const { span, talent, real } of perSpan) {
  if (talent < MEANINGFUL_TALENT) continue;
  const { slope, intercept } = real.isModernEra ? modernReg : preReg;
  const residual = real.value - (slope * talent + intercept);
  const key = normalizePlayerName(span.playerName);
  const existing = bestResidualByName.get(key);
  if (!existing || residual > existing.residual) {
    bestResidualByName.set(key, {
      name: span.playerName, position: span.primaryPosition, talent, residual,
      realValue: real.value, span: span.spanLabel, inPool: poolKeys.has(key),
    });
  }
}

const ranked = [...bestResidualByName.values()].sort((a, b) => b.residual - a.residual);
console.log(`Meaningful-talent spans with real-value coverage: ${perSpan.filter((p) => p.talent >= MEANINGFUL_TALENT).length}`);
console.log(`Distinct players ranked: ${ranked.length}`);
console.log('\n=== Top 40 most undervalued (real value exceeds prediction) ===');
for (const r of ranked.slice(0, 40)) {
  console.log(`${r.name.padEnd(25)} ${r.position} talent=${r.talent} residual=${r.residual.toFixed(2)} realValue=${r.realValue.toFixed(2)} span=${r.span} inPool=${r.inPool}`);
}

const lines = ['name,position,talent,residual,real_value,best_span,in_pool', ...ranked.map((r) => `${r.name},${r.position},${r.talent},${r.residual.toFixed(2)},${r.realValue.toFixed(2)},${r.span},${r.inPool}`)];
writeFileSync('scripts/undervaluedCandidates.csv', lines.join('\n'));
console.log(`\nWrote scripts/undervaluedCandidates.csv (${ranked.length} rows)`);
