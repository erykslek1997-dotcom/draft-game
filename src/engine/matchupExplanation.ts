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
  // Each reason is tagged with which side it favours, so a lopsided matchup leads with the reason
  // that actually explains the result instead of reciting a structural weakness that a 90%
  // favourite is comfortably overcoming anyway (2026-09-09: a 93%-favourite matchup was opening
  // with "the opponent can load the paint against your weaker spacing").
  const edges: { edge: 'own' | 'opp'; text: string }[] = [];
  const diff = (a: number, b: number) => a - b;
  const spacingGap = diff(own.components.spacingCompatibility, opponent.components.spacingCompatibility);
  const defenseGap = diff(own.components.defensiveRoleCoverage, opponent.components.defensiveRoleCoverage);
  const creationGap = diff(own.components.creationStructure, opponent.components.creationStructure);
  const sizeGap = diff(own.components.sizeCoverage, opponent.components.sizeCoverage);
  if (spacingGap >= 10) edges.push({ edge: 'own', text: 'your spacing advantage makes corner help difficult' });
  else if (spacingGap <= -10) edges.push({ edge: 'opp', text: 'they can load the paint against your weaker spacing' });
  if (defenseGap >= 10) edges.push({ edge: 'own', text: 'you have more answers at the point of attack and on the wings' });
  else if (defenseGap <= -10) edges.push({ edge: 'opp', text: 'their creation can attack your weaker perimeter matchups' });
  if (creationGap >= 10) edges.push({ edge: 'own', text: 'your creation has more margin late in the shot clock' });
  else if (creationGap <= -10) edges.push({ edge: 'opp', text: 'you may be forced to play without a primary creator' });
  if (sizeGap <= -12) edges.push({ edge: 'opp', text: 'their size advantage increases pressure on the glass and at the rim' });
  else if (sizeGap >= 12) edges.push({ edge: 'own', text: 'your functional-size advantage limits their offense at the rim' });
  if (own.inputs.defensiveWeakLinkIsHuntable && own.inputs.defensiveWeakLinkResistance < opponent.inputs.huntingPotential) {
    edges.push({ edge: 'opp', text: `${own.inputs.defensiveWeakLinkPlayer ?? 'your weakest defender'} can be targeted` });
  }

  // For a clear result, only the notes that point the SAME way as the result actually explain it —
  // a 93% favourite's own spacing hole isn't why they're winning. For a coin flip, show whatever
  // structural conflict exists on either side.
  const decisive = seriesWinProb >= 0.6 || seriesWinProb <= 0.4;
  const favouredEdge = seriesWinProb >= 0.5 ? 'own' : 'opp';
  const aligned = edges.filter((r) => r.edge === favouredEdge);
  const shown = decisive ? aligned : [...edges].sort((a) => (a.edge === favouredEdge ? -1 : 1));
  const reasons = shown.map((r) => r.text);
  if (reasons.length === 0) {
    reasons.push(
      decisive
        ? 'the result is driven mostly by the talent and depth gap, not a scheme conflict'
        : 'neither side has a decisive structural edge — expect a close series',
    );
  }
  const confidence = seriesWinProb >= 0.6 ? 'Favorable matchup.' : seriesWinProb <= 0.4 ? 'Difficult matchup.' : 'Even matchup.';
  return [`${confidence} ${reasons.slice(0, 2).join('; ')}.`];
}
