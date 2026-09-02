import type { FitScoreResult } from './fit';
import type { ScoreBreakdown } from './scoring';

export type SeasonProfileLabel = 'Playoff riser' | 'Regular-season machine' | 'Balanced contender' | 'Fragile in both phases';

export interface SeasonProfileResult {
  regularSeason: number;
  playoffs: number;
  label: SeasonProfileLabel;
  explanation: string;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export interface SeasonProfileAnchors {
  p10: number;
  median: number;
  p90: number;
  elite: number;
}

/** Maps the narrow empirical team-score distribution onto a readable 0-100 display scale. */
export function calibrateSeasonProfileScore(value: number, anchors: SeasonProfileAnchors): number {
  const interpolate = (x: number, lo: number, hi: number, outLo: number, outHi: number) =>
    outLo + ((x - lo) / Math.max(0.001, hi - lo)) * (outHi - outLo);
  if (value <= anchors.p10) return Math.round(clamp(interpolate(value, 0, anchors.p10, 0, 50)));
  if (value <= anchors.median) return Math.round(interpolate(value, anchors.p10, anchors.median, 50, 75));
  if (value <= anchors.p90) return Math.round(interpolate(value, anchors.median, anchors.p90, 75, 90));
  return Math.round(clamp(interpolate(value, anchors.p90, anchors.elite, 90, 100)));
}

const REGULAR_SEASON_ANCHORS: SeasonProfileAnchors = { p10: 67, median: 75, p90: 81, elite: 87 };
const PLAYOFF_ANCHORS: SeasonProfileAnchors = { p10: 66, median: 76, p90: 82, elite: 86 };

/**
 * Descriptive RS/PO split. It does not affect Overall, matchup odds or AI drafting.
 * RS rewards repeatable depth and rotation stability; PO shifts weight toward half-court
 * creation, defensive coverage, FIT and the empirically calibrated playoff-success prior.
 */
export function seasonProfile(breakdown: ScoreBreakdown, fit: FitScoreResult): SeasonProfileResult {
  const rawRegularSeason = clamp(
    breakdown.talentScore * 0.20
    + breakdown.offenseScore * 0.18
    + breakdown.defenseScore * 0.16
    + breakdown.spacingScore * 0.10
    + breakdown.benchDepthScore * 0.17
    + breakdown.rotationScore * 0.14
    + breakdown.fitScore * 0.05,
  );

  const weakLinkPenalty = fit.inputs.defensiveWeakLinkIsHuntable
    ? Math.min(8, Math.max(2, (50 - fit.inputs.defensiveWeakLinkResistance) * 0.25))
    : 0;
  const rawPlayoffs = clamp(
    breakdown.talentScore * 0.18
    + breakdown.offenseScore * 0.15
    + breakdown.defenseScore * 0.20
    + breakdown.fitScore * 0.15
    + fit.components.championshipStructure * 0.12
    + fit.components.creationStructure * 0.08
    + fit.components.spacingCompatibility * 0.07
    + fit.inputs.switchability * 0.05
    - weakLinkPenalty,
  );

  const regularSeason = calibrateSeasonProfileScore(rawRegularSeason, REGULAR_SEASON_ANCHORS);
  const playoffs = calibrateSeasonProfileScore(rawPlayoffs, PLAYOFF_ANCHORS);
  const delta = rawPlayoffs - rawRegularSeason;
  const label: SeasonProfileLabel = rawRegularSeason < 60 && rawPlayoffs < 60
    ? 'Fragile in both phases'
    : delta >= 6
      ? 'Playoff riser'
      : delta <= -6
        ? 'Regular-season machine'
        : 'Balanced contender';
  const explanation = label === 'Playoff riser'
    ? 'Playoff structure, half-court creation and defensive coverage improve relative value.'
    : label === 'Regular-season machine'
      ? 'Depth and rotation stability carry more of the value than the closing-lineup profile.'
      : label === 'Fragile in both phases'
        ? 'The roster lacks both regular-season stability and a dependable playoff identity.'
        : 'The roster retains most of its regular-season value when rotations shorten.';
  return { regularSeason, playoffs, label, explanation };
}
