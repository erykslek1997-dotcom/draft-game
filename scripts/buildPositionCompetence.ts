/**
 * Writes src/data/positionCompetence.json — for every player in the draft pool, his natural
 * position(s) and a score in (0, 0.9] for how well he can play each other position (see `score`).
 * Anything not listed is closed (not a realistic assignment). Read by positionCompetence.ts.
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
import { computeSpacing } from '../src/engine/spacing';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { per36 } from '../src/engine/minutesPerGame';
import '../src/engine/fit';

type Level = 'full' | 'partial' | 'emergency' | 'none';
const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const HANDLERS = ['Primary Ball Handler', 'Secondary Ball Handler', 'Shot Creator'];
const PG_HANDLERS = ['Primary Ball Handler', 'Secondary Ball Handler'];
/** e^(−0.4) × 0.9 ≈ 0.6: a named point guard always covers a stretch at the point. */
const NAMED_PG_MAX_PENALTY = 0.4;
const SMALL_BALL_C_ROLES = ['Switch Big', 'Mobile Big', 'Helper', 'Anchor Big'];

/** The best a non-natural position can score (natural positions are 1). */
const MAX_SCORE = 0.9;
/** The user's own hand decisions, as scores. */
const LEVEL_SCORE: Record<Exclude<Level, 'none'>, number> = { full: 0.9, partial: 0.6, emergency: 0.25 };

/** `weight` per unit the value misses `target` by, capped so one weak trait never closes a position. */
function shortfall(value: number, target: number, weight: number, cap: number): number {
  return Math.min(cap, weight * Math.max(0, target - value));
}

/**
 * How well a player plays `pos` coming from his nearest natural position `from`, as a score in
 * (0, 0.9], or 0 when the position is closed. Heights are inches (6'6" = 78, 0 = unknown, never
 * penalised). `share` = fraction of the player's spans listing `pos`.
 *
 * 2026-10-01, the user ("wielopozycyjność ... może zbyt twarde limity", then "bramki zamykające"
 * and "0,1 zbiórki nie może kogoś zablokować"): instead of a ladder of thresholds that opens a
 * level, every adjacent position starts open and each missing trait costs a penalty that grows
 * linearly with the shortfall and is capped per trait. score = 0.9 × e^(−Σ penalties), so no
 * single statistic closes a position and a tenth of a rebound moves the score by a fraction of a
 * percent. Counting stats are per 36 minutes (`per36`, minutesPerGame.ts). Only non-adjacent
 * positions (and the user's own decisions) are closed outright; a weak fit stays possible and the
 * minute solver prices it with the minutes played there (minuteAllocation.ts).
 */
function score(pos: Position, from: Position, s: PlayerSpan, h: number, share: number): number {
  const b = s.box;
  const rpg = per36(b.rpg, s);
  const apg = per36(b.apg, s);
  const bpg = per36(b.bpg, s);
  const spacing = computeSpacing(s);
  const dtal = computeDefensiveTalent(s);
  const handler = HANDLERS.includes(s.offensiveArchetype);
  const below = (target: number, weight: number, cap: number) => (h ? shortfall(h, target, weight, cap) : 0);
  const above = (target: number, weight: number, cap: number) => (h ? shortfall(-h, -target, weight, cap) : 0);
  let penalty: number;
  switch (pos) {
    case 'PG': {
      // 2026-10-01, the user ("wskoczyć na PG powinno być najtrudniej"; Eddie Jones and Jason
      // Richardson at the point were "gruba przesada"): the point is the hardest position to
      // step into. Every non-PG pays a base cost, a steep cost per missing assist (per 36), and
      // more without a real ball-handling role, so the best a non-PG reaches is about 0.7. The named
      // PG list (Wade, Ginóbili, Hornacek) only guarantees a stretch at the point (0.6).
      const named = isNamedPgEligible(s);
      const ballHandler = PG_HANDLERS.includes(s.offensiveArchetype);
      // Two slots away only a ball-handling wing runs the offence (a point forward: LeBron).
      if (!named && from !== 'SG' && !(from === 'SF' && handler)) return 0;
      penalty = 0.25 + shortfall(apg, 7, 0.3, 1.5) + (ballHandler ? 0 : 0.4) + (from === 'SG' || named ? 0 : 0.5);
      if (named) penalty = Math.min(penalty, NAMED_PG_MAX_PENALTY);
      break;
    }
    case 'SG':
      if (from === 'PG') penalty = below(76, 0.1, 0.8);
      else if (from === 'SF') penalty = above(79, 0.12, 0.8) + (handler || spacing >= 65 ? 0 : shortfall(apg, 3.5, 0.08, 0.4));
      else return 0;
      break;
    case 'SF':
      if (from === 'SG') {
        penalty = Math.max(0, below(78, 0.12, 0.8) + shortfall(rpg, 5.5, 0.08, 0.4) - Math.min(0.15, 0.005 * Math.max(0, dtal - 70)));
      } else if (from === 'PF') {
        penalty = above(80, 0.1, 0.8) + (handler ? 0 : shortfall(spacing, 50, 0.005, 0.4));
      } else return 0;
      break;
    case 'PF':
      // The user's rule: a centre plays the four only if he really did (half his spans list it).
      if (from === 'C') return share >= 0.5 ? MAX_SCORE : 0;
      if (from !== 'SF') return 0;
      penalty = below(79, 0.1, 0.8) + shortfall(rpg, 6.5, 0.08, 0.4);
      break;
    case 'C':
      if (from !== 'PF') return 0;
      penalty = Math.max(
        0,
        below(82, 0.1, 0.8) + shortfall(rpg, 9, 0.06, 0.4) + shortfall(bpg, 1.2, 0.15, 0.4) -
          (SMALL_BALL_C_ROLES.includes(s.defensiveRole) ? 0.2 : 0),
      );
      break;
  }
  return Math.round(MAX_SCORE * Math.exp(-penalty) * 100) / 100;
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

type Entry = { nat: Position[]; pos: Partial<Record<Position, number>> };
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
      const listed = spans.filter((s) => s.secondaryPositions.includes(pos) || s.primaryPosition === pos).length;
      const auto = score(pos, from, peak, height, listed / spans.length);
      const userLevel = userLevels[pos];
      const value = userLevel === undefined ? auto : userLevel === 'none' ? 0 : LEVEL_SCORE[userLevel];
      const bucket = value >= 0.75 ? 'full' : value >= 0.47 ? 'partial' : value > 0 ? 'emergency' : 'none';
      tally[bucket] = (tally[bucket] ?? 0) + 1;
      if (value > 0) entry.pos[pos] = value;
    }
  }
  out[key] = entry;
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(resolve(import.meta.dirname, '../src/data/positionCompetence.json'), JSON.stringify(sorted) + '\n');
console.log(`Wrote src/data/positionCompetence.json: ${Object.keys(sorted).length} players`, tally);
