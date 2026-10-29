import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import competenceData from '../data/positionCompetence.json';
import { per36 } from './minutesPerGame';
import { isNamedPgEligible } from './pgEligibility';
import { getBodyWeightLbs, getHeightInches } from '../data/heightLookup';

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

/** `pos` holds the peak span's scores, `s` every span's own (by span label), and `ov` the
 * positions set by the user's own decisions (they win over every formula). */
type Entry = {
  nat: Position[];
  pos: Partial<Record<Position, number>>;
  ov?: Position[];
  s?: Record<string, Partial<Record<Position, number>>>;
};
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

/** 2026-10-02, the user (the AI started 5'11" Jim Les at SG): nobody under 6'2" plays SG unless it
 * is his own primary position. */
const MIN_SG_HEIGHT_INCHES = 74;

export function positionCompetenceScore(span: PlayerSpan, slot: Position): number {
  if (slot === span.primaryPosition) return NATURAL_SCORE;
  if (slot === 'SG') {
    const height = getHeightInches(span.playerName);
    if (height !== undefined && height < MIN_SG_HEIGHT_INCHES) return 0;
  }
  return Math.min(rawCompetenceScore(span, slot), sizeCap(span, slot), NAMED_SLOT_CAPS[normalizePlayerName(span.playerName)]?.[slot] ?? 1);
}

/** 2026-10-29, the user (Porziņģis starting at PF beside Embiid: "a 7'4\" PF makes no real sense"):
 * named players who play a slot at most at the given score, whatever their career says. */
const NAMED_SLOT_CAPS: Record<string, Partial<Record<Position, number>>> = {
  'kristaps porzingis': { PF: 0.6 },
  // The user (export 1497221832, "Rodman na SG i SF??"): a four from his Pistons years on — the
  // wing at most as a stretch, never the two.
  'dennis rodman': { SG: 0, SF: 0.6 },
  // The user (Jason Collins, TAL 58, the four's 13 minutes beside Giannis while Ben Wallace sat:
  // "zablokuj Collinsa na PF"): a centre only.
  'jason collins': { PF: 0 },
};

/**
 * 2026-10-28, the user's export (Chris Mullin 1998-00 — 6'7", 4.8 rebounds a 36, 215 lb — starting at
 * PF; Anthony Edwards, 6'4", starting at SF): moving UP a position needs the body for it, whatever
 * the skill profile reads. Into SF from the guard spots under 6'5": at most `partial` (a small-lineup
 * stretch, not a starter's job). Into PF from the wing under 6'8" with neither a forward's
 * rebounding (5.5 a 36) nor his weight (225 lb): at most `emergency` — small-ball fours such as
 * Melo, Butler 2020-22 and Anunoby keep it.
 */
const SIZE_CAP = { sfMinInches: 77, pfMinInches: 80, pfRebounds36: 5.5, pfMinLbs: 225, partial: 0.6, emergency: 0.4 };
function sizeCap(span: PlayerSpan, slot: Position): number {
  const from = POSITION_ORDER.indexOf(span.primaryPosition);
  const to = POSITION_ORDER.indexOf(slot);
  if (to <= from) return 1;
  const height = getHeightInches(span.playerName);
  if (height === undefined) return 1;
  if (slot === 'SF' && height < SIZE_CAP.sfMinInches) return SIZE_CAP.partial;
  if (slot === 'PF' && height < SIZE_CAP.pfMinInches && per36(span.box.rpg, span) < SIZE_CAP.pfRebounds36 && (getBodyWeightLbs(span.playerName) ?? 0) < SIZE_CAP.pfMinLbs) return SIZE_CAP.emergency;
  return 1;
}

function rawCompetenceScore(span: PlayerSpan, slot: Position): number {
  const entry = entryFor(span);
  if (!entry) {
    if (span.secondaryPositions.includes(slot)) return UNLISTED_SECONDARY_SCORE;
    return Math.abs(POSITION_ORDER.indexOf(slot) - POSITION_ORDER.indexOf(span.primaryPosition)) === 1
      ? UNLISTED_ADJACENT_SCORE
      : 0;
  }
  // Each span is scored from its own numbers (the build script); a natural position other than the
  // point scores `OTHER_NATURAL_SCORE`.
  const own = entry.s?.[span.spanLabel];
  if (own) return own[slot] ?? (entry.nat.includes(slot) && slot !== 'PG' ? OTHER_NATURAL_SCORE : 0);
  if (slot === 'PG' && !entry.ov?.includes('PG')) return pointGuardScore(span, entry.nat);
  if (entry.nat.includes(slot)) return OTHER_NATURAL_SCORE;
  return entry.pos[slot] ?? 0;
}

const PG_HANDLERS = ['Primary Ball Handler', 'Secondary Ball Handler'];
const CREATORS = ['Primary Ball Handler', 'Secondary Ball Handler', 'Shot Creator'];
const PG_ASSISTS_TARGET = 7;
const PG_ASSIST_WEIGHT = 0.3;
const PG_ASSIST_CAP = 1.5;
/** e^(−0.4) × 0.9 ≈ 0.6: a named point guard always covers a stretch at the point. */
const NAMED_PG_MAX_PENALTY = 0.4;

/**
 * 2026-10-01, the user ("wskoczyć na PG powinno być najtrudniej", then Caruso and Pressey running
 * the point in teams with no natural PG: "zbicie wartości"): the point is scored per span, from
 * that span's own assists (per 36) and role, and measured from that span's own position — not
 * once per player from his peak. Caruso's 3-and-D years no longer inherit the point from his one
 * PG-tagged span, and Pressey's late spans no longer inherit his point-forward peak.
 *
 *   PG among his natural positions (tagged there in a quarter of his spans): 0.95 at 7+ assists,
 *     falling 0.3 per missing assist (West 6.1 → 0.73, Caruso 4.5 → 0.45).
 *   Otherwise: a base 0.25 plus the same assist cost, 0.4 without a ball-handling role and 0.5
 *     two slots away (a small forward); a power forward or centre never runs the point. A named
 *     point guard (pgEligibility.ts) always keeps a stretch there (0.6).
 */
export function pointGuardScore(span: PlayerSpan, natural: Position[]): number {
  const named = isNamedPgEligible(span);
  const assistGap = Math.min(PG_ASSIST_CAP, PG_ASSIST_WEIGHT * Math.max(0, PG_ASSISTS_TARGET - per36(span.box.apg, span)));
  let score: number;
  if (natural.includes('PG')) {
    score = OTHER_NATURAL_SCORE * Math.exp(-assistGap);
  } else {
    const from = span.primaryPosition;
    if (!named && (from === 'PF' || from === 'C' || (from === 'SF' && !CREATORS.includes(span.offensiveArchetype)))) return 0;
    let penalty = 0.25 + assistGap + (PG_HANDLERS.includes(span.offensiveArchetype) ? 0 : 0.4) + (from === 'SG' || named ? 0 : 0.5);
    if (named) penalty = Math.min(penalty, NAMED_PG_MAX_PENALTY);
    score = UNLISTED_SECONDARY_SCORE * Math.exp(-penalty);
  }
  return Math.round(score * 100) / 100;
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
