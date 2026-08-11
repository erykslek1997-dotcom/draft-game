import type { PlayerSpan } from '../data/schema';
import dataJson from '../data/runtimeSpanLookups.json';
import type { AvailabilityEntry } from './availabilityLookup';
import type { ZoneTotals } from './zoneEfficiencyLookup';

type ZoneTuple = [number, number, number, number, number, number];
type AvailabilityTuple = [availability: number, games: number, possibleGames: number, exact: 0 | 1];
interface RuntimeSpanLookupData {
  zoneById: Record<string, ZoneTuple>;
  availabilityById: Record<string, AvailabilityTuple>;
}
const data = dataJson as unknown as RuntimeSpanLookupData;

export function runtimeZoneTotalsForSpan(span: PlayerSpan): ZoneTotals | null {
  const row = data.zoneById[span.id];
  if (!row) return null;
  return {
    rimFgm: row[0],
    rimFga: row[1],
    midFgm: row[2],
    midFga: row[3],
    threeFgm: row[4],
    threeFga: row[5],
  };
}

export function runtimeAvailabilityForSpan(span: PlayerSpan): AvailabilityEntry | null {
  const row = data.availabilityById[span.id];
  if (!row) return null;
  return { availability: row[0], games: row[1], possibleGames: row[2], exact: row[3] === 1 };
}
