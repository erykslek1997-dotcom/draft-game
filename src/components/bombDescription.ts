import type { PlayerSpan, Position } from '../data/schema';
import { windowYears } from '../engine/dailyDraft';
import { cardRoles } from './cardRoles';

/**
 * 2026-10-16, the Bomb daily (TODO 3.4): the short line that is all you know of the Bomb until the
 * results — his position, his era and his style, from the same style labels the draft cards show
 * (cardRoles.ts). No name, no grade, no numbers: "A center from the 90s. Roll man and rim
 * protector. Rarely shoots."
 */
const POSITION_WORD: Record<Position, string> = {
  PG: 'point guard',
  SG: 'shooting guard',
  SF: 'small forward',
  PF: 'power forward',
  C: 'center',
};

function era(spanLabel: string): string {
  const [first, last] = windowYears(spanLabel);
  // The decade most of his window sits in, by the seasons' end years.
  const decade = Math.floor(((first + last) / 2) / 10) * 10;
  return decade < 2000 ? `the ${String(decade).slice(2)}s` : `the ${decade}s`;
}

function shotLine(span: PlayerSpan): string | null {
  if (span.fga < 8) return 'Rarely shoots.';
  if (span.fga >= 15) return 'Looks for his shot.';
  return null;
}

export function bombDescription(span: PlayerSpan): string {
  const position = POSITION_WORD[span.primaryPosition];
  const article = /^[aeiou]/.test(position) ? 'An' : 'A';
  const roles = cardRoles(span).map((r, i) => (i === 0 ? r : r.toLowerCase()));
  const style = roles.length ? `${roles.join(' and ')}.` : null;
  return [`${article} ${position} from ${era(span.spanLabel)}.`, style, shotLine(span)].filter(Boolean).join(' ');
}
