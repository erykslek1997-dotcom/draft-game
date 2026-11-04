import { computeOffensiveTalent } from './talent';
import type { FitScoreResult } from './fit';
import { offenseScoreBreakdown, type ScoreBreakdown } from './scoring';
import type { SeasonProfileResult } from './seasonProfile';
import type { Team } from './types';
import quantiles from '../data/challengeQuantiles.json';

export interface HistoricalChallengeCondition {
  label: string;
  met: boolean;
  value: string;
}

export interface HistoricalChallengeResult {
  id: string;
  title: string;
  inspiration: string;
  bonus: string;
  completed: boolean;
  progress: number;
  conditions: HistoricalChallengeCondition[];
}

/**
 * 2026-09-26, the user ("może obliczone percentylami będzie lepiej pasować?"): the challenges used
 * fixed numbers ("Switchability minimum 85") that drifted out of reach whenever a score's scale
 * moved — Switchability tops out at 72 and Defensive cohesion at 21 on drafted rosters, so Death
 * Lineup and Mismatch Hunters were impossible, while Lob City's thresholds were met by 78%. Every
 * continuous condition now asks for a PERCENTILE of drafted rosters ("top 10%"), resolved against
 * `challengeQuantiles.json` (12 seeded full AI drafts, rebuilt by
 * `scripts/buildChallengeQuantiles.ts` after any scoring change). Structural conditions (two rim
 * protectors, no 90+ scorer) stay counts.
 */
export type ChallengeMetric =
  | 'offense' | 'defense' | 'spacing' | 'fit' | 'benchDepth' | 'rotation'
  | 'creation' | 'roleCoverage' | 'rebounding' | 'size' | 'rimPressure' | 'cohesion'
  | 'primaryCreation' | 'switchability' | 'huntingPotential' | 'mismatchStructure' | 'guardContainment'
  | 'playmaking' | 'topScorer' | 'playoffs' | 'regularSeason';

export const CHALLENGE_METRICS: readonly ChallengeMetric[] = [
  'offense', 'defense', 'spacing', 'fit', 'benchDepth', 'rotation',
  'creation', 'roleCoverage', 'rebounding', 'size', 'rimPressure', 'cohesion',
  'primaryCreation', 'switchability', 'huntingPotential', 'mismatchStructure', 'guardContainment',
  'playmaking', 'topScorer', 'playoffs', 'regularSeason',
];

export function challengeMetrics(
  team: Team,
  breakdown: ScoreBreakdown,
  fit: FitScoreResult,
  season: SeasonProfileResult,
): Record<ChallengeMetric, number> {
  return {
    offense: breakdown.offenseScore,
    defense: breakdown.defenseScore,
    spacing: breakdown.spacingScore,
    fit: breakdown.fitScore,
    benchDepth: breakdown.benchDepthScore,
    rotation: breakdown.rotationScore,
    creation: fit.components.creationStructure,
    roleCoverage: fit.components.defensiveRoleCoverage,
    rebounding: fit.components.reboundingBalance,
    size: fit.components.sizeCoverage,
    rimPressure: fit.components.rimPressureTeam,
    cohesion: fit.components.defensiveCohesion,
    primaryCreation: Math.round(fit.inputs.primaryCreationSignal),
    switchability: fit.inputs.switchability,
    huntingPotential: Math.round(fit.inputs.huntingPotential),
    mismatchStructure: Math.round(fit.inputs.mismatchStructure),
    guardContainment: Math.round(fit.inputs.guardContainment),
    playmaking: Math.round(offenseScoreBreakdown(team).playmaking),
    topScorer: Math.round(Math.max(0, ...team.roster.map(computeOffensiveTalent))),
    playoffs: season.playoffs,
    regularSeason: season.regularSeason,
  };
}

/** `QUANTILES[metric][p]` = the value at percentile p (0-100) of drafted rosters. */
const QUANTILES = quantiles as Partial<Record<ChallengeMetric, number[]>>;

/** The value a roster needs to be in the top `topPct`% (or, `max`, the bottom `topPct`%). */
export function challengeThreshold(metric: ChallengeMetric, topPct: number, side: 'min' | 'max' = 'min'): number {
  const q = QUANTILES[metric];
  if (!q || q.length !== 101) return side === 'min' ? Infinity : -Infinity;
  return q[side === 'min' ? 100 - topPct : topPct];
}
