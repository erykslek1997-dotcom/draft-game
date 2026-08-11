/** Precomputes immutable per-span zone totals and draft-pool availability for the browser. */
import { writeFileSync } from 'node:fs';
import { players } from '../src/data/players';
import { draftPool } from '../src/data/draftPool';
import { availabilityForSpan } from '../src/engine/availabilityLookup';
import { buildZoneYearMap, zoneTotalsForSpan } from '../src/engine/zoneEfficiencyLookup';

type ZoneTuple = [number, number, number, number, number, number];
type AvailabilityTuple = [availability: number, games: number, possibleGames: number, exact: 0 | 1];

const zoneMap = buildZoneYearMap();
const zoneById: Record<string, ZoneTuple> = {};
for (const span of players) {
  const totals = zoneTotalsForSpan(span, zoneMap);
  if (!totals) continue;
  zoneById[span.id] = [
    totals.rimFgm,
    totals.rimFga,
    totals.midFgm,
    totals.midFga,
    totals.threeFgm,
    totals.threeFga,
  ];
}

const availabilityById: Record<string, AvailabilityTuple> = {};
for (const span of draftPool) {
  const entry = availabilityForSpan(span);
  if (!entry) continue;
  availabilityById[span.id] = [entry.availability, entry.games, entry.possibleGames, entry.exact ? 1 : 0];
}

const outputPath = 'src/data/runtimeSpanLookups.json';
writeFileSync(outputPath, JSON.stringify({ zoneById, availabilityById }));
console.log(
  `Wrote ${outputPath}: ${Object.keys(zoneById).length} zone spans, ` +
    `${Object.keys(availabilityById).length} availability spans.`,
);
