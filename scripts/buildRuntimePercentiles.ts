/**
 * Precomputes the two full-population percentiles needed by portability at runtime.
 *
 * The underlying models deliberately calibrate against all ~13k spans, but shipping every full
 * player record and every self-creation row to the browser just to rebuild two immutable ranks is
 * wasteful. This script remains the full-data path; production imports only its compact output.
 */
import { writeFileSync } from 'node:fs';
import { players } from '../src/data/players';
import type { PlayerSpan, Position } from '../src/data/schema';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { selfCreationPercentileForPortability } from '../src/engine/selfCreationSimilarity';

type RuntimePercentileEntry = [selfCreation: number, defensiveTalent: number];

const defenseSortedByPosition = new Map<Position, number[]>();
for (const span of players) {
  const values = defenseSortedByPosition.get(span.primaryPosition) ?? [];
  values.push(computeDefensiveTalent(span));
  defenseSortedByPosition.set(span.primaryPosition, values);
}
for (const values of defenseSortedByPosition.values()) values.sort((a, b) => a - b);

function defensePercentile(span: PlayerSpan): number {
  const sorted = defenseSortedByPosition.get(span.primaryPosition);
  if (!sorted || sorted.length === 0) return 0.5;
  const value = computeDefensiveTalent(span);
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

const percentiles: Record<string, RuntimePercentileEntry> = {};
const offensivePortabilityRanges: Partial<Record<Position, [min: number, max: number]>> = {};
for (const span of players) {
  percentiles[span.id] = [selfCreationPercentileForPortability(span), defensePercentile(span)];
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
