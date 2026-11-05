import type { PlayerSpan, Position } from '../data/schema';
import { effectiveTalent } from './grades';
import { spanOptionsFor } from './spanOptimizer';
import { positionCompetenceScore, FULL_SCORE } from './positionCompetence';
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
  return bestBench(starters, roster.filter((p) => !used.has(p.id)));
}

function bestBench(starters: Partial<Record<Position, PlayerSpan>>, rest: PlayerSpan[]): StructuredRoster {
  const problems: string[] = [];
  for (const slot of STARTER_SLOTS) if (!starters[slot]) problems.push(`no natural ${slot} to start`);
  // Up to three backups with a pair each, covering every position; the rest are glue.
  type Bench = { backups: { player: PlayerSpan; pair: [Position, Position] }[]; uncovered: Position[]; tal: number; key: number[] };
  const holder: { best: Bench | null } = { best: null };
  const options = rest.map((p) => ({ p, pairs: backupOptions(p) }));
  const search = (i: number, chosen: { player: PlayerSpan; pair: [Position, Position] }[]) => {
    if (chosen.length === 3 || i === options.length) {
      const covered = new Set(chosen.flatMap((b) => b.pair));
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
