import type { OffensiveArchetype, PlayerSpan } from '../data/schema';
import profile from '../data/offBallProfile.json';
import cutting from '../data/cuttingProfile.json';

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
  // A box score alone can't tell a shot off a screen from a spot-up (Raja Bell's six threes a game
  // read as movement): Movement Shooter needs measured play types, the player's own measured career
  // or the user-validated list (`historicalMovementShooters.ts`); the model alone stops at Off Screen.
  if (share >= OFF_BALL_SHOOTER_BANDS.movement) return PROFILE[span.id][1] === 'model' ? 'Off Screen Shooter' : 'Movement Shooter';
  if (share >= OFF_BALL_SHOOTER_BANDS.offScreen) return 'Off Screen Shooter';
  return 'Stationary Shooter';
}

/** Measured (or user-validated) movement this span can stand on, not the box-score model's guess. */
export function hasMovementEvidence(span: PlayerSpan): boolean {
  const row = PROFILE[span.id];
  return !!row && row[1] !== 'model' && row[0] / 1000 >= OFF_BALL_SHOOTER_BANDS.movement;
}

const CUTTING = cutting as unknown as Record<string, [number, string]>;
/** Share of a perimeter player's plays that were cuts (NBA.com 2015+, else the listed historical
 * cutters — `historicalCutters.ts`), or null when nothing is known. Descriptions only. */
export function cutShare(span: PlayerSpan): number | null {
  const row = CUTTING[span.id];
  return row ? row[0] / 1000 : null;
}

/** True when the share was measured (NBA.com play types), not estimated or listed — only a measured
 * share is quoted as a number in a description. */
export function movementMeasured(span: PlayerSpan): boolean {
  return PROFILE[span.id]?.[1] === 'nba';
}
export function cutMeasured(span: PlayerSpan): boolean {
  return CUTTING[span.id]?.[1] === 'nba';
}
