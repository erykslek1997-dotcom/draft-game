import { computeOffensiveTalent } from './talent';
import { primaryStarters } from './rotation';
import type { FitScoreResult } from './fit';
import type { ScoreBreakdown } from './scoring';
import type { SeasonProfileResult } from './seasonProfile';
import type { Team } from './types';

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

const condition = (label: string, met: boolean, value: string): HistoricalChallengeCondition => ({ label, met, value });

export function evaluateHistoricalChallenges(
  team: Team,
  breakdown: ScoreBreakdown,
  fit: FitScoreResult,
  season: SeasonProfileResult,
): HistoricalChallengeResult[] {
  const starters = primaryStarters(team).map((entry) => entry.player);
  const rimProtectors = starters.filter((player) => player.defensiveRole === 'Anchor Big' || player.defensiveRole === 'Mobile Big').length;
  const maxOffensiveTalent = Math.max(...team.roster.map(computeOffensiveTalent));
  const gluePlayers = team.roster.filter((player) => player.fga < 2).length;
  const lowUsageSpecialists = team.roster.filter((player) => player.fga <= 8).length;
  const trueCenters = starters.filter((player) => player.primaryPosition === 'C' && player.defensiveRole === 'Anchor Big').length;
  const build = (id: string, title: string, inspiration: string, bonus: string, conditions: HistoricalChallengeCondition[]): HistoricalChallengeResult => ({
    id,
    title,
    inspiration,
    bonus,
    completed: conditions.every((entry) => entry.met),
    progress: Math.round((conditions.filter((entry) => entry.met).length / conditions.length) * 100),
    conditions,
  });

  return [
    build('detroit-2004', 'No-Offense Superstar Defense', '2004 Detroit Pistons', 'Defensive identity badge', [
      condition('No OTAL 90+ offensive player', maxOffensiveTalent < 90, `max ${Math.round(maxOffensiveTalent)}`),
      condition('Defense minimum 85', breakdown.defenseScore >= 85, `${breakdown.defenseScore}`),
      condition('Defensive roles minimum 85', fit.components.defensiveRoleCoverage >= 85, `${fit.components.defensiveRoleCoverage}`),
      condition('PO profile minimum 78', season.playoffs >= 78, `${season.playoffs}`),
    ]),
    build('seven-seconds', 'Seven Seconds or Less', '2005–07 Phoenix Suns', 'Tempo offense badge', [
      condition('Spacing minimum 85', breakdown.spacingScore >= 85, `${breakdown.spacingScore}`),
      condition('Creation minimum 80', fit.components.creationStructure >= 80, `${fit.components.creationStructure}`),
      condition('Offense minimum 85', breakdown.offenseScore >= 85, `${breakdown.offenseScore}`),
      condition('RS profile minimum 80', season.regularSeason >= 80, `${season.regularSeason}`),
    ]),
    build('twin-towers', 'Twin Towers', '1999 San Antonio Spurs', 'Paint control badge', [
      condition('Two rim protectors in the starting five', rimProtectors >= 2, `${rimProtectors}`),
      condition('Defense minimum 82', breakdown.defenseScore >= 82, `${breakdown.defenseScore}`),
      condition('Spacing minimum 65', breakdown.spacingScore >= 65, `${breakdown.spacingScore}`),
      condition('Rebounding minimum 80', fit.components.reboundingBalance >= 80, `${fit.components.reboundingBalance}`),
    ]),
    build('heliocentric', 'Heliocentric Star + Specialists', '2018 Houston Rockets', 'Role clarity badge', [
      condition('Primary creation minimum 85', fit.inputs.primaryCreationSignal >= 85, `${Math.round(fit.inputs.primaryCreationSignal)}`),
      condition('Minimum trzech low-usage specialists', lowUsageSpecialists >= 3, `${lowUsageSpecialists}`),
      condition('Spacing minimum 78', breakdown.spacingScore >= 78, `${breakdown.spacingScore}`),
      condition('PO profile minimum 75', season.playoffs >= 75, `${season.playoffs}`),
    ]),
    build('death-lineup', 'Death Lineup', '2015–18 Golden State Warriors', 'Switch-everything badge', [
      condition('Switchability minimum 85', fit.inputs.switchability >= 85, `${fit.inputs.switchability}`),
      condition('At most one traditional anchor center', trueCenters <= 1, `${trueCenters}`),
      condition('Spacing minimum 82', breakdown.spacingScore >= 82, `${breakdown.spacingScore}`),
      condition('Functional size minimum 65', fit.components.sizeCoverage >= 65, `${fit.components.sizeCoverage}`),
    ]),
    build('beautiful-game', 'Beautiful Game', '2014 San Antonio Spurs', 'Collective creation badge', [
      condition('Creation minimum 82', fit.components.creationStructure >= 82, `${fit.components.creationStructure}`),
      condition('At least three plus shooters', fit.inputs.plusShooterCount >= 3, `${fit.inputs.plusShooterCount}`),
      condition('At least two off-ball complements', fit.inputs.offBallComplementCount >= 2, `${fit.inputs.offBallComplementCount}`),
      // 2026-09-04: `fitScore` rescaled ~7pts lower after it absorbed hunt resistance / defensive
      // cohesion / switchability (the `scoreTeam` refactor) — top rosters now read ~78-81 rather
      // than ~85-88. 75 preserves this as a genuine elite-fit gate on the new scale.
      condition('FIT minimum 75', breakdown.fitScore >= 75, `${breakdown.fitScore}`),
    ]),
    build('fga-glue', 'Shots Glue', 'Low-usage championship role players', 'Cap alchemist badge', [
      condition('At least two players below 2 shots', gluePlayers >= 2, `${gluePlayers}`),
      condition('PO profile minimum 80', season.playoffs >= 80, `${season.playoffs}`),
      condition('Bench depth minimum 70', breakdown.benchDepthScore >= 70, `${breakdown.benchDepthScore}`),
      condition('Rotation minimum 75', breakdown.rotationScore >= 75, `${breakdown.rotationScore}`),
    ]),
  ].sort((a, b) => Number(b.completed) - Number(a.completed) || b.progress - a.progress);
}
