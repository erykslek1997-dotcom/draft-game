import type { PlayerSpan } from '../data/schema';
import { effectiveTalent } from './grades';
import { teamSpacingValue } from './midrangeGravity';
import { computeDefensiveTalent } from './defensiveTalent';

/**
 * 2026-10-01, the user's own rule after grading the 73 sub-65-TAL starters of 100 AI drafts one by
 * one ("nowoczesne zespoły wymagają od role playerów również spacingu"): a starter below
 * `STARTER_STANDARD_TAL` belongs in a five only as a role player who both spaces the floor and
 * defends — Danny Green, Ingles 2017-19, Mullin, Bridges, Posey, O'Neale. A shooter who can't
 * defend (Dudley, Mike Miller, Brent Barry), a defender who can't shoot (Outlaw, Horry,
 * Christie, Mark Jackson, McMillan) and anyone under TAL 50 is a hole in the lineup, era
 * regardless. Real minutes and team strength were tested as extra criteria and dropped: they
 * did not separate the user's verdicts. Fits the user's 29 verdicts with one miss (Ingles
 * 2019-21: spacing 91, D-TAL 40).
 */
export const STARTER_STANDARD_TAL = 65;
const ROLE_STARTER_MIN_TAL = 50;
const ROLE_STARTER_MIN_SPACING = 55;
const ROLE_STARTER_MIN_DEFENSE = 56;

export function isJustifiedRoleStarter(span: PlayerSpan): boolean {
  return (
    effectiveTalent(span) >= ROLE_STARTER_MIN_TAL &&
    teamSpacingValue(span) >= ROLE_STARTER_MIN_SPACING &&
    computeDefensiveTalent(span) >= ROLE_STARTER_MIN_DEFENSE
  );
}

/** A starter the five can carry: TAL at the standard, or a justified role starter below it. */
export function meetsStarterStandard(span: PlayerSpan): boolean {
  return effectiveTalent(span) >= STARTER_STANDARD_TAL || isJustifiedRoleStarter(span);
}
