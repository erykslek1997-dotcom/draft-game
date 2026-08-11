import type { PlayerSpan } from './schema';
import curatedVerifiedBoxData from './curatedVerifiedBox.json';
import curatedPlayerIds from './curatedPlayerIds.json';
import { spanEndYears } from '../engine/era';

export type DataStatus = 'measured' | 'derived' | 'estimated' | 'manual' | 'unavailable';
export type SpanSourceKind = 'curated-verified' | 'curated-manual' | 'curated-expanded' | 'generated';

interface VerifiedRecord {
  id: string;
  sourcePlayerId: string;
  sourceSpanId: string;
  measuredFields: string[];
  derivedFields: string[];
  estimatedFields: string[];
}

export interface SpanProvenance {
  sourceKind: SpanSourceKind;
  sourceLabel: string;
  boxStatus: DataStatus | 'mixed';
  measuredFields: string[];
  derivedFields: string[];
  estimatedFields: string[];
  unavailableFields: string[];
  positionStatus: DataStatus;
  offensiveRoleStatus: DataStatus;
  defensiveRoleStatus: DataStatus;
}

const verifiedById = new Map(
  (curatedVerifiedBoxData as VerifiedRecord[]).map((record) => [record.id, record]),
);
const curatedIds = new Set(curatedPlayerIds as string[]);
const STANDARD_MEASURED_FIELDS = ['fga', 'ppg', 'rpg', 'apg', 'spg', 'bpg', 'fgPct', 'threePct', 'threePA', 'ftPct'];
const STANDARD_DERIVED_FIELDS = ['tsPct'];

function unavailableBoxFields(span: PlayerSpan): string[] {
  const entries: Array<[string, unknown]> = [['fga', span.fga], ...Object.entries(span.box)];
  const unavailable = entries.filter(([, value]) => value == null || !Number.isFinite(value)).map(([field]) => field);
  // NBA box scores did not officially record steals or blocks before 1973-74. Numeric zero in
  // the raw historical export is therefore a missing-value sentinel, not a measured zero.
  if (spanEndYears(span.spanLabel).some((year) => year < 1974)) {
    if (!unavailable.includes('spg')) unavailable.push('spg');
    if (!unavailable.includes('bpg')) unavailable.push('bpg');
  }
  return unavailable;
}

export function provenanceForSpan(span: PlayerSpan): SpanProvenance {
  const verified = verifiedById.get(span.id);
  if (verified) {
    return {
      sourceKind: 'curated-verified',
      sourceLabel: `local player-data (${verified.sourcePlayerId}, ${verified.sourceSpanId})`,
      boxStatus: verified.estimatedFields.length > 0 ? 'mixed' : 'measured',
      measuredFields: verified.measuredFields,
      derivedFields: verified.derivedFields,
      estimatedFields: verified.estimatedFields,
      unavailableFields: [],
      positionStatus: 'manual',
      offensiveRoleStatus: 'manual',
      defensiveRoleStatus: 'manual',
    };
  }

  if (curatedIds.has(span.id)) {
    return {
      sourceKind: 'curated-manual',
      sourceLabel: 'hand-curated anchor; no exact local source window',
      boxStatus: 'manual',
      measuredFields: [],
      derivedFields: [],
      estimatedFields: ['fga', ...Object.keys(span.box)],
      unavailableFields: [],
      positionStatus: 'manual',
      offensiveRoleStatus: 'manual',
      defensiveRoleStatus: 'manual',
    };
  }

  const unavailableFields = unavailableBoxFields(span);
  if (span.id.includes('-cw-')) {
    return {
      sourceKind: 'curated-expanded',
      sourceLabel: 'local player-data exact span; qualitative roles inherited from nearest curated anchor',
      boxStatus: unavailableFields.length > 0 ? 'mixed' : 'measured',
      measuredFields: STANDARD_MEASURED_FIELDS.filter((field) => !unavailableFields.includes(field)),
      derivedFields: STANDARD_DERIVED_FIELDS,
      estimatedFields: [],
      unavailableFields,
      positionStatus: 'derived',
      offensiveRoleStatus: 'manual',
      defensiveRoleStatus: 'manual',
    };
  }

  return {
    sourceKind: 'generated',
    sourceLabel: 'local player-data exact span; roles classified from box shape and position',
    boxStatus: unavailableFields.length > 0 ? 'mixed' : 'measured',
    measuredFields: STANDARD_MEASURED_FIELDS.filter((field) => !unavailableFields.includes(field)),
    derivedFields: STANDARD_DERIVED_FIELDS,
    estimatedFields: [],
    unavailableFields,
    positionStatus: 'derived',
    offensiveRoleStatus: 'derived',
    defensiveRoleStatus: unavailableFields.some((field) => field === 'spg' || field === 'bpg') ? 'unavailable' : 'derived',
  };
}
