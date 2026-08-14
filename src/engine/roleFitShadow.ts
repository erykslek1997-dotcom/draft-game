import type {
  DefensiveRole,
  OffensiveArchetype,
  PlayerSpan,
  Position,
  RoleFitConfidence,
  RoleFitScore,
  ShadowRoleProfile,
} from '../data/schema';
import { historicalMovementShooterEvidenceForSpan } from '../data/historicalMovementShooters';
import { historicalRimPressureEvidenceForSpan, type RimPressureRole } from '../data/historicalRimPressureEvidence';
import { runtimeZoneTotalsForSpan } from './runtimeSpanLookups';
import { buildSelfCreationYearMap, measuredSelfCreationForSpan } from './selfCreationLookup';

const OFFENSIVE_ROLES: OffensiveArchetype[] = [
  'Primary Ball Handler',
  'Secondary Ball Handler',
  'Shot Creator',
  'Slasher',
  'Athletic Finisher',
  'Off Screen Shooter',
  'Movement Shooter',
  'Stationary Shooter',
  'Versatile Big',
  'Post Scorer',
  'Stretch Big',
  'Roll & Cut Big',
];

const DEFENSIVE_ROLES: DefensiveRole[] = [
  'Point of Attack',
  'Chaser',
  'Helper',
  'Wing Stopper',
  'Mobile Big',
  'Anchor Big',
  'Low Activity',
];

type FeatureName =
  | 'fga'
  | 'ppg'
  | 'apg'
  | 'rpg'
  | 'spg'
  | 'bpg'
  | 'fgPct'
  | 'threePct'
  | 'threePA'
  | 'tsPct'
  | 'assistRate'
  | 'threeRate';

type FeatureVector = Record<FeatureName, number>;
type PositionDistributions = Record<FeatureName, number[]>;

export interface RoleFitContext {
  byPosition: Record<Position, PositionDistributions>;
}

export interface ShadowRoleOptions {
  stocksAvailable?: boolean;
  allowAdditionalRoles?: boolean;
  offenseConfidence?: RoleFitConfidence;
  defenseConfidence?: RoleFitConfidence;
  warnings?: string[];
}

const ADDITIONAL_ROLE_THRESHOLD = 72;
const MAX_ADDITIONAL_ROLES_PER_SIDE = 2;
const measuredUnassistedThreeByYear = buildSelfCreationYearMap('unassisted3Pt');

function rawFeatures(span: PlayerSpan): FeatureVector {
  return {
    fga: span.fga,
    ppg: span.box.ppg,
    apg: span.box.apg,
    rpg: span.box.rpg,
    spg: span.box.spg,
    bpg: span.box.bpg,
    fgPct: span.box.fgPct,
    threePct: span.box.threePct,
    threePA: span.box.threePA,
    tsPct: span.box.tsPct,
    assistRate: span.fga > 0 ? span.box.apg / span.fga : 0,
    threeRate: span.fga > 0 ? span.box.threePA / span.fga : 0,
  };
}

function emptyDistributions(): PositionDistributions {
  return {
    fga: [], ppg: [], apg: [], rpg: [], spg: [], bpg: [], fgPct: [], threePct: [],
    threePA: [], tsPct: [], assistRate: [], threeRate: [],
  };
}

/** Builds only reference distributions. No values are written back to the player database. */
export function buildRoleFitContext(spans: PlayerSpan[]): RoleFitContext {
  const byPosition: Record<Position, PositionDistributions> = {
    PG: emptyDistributions(), SG: emptyDistributions(), SF: emptyDistributions(),
    PF: emptyDistributions(), C: emptyDistributions(),
  };
  for (const span of spans) {
    const features = rawFeatures(span);
    const distributions = byPosition[span.primaryPosition];
    for (const feature of Object.keys(features) as FeatureName[]) distributions[feature].push(features[feature]);
  }
  for (const distributions of Object.values(byPosition)) {
    for (const values of Object.values(distributions)) values.sort((a, b) => a - b);
  }
  return { byPosition };
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 50;
  let below = 0;
  let upper = sorted.length;
  while (below < upper) {
    const mid = (below + upper) >>> 1;
    if (sorted[mid] < value) below = mid + 1;
    else upper = mid;
  }
  let atOrBelow = below;
  upper = sorted.length;
  while (atOrBelow < upper) {
    const mid = (atOrBelow + upper) >>> 1;
    if (sorted[mid] <= value) atOrBelow = mid + 1;
    else upper = mid;
  }
  return ((below + atOrBelow) / 2 / sorted.length) * 100;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function weighted(parts: Array<[number, number]>): number {
  const totalWeight = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return totalWeight > 0 ? parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight : 0;
}

function closeness(value: number, target: number): number {
  return Math.max(0, 100 - Math.abs(value - target) * 2);
}

function positionFactor(position: Position, factors: Partial<Record<Position, number>>): number {
  return factors[position] ?? 0;
}

function roleEvidence(
  span: PlayerSpan,
  role: OffensiveArchetype | DefensiveRole,
  rim: { share: number; pct: number } | null,
  measuredUnassistedThree: number | null = null,
  movementEvidence: string | null = null,
  rimPressureEvidence: string | null = null,
): string[] {
  if (['Primary Ball Handler', 'Secondary Ball Handler', 'Shot Creator'].includes(role)) {
    return [`APG ${span.box.apg.toFixed(1)}`, `FGA ${span.fga.toFixed(1)}`, `PPG ${span.box.ppg.toFixed(1)}`];
  }
  if (['Off Screen Shooter', 'Movement Shooter', 'Stationary Shooter', 'Stretch Big'].includes(role)) {
    const evidence = [`3PA ${span.box.threePA.toFixed(1)}`, `3P% ${(span.box.threePct * 100).toFixed(1)}`, `3PA/FGA ${(span.box.threePA / Math.max(span.fga, 0.1)).toFixed(2)}`];
    if (measuredUnassistedThree !== null) evidence.push(`unassisted 3PM ${(measuredUnassistedThree * 100).toFixed(1)}% (PBP)`);
    if (role === 'Movement Shooter' && movementEvidence) evidence.push(movementEvidence);
    return evidence;
  }
  if (['Slasher', 'Athletic Finisher', 'Roll & Cut Big'].includes(role)) {
    const evidence = [`FG% ${(span.box.fgPct * 100).toFixed(1)}`, `TS% ${(span.box.tsPct * 100).toFixed(1)}`];
    if (rim) evidence.push(`rim share ${(rim.share * 100).toFixed(1)}%`, `rim FG% ${(rim.pct * 100).toFixed(1)}`);
    else if (rimPressureEvidence) evidence.push(rimPressureEvidence);
    return evidence;
  }
  if (['Versatile Big', 'Post Scorer'].includes(role)) {
    return [`APG ${span.box.apg.toFixed(1)}`, `RPG ${span.box.rpg.toFixed(1)}`, `FGA ${span.fga.toFixed(1)}`];
  }
  return [`RPG ${span.box.rpg.toFixed(1)}`, `SPG ${span.box.spg.toFixed(1)}`, `BPG ${span.box.bpg.toFixed(1)}`];
}

function scoreOffense(span: PlayerSpan, context: RoleFitContext, confidence: RoleFitConfidence): RoleFitScore<OffensiveArchetype>[] {
  const raw = rawFeatures(span);
  const distributions = context.byPosition[span.primaryPosition];
  const p = (feature: FeatureName) => percentile(distributions[feature], raw[feature]);
  const rimTotals = runtimeZoneTotalsForSpan(span);
  const classifiedShots = rimTotals ? rimTotals.rimFga + rimTotals.midFga + rimTotals.threeFga : 0;
  const rim = rimTotals && classifiedShots >= 150
    ? { share: rimTotals.rimFga / classifiedShots, pct: rimTotals.rimFgm / Math.max(1, rimTotals.rimFga) }
    : null;
  const measuredUnassistedThree = measuredSelfCreationForSpan(span, measuredUnassistedThreeByYear);
  const historicalMovementEvidence = historicalMovementShooterEvidenceForSpan(span);
  // Shot-location tracking does not exist before 1996-97. Without it, "rim share"/"rim accuracy"
  // have no real signal to fall back to except three-point rate and overall FG%, which are true of
  // most efficient non-shooters from a low-three-rate era regardless of whether they ever attacked
  // the rim (this previously proposed Larry Bird and Kareem Abdul-Jabbar as Slasher/Roll & Cut Big
  // from box shape alone). Slasher, Athletic Finisher and Roll & Cut Big are therefore gated to a
  // score of 0 when zone data is unavailable, unless the specific player+role pair is verified in
  // `historicalRimPressureEvidence.ts` -- a small, explicitly cross-checked registry, not a guess.
  const hasZoneData = rim !== null;
  const rimPressureEvidenceFor = (role: RimPressureRole) => historicalRimPressureEvidenceForSpan(span, role);
  const slasherRimEvidence = rimPressureEvidenceFor('Slasher');
  const athleticFinisherRimEvidence = rimPressureEvidenceFor('Athletic Finisher');
  const rollCutRimEvidence = rimPressureEvidenceFor('Roll & Cut Big');
  const slasherRimNote = slasherRimEvidence ? `historical validation: ${slasherRimEvidence.note}` : null;
  const athleticFinisherRimNote = athleticFinisherRimEvidence ? `historical validation: ${athleticFinisherRimEvidence.note}` : null;
  const rollCutRimNote = rollCutRimEvidence ? `historical validation: ${rollCutRimEvidence.note}` : null;
  const rimShareScore = rim ? clampScore(((rim.share - 0.2) / 0.6) * 100) : 100 - p('threeRate');
  const rimAccuracyScore = rim ? clampScore(((rim.pct - 0.5) / 0.25) * 100) : p('fgPct');
  const lowUsage = 100 - p('fga');
  const lowPlaymaking = 100 - p('apg');
  const lowThreeRate = 100 - p('threeRate');
  const bigFactor = positionFactor(span.primaryPosition, { C: 100, PF: 92, SF: 30, SG: 5, PG: 0 });
  const perimeterFactor = positionFactor(span.primaryPosition, { PG: 100, SG: 100, SF: 95, PF: 75, C: 20 });
  const threeGate = span.box.threePA >= 1.5;
  // Movement shooting is a route/footwork skill, not a synonym for high-volume three-point
  // shooting. The old box-only gate admitted on-ball pull-up creators (Harden, Doncic, Tatum)
  // because it could not see how their shots were created. Until Synergy OffScreen/Handoff data
  // is imported, only an incumbent Movement tag or explicitly validated historical evidence may
  // unlock this fit. The minimums below use real box data to prevent the qualitative evidence
  // from assigning the role to low-volume/non-shooting stretches of the same player's career.
  const movementEvidenceNote = historicalMovementEvidence
    ? `historical validation: ${historicalMovementEvidence.note}`
    : span.offensiveArchetype === 'Movement Shooter'
      ? 'incumbent movement-shooter role'
      : null;
  const movementGate =
    span.primaryPosition !== 'C' &&
    movementEvidenceNote !== null &&
    span.box.threePA >= 2.5 &&
    span.box.threePct >= 0.36 &&
    raw.threeRate >= 0.15 &&
    span.box.apg < 5 &&
    span.offensiveArchetype !== 'Stretch Big';
  const primaryHandlerGate = span.box.apg >= 5 && (span.primaryPosition !== 'C' || span.box.apg >= 6);
  const shotCreatorGate = span.primaryPosition !== 'C';
  const slasherGate = span.primaryPosition !== 'C' && (hasZoneData || slasherRimNote !== null);
  const athleticFinisherGate = hasZoneData || athleticFinisherRimNote !== null;
  const rollCutGate = hasZoneData || rollCutRimNote !== null;
  // Box scores do not record route type. Keep Off Screen conservative: a perimeter shooter must
  // show meaningful shot volume, solid accuracy and a mixed (not almost exclusively spot-up)
  // shot diet. Existing Stationary/Stretch tags are not automatically promoted from the same
  // shooting inputs that produced those incumbent tags in the first place.
  const offScreenGate =
    (span.primaryPosition === 'PG' || span.primaryPosition === 'SG' || span.primaryPosition === 'SF') &&
    span.fga >= 10 &&
    span.fga < 13 &&
    span.box.threePA >= 5 &&
    span.box.threePct >= 0.38 &&
    raw.threeRate >= 0.35 &&
    raw.threeRate <= 0.55 &&
    span.box.apg < 3.5 &&
    measuredUnassistedThree !== null &&
    measuredUnassistedThree <= 0.2 &&
    span.offensiveArchetype !== 'Stationary Shooter' &&
    span.offensiveArchetype !== 'Stretch Big';
  const stationaryGate =
    threeGate &&
    span.fga < 12 &&
    span.box.threePct >= 0.36 &&
    span.box.apg < 3 &&
    span.offensiveArchetype !== 'Stretch Big';
  const fits: Array<[OffensiveArchetype, number]> = [
    ['Primary Ball Handler', primaryHandlerGate ? weighted([[p('apg'), 35], [p('assistRate'), 25], [p('fga'), 15], [p('ppg'), 10], [perimeterFactor, 15]]) : 0],
    ['Secondary Ball Handler', weighted([[p('apg'), 30], [p('assistRate'), 25], [closeness(p('fga'), 55), 20], [p('tsPct'), 10], [perimeterFactor, 15]])],
    ['Shot Creator', shotCreatorGate ? weighted([[p('fga'), 35], [p('ppg'), 30], [p('tsPct'), 15], [p('apg'), 10], [perimeterFactor, 10]]) : 0],
    ['Slasher', slasherGate ? weighted([[rimShareScore, 30], [rimAccuracyScore, 20], [p('ppg'), 20], [p('fga'), 15], [perimeterFactor, 15]]) : 0],
    ['Athletic Finisher', athleticFinisherGate ? weighted([[rimShareScore, 30], [rimAccuracyScore, 25], [p('tsPct'), 20], [lowUsage, 15], [perimeterFactor, 10]]) : 0],
    ['Off Screen Shooter', offScreenGate ? weighted([[p('threePA'), 30], [p('threePct'), 30], [p('threeRate'), 20], [lowUsage, 10], [lowPlaymaking, 10]]) : 0],
    ['Movement Shooter', movementGate ? weighted([[p('threePA'), 35], [p('threePct'), 25], [p('threeRate'), 15], [p('fga'), 15], [lowPlaymaking, 10]]) : 0],
    ['Stationary Shooter', stationaryGate ? weighted([[p('threeRate'), 30], [p('threePct'), 30], [p('threePA'), 15], [lowUsage, 15], [lowPlaymaking, 10]]) : 0],
    ['Versatile Big', weighted([[bigFactor, 25], [p('apg'), 25], [p('assistRate'), 15], [p('tsPct'), 15], [p('rpg'), 10], [p('threePA'), 10]])],
    ['Post Scorer', weighted([[bigFactor, 25], [p('fga'), 25], [p('ppg'), 25], [lowThreeRate, 15], [p('fgPct'), 10]])],
    ['Stretch Big', threeGate ? weighted([[bigFactor, 30], [p('threePA'), 25], [p('threeRate'), 20], [p('threePct'), 15], [p('rpg'), 10]]) : 0],
    ['Roll & Cut Big', rollCutGate ? weighted([[bigFactor, 25], [rimShareScore, 25], [rimAccuracyScore, 20], [p('tsPct'), 15], [lowUsage, 10], [p('rpg'), 5]]) : 0],
  ];
  const rimPressureNoteByRole: Partial<Record<OffensiveArchetype, string | null>> = {
    Slasher: slasherRimNote,
    'Athletic Finisher': athleticFinisherRimNote,
    'Roll & Cut Big': rollCutRimNote,
  };
  return fits
    .map(([role, score]) => ({
      role,
      score: clampScore(score),
      confidence: role === 'Movement Shooter'
        ? (historicalMovementEvidence ? 'medium' : 'low')
        : role === 'Off Screen Shooter'
          ? 'low'
          // A rim role scored without real zone data is always a proxy, even when a verified
          // historical note unlocked it -- flag it as low-confidence rather than reporting it
          // as equal to a zone-verified score.
          : (role === 'Slasher' || role === 'Athletic Finisher' || role === 'Roll & Cut Big') && !hasZoneData
            ? 'low'
            : confidence,
      evidence: roleEvidence(span, role, rim, measuredUnassistedThree, movementEvidenceNote, rimPressureNoteByRole[role] ?? null),
    }))
    .sort((a, b) => b.score - a.score || a.role.localeCompare(b.role));
}

function scoreDefense(
  span: PlayerSpan,
  context: RoleFitContext,
  confidence: RoleFitConfidence,
  stocksAvailable: boolean,
): RoleFitScore<DefensiveRole>[] {
  const raw = rawFeatures(span);
  const distributions = context.byPosition[span.primaryPosition];
  const p = (feature: FeatureName) => percentile(distributions[feature], raw[feature]);
  const guard = positionFactor(span.primaryPosition, { PG: 100, SG: 100, SF: 55, PF: 25, C: 0 });
  const wing = positionFactor(span.primaryPosition, { PG: 65, SG: 100, SF: 100, PF: 85, C: 20 });
  const big = positionFactor(span.primaryPosition, { PG: 0, SG: 10, SF: 45, PF: 95, C: 100 });
  const activity = weighted([[p('spg'), 45], [p('bpg'), 35], [p('rpg'), 20]]);
  const fits: Array<[DefensiveRole, number]> = [
    ['Point of Attack', span.box.spg >= 1 ? weighted([[p('spg'), 50], [p('rpg'), 10], [guard, 40]]) : 0],
    ['Chaser', span.box.spg >= 0.8 ? weighted([[p('spg'), 40], [p('bpg'), 10], [guard, 30], [wing, 20]]) : 0],
    ['Helper', span.box.spg >= 0.7 || span.box.bpg >= 0.5 || span.box.rpg >= 5
      ? weighted([[p('spg'), 30], [p('bpg'), 30], [p('rpg'), 30], [60, 10]])
      : 0],
    ['Wing Stopper', span.box.spg >= 0.9 ? weighted([[p('spg'), 35], [p('bpg'), 20], [p('rpg'), 15], [wing, 30]]) : 0],
    ['Mobile Big', span.box.bpg >= 0.5 || span.box.rpg >= 6 ? weighted([[p('bpg'), 30], [p('spg'), 20], [p('rpg'), 25], [big, 25]]) : 0],
    ['Anchor Big', span.box.bpg >= 0.8 ? weighted([[p('bpg'), 45], [p('rpg'), 30], [big, 25]]) : 0],
    ['Low Activity', 100 - activity],
  ];
  return fits
    .map(([role, score]) => ({ role, score: clampScore(score), confidence: stocksAvailable ? confidence : 'low', evidence: roleEvidence(span, role, null) }))
    .sort((a, b) => b.score - a.score || a.role.localeCompare(b.role));
}

function proposedRoles<Role extends string>(fits: RoleFitScore<Role>[], incumbent: Role, enabled: boolean): RoleFitScore<Role>[] {
  if (!enabled) return [];
  return fits
    .filter((fit) => fit.role !== incumbent && fit.role !== 'Low Activity' && fit.score >= ADDITIONAL_ROLE_THRESHOLD)
    .slice(0, MAX_ADDITIONAL_ROLES_PER_SIDE);
}

export function computeShadowRoleProfile(
  span: PlayerSpan,
  context: RoleFitContext,
  options: ShadowRoleOptions = {},
): ShadowRoleProfile {
  const stocksAvailable = options.stocksAvailable ?? true;
  const allowAdditionalRoles = options.allowAdditionalRoles ?? true;
  const offensiveFits = scoreOffense(span, context, options.offenseConfidence ?? 'medium');
  const defensiveFits = scoreDefense(span, context, options.defenseConfidence ?? 'medium', stocksAvailable);
  return {
    version: 'role-fit-shadow-v1',
    playerId: span.id,
    incumbentOffensiveRole: span.offensiveArchetype,
    incumbentDefensiveRole: span.defensiveRole,
    offensiveFits,
    defensiveFits,
    proposedOffensiveRoles: proposedRoles(offensiveFits, span.offensiveArchetype, allowAdditionalRoles),
    proposedDefensiveRoles: proposedRoles(defensiveFits, span.defensiveRole, allowAdditionalRoles && stocksAvailable),
    warnings: [...(options.warnings ?? []), ...(!stocksAvailable ? ['Defensive additions withheld: STL/BLK unavailable.'] : [])],
  };
}

export const SHADOW_ROLE_TAXONOMY = { offense: OFFENSIVE_ROLES, defense: DEFENSIVE_ROLES } as const;
