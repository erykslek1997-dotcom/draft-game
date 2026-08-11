import type { PlayerSpan, Position } from '../data/schema';
import percentileData from '../data/runtimePercentiles.json';

type RuntimePercentileEntry = [selfCreation: number, defensiveTalent: number];
interface RuntimePercentileData {
  percentiles: Record<string, RuntimePercentileEntry>;
  offensivePortabilityRanges: Record<Position, [min: number, max: number]>;
}
const data = percentileData as unknown as RuntimePercentileData;

function entryFor(span: PlayerSpan): RuntimePercentileEntry | undefined {
  return data.percentiles[span.id];
}

/** Full-population self-creation percentile precomputed by buildRuntimePercentiles.ts. */
export function runtimeSelfCreationPercentile(span: PlayerSpan): number {
  return entryFor(span)?.[0] ?? 0.5;
}

/** Full-population, position-relative D-TAL percentile from the same generated artifact. */
export function runtimeDefenseTalentPercentile(span: PlayerSpan): number {
  return entryFor(span)?.[1] ?? 0.5;
}

export function runtimeOffensivePortabilityRange(position: Position): { min: number; max: number } | null {
  const range = data.offensivePortabilityRanges[position];
  return range ? { min: range[0], max: range[1] } : null;
}
