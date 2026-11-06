import type { PlayerSpan, Position } from '../data/schema';
import { displayTierForSpan, effectiveTalent, tierContextFor } from './grades';
import { spanOptionsFor } from './spanOptimizer';
import { positionCompetenceScore } from './positionCompetence';
import { normalizePlayerName } from '../data/schema';
import { STARTER_SLOTS, isRealPositionFit } from './positions';
import { computeSpacing } from './spacing';
import { midrangeGravitySpacing, PRE_ZONE_MIDRANGE_SHARE } from './midrangeGravity';
import { preZoneShootingSkill } from './preZoneShooting';
import starterShareData from '../data/starterShare.json';
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
// comboScore FULL_SCORE → 0.7 (2026-11-05, the user's round-3 notes: "Beverley PG / SG", "Chalmers
// na SG 6'", "Kevin na SG" — a backup point guard covers the two, competence 0.74 there).
export const STRUCTURE = { comboScore: 0.7, glueFga: 2.5, starterMinutes: 36, minRotationTal: 55, minBackupTal: 0 };
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
const SLIDING_STARTERS: Record<string, Position> = Object.fromEntries(
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
const SLIDE = { minScore: 0.9, ownMinutes: 32, slideMinutes: 8, coveredStarterMinutes: 40 };

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

/**
 * Bench positions the user corrected on review, used by the bench reading only (2026-11-05: "Boucher
 * zła pozycja, powinien być PF/C"; "Hart zamiast SG/SF może być SF/PF"). Kept out of the pool data:
 * there they reshuffle the classic drafts and trip `testRotationInvariants` on an unrelated case.
 */
const BENCH_POSITIONS: Record<string, { primary?: Position; competence?: Partial<Record<Position, number>> }> = {
  'chris boucher': { primary: 'PF', competence: { C: 0.95, SF: 0 } },
  'josh hart': { competence: { PF: 0.75 } },
};
function benchPrimary(p: PlayerSpan): Position {
  return BENCH_POSITIONS[normalizePlayerName(p.playerName)]?.primary ?? p.primaryPosition;
}
function benchCompetence(p: PlayerSpan, slot: Position): number {
  return BENCH_POSITIONS[normalizePlayerName(p.playerName)]?.competence?.[slot] ?? positionCompetenceScore(p, slot);
}

/** The pairs a player can back up: his primary in the pair, the other one played for real. */
const pairsMemo = new Map<string, [Position, Position][]>();
export function pairsFor(p: PlayerSpan): [Position, Position][] {
  let hit = pairsMemo.get(p.id);
  if (!hit) {
    hit = pairsForUncached(p);
    pairsMemo.set(p.id, hit);
  }
  return hit;
}
function pairsForUncached(p: PlayerSpan): [Position, Position][] {
  const primary = benchPrimary(p);
  return BACKUP_PAIRS.filter(([a, b]) => {
    if (primary === a) return benchCompetence(p, b) >= STRUCTURE.comboScore;
    if (primary === b) return benchCompetence(p, a) >= STRUCTURE.comboScore;
    return false;
  });
}

/**
 * What a backup can cover: any pair he plays, or his own position alone (2026-11-05, the user: "drużyna
 * może wybrać PG/SG ; SF/PF ; C" or "PG ; SG/SF ; PF/C" — the three together still cover all five).
 */
const backupOptionsMemo = new Map<string, [Position, Position][]>();
export function backupOptions(p: PlayerSpan): [Position, Position][] {
  let hit = backupOptionsMemo.get(p.id);
  if (!hit) {
    hit = backupOptionsUncached(p);
    backupOptionsMemo.set(p.id, hit);
  }
  return hit;
}
function backupOptionsUncached(p: PlayerSpan): [Position, Position][] {
  // Under `STRUCTURE.minBackupTal` he is glue at best (Caldwell Jones 1988-90, 27, as a C backup).
  // Lower than the draft board's floor (`minRotationTal`): a late 50-54 backup beats an uncovered spot.
  // Off (0) for now: with it 3 of 64 CPU teams were left with a spot uncovered late in the draft —
  // the feasibility check's shot budget does not reach the path those picks take. To revisit.
  if (effectiveTalent(p) < STRUCTURE.minBackupTal) return [];
  // A single can be any spot of a pair he plays (LaFrentz at C only, Hayes at C only: the user's
  // "Royce SF/PF / LaFrentz C").
  const pairs = pairsFor(p);
  const singles = [...new Set([benchPrimary(p), ...pairs.flat()])].map((slot): [Position, Position] => [slot, slot]);
  const all: [Position, Position][] = [...pairs, ...singles];
  return playsGuard(p) ? all : all.filter((pair) => !pair.some(isGuardSpot));
}

/**
 * 2026-11-05, the user ("Non shooterzy na pozycjach 1-2 psują immersję, w obecnej lidze taki guard by
 * nie grał"; the strict, modern reading chosen — an era-fair one for pre-1990 windows is for later):
 * minutes at the point or the two need a shooter, spacing `GUARD_SHOOTING.minSpacing`+, unless he is a
 * star (`GUARD_SHOOTING.starTal`+: Jordan 1987-89, Isiah, Westbrook).
 */
// starTal 85 → 75 (the user, on Penny 1998-00 at TAL 78: "2 do 75 tal").
const GUARD_SHOOTING = { minSpacing: 25, starTal: 75 };
/** Guards who never get the TAL pass (the user: "Alvin wyłącz ręcznie"). */
const GUARD_SHOOTING_NO_PASS = new Set(['Alvin Robertson'].map(normalizePlayerName));
const isGuardSpot = (slot: Position) => slot === 'PG' || slot === 'SG';
const spacingMemo = new Map<string, number>();
export function playsGuard(p: PlayerSpan): boolean {
  if (effectiveTalent(p) >= GUARD_SHOOTING.starTal && !GUARD_SHOOTING_NO_PASS.has(normalizePlayerName(p.playerName))) return true;
  let v = spacingMemo.get(p.id);
  if (v === undefined) {
    v = computeSpacing(p);
    spacingMemo.set(p.id, v);
  }
  return v >= GUARD_SHOOTING.minSpacing;
}

/**
 * A big who is some threat away from the rim: a three (`computeSpacing` `BIG_THREAT.spacing`+) or a
 * midrange jumper (`midrangeGravitySpacing` from the shot zones, 1996-97 on, or the hand-set pre-zone
 * skill at `PRE_ZONE_MIDRANGE_SHARE`) of `BIG_THREAT.midrange`+. Duncan 2001-03 reads 20, Mourning
 * 26, Hakeem 38; Shaq, Ben Wallace, Gobert, Howard, Rodman 0.
 */
const BIG_THREAT = { spacing: 25, midrange: 20 };
const bigThreatMemo = new Map<string, boolean>();
export function bigThreat(p: PlayerSpan): boolean {
  let hit = bigThreatMemo.get(p.id);
  if (hit === undefined) {
    const mid = Math.max(midrangeGravitySpacing(p), (preZoneShootingSkill(p) ?? 0) * PRE_ZONE_MIDRANGE_SHARE);
    hit = computeSpacing(p) >= BIG_THREAT.spacing || mid >= BIG_THREAT.midrange;
    bigThreatMemo.set(p.id, hit);
  }
  return hit;
}

/**
 * 2026-11-05, the user ("czy gracz IRL był starterem czy raczej ławkowiczem ... Caruso raczej wchodził
 * z ławki"): a window whose player started under `IRL_ROLE.benchBelow` of his games (games started
 * on record from 1981-82; `starterShare.json`, scripts/buildStarterShare.ts) starts here only as a
 * star (STRUCTURE_STAR_TAL+); the reading starts the next natural first. Caruso 2019-21 7%, Lou
 * Williams 2017-19 13%; Manu 2006-08 40% and Crawford 2008-10 45% pass.
 */
const IRL_ROLE = { benchBelow: 0.3 };
const IRL = starterShareData as unknown as Record<string, [number, number]>;
function starterShareIrl(p: PlayerSpan): number | undefined {
  const share = IRL[`${normalizePlayerName(p.playerName)}|${p.spanLabel}`]?.[0];
  return share === undefined || share < 0 ? undefined : share;
}
/** Minutes a game in real life, when under 36 (from 1973-74); undefined for full-time starters. */
function minutesIrl(p: PlayerSpan): number | undefined {
  return IRL[`${normalizePlayerName(p.playerName)}|${p.spanLabel}`]?.[1];
}
export function startedIrl(p: PlayerSpan): boolean {
  const share = starterShareIrl(p);
  return share === undefined || share >= IRL_ROLE.benchBelow || effectiveTalent(p) >= STRUCTURE_STAR_TAL;
}

/** A star never comes off the bench (the user: "KD czy Nash z ławki nieakceptowalne"). */
export const STRUCTURE_STAR_TAL = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.STAR_TAL ?? 82);

/**
 * The structured reading of a roster, and what breaks it. The starter at each slot is always the
 * best player (TAL) whose own position it is — never a lesser one picked so the bench fits (the
 * first reading started Michael Cooper over Michael Jordan to keep Cooper off the glue spot); the
 * rest is split into backups and glue as well as it can be.
 */
// The same rosters are read many times a pick (score, cost, feasibility, filters): memoized by ids.
const structureMemo = new Map<string, StructuredRoster>();
export function readStructure(roster: PlayerSpan[]): StructuredRoster {
  const key = roster.map((p) => p.id).sort().join(',');
  const hit = structureMemo.get(key);
  if (hit) return hit;
  const result = readStructureUncached(roster);
  if (structureMemo.size >= 20000) structureMemo.clear();
  structureMemo.set(key, result);
  return result;
}
function readStructureUncached(roster: PlayerSpan[]): StructuredRoster {
  const starters: Partial<Record<Position, PlayerSpan>> = {};
  const shooterIssues: string[] = [];
  for (const slot of STARTER_SLOTS) {
    const naturals = roster.filter((p) => p.primaryPosition === slot).sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
    const shoots = (p: PlayerSpan) => !isGuardSpot(slot) || playsGuard(p);
    const best = naturals.find((p) => shoots(p) && startedIrl(p)) ?? naturals.find(shoots) ?? naturals[0];
    if (best) starters[slot] = best;
    if (best && !shoots(best)) shooterIssues.push(`non-shooter ${best.playerName} starts at ${slot}`);
    if (best && !startedIrl(best)) shooterIssues.push(`${best.playerName} came off the bench in real life (${Math.round(starterShareIrl(best)! * 100)}% starts)`);
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
  // 2026-11-05, the user ("Jeśli gra dwóch bigs bez rzutu, chociaż jeden z nich powinien być
  // jakimkolwiek zagrożeniem z mid-range"): the starting four and five are not both non-threats.
  const four = starters.PF;
  const five = starters.C;
  if (four && five && !bigThreat(four) && !bigThreat(five)) shooterIssues.push(`non-shooting bigs ${four.playerName} + ${five.playerName}: neither a midrange threat`);
  const benchStars = [...best.backups.map((b) => b.player), ...best.glue].filter((p) => effectiveTalent(p) >= STRUCTURE_STAR_TAL);
  return { ...best, problems: [...shooterIssues, ...benchStars.map((p) => `star ${p.playerName} off the bench`), ...best.problems] };
}

const BENCH_READING = { centreAtFour: 0.8 };

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
      // 2026-11-05, the user's notes on round 3 ("Prince przejmuje minuty Collisiona na PF", "Dort
      // full SG bez McMillana", "Tucker full PF bez Jaylina"): every spot has one backup, never two
      // splitting it 6/6; among such splits the better backups take the bigger share (TAL per spot).
      const shared = STARTER_SLOTS.reduce((sum, slot) => sum + Math.max(0, chosen.filter((c) => c.pair.includes(slot)).length - 1), 0);
      // A centre's minutes at the four count `BENCH_READING.centreAtFour` (the user: "z ławki
      // najważniejszy Guard, później SF/PF i na końcu C"; "Hart ... SF/PF" over Splitter at PF).
      const weighted = chosen.reduce(
        (sum, c) => sum + effectiveTalent(c.player) * [...new Set(c.pair)].reduce((w, slot) => w + (slot === 'PF' && benchPrimary(c.player) === 'C' ? BENCH_READING.centreAtFour : 1), 0),
        0,
      );
      const b = holder.best;
      const key = [uncovered.length, -chosen.length, dearGlue, shared, -weighted, -t];
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

const QUALITY_SHIFT = { margin: 5, minutes: 6, starterFloor: 30, backupMax: 30 };
// 2026-11-06, the user ("nie może być czegoś takiego jak 'no one else here'", then "GOAT 42, legend
// 40"): nobody plays 48.
const TIER_MINUTES = { goat: 42, legend: 40, high: 38, rest: 36 };
const tierCapMemo = new Map<string, number>();
function tierMinutesCap(p: PlayerSpan): number {
  let cap = tierCapMemo.get(p.id);
  if (cap === undefined) {
    const tier = displayTierForSpan(tierContextFor(p));
    cap = tier === 'GOAT' ? TIER_MINUTES.goat : tier === 'Legend' ? TIER_MINUTES.legend : tier === 'MVP' || tier === 'All-NBA' ? TIER_MINUTES.high : TIER_MINUTES.rest;
    tierCapMemo.set(p.id, cap);
  }
  return cap;
}
const IRL_MINUTES = { margin: 2, starterFloor: 24, backupDefault: 30, minStint: 4 };
const QUALITY_SLIDE = { starMinutesEach: 18, bigGap: 12, bigHomeMinutes: 12 };

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
    // The covered starter within his tier's minutes (Jokić, an MVP, 38 not 40); the slider takes
    // the rest of that spot, and plays that much less at home (within his own tier's minutes too).
    const coveredStarter = slots[there][0] ? roster.find((p) => p.id === slots[there][0].playerId) : undefined;
    const covered = coveredStarter ? Math.min(SLIDE.coveredStarterMinutes, tierMinutesCap(coveredStarter)) : SLIDE.coveredStarterMinutes;
    const slide = 48 - covered;
    const own = Math.min(SLIDE.ownMinutes, tierMinutesCap(s.slider.player) - slide);
    slots[home][0] = { ...slots[home][0], minutes: own };
    left.set(home, 48 - own);
    slots[there][0] = { ...slots[there][0], minutes: covered };
    slots[there].push({ playerId: s.slider.player.id, minutes: slide });
    left.set(there, 0);
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
  // 2026-11-05, the user (Tucson: "Obok Luki Porter mógłby być starting 5 — Porter 30 / Luka 18,
  // Luka 18 / Cooper 30"): a listed sliding starter whose own backup is clearly better than the
  // starter beside him splits his minutes between the two spots (`QUALITY_SLIDE`), and the backup
  // takes his spot. Only when the backup plays just those two spots and nobody else backs them up.
  if (!s.slider) {
    for (const slot of STARTER_SLOTS) {
      const star = s.starters[slot];
      const there = star ? SLIDING_STARTERS[normalizePlayerName(star.playerName)] : undefined;
      if (!star || !there || there === slot) continue;
      const beside = s.starters[there];
      if (!beside || effectiveTalent(beside) >= STRUCTURE_STAR_TAL || positionCompetenceScore(star, there) < SLIDE.minScore) continue;
      const mine = s.backups.filter((b) => b.pair.includes(slot) || b.pair.includes(there));
      if (mine.length !== 1 || !mine[0].pair.every((x) => x === slot || x === there)) continue;
      const b = mine[0].player;
      const gap = effectiveTalent(b) - effectiveTalent(beside);
      if (gap < QUALITY_SHIFT.margin) continue;
      // A far better backup (`QUALITY_SLIDE.bigGap`+; West–Nash beside Wesley Person, the user: "Lepiej
      // prawda" for Nash 36 / West 12, West 24 / Person 24) moves the star over for good.
      const big = gap >= QUALITY_SLIDE.bigGap;
      const home = big ? QUALITY_SLIDE.bigHomeMinutes : QUALITY_SLIDE.starMinutesEach;
      const away = STRUCTURE.starterMinutes - home;
      slots[slot] = [
        { playerId: star.id, minutes: home },
        { playerId: b.id, minutes: 48 - home },
      ];
      slots[there] = [
        { playerId: beside.id, minutes: 48 - away },
        { playerId: star.id, minutes: away },
      ];
      break;
    }
  }
  // 2026-11-05, the user's round-3/4 notes (Detroit: "Green 30 / Porter 18"; Tucson: Porter beside
  // Luka, Cooper 30): a backup clearly better than a starter (`QUALITY_SHIFT.margin` TAL+) takes
  // `QUALITY_SHIFT.minutes` of that starter's minutes, the starter keeping `QUALITY_SHIFT.starterFloor`
  // and the backup at most `QUALITY_SHIFT.backupMax` in all. Stars (STRUCTURE_STAR_TAL+) keep theirs.
  const sliderId = s.slider?.player.id;
  const shifts = s.backups
    .flatMap((b) =>
      [...new Set(b.pair)].map((slot) => {
        const starter = s.starters[slot];
        const gap = starter ? effectiveTalent(b.player) - effectiveTalent(starter) : 0;
        return { b, slot, starter, gap };
      }),
    )
    .filter((x) => x.starter && x.starter.id !== sliderId && x.gap >= QUALITY_SHIFT.margin && effectiveTalent(x.starter) < STRUCTURE_STAR_TAL)
    .sort((a, b) => b.gap - a.gap);
  for (const { b, slot, starter } of shifts) {
    const row = slots[slot].find((r) => r.playerId === starter!.id);
    const mine = slots[slot].find((r) => r.playerId === b.player.id);
    if (!row || !mine) continue;
    const total = STARTER_SLOTS.reduce((sum, x) => sum + (slots[x].find((r) => r.playerId === b.player.id)?.minutes ?? 0), 0);
    const move = Math.min(QUALITY_SHIFT.minutes, row.minutes - QUALITY_SHIFT.starterFloor, QUALITY_SHIFT.backupMax - total);
    if (move <= 0) continue;
    row.minutes -= move;
    mine.minutes += move;
  }
  // 2026-11-05, the user (Caruso's real minutes: "można pomyśleć w tym kierunku"): a starter plays no
  // more than he did in real life plus `IRL_MINUTES.margin` (never under `IRL_MINUTES.starterFloor`);
  // the rest goes to that spot's backup while he stays within his own real minutes (or 30).
  const totalOf = (id: string) => STARTER_SLOTS.reduce((sum, x) => sum + slots[x].filter((r) => r.playerId === id).reduce((a, r) => a + r.minutes, 0), 0);
  for (const slot of STARTER_SLOTS) {
    const starter = s.starters[slot];
    const real = starter ? minutesIrl(starter) : undefined;
    if (!starter || real === undefined) continue;
    const row = slots[slot].find((r) => r.playerId === starter.id);
    const backupRow = slots[slot].find((r) => r.playerId !== starter.id);
    if (!row || !backupRow) continue;
    const cap = Math.max(IRL_MINUTES.starterFloor, Math.round(real + IRL_MINUTES.margin));
    const backup = roster.find((p) => p.id === backupRow.playerId)!;
    const backupReal = minutesIrl(backup);
    const backupCap = backupReal === undefined ? IRL_MINUTES.backupDefault : Math.max(IRL_MINUTES.backupDefault, Math.round(backupReal + IRL_MINUTES.margin));
    const move = Math.min(row.minutes - cap, backupCap - totalOf(backup.id));
    if (move <= 0) continue;
    row.minutes -= move;
    backupRow.minutes += move;
  }
  // 2026-11-05, the user ("Gracze poniżej goat i legend nie powinni grać 40 minut, poniżej all NBA 38
  // i później all star 36"): a player over his tier's cap (`TIER_MINUTES`, the card's tier) hands
  // the rest to a teammate in the same spot who still has room under his own cap.
  for (const p of roster) {
    let excess = totalOf(p.id) - tierMinutesCap(p);
    for (const slot of STARTER_SLOTS) {
      if (excess <= 0) break;
      const mine = slots[slot].find((r) => r.playerId === p.id);
      if (!mine) continue;
      for (const other of slots[slot]) {
        if (excess <= 0 || other.playerId === p.id) continue;
        const room = tierMinutesCap(roster.find((q) => q.id === other.playerId)!) - totalOf(other.playerId);
        const move = Math.min(excess, room, mine.minutes);
        if (move <= 0) continue;
        mine.minutes -= move;
        other.minutes += move;
        excess -= move;
      }
    }
  }
  // A slot no backup covers (the structure's own error says so): its starter up to his tier's
  // minutes, then whoever plays that spot best with minutes to spare (2026-11-05, the user's
  // screenshot: OG Anunoby 48 minutes at SF), the starter only as a last resort.
  for (const slot of STARTER_SLOTS) {
    let rest = left.get(slot)!;
    if (rest <= 0 || !slots[slot][0]) continue;
    const starterRow = slots[slot][0];
    const starter = roster.find((p) => p.id === starterRow.playerId)!;
    const own = Math.max(0, Math.min(rest, tierMinutesCap(starter) - totalOf(starter.id)));
    starterRow.minutes += own;
    rest -= own;
    const helpers = roster
      .filter((p) => p.id !== starter.id && positionCompetenceScore(p, slot) > 0)
      .sort((a, b) => positionCompetenceScore(b, slot) - positionCompetenceScore(a, slot));
    const roomOf = (p: PlayerSpan) => Math.min(tierMinutesCap(p), IRL_MINUTES.backupDefault) - totalOf(p.id);
    // One helper who can take it all comes first; a split never leaves a stint under
    // `IRL_MINUTES.minStint` (the user on Danny Green's 1 minute at SF: "1 minuta cmon").
    const whole = helpers.find((p) => roomOf(p) >= rest);
    for (const p of whole ? [whole] : helpers) {
      if (rest <= 0) break;
      const take = Math.min(rest, roomOf(p));
      if (take < IRL_MINUTES.minStint) continue;
      const row = slots[slot].find((r) => r.playerId === p.id);
      if (row) row.minutes += take;
      else slots[slot].push({ playerId: p.id, minutes: take });
      rest -= take;
    }
    if (rest > 0) starterRow.minutes += rest;
  }
  // 2026-11-06, the user ("nie może być czegoś takiego jak 'no one else here'": Kawhi 48 at SF; on
  // 96 CPU teams 23 spots had nobody else and 24 players ran past 42; "nie może być na dowolnego, bo
  // wyjdą głupoty"): whoever is still past his tier's minutes hands the rest, in his own spots, to a
  // teammate listed at that spot with room — or, when none has room, one listed there shifts over
  // and a teammate listed at that player's other spot takes those minutes (Bell from SG to SF, Ward
  // to SG). Nobody plays a spot he isn't listed at.
  const roomOf = (q: PlayerSpan) => tierMinutesCap(q) - totalOf(q.id);
  const addTo = (slot: Position, id: string, m: number) => {
    const row = slots[slot].find((r) => r.playerId === id);
    if (row) row.minutes += m;
    else slots[slot].push({ playerId: id, minutes: m });
  };
  for (const p of roster) {
    let excess = totalOf(p.id) - tierMinutesCap(p);
    for (const slot of STARTER_SLOTS) {
      if (excess <= 0) break;
      const mine = slots[slot].find((r) => r.playerId === p.id);
      if (!mine || mine.minutes <= 0) continue;
      const listed = roster.filter((q) => q.id !== p.id && isRealPositionFit(q, slot));
      for (const q of [...listed].sort((a, b) => roomOf(b) - roomOf(a))) {
        if (excess <= 0 || mine.minutes <= 0) break;
        const take = Math.min(excess, mine.minutes, roomOf(q));
        if (take <= 0) continue;
        addTo(slot, q.id, take);
        mine.minutes -= take;
        excess -= take;
      }
      for (const q of listed) {
        if (excess <= 0 || mine.minutes <= 0) break;
        for (const other of STARTER_SLOTS) {
          if (excess <= 0 || other === slot) continue;
          const qRow = slots[other].find((r) => r.playerId === q.id);
          if (!qRow || qRow.minutes <= 0) continue;
          for (const r of roster.filter((x) => x.id !== p.id && x.id !== q.id && isRealPositionFit(x, other)).sort((a, b) => roomOf(b) - roomOf(a))) {
            const take = Math.min(excess, mine.minutes, qRow.minutes, roomOf(r));
            if (take <= 0) continue;
            qRow.minutes -= take;
            addTo(other, r.id, take);
            addTo(slot, q.id, take);
            mine.minutes -= take;
            excess -= take;
            if (excess <= 0) break;
          }
        }
      }
    }
  }
  for (const slot of STARTER_SLOTS) slots[slot] = slots[slot].filter((r, i) => i === 0 || r.minutes > 0);
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
/**
 * Shots a role still to fill needs at least (2026-11-05: with the 55-TAL rotation floor the cheapest
 * real backup costs 4-5 FGA; a team left with 2.5 could only add glue and left C or PG uncovered).
 */
const ROLE_MIN_FGA = { starter: 6, backup: 4.5, glue: 1 };
export function canStillComplete(roster: PlayerSpan[], rosterSize: number, capLeft = Infinity): boolean {
  const s = readStructure(roster);
  const left = rosterSize - roster.length;
  const missingStarters = STARTER_SLOTS.filter((slot) => !s.starters[slot]).length;
  const openBackups = 3 - s.backups.length;
  const covered = new Set([...s.backups.flatMap((b) => b.pair), ...(s.slider ? [s.slider.covers] : [])]);
  const uncovered = STARTER_SLOTS.filter((slot) => !covered.has(slot)).length;
  const glueOpen = s.glue.length === 0 ? 1 : 0;
  if (s.glue.length > 1) return false;
  // A player with no role is the glue: one whose cheapest window at his position still costs more
  // than `STRUCTURE.glueFga` breaks the shape for good (Doc Rivers 1991-93, spacing 22, can't play
  // the point; even his 1994-96 costs 4.2).
  if (s.glue.some((g) => cheapestAt(g) > STRUCTURE.glueFga)) return false;
  if (missingStarters + openBackups + glueOpen > left) return false;
  if (missingStarters * ROLE_MIN_FGA.starter + openBackups * ROLE_MIN_FGA.backup + glueOpen * ROLE_MIN_FGA.glue > capLeft + 1e-9) return false;
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

const cheapestMemo = new Map<string, number>();
function cheapestAt(p: PlayerSpan): number {
  const k = `${normalizePlayerName(p.playerName)}|${p.primaryPosition}`;
  let v = cheapestMemo.get(k);
  if (v === undefined) {
    v = Math.min(p.fga, ...spanOptionsFor(p.playerName).filter((o) => o.primaryPosition === p.primaryPosition).map((o) => o.fga));
    cheapestMemo.set(k, v);
  }
  return v;
}
