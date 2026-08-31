import type { PlayerSpan, Position } from '../data/schema';
import percentileData from '../data/runtimePercentiles.json';

type RuntimePercentileEntry = [selfCreation: number, defensiveTalent: number, impliedTalDefense?: number];
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

/**
 * Full-population, position-relative percentile of `normalizedDefenseForFit` — i.e. where TAL's
 * OWN internal defense read places this span among its position. Paired with
 * `runtimeDefenseTalentPercentile` above by the D-TAL->TAL bridge (`talent.ts`), which corrects
 * TAL by the gap between the two ranks. Falls back to 0.5 for a span missing from the artifact
 * (same neutral default as the other two readers) — a stale artifact then simply means "no bridge
 * correction," never a crash. Regenerate with `npm run build:runtime-percentiles`.
 */
export function runtimeImpliedDefensePercentile(span: PlayerSpan): number {
  return entryFor(span)?.[2] ?? 0.5;
}

export function runtimeOffensivePortabilityRange(position: Position): { min: number; max: number } | null {
  const range = data.offensivePortabilityRanges[position];
  return range ? { min: range[0], max: range[1] } : null;
}
