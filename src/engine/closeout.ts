import type { PlayerSpan } from '../data/schema';
import { computeOffensiveTalent } from './talent';

/**
 * 2026-10-30, the user ("gramy na obecne zasady — w play-offach non-shooterzy są ściągani z boiska
 * albo odpuszczani na obwodzie"; Bruce Bowen's 40% on 2.7 threes a game; "ma działać na McMillana"):
 * a man who takes few real threes (not era-scaled) and is too weak on offense to punish a closeout
 * gets sagged off, whatever his percentage — his floor-spacing credit shrinks. Both have to hold:
 * Klay or Ray Allen shoot too often, Kidd attacks the space (O-TAL 66). Bowen 71 → 54, McMillan
 * 1994-96 41 → 25. Real 2015-26 playoff teams back the direction (three-point rate predicts series
 * wins beyond SRS, r +0.12, 192 teams; none before 2015); the regular season does not, but the game
 * plays by today's rules and its ranking is where many players stop.
 */
const VOLUME = { full: 1, none: 4 };
const OFFENSE = { full: 40, none: 65 };
const MAX_SAG = 0.6;
const cache = new WeakMap<PlayerSpan, number>();
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The share of his spacing a defense still respects, 0.4-1. */
export function closeoutFactor(span: PlayerSpan): number {
  const hit = cache.get(span);
  if (hit !== undefined) return hit;
  const lowVolume = clamp01((VOLUME.none - span.box.threePA) / (VOLUME.none - VOLUME.full));
  const weakOffense = clamp01((OFFENSE.none - computeOffensiveTalent(span)) / (OFFENSE.none - OFFENSE.full));
  const factor = CLOSEOUT_RULES.on ? 1 - MAX_SAG * lowVolume * weakOffense : 1;
  cache.set(span, factor);
  return factor;
}
/** Mutable only so the measurements can switch it off. */
export const CLOSEOUT_RULES = { on: true };
