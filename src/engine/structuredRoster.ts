import type { PlayerSpan, Position } from '../data/schema';
import { effectiveTalent } from './grades';
import { spanOptionsFor } from './spanOptimizer';
import { positionCompetenceScore, FULL_SCORE } from './positionCompetence';
import { normalizePlayerName } from '../data/schema';
import { STARTER_SLOTS } from './positions';
import type { Rotation } from './types';

/**
 * 2026-11-05, the user's test draft ("każdy ma być na swojej pozycji, oprócz ławkowiczów którzy mogą
 * grać PG/SG / SG/SF / SF/PF [, PF/C]. 8 man rotation + salary glue"): a strict roster shape.
 *  - five starters, each at his own (primary) position;
 *  - three rotation backups, each playing one adjacent pair (his primary plus a second position he
 *    really plays, competence `STRUCTURE.comboScore`+) or his own position alone, together covering
 *    all five positions;
 *  - one salary glue: `STRUCTURE.glueFga` shots at most, no minutes.
 * The rotation follows: starters `STRUCTURE.starterMinutes`, backups only in their pair.
 */
export const STRUCTURE = { comboScore: FULL_SCORE, glueFga: 2.5, starterMinutes: 36 };
export const BACKUP_PAIRS: [Position, Position][] = [
  ['PG', 'SG'],
  ['SG', 'SF'],
  ['SF', 'PF'],
  ['PF', 'C'],
];

export interface StructuredRoster {
  starters: Partial<Record<Position, PlayerSpan>>;
  backups: { player: PlayerSpan; pair: [Position, Position] }[];
  glue: PlayerSpan[];
  problems: string[];
  /** A listed starter who also covers the next spot (`SLIDING_STARTERS`), if the roster uses one. */
  slider?: { player: PlayerSpan; covers: Position };
}

/**
 * 2026-11-05, the user ("Jeśli w składzie jest np KD, to KD może być tym SF/PF ... BARDZO
 * DELIKATNIE"; the list approved by the user): starters who also cover the spot next to theirs, in
 * windows where they really play it (competence `SLIDE.minScore`+). One a team at most. He plays
 * `SLIDE.ownMinutes` at home and `SLIDE.slideMinutes` there, that spot's starter
 * `SLIDE.coveredStarterMinutes`; the spot counts as covered, his own still needs a backup.
 */
export const SLIDING_STARTERS: Record<string, Position> = Object.fromEntries(
  (
    [
      ['LeBron James', 'SF'],
      ['Kevin Durant', 'SF'],
      ['Tracy McGrady', 'SF'],
      ['Larry Bird', 'PF'],
      ['Tim Duncan', 'PF'],
      ['Victor Wembanyama', 'PF'],
      ['James Harden', 'SG'],
      ['Shai Gilgeous-Alexander', 'SG'],
      ['Luka Doncic', 'SG'],
      ['Jerry West', 'SG'],
      ['Jimmy Butler', 'SG'],
      ['Anfernee Hardaway', 'SG'],
      ['Anthony Davis', 'C'],
    ] as [string, Position][]
  ).map(([name, slot]) => [normalizePlayerName(name), slot]),
);
export const SLIDE = { minScore: 0.9, ownMinutes: 32, slideMinutes: 8, coveredStarterMinutes: 40 };

function slidersFor(starters: Partial<Record<Position, PlayerSpan>>): { player: PlayerSpan; covers: Position }[] {
  const out: { player: PlayerSpan; covers: Position }[] = [];
  for (const slot of STARTER_SLOTS) {
    const p = starters[slot];
    if (!p) continue;
    const covers = SLIDING_STARTERS[normalizePlayerName(p.playerName)];
    if (!covers || covers === slot || !starters[covers]) continue;
    if (positionCompetenceScore(p, covers) < SLIDE.minScore) continue;
    out.push({ player: p, covers });
  }
  return out;
}

/** The pairs a player can back up: his primary in the pair, the other one played for real. */
export function pairsFor(p: PlayerSpan): [Position, Position][] {
  return BACKUP_PAIRS.filter(([a, b]) => {
    if (p.primaryPosition === a) return positionCompetenceScore(p, b) >= STRUCTURE.comboScore;
    if (p.primaryPosition === b) return positionCompetenceScore(p, a) >= STRUCTURE.comboScore;
    return false;
  });
}

/**
 * What a backup can cover: any pair he plays, or his own position alone (2026-11-05, the user: "drużyna
 * może wybrać PG/SG ; SF/PF ; C" or "PG ; SG/SF ; PF/C" — the three together still cover all five).
 */
export function backupOptions(p: PlayerSpan): [Position, Position][] {
  return [...pairsFor(p), [p.primaryPosition, p.primaryPosition]];
}

/**
 * The structured reading of a roster, and what breaks it. The starter at each slot is always the
 * best player (TAL) whose own position it is — never a lesser one picked so the bench fits (the
 * first reading started Michael Cooper over Michael Jordan to keep Cooper off the glue spot); the
 * rest is split into backups and glue as well as it can be.
 */
export function readStructure(roster: PlayerSpan[]): StructuredRoster {
  const starters: Partial<Record<Position, PlayerSpan>> = {};
  for (const slot of STARTER_SLOTS) {
    const best = roster.filter((p) => p.primaryPosition === slot).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
    if (best) starters[slot] = best;
  }
  const used = new Set(Object.values(starters).map((p) => p!.id));
  const rest = roster.filter((p) => !used.has(p.id));
  // With a listed sliding starter, the reading tries him covering his second spot, and keeps it only
  // when it mends something.
  let best = bestBench(starters, rest, []);
  for (const slider of slidersFor(starters)) {
    const withSlider = bestBench(starters, rest, [slider.covers]);
    if (withSlider.problems.length < best.problems.length) best = { ...withSlider, slider };
  }
  return best;
}

function bestBench(starters: Partial<Record<Position, PlayerSpan>>, rest: PlayerSpan[], preCovered: Position[]): StructuredRoster {
  const problems: string[] = [];
  for (const slot of STARTER_SLOTS) if (!starters[slot]) problems.push(`no natural ${slot} to start`);
  // Up to three backups with a pair each, covering every position; the rest are glue.
  type Bench = { backups: { player: PlayerSpan; pair: [Position, Position] }[]; uncovered: Position[]; tal: number; key: number[] };
  const holder: { best: Bench | null } = { best: null };
  const options = rest.map((p) => ({ p, pairs: backupOptions(p) }));
  const search = (i: number, chosen: { player: PlayerSpan; pair: [Position, Position] }[]) => {
    if (chosen.length === 3 || i === options.length) {
      const covered = new Set([...preCovered, ...chosen.flatMap((b) => b.pair)]);
      const uncovered = STARTER_SLOTS.filter((slot) => !covered.has(slot));
      const t = chosen.reduce((sum, b) => sum + effectiveTalent(b.player), 0);
      const ids = new Set(chosen.map((b) => b.player.id));
      // A cheap glue beats a dear one at equal coverage: the reading never leaves Brent Barry
      // (8 FGA) as glue while a 3-shot player plays his backup minutes.
      const dearGlue = rest.filter((p) => !ids.has(p.id) && p.fga > STRUCTURE.glueFga).length;
      const b = holder.best;
      const key = [uncovered.length, -chosen.length, dearGlue, -t];
      const first = b ? key.findIndex((v, i) => v !== b.key[i]) : -1;
      const better = !b || (first >= 0 && key[first] < b.key[first]);
      if (better) holder.best = { backups: [...chosen], uncovered, tal: t, key };
      if (chosen.length === 3 || i === options.length) return;
    }
    search(i + 1, chosen);
    for (const pair of options[i].pairs) search(i + 1, [...chosen, { player: options[i].p, pair }]);
  };
  search(0, []);
  const picked: Bench = holder.best ?? { backups: [], uncovered: [...STARTER_SLOTS], tal: 0, key: [] };
  if (picked.backups.length < 3) problems.push(`${3 - picked.backups.length} backup(s) short: no combo player for an open pair`);
  for (const slot of picked.uncovered) problems.push(`no backup covers ${slot}`);
  const backupIds = new Set(picked.backups.map((b) => b.player.id));
  const glue = rest.filter((p) => !backupIds.has(p.id));
  for (const g of glue) if (g.fga > STRUCTURE.glueFga) problems.push(`glue ${g.playerName} costs ${g.fga.toFixed(1)} FGA (> ${STRUCTURE.glueFga}) for no minutes`);
  return { starters, backups: picked.backups, glue, problems };
}

/** The 8-man rotation of a structured roster: starters at home, backups only in their pair. */
export function structuredRotation(roster: PlayerSpan[]): Rotation {
  const s = readStructure(roster);
  const slots = Object.fromEntries(STARTER_SLOTS.map((slot) => [slot, [] as { playerId: string; minutes: number }[]])) as Rotation['slots'];
  const left = new Map<Position, number>(STARTER_SLOTS.map((slot) => [slot, 48]));
  for (const slot of STARTER_SLOTS) {
    const p = s.starters[slot];
    if (!p) continue;
    slots[slot].push({ playerId: p.id, minutes: STRUCTURE.starterMinutes });
    left.set(slot, 48 - STRUCTURE.starterMinutes);
  }
  if (s.slider) {
    // The slider: fewer minutes at home, a stretch at the spot he covers beside that spot's starter.
    const home = s.slider.player.primaryPosition;
    const there = s.slider.covers;
    slots[home][0] = { ...slots[home][0], minutes: SLIDE.ownMinutes };
    left.set(home, 48 - SLIDE.ownMinutes);
    slots[there][0] = { ...slots[there][0], minutes: SLIDE.coveredStarterMinutes };
    slots[there].push({ playerId: s.slider.player.id, minutes: SLIDE.slideMinutes });
    left.set(there, 48 - SLIDE.coveredStarterMinutes - SLIDE.slideMinutes);
  }
  // Slots one backup covers alone take him first; shared ones split evenly between their backups.
  const minutesOf = new Map<string, number>();
  const coverers = (slot: Position) => s.backups.filter((b) => b.pair.includes(slot));
  const order = [...STARTER_SLOTS].sort((a, b) => coverers(a).length - coverers(b).length);
  for (const slot of order) {
    const who = coverers(slot);
    if (who.length === 0) continue;
    const need = left.get(slot)!;
    const share = Math.floor(need / who.length);
    who.forEach((b, i) => {
      const m = i === who.length - 1 ? need - share * (who.length - 1) : share;
      if (m <= 0) return;
      slots[slot].push({ playerId: b.player.id, minutes: m });
      minutesOf.set(b.player.id, (minutesOf.get(b.player.id) ?? 0) + m);
    });
    left.set(slot, 0);
  }
  // A slot no backup covers: its starter plays it all (the structure's own error says so).
  for (const slot of STARTER_SLOTS) {
    const rest = left.get(slot)!;
    if (rest > 0 && slots[slot][0]) slots[slot][0] = { ...slots[slot][0], minutes: slots[slot][0].minutes + rest };
  }
  return { slots };
}

/**
 * After the draft: each glue takes his cheapest window at his drafted position (the user: "ostateczny
 * wybór okna kleju na najtańszy" — Fred Hoiberg 3.6 and 4.3, Keith Bogans 3.8 had cheaper ones).
 */
export function cheapestGlueWindows(roster: PlayerSpan[]): PlayerSpan[] {
  const glue = new Set(readStructure(roster).glue.map((p) => p.id));
  return roster.map((p) => {
    if (!glue.has(p.id)) return p;
    const cheapest = spanOptionsFor(p.playerName)
      .filter((o) => o.primaryPosition === p.primaryPosition)
      .sort((a, b) => a.fga - b.fga)[0];
    return cheapest && cheapest.fga < p.fga ? cheapest : p;
  });
}

/**
 * Can a partial roster still grow into the full structure? Its own reading, then: the slots left hold
 * every role still open, the backups still to come (two positions each, at most) can cover what is
 * uncovered, and at most one player has no role (the glue). The structured test's pick check: two
 * one-position backups (Mario Chalmers, Jon Barry) left the third to cover three spots.
 */
export function canStillComplete(roster: PlayerSpan[], rosterSize: number): boolean {
  const s = readStructure(roster);
  const left = rosterSize - roster.length;
  const missingStarters = STARTER_SLOTS.filter((slot) => !s.starters[slot]).length;
  const openBackups = 3 - s.backups.length;
  const covered = new Set([...s.backups.flatMap((b) => b.pair), ...(s.slider ? [s.slider.covers] : [])]);
  const uncovered = STARTER_SLOTS.filter((slot) => !covered.has(slot)).length;
  const glueOpen = s.glue.length === 0 ? 1 : 0;
  if (s.glue.length > 1) return false;
  if (missingStarters + openBackups + glueOpen > left) return false;
  // Exact: the backups still to come must cover what is left with real shapes — an adjacent pair or
  // one spot each. Two open spots far apart (PG and C) need two backups, not one (Portland had one).
  const open = STARTER_SLOTS.filter((slot) => !covered.has(slot));
  return uncovered === 0 || coverable(open, openBackups);
}

const SHAPES: Position[][] = [...BACKUP_PAIRS.map((p) => [...p]), ...STARTER_SLOTS.map((slot) => [slot])];
function coverable(open: Position[], backups: number): boolean {
  if (open.length === 0) return true;
  if (backups === 0) return false;
  return SHAPES.some((shape) => shape.includes(open[0]) && coverable(open.filter((slot) => !shape.includes(slot)), backups - 1));
}

/**
 * Does adding `p` keep everyone already drafted in a playing role? A starter or backup pushed to the
 * glue spot at more than `STRUCTURE.glueFga` shots is a wasted pick (Mikal Bridges, a backup, left a
 * 6.8-FGA glue when a better wing came).
 */
export function keepsRoles(roster: PlayerSpan[], p: PlayerSpan): boolean {
  const before = new Set(readStructure(roster).glue.map((x) => x.id));
  const after = readStructure([...roster, p]).glue;
  return after.every((x) => x.id === p.id || before.has(x.id) || x.fga <= STRUCTURE.glueFga);
}
