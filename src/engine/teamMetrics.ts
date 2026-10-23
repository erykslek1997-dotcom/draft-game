import type { Team } from './types';
import { fitScore, type FitScoreResult } from './fit';
import { offenseScoreBreakdown, teamDefensiveTalentScore, calibrateOffenseToDefenseScale } from './scoring';

export type TeamMetricValues = Record<string, number>;

/** Every metric the panel shows, for one team — also run for the whole field (medians, ranks). */
export function teamMetricValues(team: Team, fit: FitScoreResult = fitScore(team)): TeamMetricValues {
  const offense = offenseScoreBreakdown(team);
  const c = fit.components;
  // Same mapping as the Offense details bars, so a team's O-TAL reads the same on every screen.
  const o = (v: number) => Math.round(calibrateOffenseToDefenseScale(v));
  return {
    otal: o(offense.otal),
    creation: o(c.creationStructure),
    spacing: o(offense.spacing),
    rim: o(c.rimPressureTeam),
    playmaking: o(offense.playmaking),
    selfCreation: o(offense.selfCreation),
    mismatch: o(offense.mismatchStructure),
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
