import type { PlayerSpan } from '../data/schema';
import { realSpan } from './realAdvancedLookup';

/**
 * 2026-10-28, step 6.2 (the user: two players who play WITH the ball should not fit — not two
 * scorers). How much of his floor time a player holds the ball, read from his real USG% and AST%
 * and his position: fit on NBA.com tracking (time of possession over minutes, 3,283 player-seasons
 * 2013-14 on with 1000+ minutes, R² 0.83; Westbrook 2017 0.31, Harden 2017-18 0.25-0.28, Magic and
 * Nash ~0.27, LeBron 2011 0.20, Kobe 2007-09 and Jordan ~0.14-0.15, Klay 0.07). Spans without real
 * USG% / AST% (before 1973-74) read AST% from assists a 36 minutes.
 *
 * `scripts/measureBallDominance.ts`, 955 real five-man units 2013-14 on: a second player holding the
 * ball costs the five offense beyond what its players are worth — tracked at 18%+, −2.3 ORtg (90%
 * −4.0…−0.8); on the share estimated here, −1.6 ORtg per 0.10 of the second handler's share past
 * 0.12 (90% −3.6…+0.3). A second high-usage scorer costs nothing (+0.9). `perTen`: ORtg a 100
 * trips per 0.10 of the second handler's share past `from`.
 */
export const BALL_HANDLER_TUNING = { from: 0.12, perTen: 1.6 };

const POSITION_SHIFT: Record<string, number> = { PG: 0.04444, SG: 0.00562, SF: 0, PF: -0.0103, C: -0.0103 };
const shareCache = new WeakMap<PlayerSpan, number>();

/** Real AST% of the window (BBRef), or one read from assists a 36 minutes where it has none. */
export function astPctForSpan(span: PlayerSpan): number {
  const real = realSpan(span);
  const mpg = Math.max(10, real?.mpg ?? 34);
  return real?.ast ?? Math.min(55, (4.2 * span.box.apg * 36) / mpg);
}

export function ballShare(span: PlayerSpan): number {
  let share = shareCache.get(span);
  if (share !== undefined) return share;
  const real = realSpan(span);
  const usg = real?.usg ?? 20;
  const ast = astPctForSpan(span);
  share = Math.max(0.02, -0.01139 + 0.00174 * usg + 0.00445 * ast - (0.00194 * usg * ast) / 100 + (POSITION_SHIFT[span.primaryPosition] ?? 0));
  shareCache.set(span, share);
  return share;
}

/** The second-highest ball share of a five past `from` (0 when one player has the ball). */
export function secondHandlerExcess(five: PlayerSpan[]): number {
  const shares = five.map(ballShare).sort((a, b) => b - a);
  return Math.max(0, (shares[1] ?? 0) - BALL_HANDLER_TUNING.from);
}

/** ORtg points a 100 trips per point of shooting on every shot of the five, as the game plays it:
 * set so Harden 2016-18 + Westbrook 2016-18 (cost 2.5) lose 2.5 points a 100 trips in the game's
 * mechanics (`mechanicsPer100`, against 48 bench-league teams). */
export const ORTG_PER_TS = 94;

/** What that costs the five, in ORtg points a 100 trips (≈ points a game). */
export function ballHandlerCost(five: PlayerSpan[]): number {
  return BALL_HANDLER_TUNING.perTen * secondHandlerExcess(five) * 10;
}
