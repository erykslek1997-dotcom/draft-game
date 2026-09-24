/**
 * Precomputes the full-population percentiles needed by portability and the D-TAL->TAL bridge at
 * runtime.
 *
 * The underlying models deliberately calibrate against all ~13k spans, but shipping every full
 * player record and every self-creation row to the browser just to rebuild immutable ranks is
 * wasteful. This script remains the full-data path; production imports only its compact output.
 *
 * Entry tuple: [selfCreation, defensiveTalent, impliedTalDefense].
 * - `defensiveTalent` — within-position fraction of spans with a STRICTLY lower `computeDefensiveTalent`
 *   (the display ladder). Legacy semantics, kept bit-identical: `portability.ts` reads this and its
 *   own gates are calibrated against exactly this definition.
 * - `impliedTalDefense` — within-position MIDRANK percentile of `normalizedDefenseForFit` (TAL's OWN
 *   internal defense read, the pre-2026-07-30 linear scale). Midrank (not strictly-below) because
 *   that value has a huge point mass at DEFENSE_FLOOR — strictly-below would map ~40% of the pool to
 *   ~0 and bias every rank gap positive. The bridge (`talent.ts`) corrects TAL by the gap between
 *   these two ranks: a span D-TAL rates well above where TAL's own blend places it gets pulled up,
 *   and vice versa. Both inputs are unaffected by the bridge itself (it changes `computeTalent`, not
 *   `rawComponents`/`computeDefensiveTalent`), so there is no feedback loop and this artifact never
 *   needs a second regeneration pass after a bridge-constant change.
 */
import { writeFileSync } from 'node:fs';
import { players } from '../src/data/players';
import type { PlayerSpan, Position } from '../src/data/schema';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { functionalPosition } from '../src/engine/functionalPosition';
import { normalizedDefenseForFit } from '../src/engine/talent';
import { selfCreationPercentileForPortability } from '../src/engine/selfCreationSimilarity';

type RuntimePercentileEntry = [selfCreation: number, defensiveTalent: number, impliedTalDefense: number];

function percentileFn(
  valueOf: (span: PlayerSpan) => number,
  ties: 'strictly-below' | 'midrank',
): (span: PlayerSpan) => number {
  const sortedByPosition = new Map<Position, number[]>();
  for (const span of players) {
    const values = sortedByPosition.get(functionalPosition(span)) ?? [];
    values.push(valueOf(span));
    sortedByPosition.set(functionalPosition(span), values);
  }
  for (const values of sortedByPosition.values()) values.sort((a, b) => a - b);
  return (span: PlayerSpan): number => {
    const sorted = sortedByPosition.get(functionalPosition(span));
    if (!sorted || sorted.length === 0) return 0.5;
    const value = valueOf(span);
    let below = 0;
    let atOrBelow = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] < value) below++;
      if (sorted[i] <= value) atOrBelow++;
    }
    // 'strictly-below': legacy `lo / n` — the fraction with a strictly lower value.
    // 'midrank': midpoint of the tied block, so a large point mass (the DEFENSE_FLOOR blob in
    // `normalizedDefenseForFit`) gets a fair central rank instead of ~0. Keeps E[pctl] = 0.5.
    return ties === 'strictly-below' ? below / sorted.length : (below + atOrBelow) / (2 * sorted.length);
  };
}

const defensePercentile = percentileFn(computeDefensiveTalent, 'strictly-below');
const impliedDefensePercentile = percentileFn(normalizedDefenseForFit, 'midrank');

const percentiles: Record<string, RuntimePercentileEntry> = {};
const offensivePortabilityRanges: Partial<Record<Position, [min: number, max: number]>> = {};
for (const span of players) {
  percentiles[span.id] = [
    selfCreationPercentileForPortability(span),
    defensePercentile(span),
    impliedDefensePercentile(span),
  ];
}

const outputPath = 'src/data/runtimePercentiles.json';
// Let portability load the freshly-written percentiles instead of the previous artifact. Its raw
// offense calculation needs the self-creation rank, but not the range being built in this pass.
writeFileSync(outputPath, JSON.stringify({ percentiles, offensivePortabilityRanges }));
const { rawOffensivePortability } = await import('../src/engine/portability');
for (const span of players) {
  const rawOffense = rawOffensivePortability(span);
  const range = offensivePortabilityRanges[span.primaryPosition];
  if (!range) offensivePortabilityRanges[span.primaryPosition] = [rawOffense, rawOffense];
  else {
    range[0] = Math.min(range[0], rawOffense);
    range[1] = Math.max(range[1], rawOffense);
  }
}

writeFileSync(outputPath, JSON.stringify({ percentiles, offensivePortabilityRanges }));
console.log(`Wrote ${outputPath}: ${Object.keys(percentiles).length} spans.`);
