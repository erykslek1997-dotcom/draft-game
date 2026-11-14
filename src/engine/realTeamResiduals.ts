import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { envVar } from './env';
import data from '../data/realTeamResiduals.json';

/**
 * 2026-11-14 (the user: "jak poprawia to raczej wprowadzamy"): how much a player's real teams scored
 * and defended over what the engine's Offense / Defense said of them — ORtg / DRtg points a
 * full-minutes season against the league, split over the players by ridge (λ 6, players with 4+
 * weighted seasons; `scripts/buildRealTeamResiduals.ts`, 600 team-seasons since 1973-74). Out of
 * sample (learned on even years, read on odd, and back): team Offense vs real ORtg 0.722 → 0.755,
 * Defense vs real DRtg 0.726 → 0.738. Reggie Miller's teams defended +0.70 better, Jrue Holiday's
 * −0.66, Nash's scored +0.97 more. A team takes each player's by his share of the minutes, turned
 * into score points by the judges' own slopes. `REAL_RES=0` turns it off (and the build script reads
 * the scores that way, so it never learns from itself).
 */
const ROWS = data as unknown as Record<string, [number, number]>;
// Half strength: real SRS 0.8600 → 0.8641 (in sample), game 0.8099 → 0.8079; full: 0.8673 / 0.7931.
export const REAL_RES_SCALE = Number(envVar('REAL_RES') ?? 0.5);
/** Real ORtg / DRtg points per point of the team's Offense / Defense score (the audits' slopes). */
const POINTS_PER_SCORE = { offense: 0.164, defense: 0.14 };
export function realTeamResidual(span: PlayerSpan): { offense: number; defense: number } {
  const row = ROWS[normalizePlayerName(span.playerName)];
  return row ? { offense: row[0], defense: row[1] } : { offense: 0, defense: 0 };
}
/** Score points for a rotation: Σ minutes/48 · the player's residual, on the score's scale. */
export function realResidualPoints(minutes: { player: PlayerSpan; minutes: number }[], side: 'offense' | 'defense'): number {
  if (REAL_RES_SCALE === 0) return 0;
  let sum = 0;
  for (const m of minutes) sum += (m.minutes / 48) * realTeamResidual(m.player)[side];
  return (REAL_RES_SCALE * sum) / POINTS_PER_SCORE[side];
}
