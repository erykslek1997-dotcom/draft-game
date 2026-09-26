import type { Team } from './types';
import { fitScore, type FitScoreResult } from './fit';
import { offenseScoreBreakdown, teamDefensiveTalentScore } from './scoring';

export type TeamMetricValues = Record<string, number>;

/** Every metric the panel shows, for one team — also run for the whole field (medians, ranks). */
export function teamMetricValues(team: Team, fit: FitScoreResult = fitScore(team)): TeamMetricValues {
  const offense = offenseScoreBreakdown(team);
  const c = fit.components;
  return {
    otal: offense.otal,
    creation: c.creationStructure,
    spacing: offense.spacing,
    rim: offense.rimPressure,
    playmaking: offense.playmaking,
    selfCreation: offense.selfCreation,
    mismatch: offense.mismatchStructure,
    hunting: fit.inputs.huntingPotential,
    dtal: teamDefensiveTalentScore(team),
    roleCoverage: c.defensiveRoleCoverage,
    switchability: c.switchability,
    huntResistance: c.huntResistance,
    rebounding: c.reboundingBalance,
    size: c.sizeCoverage,
    cohesion: c.defensiveCohesion,
    titleStructure: c.championshipStructure,
  };
}
