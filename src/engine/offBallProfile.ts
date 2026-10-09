import type { OffensiveArchetype, PlayerSpan } from '../data/schema';
import profile from '../data/offBallProfile.json';

/**
 * How a perimeter shooter gets his shots off the ball (`scripts/buildOffBallProfile.ts`): the share
 * of his plays that came running off screens and hand-offs. 2026-10-09, the user: the shooter
 * labels follow it. On the NBA.com play types (2015-16 on, 469 players) 0.30+ is the league's
 * dozen constant movers (Redick 0.48, Korver 0.46, Klay 0.39, Duncan Robinson 0.36), 0.20+ its top
 * tenth; under that a shooter mostly waits for the ball.
 */
const PROFILE = profile as unknown as Record<string, [number, string]>;
export const OFF_BALL_SHOOTER_BANDS = { movement: 0.3, offScreen: 0.2, minThreePA: 3 };

/** Share of his plays off screens and hand-offs, or null when he is not a perimeter shooter. */
export function movementShare(span: PlayerSpan): number | null {
  const row = PROFILE[span.id];
  return row ? row[0] / 1000 : null;
}

/** The shooter label his movement earns, or null when there is nothing to read. */
export function offBallShooterLabel(span: PlayerSpan): OffensiveArchetype | null {
  const share = movementShare(span);
  if (share === null || (span.box.threePA ?? 0) < OFF_BALL_SHOOTER_BANDS.minThreePA) return null;
  if (share >= OFF_BALL_SHOOTER_BANDS.movement) return 'Movement Shooter';
  if (share >= OFF_BALL_SHOOTER_BANDS.offScreen) return 'Off Screen Shooter';
  return 'Stationary Shooter';
}
