import { playoffTalentTerm } from './playoffImpact';
import type { PlayerSpan } from '../data/schema';

/**
 * The playoff riser/dropper badge. 2026-09-26: the TS%-only `playoffCollapse.json` term, its tier
 * caps and its named riser/dampening exceptions were replaced by `playoffImpact.ts` (playoff BPM
 * split into offense and defense against the expected playoff change); this file keeps only the
 * badge, read from that same number.
 */
export type PlayoffPerformanceTier =
  | 'Platinum Dropper'
  | 'Gold Dropper'
  | 'Silver Dropper'
  | 'Bronze Dropper'
  | 'Bronze Riser'
  | 'Silver Riser'
  | 'Gold Riser'
  | 'Platinum Riser';

/** 2026-09-26: the badge reads the new playoff impact (`playoffImpact.ts`, TAL points: offense +
 * defense + Finals MVP) — the same number TAL now carries. Bands ≤2 / ≤5 / ≤8 / >8 per direction;
 * anything under 0.5 either way is no badge. */
function tierForMagnitude(bonus: number): PlayoffPerformanceTier {
  const dropper: PlayoffPerformanceTier[] = ['Bronze Dropper', 'Silver Dropper', 'Gold Dropper', 'Platinum Dropper'];
  const riser: PlayoffPerformanceTier[] = ['Bronze Riser', 'Silver Riser', 'Gold Riser', 'Platinum Riser'];
  const bands = bonus < 0 ? dropper : riser;
  const mag = Math.abs(bonus);
  if (mag <= 2) return bands[0];
  if (mag <= 5) return bands[1];
  if (mag <= 8) return bands[2];
  return bands[3];
}

export function playoffPerformanceTier(span: PlayerSpan): PlayoffPerformanceTier | null {
  const bonus = playoffTalentTerm(span);
  return Math.abs(bonus) >= 0.5 ? tierForMagnitude(bonus) : null;
}
