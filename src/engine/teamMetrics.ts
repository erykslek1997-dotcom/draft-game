import type { Team } from './types';
import { fitScore, type FitScoreResult } from './fit';
import { offenseScoreBreakdown, teamDefensiveTalentScore, calibrateOffenseToDefenseScale, spacingScore } from './scoring';

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
    // The team Spacing score itself, the number the summary bars show (2026-10-30, the user: the table
    // read 50 where the bars read 63 — the offense part on the defense scale under the same name).
    spacing: Math.round(spacingScore(team)),
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
