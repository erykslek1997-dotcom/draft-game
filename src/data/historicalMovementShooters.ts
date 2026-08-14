import type { PlayerSpan } from './schema';
import { normalizePlayerName } from './schema';

/**
 * Qualitative movement-shooting evidence supplied and explicitly validated by the user on
 * 2026-08-11. This is deliberately a very small seed list, not a claim that these are the only
 * historical movement shooters. It contains no invented possessions or tracking values: the
 * evidence only unlocks the role gate, while the fit score is still derived from the player's
 * recorded shooting volume, accuracy and box line.
 *
 * Pre-Synergy box scores cannot distinguish a stationary catch-and-shoot attempt from a shot
 * after a screen or relocation. Consequently, unlisted historical players are not inferred as
 * Movement Shooters from box shape alone. Additions to this list require separate scouting or
 * play-type validation.
 */
export interface HistoricalMovementShooterEvidence {
  playerName: string;
  note: string;
}

export const HISTORICAL_MOVEMENT_SHOOTER_EVIDENCE: HistoricalMovementShooterEvidence[] = [
  {
    playerName: 'Dale Ellis',
    note: 'User-validated early movement-shooting precursor; recorded volume and accuracy determine the score.',
  },
  {
    playerName: 'Reggie Miller',
    note: 'User-validated historical movement-shooting centerpiece.',
  },
  {
    playerName: 'Dell Curry',
    note: 'User-validated movement-shooting role player; role evidence does not add star value.',
  },
  {
    playerName: 'Ray Allen',
    note: 'User-validated movement shooter with separate on-ball value in applicable spans.',
  },
  {
    playerName: 'Kyle Korver',
    note: 'User-validated movement-shooting role player; role evidence does not add self-creation.',
  },
];

const evidenceByName = new Map(
  HISTORICAL_MOVEMENT_SHOOTER_EVIDENCE.map((entry) => [normalizePlayerName(entry.playerName), entry]),
);

export function historicalMovementShooterEvidenceForSpan(
  span: Pick<PlayerSpan, 'playerName'>,
): HistoricalMovementShooterEvidence | null {
  return evidenceByName.get(normalizePlayerName(span.playerName)) ?? null;
}
