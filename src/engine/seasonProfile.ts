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

/**
 * Descriptive RS/PO split. It does not affect Overall, matchup odds or AI drafting.
 * RS rewards repeatable depth and rotation stability; PO shifts weight toward half-court
 * creation, defensive coverage, FIT and the empirically calibrated playoff-success prior.
 */
export function seasonProfile(breakdown: ScoreBreakdown, fit: FitScoreResult): SeasonProfileResult {
  const regularSeason = Math.round(clamp(
    breakdown.talentScore * 0.20
    + breakdown.offenseScore * 0.18
    + breakdown.defenseScore * 0.16
    + breakdown.spacingScore * 0.10
    + breakdown.benchDepthScore * 0.17
    + breakdown.rotationScore * 0.14
    + breakdown.fitScore * 0.05,
  ));

  const weakLinkPenalty = fit.inputs.defensiveWeakLinkIsHuntable
    ? Math.min(8, Math.max(2, (50 - fit.inputs.defensiveWeakLinkResistance) * 0.25))
    : 0;
  const playoffs = Math.round(clamp(
    breakdown.talentScore * 0.18
    + breakdown.offenseScore * 0.15
    + breakdown.defenseScore * 0.20
    + breakdown.fitScore * 0.15
    + fit.components.championshipStructure * 0.12
    + fit.components.creationStructure * 0.08
    + fit.components.spacingCompatibility * 0.07
    + fit.inputs.switchability * 0.05
    - weakLinkPenalty,
  ));

  const delta = playoffs - regularSeason;
  const label: SeasonProfileLabel = regularSeason < 60 && playoffs < 60
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
