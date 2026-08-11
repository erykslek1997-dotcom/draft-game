/**
 * Validates the user's total BPM2 field against independent season-level total-impact sources
 * before BPM2 is allowed to participate in the production real-value blend.
 */
import bpm2Data from '../src/data/awards/bpm2.json';
import historicalApmData from '../src/data/awards/historicalApm.json';
import pipmData from '../src/data/awards/pipm.json';
import { normalizePlayerName } from '../src/data/schema';

interface Bpm2Row {
  name: string;
  season: string;
  bpm: number;
  confidence: string;
  dataStatus: string;
}

interface ImpactRow {
  name: string;
  season: string;
  value: number;
}

function key(name: string, season: string): string {
  return `${normalizePlayerName(name)}|${season}`;
}

function pearson(points: Array<[number, number]>): number {
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / n;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of points) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  return covariance / Math.sqrt(varianceX * varianceY);
}

function validate(label: string, reference: ImpactRow[], predicate: (row: Bpm2Row) => boolean): void {
  const referenceByKey = new Map(reference.map((row) => [key(row.name, row.season), row.value]));
  const points = (bpm2Data as Bpm2Row[])
    .filter(predicate)
    .map((row) => [row.bpm, referenceByKey.get(key(row.name, row.season))] as const)
    .filter((point): point is [number, number] => point[1] !== undefined);
  console.log(`${label.padEnd(34)} n=${String(points.length).padStart(5)} Pearson=${pearson(points).toFixed(3)}`);
}

const historicalApm = (historicalApmData as Array<{ name: string; season: string; apm: number }>).map((row) => ({
  name: row.name,
  season: row.season,
  value: row.apm,
}));
const pipm = (pipmData as Array<{ name: string; season: string; pipm: number }>).map((row) => ({
  name: row.name,
  season: row.season,
  value: row.pipm,
}));

console.log('BPM2 total vs independent total-impact sources (same player-season):');
validate('all vs historical APM', historicalApm, () => true);
validate('all vs PIPM', pipm, () => true);
validate('observed high-confidence vs APM', historicalApm, (row) => row.confidence === 'high');
validate('observed high-confidence vs PIPM', pipm, (row) => row.confidence === 'high');
validate('pre-1997 vs historical APM', historicalApm, (row) => parseInt(row.season.slice(0, 4), 10) < 1996);
validate('pre-1997 vs PIPM', pipm, (row) => parseInt(row.season.slice(0, 4), 10) < 1996);

const byStatus = new Map<string, number>();
for (const row of bpm2Data as Bpm2Row[]) {
  byStatus.set(row.dataStatus, (byStatus.get(row.dataStatus) ?? 0) + 1);
}
console.log('\nBPM2 source status after the 500-minute filter:');
for (const [status, count] of [...byStatus].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status.padEnd(38)} ${count}`);
}
