import type { FitScoreResult } from './fit';

export interface MatchupExplanationInput {
  own: FitScoreResult;
  opponent: FitScoreResult;
  seriesWinProb: number;
}

/** Converts the pairwise model output into a short, causal explanation. This is descriptive only:
 * it never changes the matchup probability or any FIT component. */
export function explainMatchup({ own, opponent, seriesWinProb }: MatchupExplanationInput): string[] {
  const reasons: string[] = [];
  const diff = (a: number, b: number) => a - b;
  const spacingGap = diff(own.components.spacingCompatibility, opponent.components.spacingCompatibility);
  const defenseGap = diff(own.components.defensiveRoleCoverage, opponent.components.defensiveRoleCoverage);
  const creationGap = diff(own.components.creationStructure, opponent.components.creationStructure);
  const sizeGap = diff(own.components.sizeCoverage, opponent.components.sizeCoverage);
  if (spacingGap >= 10) reasons.push('twoja przewaga spacingu utrudnia przeciwnikowi pomoc z rogu');
  else if (spacingGap <= -10) reasons.push('przeciwnik może zamknąć wjazdy przez słabszy spacing');
  if (defenseGap >= 10) reasons.push('masz więcej odpowiedzi na POA i skrzydła');
  else if (defenseGap <= -10) reasons.push('ich kreacja może atakować twoje słabsze matchupy na obwodzie');
  if (creationGap >= 10) reasons.push('twoja kreacja ma większy zapas na końcówki akcji');
  else if (creationGap <= -10) reasons.push('możesz zostać zmuszony do grania bez głównego kreatora');
  if (sizeGap <= -12) reasons.push('ich przewaga rozmiaru zwiększa presję na zbiórkę i obręcz');
  else if (sizeGap >= 12) reasons.push('twoja przewaga funkcjonalnego rozmiaru ogranicza atak przy obręczy');
  if (own.inputs.defensiveWeakLinkIsHuntable && own.inputs.defensiveWeakLinkResistance < opponent.inputs.primaryCreationSignal) {
    reasons.push(`do polowania nadaje się ${own.inputs.defensiveWeakLinkPlayer ?? 'najsłabszy obrońca'}`);
  }
  if (reasons.length === 0) reasons.push('wynik zależy głównie od różnicy talentu, bez wyraźnego konfliktu schematów');
  const confidence = seriesWinProb >= 0.6 ? 'To korzystny matchup.' : seriesWinProb <= 0.4 ? 'To trudny matchup.' : 'To wyrównany matchup.';
  return [`${confidence} ${reasons.slice(0, 2).join('; ')}.`];
}
