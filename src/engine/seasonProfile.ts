import type { FitScoreResult } from './fit';
import type { ScoreBreakdown } from './scoring';

export type SeasonProfileLabel = 'Playoff riser' | 'Regular-season machine' | 'Balanced contender' | 'Fragile in both phases';

export interface SeasonProfileResult {
  regularSeason: number;
  playoffs: number;
  label: SeasonProfileLabel;
  rawRegularSeason?: number;
  rawPlayoffs?: number;
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

/**
 * 2026-11-25 (the user's draft 3971144868: RS 97 / PO 69, 'Regular-season machine' for a LeBron team):
 * the anchors were set on real team-seasons, but drafted all-time teams sit near the RS ceiling (deep
 * benches, Rotation 100), so RS read 93 on average against PO 80 and a quarter of AI teams got the
 * machine label. Anchors now from the raw scores of 48 AI-drafted teams (scripts/_sprof2.ts), so a
 * typical drafted team reads 75 on both. Against real playoff teams 1997+ (scripts/_sprof.ts) the
 * PO-RS gap carries a small real signal beyond SRS (r 0.16 with series wins over SRS).
 */
const REGULAR_SEASON_ANCHORS: SeasonProfileAnchors = { p10: 80.2, median: 83.4, p90: 85.2, elite: 87 };
const PLAYOFF_ANCHORS: SeasonProfileAnchors = { p10: 70.1, median: 79.5, p90: 81.9, elite: 84.5 };
const LABEL_GAP = 12;

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
  const delta = playoffs - regularSeason;
  const label: SeasonProfileLabel = regularSeason < 50 && playoffs < 50
    ? 'Fragile in both phases'
    : delta >= LABEL_GAP
      ? 'Playoff riser'
      : delta <= -LABEL_GAP
        ? 'Regular-season machine'
        : 'Balanced contender';
  const explanation = label === 'Playoff riser'
    ? 'Built for the playoffs: half-court scoring and defense matter more once rotations shorten.'
    : label === 'Regular-season machine'
      ? 'Depth wins regular-season games, but the playoff closing lineup is less convincing.'
      : label === 'Fragile in both phases'
        ? 'Neither the depth for the regular season nor a clear playoff identity.'
        : 'Keeps most of its value when the playoff rotation shortens.';
  return { regularSeason, playoffs, label, explanation, rawRegularSeason, rawPlayoffs };
}
