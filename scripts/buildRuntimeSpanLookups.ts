/** Precomputes immutable per-span zone totals and draft-pool availability for the browser. */
import { writeFileSync } from 'node:fs';
import { players } from '../src/data/players';
import { draftPoolBeforeAvailability } from '../src/data/draftPool';
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

// 2026-10-28: measured on the pool BEFORE the availability filter. Built from the filtered pool,
// every rebuild dropped the entries of the spans the last build had filtered out, and the next
// load let them back in (Embiid 2023-25, 58 of 164 games, came back this way).
const availabilityById: Record<string, AvailabilityTuple> = {};
for (const span of draftPoolBeforeAvailability) {
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
