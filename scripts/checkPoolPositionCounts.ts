import { draftPool } from '../src/data/draftPool';

const byPrimarySpans: Record<string, number> = {};
for (const p of draftPool) byPrimarySpans[p.primaryPosition] = (byPrimarySpans[p.primaryPosition] ?? 0) + 1;
console.log('Primary position counts in draftPool (spans, not distinct players):', byPrimarySpans);

const seen = new Set<string>();
const distinctByPos: Record<string, number> = {};
for (const p of draftPool) {
  if (seen.has(p.playerName)) continue;
  seen.add(p.playerName);
  distinctByPos[p.primaryPosition] = (distinctByPos[p.primaryPosition] ?? 0) + 1;
}
console.log('Distinct players by primary position (first span seen):', distinctByPos);
console.log('Total distinct players (approx):', seen.size);
