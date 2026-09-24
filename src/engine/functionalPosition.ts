import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { players } from '../data/players';
import { getHeightInches } from '../data/heightLookup';

/**
 * 2026-09-24, user ("czy jesteśmy w stanie sprawdzić kto był po prostu small ball PF i oceniać go
 * jako SF?"): the share-of-games position tag flips wings who play the 4 between SF and PF, and the
 * D-TAL ladder is 7-9 points harsher for PF (its rungs are inflated by bigs' rebounds and blocks),
 * so near-identical spans of the same player read up to 36 points apart depending on the tag
 * (Herbert Jones, Joe Ingles, DeRozan, Bird, P.J. Tucker 2017-19). Measured on the 140 adjacent
 * same-player SF<->PF flips with a near-flat box: the PF-side D-TAL gap was -10.7 on the flagged
 * spans, -1.6 once they are read as SF, and stayed -2.8 on the unflagged ones.
 *
 * A PF-tagged span is a "small-ball PF" — read as SF for the D-TAL ladder, the undersized-big
 * malus and the bridge's percentile grouping — when ALL hold: listed height <= 6'8", rpg < 9, bpg
 * < 0.9, and there is evidence he also plays the wing (an SF secondary position, or an SF-tagged
 * span elsewhere in the pool). 325 spans / 130 players. Everything else about the span (TAL blend,
 * tier caps, position correction, `primaryPosition` for the UI) is untouched.
 */
const SMALL_BALL_MAX_HEIGHT_IN = 80;
const SMALL_BALL_MAX_RPG = 9;
const SMALL_BALL_MAX_BPG = 0.9;

let namesWithSfSpan: Set<string> | null = null;
function hasSfSpan(playerName: string): boolean {
  if (!namesWithSfSpan) {
    namesWithSfSpan = new Set();
    for (const p of players) if (p.primaryPosition === 'SF') namesWithSfSpan.add(normalizePlayerName(p.playerName));
  }
  return namesWithSfSpan.has(normalizePlayerName(playerName));
}

const cache = new Map<string, Position>();
export function functionalPosition(span: PlayerSpan): Position {
  if (span.primaryPosition !== 'PF') return span.primaryPosition;
  const cached = cache.get(span.id);
  if (cached) return cached;
  const height = getHeightInches(span.playerName);
  const smallBall =
    height !== undefined &&
    height <= SMALL_BALL_MAX_HEIGHT_IN &&
    span.box.rpg < SMALL_BALL_MAX_RPG &&
    span.box.bpg < SMALL_BALL_MAX_BPG &&
    (span.secondaryPositions.includes('SF') || hasSfSpan(span.playerName));
  const result: Position = smallBall ? 'SF' : 'PF';
  cache.set(span.id, result);
  return result;
}
