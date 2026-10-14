import type { PlayerSpan } from '../data/schema';
import type { Grade } from '../engine/grades';
import { hadThreePointLine } from './eraNotes';

/**
 * 2026-10-14, the user ("żeby była podpowiedź co znaczy dana literka"): a letter alone doesn't say
 * what it grades or how good it is. Every grade badge carries a tip: what the grade measures and
 * what its letter means on the F–S scale. Spacing before the 3-point line (1979-80) shows "—" with
 * its own tip instead of an F the player couldn't have avoided.
 */
export type GradeKey = 'OFF' | 'DEF' | '3PT' | 'DUR' | 'FIN' | 'POR';

const MEASURES: Record<GradeKey, string> = {
  OFF: 'Offense: scoring, efficiency and playmaking',
  DEF: 'Defense: stopping his man and protecting the team',
  '3PT': 'Spacing: how far out his shooting pulls defenders',
  DUR: 'Durability: how many games he played',
  FIN: 'Finishing: scoring at the rim',
  POR: 'Portability: how well his game fits next to other stars',
};

function letterMeaning(grade: Grade): string {
  switch (grade[0]) {
    case 'S':
      return 'among the very best in the pool';
    case 'A':
      return 'elite';
    case 'B':
      return 'good';
    case 'C':
      return 'about average';
    case 'D':
      return 'below average';
    default:
      return 'a weakness';
  }
}

export function gradeTip(key: GradeKey, grade: Grade): string {
  return `${MEASURES[key]}. ${grade} — ${letterMeaning(grade)}. Scale: S (best) → F.`;
}

export const NO_THREE_LINE_TIP = 'No 3-point line in his era (before 1979-80), so spacing is not graded.';

/** Spacing isn't graded for years before the 3-point line. */
export function spacingUngraded(span: Pick<PlayerSpan, 'spanLabel'>): boolean {
  return !hadThreePointLine(span);
}
