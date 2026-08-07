// Moved out of src/engine/darkoCorrection.ts (2026-07-30 load-time fix) so the production file
// doesn't need to `import { players }` (the full ~13,145-span dataset) just to expose this
// calibration-only helper. Only `scripts/calibrateDefensiveTalent.ts` uses it — scripts aren't
// part of the shipped bundle, so importing the full dataset here is free.
import { players } from '../../src/data/players';
import { computeDefensiveImpact } from '../../src/engine/defense';
import { buildFullDarkoYearMap, avgFullDarkoFieldForSpan } from './fullDarkoLookup';

// Uses the FULL (untrimmed) darko.json via fullDarkoLookup.ts, not the production
// darkoLookup.ts (which reads darko.pool.json since the 2026-07-30 trim) — this needs the whole
// historical DARKO population to fit a defensible regression, not just the current draft pool.
const ddpmByNameYear = buildFullDarkoYearMap('ddpm');

export function matchedDarkoDefensePoints(): { defImpact: number; ddpm: number }[] {
  const points: { defImpact: number; ddpm: number }[] = [];
  for (const span of players) {
    const ddpm = avgFullDarkoFieldForSpan(span, ddpmByNameYear);
    if (ddpm === null) continue;
    points.push({ defImpact: computeDefensiveImpact(span), ddpm });
  }
  return points;
}
