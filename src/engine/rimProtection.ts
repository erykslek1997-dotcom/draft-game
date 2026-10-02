import type { PlayerSpan } from '../data/schema';
import { per36 } from './minutesPerGame';
import { computeDefensiveTalent } from './defensiveTalent';
import { getHeightInches } from '../data/heightLookup';

/**
 * 2026-10-02, the user (Dirk Nowitzki read as a rim protector beside Nikola Jokić because his span is
 * tagged 'Mobile Big', and the AI drafted him for it): rim protection is read from the numbers, not
 * the role label — blocks per 36 minutes and D-TAL, with a discount below 6'9". A role label can
 * lower this reading, never raise it. Blocks were first recorded in 1973-74, so earlier spans have
 * no reading (null) and fall back to the role.
 */
const FIRST_BLOCKS_SEASON_START = 1973;
const RIM_PROTECTOR_HEIGHT = 81;
const UNDERSIZED_SHARE = 0.85;

export function rimProtectionByNumbers(span: PlayerSpan): number | null {
  if (Number(span.spanLabel.slice(0, 4)) < FIRST_BLOCKS_SEASON_START) return null;
  const blocks = per36(span.box.bpg, span);
  const blockTerm = Math.max(0, Math.min(1, (blocks - 0.6) / 1.4));
  const raw = 50 + 35 * blockTerm + 0.5 * (computeDefensiveTalent(span) - 60);
  const height = getHeightInches(span.playerName);
  const sized = height !== undefined && height < RIM_PROTECTOR_HEIGHT ? raw * UNDERSIZED_SHARE : raw;
  return Math.max(0, Math.min(100, sized));
}

/** A real rim protector by the numbers (or, without block data, by role). */
export const REAL_RIM_PROTECTOR_SCORE = 70;
export function isRealRimProtector(span: PlayerSpan, roleSaysRim: boolean): boolean {
  const byNumbers = rimProtectionByNumbers(span);
  return byNumbers === null ? roleSaysRim : byNumbers >= REAL_RIM_PROTECTOR_SCORE;
}
