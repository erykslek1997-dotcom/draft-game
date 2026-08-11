/** Generates a reproducible, machine-readable audit of the exact production draft pool. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { draftPool } from '../src/data/draftPool';
import { provenanceForSpan } from '../src/data/provenance';
import { availabilityForSpan } from '../src/engine/availabilityLookup';
import { athleticismScoreForSpan } from '../src/engine/athleticismLookup';
import { playmakingScoreForPlayer } from '../src/engine/playmakingLookup';
import {
  bpm2CoverageForSpan,
  ddpmCoverageForSpan,
  matchupCoverageForSpan,
  raptorCoverageForSpan,
} from '../src/engine/blendedDefenseLookup';
import { blendedRealValueForSpan } from '../src/engine/blendedRealValueLookup';
import { selfCreationIsMeasured } from '../src/engine/selfCreationSimilarity';
import { buildZoneYearMap, zoneTotalsForSpan } from '../src/engine/zoneEfficiencyLookup';
import { spanEndYears } from '../src/engine/era';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dirname, '../reports');
const REPORT_FILE = path.join(REPORT_DIR, 'data-provenance.json');
const zoneMap = buildZoneYearMap();

type CountMap = Record<string, number>;
const increment = (map: CountMap, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};

const sourceCounts: CountMap = {};
const boxStatusCounts: CountMap = {};
const coverageCounts: CountMap = {
  availability: 0,
  athleticism: 0,
  playmaking: 0,
  darko: 0,
  raptor: 0,
  matchupDefense: 0,
  bpm2: 0,
  selfCreationMeasured: 0,
  zoneEfficiency: 0,
  blendedRealValue: 0,
  blendedRealValueMeasured: 0,
  blendedRealValueBpm2Fallback: 0,
};
const byDecade: Record<string, { spans: number; measuredBox: number; estimatedOrManualBox: number }> = {};
const exceptions: Array<{
  id: string;
  player: string;
  span: string;
  sourceKind: string;
  estimatedFields: string[];
  unavailableFields: string[];
}> = [];

for (const span of draftPool) {
  const provenance = provenanceForSpan(span);
  increment(sourceCounts, provenance.sourceKind);
  increment(boxStatusCounts, provenance.boxStatus);

  if (availabilityForSpan(span)) coverageCounts.availability++;
  if (athleticismScoreForSpan(span) != null) coverageCounts.athleticism++;
  if (playmakingScoreForPlayer(span) != null) coverageCounts.playmaking++;
  if (ddpmCoverageForSpan(span)) coverageCounts.darko++;
  if (raptorCoverageForSpan(span)) coverageCounts.raptor++;
  if (matchupCoverageForSpan(span)) coverageCounts.matchupDefense++;
  if (bpm2CoverageForSpan(span)) coverageCounts.bpm2++;
  if (selfCreationIsMeasured(span)) coverageCounts.selfCreationMeasured++;
  if (zoneTotalsForSpan(span, zoneMap)) coverageCounts.zoneEfficiency++;
  const realValue = blendedRealValueForSpan(span);
  if (realValue) {
    coverageCounts.blendedRealValue++;
    if (realValue.source === 'measured-blend') coverageCounts.blendedRealValueMeasured++;
    else coverageCounts.blendedRealValueBpm2Fallback++;
  }

  const firstYear = spanEndYears(span.spanLabel)[0] ?? 0;
  const decade = `${Math.floor((firstYear - 1) / 10) * 10}s`;
  const era = byDecade[decade] ?? { spans: 0, measuredBox: 0, estimatedOrManualBox: 0 };
  era.spans++;
  if (provenance.boxStatus === 'measured') era.measuredBox++;
  else era.estimatedOrManualBox++;
  byDecade[decade] = era;

  if (provenance.estimatedFields.length > 0 || provenance.unavailableFields.length > 0) {
    exceptions.push({
      id: span.id,
      player: span.playerName,
      span: span.spanLabel,
      sourceKind: provenance.sourceKind,
      estimatedFields: provenance.estimatedFields,
      unavailableFields: provenance.unavailableFields,
    });
  }
}

const uniquePlayers = new Set(draftPool.map((span) => span.playerName)).size;
const coverage = Object.fromEntries(
  Object.entries(coverageCounts).map(([metric, count]) => [
    metric,
    { count, percent: Math.round((count / draftPool.length) * 1000) / 10 },
  ]),
);
const report = {
  scope: { spans: draftPool.length, uniquePlayers },
  sourceCounts,
  boxStatusCounts,
  coverage,
  byDecade,
  exceptions,
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, exceptions: `${exceptions.length} rows; see report file` }, null, 2));
console.log(`Wrote ${REPORT_FILE}`);
