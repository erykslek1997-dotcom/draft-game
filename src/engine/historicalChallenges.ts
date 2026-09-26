import { computeOffensiveTalent } from './talent';
import { primaryStarters } from './rotation';
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

const METRIC_LABEL: Record<ChallengeMetric, string> = {
  offense: 'Offense', defense: 'Defense', spacing: 'Spacing', fit: 'FIT', benchDepth: 'Bench depth', rotation: 'Rotation',
  creation: 'Creation', roleCoverage: 'Defensive roles', rebounding: 'Rebounding', size: 'Functional size',
  rimPressure: 'Rim pressure', cohesion: 'Defensive cohesion', primaryCreation: 'Primary creation',
  switchability: 'Switchability', huntingPotential: 'Hunting potential', mismatchStructure: 'Mismatch structure',
  guardContainment: 'Guard containment', playmaking: 'Playmaking', topScorer: 'Top scorer O-TAL',
  playoffs: 'PO profile', regularSeason: 'RS profile',
};

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

const condition = (label: string, met: boolean, value: string): HistoricalChallengeCondition => ({ label, met, value });

function top(values: Record<ChallengeMetric, number>, metric: ChallengeMetric, topPct: number): HistoricalChallengeCondition {
  const threshold = challengeThreshold(metric, topPct);
  return condition(`${METRIC_LABEL[metric]} in the top ${topPct}% (${Math.round(threshold)}+)`, values[metric] >= threshold, `${Math.round(values[metric])}`);
}

function bottom(values: Record<ChallengeMetric, number>, metric: ChallengeMetric, bottomPct: number): HistoricalChallengeCondition {
  const threshold = challengeThreshold(metric, bottomPct, 'max');
  return condition(`${METRIC_LABEL[metric]} in the bottom ${bottomPct}% (${Math.round(threshold)} or less)`, values[metric] <= threshold, `${Math.round(values[metric])}`);
}

export function evaluateHistoricalChallenges(
  team: Team,
  breakdown: ScoreBreakdown,
  fit: FitScoreResult,
  season: SeasonProfileResult,
): HistoricalChallengeResult[] {
  const starters = primaryStarters(team).map((entry) => entry.player);
  const rimProtectors = starters.filter((player) => player.defensiveRole === 'Anchor Big' || player.defensiveRole === 'Mobile Big').length;
  const lowUsageSpecialists = team.roster.filter((player) => player.fga <= 8).length;
  const trueCenters = starters.filter((player) => player.primaryPosition === 'C' && player.defensiveRole === 'Anchor Big').length;
  const v = challengeMetrics(team, breakdown, fit, season);
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
      condition('No O-TAL 90+ player on the roster', v.topScorer < 90, `max ${v.topScorer}`),
      top(v, 'defense', 15),
      top(v, 'roleCoverage', 30),
      top(v, 'playoffs', 50),
    ]),
    build('seven-seconds', 'Seven Seconds or Less', '2005–07 Phoenix Suns', 'Tempo offense badge', [
      top(v, 'spacing', 25),
      top(v, 'playmaking', 35),
      top(v, 'offense', 20),
      top(v, 'regularSeason', 50),
    ]),
    build('twin-towers', 'Twin Towers', '1999 San Antonio Spurs', 'Paint control badge', [
      condition('Two rim protectors in the starting five', rimProtectors >= 2, `${rimProtectors}`),
      top(v, 'defense', 25),
      top(v, 'rebounding', 30),
      top(v, 'size', 40),
    ]),
    build('heliocentric', 'Heliocentric Star + Specialists', '2018 Houston Rockets', 'Role clarity badge', [
      top(v, 'topScorer', 20),
      condition('At least three low-usage specialists (8 FGA or less)', lowUsageSpecialists >= 3, `${lowUsageSpecialists}`),
      top(v, 'spacing', 30),
      top(v, 'playoffs', 50),
    ]),
    build('death-lineup', 'Death Lineup', '2015–18 Golden State Warriors', 'Switch-everything badge', [
      top(v, 'switchability', 15),
      condition('At most one traditional anchor center', trueCenters <= 1, `${trueCenters}`),
      top(v, 'spacing', 40),
      top(v, 'offense', 50),
    ]),
    build('beautiful-game', 'Beautiful Game', '2014 San Antonio Spurs', 'Collective creation badge', [
      top(v, 'creation', 30),
      condition('At least three plus shooters', fit.inputs.plusShooterCount >= 3, `${fit.inputs.plusShooterCount}`),
      condition('At least two off-ball complements', fit.inputs.offBallComplementCount >= 2, `${fit.inputs.offBallComplementCount}`),
      top(v, 'fit', 20),
    ]),
    build('lob-city', 'Lob City', '2012–15 LA Clippers', 'Alley-oop badge', [
      top(v, 'playmaking', 30),
      condition('Two rim-running bigs in the starting five', rimProtectors >= 2, `${rimProtectors}`),
      top(v, 'rimPressure', 50),
      top(v, 'rebounding', 40),
      top(v, 'regularSeason', 50),
    ]),
    build('grit-and-grind', 'Grit and Grind', '2011–13 Memphis Grizzlies', 'Bully-ball badge', [
      top(v, 'defense', 30),
      top(v, 'rebounding', 30),
      top(v, 'guardContainment', 50),
      bottom(v, 'spacing', 25),
    ]),
    build('mismatch-hunters', 'Mismatch Hunters', '2010–14 Miami Heat', 'Isolation badge', [
      top(v, 'huntingPotential', 25),
      top(v, 'mismatchStructure', 40),
      top(v, 'cohesion', 40),
      top(v, 'playoffs', 50),
    ]),
  ].sort((a, b) => Number(b.completed) - Number(a.completed) || b.progress - a.progress);
}
