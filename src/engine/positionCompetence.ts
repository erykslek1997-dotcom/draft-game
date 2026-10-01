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

type Entry = { nat: Position[]; pos: Partial<Record<Position, number>> };
const DATA = competenceData as Record<string, Entry>;
const POSITION_ORDER: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Multipliers on a player's value in a slot at the score anchors (0.9 and 0.6), interpolated in
 * between by `positionFitMultiplier` (positions.ts); `emergency` keeps the old adjacent fallback. */
export const COMPETENCE_MULTIPLIER = { natural: 1, full: 0.975, partial: 0.945 } as const;
export const EMERGENCY_UP_MULTIPLIER = 0.85;
export const EMERGENCY_DOWN_MULTIPLIER = 0.5;
/** A `partial` player covers this many minutes at a lower slot before the downward penalty
 * starts ramping (the user's "do ~12-15 min, dłużej spada"). */
export const PARTIAL_POSITION_GRACE_MINUTES = 15;

function entryFor(span: PlayerSpan): Entry | undefined {
  return DATA[normalizePlayerName(span.playerName)];
}

/**
 * 2026-10-01, the user ("bramki zamykające", "0,1 zbiórki nie może kogoś zablokować"): how well a
 * player plays `slot` as a continuous score — 1 at his span's own position, up to 0.9 at another,
 * 0 when closed. The build script lowers it smoothly for each missing trait instead of opening
 * discrete levels at thresholds. A span outside the built table falls back to the old rules.
 */
export const NATURAL_SCORE = 1;
/** Another of the player's natural positions (Harden's SG-tagged span at PG). */
const OTHER_NATURAL_SCORE = 0.95;
const UNLISTED_SECONDARY_SCORE = 0.9;
const UNLISTED_ADJACENT_SCORE = 0.25;
/** Score bands behind the discrete levels the rest of the engine reads (depth, grace, cards). */
export const FULL_SCORE = 0.75;
export const PARTIAL_SCORE = 0.47;

export function positionCompetenceScore(span: PlayerSpan, slot: Position): number {
  if (slot === span.primaryPosition) return NATURAL_SCORE;
  const entry = entryFor(span);
  if (!entry) {
    if (span.secondaryPositions.includes(slot)) return UNLISTED_SECONDARY_SCORE;
    return Math.abs(POSITION_ORDER.indexOf(slot) - POSITION_ORDER.indexOf(span.primaryPosition)) === 1
      ? UNLISTED_ADJACENT_SCORE
      : 0;
  }
  if (entry.nat.includes(slot)) return OTHER_NATURAL_SCORE;
  return entry.pos[slot] ?? 0;
}

export function positionCompetence(span: PlayerSpan, slot: Position): PositionCompetence {
  if (slot === span.primaryPosition) return 'natural';
  const score = positionCompetenceScore(span, slot);
  if (score >= FULL_SCORE) return 'full';
  if (score >= PARTIAL_SCORE) return 'partial';
  return score > 0 ? 'emergency' : 'none';
}

/** The positions a player genuinely plays besides this span's tag (`full` first, then
 * `partial`) — what the rotation, AI needs and cards treat as his real secondaries. */
export function realSecondaryPositions(span: PlayerSpan): Position[] {
  const levels = POSITION_ORDER.filter((pos) => pos !== span.primaryPosition)
    .map((pos) => ({ pos, level: positionCompetence(span, pos) }))
    .filter(({ level }) => level === 'full' || level === 'partial');
  return [...levels.filter((l) => l.level === 'full'), ...levels.filter((l) => l.level === 'partial')].map((l) => l.pos);
}
