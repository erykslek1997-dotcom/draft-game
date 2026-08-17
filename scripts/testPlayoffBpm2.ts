import { draftPool } from '../src/data/draftPool';
import { playoffBpm2CoverageRows, playoffBpm2ForSpan } from '../src/engine/playoffBpm2Lookup';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const rows = playoffBpm2CoverageRows();
assert(rows.length > 0, 'playoff BPM source contains production-pool rows');
assert(rows.every((row) => row.games >= 5), 'every playoff BPM row clears the 5-game floor');
assert(rows.every((row) => row.minutes >= 100), 'every playoff BPM row clears the 100-minute floor');
assert(rows.every((row) => [row.bpm, row.obpm, row.dbpm, row.bpmDeltaVsRs].every(Number.isFinite)), 'every playoff BPM row has finite metrics');

for (const name of ['Klay Thompson', 'Pau Gasol', 'Marc Gasol', 'Brook Lopez']) {
  const spans = draftPool.filter((span) => span.playerName === name);
  assert(spans.length > 0, `${name} exists in the draft pool`);
  assert(spans.some((span) => playoffBpm2ForSpan(span) !== null), `${name} has playoff BPM span coverage`);
}

const sample = draftPool.map(playoffBpm2ForSpan).find((value) => value !== null);
assert(!!sample && sample.reliability > 0 && sample.reliability <= 1, 'span reliability is bounded to (0, 1]');
console.log('Playoff BPM2 tests complete.');
