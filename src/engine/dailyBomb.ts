import type { PlayerSpan } from '../data/schema';
import { peakDraftPool } from './peakDraftPool';
import { effectiveTalent } from './grades';
import { mixSeed, mulberry32 } from './rng';

/**
 * 2026-10-16, the Bomb daily (TODO 3.4, mockup `docs/mockups/daily-drafts.html` screens 4-5): the
 * hidden player who joins your team in the day's round. The same for everyone that day (the day's
 * seed); the CPU never gets him — he is off the board from the first pick.
 *
 * Usually a role player — a player whose best stretch reads TAL 50-65 and costs at most 14 caps,
 * so the cap he takes stays plannable; about one day in five a gem, a player whose best stretch
 * reads 78-88. Always his best stretch (the peak pool), so the reveal names a player at his best.
 */
/** He plays at least this many minutes (TODO 3.4). */
export const BOMB_MIN_MINUTES = 10;

const ROLE_TAL: [number, number] = [50, 66];
const ROLE_MAX_FGA = 14;
const GEM_TAL: [number, number] = [78, 89];

let roleCandidates: PlayerSpan[] | null = null;
let gemCandidates: PlayerSpan[] | null = null;
function candidates(gem: boolean): PlayerSpan[] {
  if (gem) {
    gemCandidates ??= peakDraftPool.filter((s) => effectiveTalent(s) >= GEM_TAL[0] && effectiveTalent(s) < GEM_TAL[1]);
    return gemCandidates;
  }
  roleCandidates ??= peakDraftPool.filter((s) => effectiveTalent(s) >= ROLE_TAL[0] && effectiveTalent(s) < ROLE_TAL[1] && s.fga <= ROLE_MAX_FGA);
  return roleCandidates;
}

/** The day's Bomb. */
export function dailyBombSpan(seed: number, gem: boolean): PlayerSpan {
  const pool = candidates(gem);
  const rng = mulberry32(mixSeed(seed, 0xb0b));
  return pool[Math.floor(rng() * pool.length)];
}
