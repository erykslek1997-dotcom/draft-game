/**
 * Writes src/data/positionCompetence.json — for every player in the draft pool, his natural
 * position(s) and how well he can play each other position: 'full' (played it for real),
 * 'partial' (can, but not for a whole game), 'emergency' (only when nothing better exists).
 * Anything not listed is 'none' (not a realistic assignment). Read by positionCompetence.ts.
 *
 * 2026-09-25, user's multi-position ask ("wielopozycyjność ... na marginalnych spadkach"). The
 * levels come from a skill-profile classifier (height, rebounding, playmaking, defense, shooting)
 * that was calibrated against the user's own hand review of the top ~100 players, then the
 * user's explicit decisions (scripts/positionCompetenceOverrides.json, exported from the review
 * artifact) are applied on top and always win.
 *
 * Deliberately NOT derived from TAL recomputed at another position: ratings are position-relative,
 * so a re-rated Shaq reads 97 at SG and Curry 98 at C. The listed secondary positions from the
 * source data are only a weak signal (Payton/Kidd/Nash were listed SG in every span; the user
 * rated them emergency/none there), so they only drive two narrow rules below.
 *
 * Run: npx tsx scripts/buildPositionCompetence.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import type { PlayerSpan, Position } from '../src/data/schema';
import { getHeightInches } from '../src/data/heightLookup';
import { effectiveTalent } from '../src/engine/grades';
import { isNamedPgEligible } from '../src/engine/pgEligibility';
import { positionDistance, hardLockedPosition } from '../src/engine/positions';
import { playmakingScoreForPlayer } from '../src/engine/playmakingLookup';
import { computeSpacing } from '../src/engine/spacing';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';

type Level = 'full' | 'partial' | 'emergency' | 'none';
const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const HANDLERS = ['Primary Ball Handler', 'Secondary Ball Handler', 'Shot Creator'];
const SMALL_BALL_C_ROLES = ['Switch Big', 'Mobile Big', 'Helper', 'Anchor Big'];

/** Heights are inches (6'6" = 78). `share` = fraction of the player's spans listing `pos`. */
function classify(pos: Position, from: Position, s: PlayerSpan, h: number, share: number): Level {
  const b = s.box;
  const pm = playmakingScoreForPlayer(s) ?? 0;
  const spacing = computeSpacing(s);
  const dtal = computeDefensiveTalent(s);
  const handler = HANDLERS.includes(s.offensiveArchetype);
  switch (pos) {
    case 'PG':
      if (share >= 0.5 && b.apg >= 6.5) return 'full';
      if (isNamedPgEligible(s)) return 'partial';
      if (handler && (b.apg >= 6.5 || pm >= 90)) return 'emergency';
      return 'none';
    case 'SG':
      if (from === 'PG') {
        if (h >= 78) return 'full';
        if (h >= 77) return 'partial';
        if (h >= 76) return 'emergency';
        return 'none';
      }
      if (h && h <= 78 && (handler || spacing >= 65 || b.apg >= 3.5)) return 'full';
      if (h && h <= 79) return 'emergency';
      if (h === 80) return dtal >= 80 ? 'partial' : 'emergency';
      return 'none';
    case 'SF':
      if (from === 'PG' || from === 'SG') {
        if (h >= 78 && b.rpg >= 6.5) return dtal >= 90 ? 'full' : 'partial';
        if (h >= 78) return 'emergency';
        return 'none';
      }
      return h && h <= 78 ? 'emergency' : 'none';
    case 'PF':
      if (from === 'C') return share >= 0.5 ? 'full' : 'none';
      if (h >= 82) return 'full';
      if (b.rpg >= 6 && ((h >= 79 && (dtal >= 70 || b.rpg >= 7.3)) || (h >= 78 && dtal >= 85))) return 'partial';
      return 'none';
    case 'C':
      if (s.primaryPosition !== 'PF') return 'none';
      if (h >= 81 && b.rpg >= 9) return 'partial';
      if (b.rpg >= 7 && b.bpg >= 1 && SMALL_BALL_C_ROLES.includes(s.defensiveRole)) return 'partial';
      return 'none';
  }
}

const overrides = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'positionCompetenceOverrides.json'), 'utf8'),
) as Record<string, Partial<Record<Position, Level>>>;
const overridesByKey = new Map(Object.entries(overrides).map(([name, levels]) => [normalizePlayerName(name), levels]));

const byName = new Map<string, PlayerSpan[]>();
for (const span of draftPool) {
  const list = byName.get(span.playerName) ?? [];
  list.push(span);
  byName.set(span.playerName, list);
}

type Entry = { nat: Position[]; pos: Partial<Record<Position, Exclude<Level, 'none'>>> };
const out: Record<string, Entry> = {};
const tally: Record<string, number> = {};
for (const [name, spans] of byName) {
  const peak = spans.map((s) => ({ s, t: effectiveTalent(s) })).sort((a, b) => b.t - a.t)[0].s;
  const primaryCount = new Map<Position, number>();
  for (const s of spans) primaryCount.set(s.primaryPosition, (primaryCount.get(s.primaryPosition) ?? 0) + 1);
  // A position is natural when it is his tag in a quarter of his spans, or at his peak.
  const nat = [...primaryCount]
    .filter(([pos, count]) => count / spans.length >= 0.25 || pos === peak.primaryPosition)
    .map(([pos]) => pos)
    .sort((a, b) => POSITIONS.indexOf(a) - POSITIONS.indexOf(b));
  const entry: Entry = { nat, pos: {} };
  const key = normalizePlayerName(name);
  if (!hardLockedPosition(spans[0])) {
    const height = getHeightInches(name) ?? 0;
    const userLevels = overridesByKey.get(key) ?? {};
    for (const pos of POSITIONS) {
      if (nat.includes(pos)) continue;
      const from = [...nat].sort((a, b) => positionDistance(a, pos) - positionDistance(b, pos))[0];
      const adjacent = positionDistance(from, pos) === 1;
      const listed = spans.filter((s) => s.secondaryPositions.includes(pos) || s.primaryPosition === pos).length;
      const pgList = pos === 'PG' && isNamedPgEligible(spans[0]);
      const auto: Level = adjacent || pgList ? classify(pos, from, peak, height, listed / spans.length) : 'none';
      const level = userLevels[pos] ?? auto;
      tally[level] = (tally[level] ?? 0) + 1;
      if (level !== 'none') entry.pos[pos] = level;
    }
  }
  out[key] = entry;
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(resolve(import.meta.dirname, '../src/data/positionCompetence.json'), JSON.stringify(sorted) + '\n');
console.log(`Wrote src/data/positionCompetence.json: ${Object.keys(sorted).length} players`, tally);
