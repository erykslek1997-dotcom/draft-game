import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import competenceData from '../data/positionCompetence.json';

/**
 * 2026-09-25, user's multi-position ask ("wielopozycyjność ... na marginalnych spadkach"): how
 * well a player plays each position, as one source of truth for rotation, AI needs, penalties,
 * insights and cards. Built by `scripts/buildPositionCompetence.ts` (a calibrated skill-profile
 * classifier plus the user's own hand decisions, which always win).
 *
 *   natural   — the span's own tag.
 *   full      — played it for real (Magic at SG, Durant at PF): a marginal drop.
 *   partial   — can, but not for a whole game (Wade/Manu at PG): a bigger, still small drop,
 *               plus a downward-position penalty past `PARTIAL_POSITION_GRACE_MINUTES`.
 *   emergency — only when nothing better exists (the old adjacent fallback).
 *   none      — not a realistic assignment.
 *
 * Deliberately separate from `span.secondaryPositions`, which stays the raw source-data list:
 * ratings (portability, defensive role fit) still read that, so this changes where a player can
 * play without moving anyone's TAL.
 */
export type PositionCompetence = 'natural' | 'full' | 'partial' | 'emergency' | 'none';

type Entry = { nat: Position[]; pos: Partial<Record<Position, Exclude<PositionCompetence, 'natural' | 'none'>>> };
const DATA = competenceData as Record<string, Entry>;
const POSITION_ORDER: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Multipliers on a player's value in a slot. `full`/`partial` stay at or above the 0.9 line
 * the engine reads as a real position fit; `emergency` keeps the old adjacent fallback. */
export const COMPETENCE_MULTIPLIER = { natural: 1, full: 0.975, partial: 0.945 } as const;
export const EMERGENCY_UP_MULTIPLIER = 0.85;
export const EMERGENCY_DOWN_MULTIPLIER = 0.5;
/** A `partial` player covers this many minutes at a lower slot before the downward penalty
 * starts ramping (the user's "do ~12-15 min, dłużej spada"). */
export const PARTIAL_POSITION_GRACE_MINUTES = 15;

function entryFor(span: PlayerSpan): Entry | undefined {
  return DATA[normalizePlayerName(span.playerName)];
}

export function positionCompetence(span: PlayerSpan, slot: Position): PositionCompetence {
  if (slot === span.primaryPosition) return 'natural';
  const entry = entryFor(span);
  if (!entry) {
    // A span outside the built table (not in the draft pool): the pre-table rules.
    if (span.secondaryPositions.includes(slot)) return 'full';
    return Math.abs(POSITION_ORDER.indexOf(slot) - POSITION_ORDER.indexOf(span.primaryPosition)) === 1
      ? 'emergency'
      : 'none';
  }
  // Another of the player's natural positions (Harden's SG-tagged span at PG).
  if (entry.nat.includes(slot)) return 'full';
  return entry.pos[slot] ?? 'none';
}

/** The positions a player genuinely plays besides this span's tag (`full` first, then
 * `partial`) — what the rotation, AI needs and cards treat as his real secondaries. */
export function realSecondaryPositions(span: PlayerSpan): Position[] {
  const levels = POSITION_ORDER.filter((pos) => pos !== span.primaryPosition)
    .map((pos) => ({ pos, level: positionCompetence(span, pos) }))
    .filter(({ level }) => level === 'full' || level === 'partial');
  return [...levels.filter((l) => l.level === 'full'), ...levels.filter((l) => l.level === 'partial')].map((l) => l.pos);
}
