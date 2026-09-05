import type { FitScoreResult } from './fit';

export interface MatchupExplanationInput {
  own: FitScoreResult;
  opponent: FitScoreResult;
  seriesWinProb: number;
}

/** Converts the pairwise model output into a short, causal explanation. This is descriptive only:
 * it never changes the matchup probability or any FIT component.
 *
 * 2026-09-05: the weak-link check below used to compare against `primaryCreationSignal`
 * (playmaking-only — the best passer's ball-handling score). Switched to `huntingPotential`
 * (playmaking + self-creation, `fit.ts`'s own docstring) per the user's explicit point: a huntable
 * defender only really gets exploited if the opponent can both force the mismatch AND punish it —
 * either by passing out of it or, just as often, by simply shooting over the smaller/weaker
 * defender off the dribble. `primaryCreationSignal` alone missed that second half entirely (a
 * pure self-creating scorer with modest measured playmaking read as no real threat). */
export function explainMatchup({ own, opponent, seriesWinProb }: MatchupExplanationInput): string[] {
  const reasons: string[] = [];
  const diff = (a: number, b: number) => a - b;
  const spacingGap = diff(own.components.spacingCompatibility, opponent.components.spacingCompatibility);
  const defenseGap = diff(own.components.defensiveRoleCoverage, opponent.components.defensiveRoleCoverage);
  const creationGap = diff(own.components.creationStructure, opponent.components.creationStructure);
  const sizeGap = diff(own.components.sizeCoverage, opponent.components.sizeCoverage);
  if (spacingGap >= 10) reasons.push('your spacing advantage makes corner help difficult');
  else if (spacingGap <= -10) reasons.push('the opponent can load the paint against your weaker spacing');
  if (defenseGap >= 10) reasons.push('you have more answers at the point of attack and on the wings');
  else if (defenseGap <= -10) reasons.push('their creation can attack your weaker perimeter matchups');
  if (creationGap >= 10) reasons.push('your creation has more margin late in the shot clock');
  else if (creationGap <= -10) reasons.push('you may be forced to play without a primary creator');
  if (sizeGap <= -12) reasons.push('their size advantage increases pressure on the glass and at the rim');
  else if (sizeGap >= 12) reasons.push('your functional-size advantage limits offense at the rim');
  if (own.inputs.defensiveWeakLinkIsHuntable && own.inputs.defensiveWeakLinkResistance < opponent.inputs.huntingPotential) {
    reasons.push(`${own.inputs.defensiveWeakLinkPlayer ?? 'your weakest defender'} can be targeted`);
  }
  if (reasons.length === 0) reasons.push('the result is driven mostly by the talent gap, without a clear scheme conflict');
  const confidence = seriesWinProb >= 0.6 ? 'Favorable matchup.' : seriesWinProb <= 0.4 ? 'Difficult matchup.' : 'Even matchup.';
  return [`${confidence} ${reasons.slice(0, 2).join('; ')}.`];
}
