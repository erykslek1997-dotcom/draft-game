import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, positionFitMultiplier } from './positions';
import { positionCompetenceScore } from './positionCompetence';
import { effectiveTalent } from './grades';
import { maxSustainableMinutes } from './durability';
import { minuteProfileForSpan, MINUTES_CAP_TOLERANCE, OVERRUN_BANDS } from './rotationRoleMinutes';

/**
 * 2026-09-30, engine calibration session 2 (the user: "z takimi fuckapami jak w 2 to ciężko
 * cokolwiek wnioskować" — Rudy Gobert at SF, Toni Kukoč 42 minutes on a 34-minute body, Jared
 * Dudley 40 minutes at PF while Dikembe Mutombo sat on 12, a Cigarette Butt on the floor while
 * Towns had minutes to give). The old backup fill solved one slot at a time, greedily, and four
 * later repair passes moved minutes around after the fact — the passes are what broke the caps.
 *
 * This solves all five slots at once as a transportation problem (min-cost flow): every slot needs
 * its 48 minutes, every player supplies minutes up to his own limits, and a minute of player p at
 * slot s is worth his TAL x how well he plays that slot. Each player's supply is split into pieces
 * with their own price, so the solver fills in this order of preference:
 *  - a tier's minimum (All-star and up: 24/32 minutes) — met whenever the roster allows;
 *  - a useful bench stint (12 minutes, a real backup shift) for any real bench player;
 *  - minutes up to the tier's optimal load;
 *  - minutes past the optimal load, up to the tier ceiling and the durability limit — a clear
 *    discount, so a star doesn't play 40 while a fine backup sits;
 *  - past the tier ceiling (durability still respected) — only when nothing else can cover;
 *  - past durability — never, unless the slot would otherwise go short.
 * A slot two positions away (a centre at SF) costs so much it's used only when no one else is
 * left. Starters keep their own slot first: their first minutes there carry a large bonus, the rest
 * a small one — strong enough to hold the slot, never strong enough to break a cap for it.
 */

const UNIT = 2;
const EMERGENCY_FIT_COST = 400;
const TIER_FLOOR_BONUS = 200;
const USEFUL_BENCH_MINUTES = 12;
const USEFUL_BENCH_TALENT_FLOOR = 55;
const USEFUL_BENCH_BONUS = 25;
const PAST_OPTIMAL_TALENT_SHARE = 0.5;
const PAST_OPTIMAL_FLAT_COST = 12;
/** 2026-09-30, the user ("prawie każdy dostaje 40 minut, psuje immersje"): past `HEAVY_LOAD_MINUTES`
 * a minute costs almost its whole value — a star plays 39-40 only when the bench truly can't cover. */
const HEAVY_LOAD_MINUTES = 38;
const HEAVY_LOAD_TALENT_SHARE = 0.9;
const PAST_CEILING_COST = 150;
const OVERRUN_FREE_TALENT_SHARE = 0.95;
const OVERRUN_NOTICEABLE_TALENT_SHARE = 1.3;
const OVERRUN_HEAVY_TALENT_SHARE = 1.8;
const PAST_DURABILITY_COST = 2000;
/** A guard or wing playing the four or five (small-ball) — the same cost the rotation score charges. */
const SMALL_BALL_VALUE_SHARE = 0.9;
/** A forced star at the neighbouring position (a centre at the four) plays it at this share. */
const FORCED_HOME_SLOT_SHARE = 0.75; // = rotation.ts FORCED_STAR_SLOT_FIT
/** A starter's first `STARTER_CORE_MINUTES` at his own slot are worth `STARTER_CORE_BONUS` more a
 * minute; every minute there `OWN_SLOT_BONUS` more — enough to keep him home unless a gap elsewhere
 * needs him (Jordan sliding to SF so Kidd can cover SG, instead of a centre playing the wing). */
const STARTER_CORE_MINUTES = 24;
const STARTER_CORE_BONUS = 60;
const OWN_SLOT_BONUS = 12;

/**
 * 2026-10-02: past the stretch the share now drops 0.6 / 0.35 / 0.2 (the user: "twardszy limit").
 * 2026-10-01, the user ("skalowalne do minut?", "bramki zamykające", then "traktuję to bardziej
 * jako rozbicie minut na innej pozycji niż start na niej"): the competence score
 * (positionCompetence.ts) is read as how many minutes a game a player can cover at a position
 * that isn't his own, interpolated between the agreed anchors: 0.25 → 2, 0.4 → 6, 0.6 → 12,
 * 0.75 → 20 and 0.9 (a real second position, a starter there) → the whole game.
 * Those minutes keep their value; past them it drops fast (`OFF_POSITION_DROP`, two minutes per
 * step) to `OFF_POSITION_FLOOR_SHARE`, so he goes past his stretch only when nobody fits better.
 */
const GAME_SLOT_MINUTES = 48;
const OFF_POSITION_MINUTE_ANCHORS: Array<[number, number]> = [
  [0, 0],
  [0.25, 2],
  [0.4, 6],
  [0.6, 12],
  [0.75, 20],
  [0.9, GAME_SLOT_MINUTES],
];
const OFF_POSITION_DROP = [0.6, 0.35, 0.2];
/** A must-start star forced to a neighbouring slot he can't play covers it like a 0.4 fit (6 minutes). */
const FORCED_CLOSED_SLOT_SCORE = 0.4;
const OFF_POSITION_FLOOR_SHARE = 0.2;
/** 2026-10-02, the user (Collison at SF, Sabonis at SF): a big out of position costs the team the
 * same whoever he is, so every minute past his stretch also carries a flat cost, not only a share of
 * his own (small, for a bench player) value. */
const OFF_POSITION_EXCESS_COST = 30;
export const BENCH_MINUTES_CAP = 28;
export const SIXTH_MAN_MINUTES_CAP = 32;

export function offPositionMinutes(score: number): number {
  let minutes = GAME_SLOT_MINUTES;
  for (let i = 1; i < OFF_POSITION_MINUTE_ANCHORS.length; i++) {
    const [s1, m1] = OFF_POSITION_MINUTE_ANCHORS[i];
    if (score <= s1) {
      const [s0, m0] = OFF_POSITION_MINUTE_ANCHORS[i - 1];
      minutes = m0 + ((m1 - m0) * (score - s0)) / (s1 - s0);
      break;
    }
  }
  return Math.floor(minutes / UNIT) * UNIT;
}

function offPositionCurve(score: number): Array<[number, number]> {
  if (score >= 1) return [[GAME_SLOT_MINUTES, 1]];
  let reached = offPositionMinutes(score);
  const curve: Array<[number, number]> = reached > 0 ? [[reached, 1]] : [];
  for (const share of OFF_POSITION_DROP) {
    reached += UNIT;
    if (reached >= GAME_SLOT_MINUTES) break;
    curve.push([reached, share]);
  }
  curve.push([GAME_SLOT_MINUTES, OFF_POSITION_FLOOR_SHARE]);
  return curve;
}

interface Arc {
  to: number;
  cap: number;
  initial: number;
  cost: number;
  rev: number;
}

class MinCostFlow {
  graph: Arc[][];
  constructor(n: number) {
    this.graph = Array.from({ length: n }, () => []);
  }
  add(from: number, to: number, cap: number, cost: number): void {
    if (cap <= 0) return;
    this.graph[from].push({ to, cap, initial: cap, cost, rev: this.graph[to].length });
    this.graph[to].push({ to: from, cap: 0, initial: 0, cost: -cost, rev: this.graph[from].length - 1 });
  }
  /** Successive shortest paths (Bellman-Ford / SPFA — costs can be negative, the graph is tiny). */
  run(source: number, sink: number, maxFlow: number): number {
    let flow = 0;
    const n = this.graph.length;
    while (flow < maxFlow) {
      const dist = new Array<number>(n).fill(Infinity);
      const inQueue = new Array<boolean>(n).fill(false);
      const prevNode = new Array<number>(n).fill(-1);
      const prevArc = new Array<number>(n).fill(-1);
      dist[source] = 0;
      const queue = [source];
      inQueue[source] = true;
      while (queue.length > 0) {
        const u = queue.shift()!;
        inQueue[u] = false;
        this.graph[u].forEach((arc, i) => {
          if (arc.cap > 0 && dist[u] + arc.cost < dist[arc.to] - 1e-9) {
            dist[arc.to] = dist[u] + arc.cost;
            prevNode[arc.to] = u;
            prevArc[arc.to] = i;
            if (!inQueue[arc.to]) {
              queue.push(arc.to);
              inQueue[arc.to] = true;
            }
          }
        });
      }
      if (dist[sink] === Infinity) break;
      let push = maxFlow - flow;
      for (let v = sink; v !== source; v = prevNode[v]) push = Math.min(push, this.graph[prevNode[v]][prevArc[v]].cap);
      for (let v = sink; v !== source; v = prevNode[v]) {
        const arc = this.graph[prevNode[v]][prevArc[v]];
        arc.cap -= push;
        this.graph[v][arc.rev].cap += push;
      }
      flow += push;
    }
    return flow;
  }
}

function isBig(position: Position): boolean {
  return position === 'PF' || position === 'C';
}

/** Value of one minute of `player` at `slot`, before the per-piece prices. */
function minuteValue(player: PlayerSpan, slot: Position, homeSlot?: Position): number {
  const fit = positionFitMultiplier(player, slot);
  // A must-start star placed next to his position (rotation.ts `forceStarsIntoLineup`) plays it.
  if (fit <= 0 && slot === homeSlot) return effectiveTalent(player) * FORCED_HOME_SLOT_SHARE;
  if (fit <= 0) return -EMERGENCY_FIT_COST;
  const smallBall = isBig(slot) && !isBig(player.primaryPosition) ? SMALL_BALL_VALUE_SHARE : 1;
  return effectiveTalent(player) * fit * smallBall;
}

export interface MinuteGrant {
  playerId: string;
  slot: Position;
  minutes: number;
}

/**
 * Allocates every slot's 48 minutes over the whole roster at once. A starter's first
 * `STARTER_CORE_MINUTES` at his own slot carry `STARTER_CORE_BONUS` on top of the home-slot bonus,
 * so he keeps his slot unless the rest of the roster truly needs those minutes moved.
 */
export function allocateMinutes(
  roster: PlayerSpan[],
  starterBySlot: Partial<Record<Position, PlayerSpan>>,
  gameMinutes: number,
  maxMinutesPerPlayer: number,
): MinuteGrant[] {
  return consolidateRotation(roster, starterBySlot, gameMinutes, maxMinutesPerPlayer);
}

/**
 * 2026-10-01, the user on two AI rotations ("LeBron rozjebany na 4 pozycjach wygląda brzydko", and
 * a Kansas City SF column of Iguodala 38 / Green 4 / Bonga 4 / Eddie Jones 2): the flow has no
 * notion of a player changing position, so a player who fits several slots equally well is spread
 * across all of them in arbitrary shares. A fragment is any stint under `MIN_STINT_MINUTES`, or the
 * smallest away-from-home stint of a player already in more than `MAX_SLOTS_PER_PLAYER` slots. The
 * smallest fragment is forbidden and the whole allocation re-solved; the change is kept when the
 * rotation's value drops by at most `FRAGMENT_VALUE_TOLERANCE`, otherwise that stint stays (it is
 * genuinely needed: nobody else can cover those minutes). A starter's own slot is never forbidden.
 */
const MIN_STINT_MINUTES = 6;
const MAX_SLOTS_PER_PLAYER = 2;
// 2026-10-01: 120 -> 200 once star minutes followed real playoff minutes (players in 3+ slots
// 33 -> 22 on 3,200 AI teams).
const FRAGMENT_VALUE_TOLERANCE = 200;
const MAX_CONSOLIDATION_PASSES = 10;
/** Removing a sub-6-minute stint may push the roster up to this many minutes further past its
 * limits — the soft cap's "barely felt" band (rotationRoleMinutes.ts). */
const TINY_STINT_OVERRUN_ALLOWANCE = 4;

function consolidateRotation(
  roster: PlayerSpan[],
  starterBySlot: Partial<Record<Position, PlayerSpan>>,
  gameMinutes: number,
  maxMinutesPerPlayer: number,
): MinuteGrant[] {
  const homeById = new Map<string, Position>();
  for (const slot of STARTER_SLOTS) {
    const starter = starterBySlot[slot];
    if (starter) homeById.set(starter.id, slot);
  }
  const forbidden = new Set<string>();
  const kept = new Set<string>();
  // Consolidation never pushes anyone further past his tier ceiling or durability.
  const limitById = new Map(
    roster.map((p) => [p.id, Math.min(minuteProfileForSpan(p).ceiling + MINUTES_CAP_TOLERANCE, maxSustainableMinutes(p, maxMinutesPerPlayer), maxMinutesPerPlayer)]),
  );
  const overLimit = (grants: MinuteGrant[]) => {
    const total = new Map<string, number>();
    for (const g of grants) total.set(g.playerId, (total.get(g.playerId) ?? 0) + g.minutes);
    let over = 0;
    for (const [id, minutes] of total) over += Math.max(0, minutes - (limitById.get(id) ?? Infinity));
    return over;
  };
  let best = solveMinutes(roster, starterBySlot, gameMinutes, maxMinutesPerPlayer, forbidden);
  const byId = new Map(roster.map((p) => [p.id, p]));
  for (let pass = 0; pass < MAX_CONSOLIDATION_PASSES; pass++) {
    const fragment = smallestFragment(best.grants, homeById, kept, byId);
    if (!fragment) break;
    // 2026-10-02, the user (Cliff Robinson at SF/PF/C: the smallest stint, SF, was dropped and Nick
    // Collison covered SF instead of centre): a player in too many slots tries dropping each of his
    // away slots, and the best re-solve wins.
    // 2026-10-02, the user (Bryon Russell 12 minutes, Ryan Bowen 16): a crowded slot tries dropping
    // each of its backups, not just the smallest stint, so the weakest one goes.
    const options = fragment.overSlots
      ? best.grants
          .filter((g) => g.playerId === fragment.playerId && homeById.get(g.playerId) !== g.slot && !kept.has(`${g.playerId}|${g.slot}`))
          .map((g) => `${g.playerId}|${g.slot}`)
      : fragment.crowded
        ? best.grants
            .filter((g) => g.slot === fragment.slot && homeById.get(g.playerId) !== g.slot && !kept.has(`${g.playerId}|${g.slot}`))
            .map((g) => `${g.playerId}|${g.slot}`)
        : [`${fragment.playerId}|${fragment.slot}`];
    let chosen: { key: string; trial: ReturnType<typeof solveMinutes> } | null = null;
    for (const key of options) {
      forbidden.add(key);
      const trial = solveMinutes(roster, starterBySlot, gameMinutes, maxMinutesPerPlayer, forbidden);
      forbidden.delete(key);
      // A stint under `MIN_STINT_MINUTES` goes whenever the slots still fill without anyone pushed
      // further past his limit — the user prefers a logical rotation to a few points of value.
      const tiny = fragment.minutes < MIN_STINT_MINUTES;
      const acceptable =
        trial.filled === best.filled &&
        (tiny || trial.cost - best.cost <= FRAGMENT_VALUE_TOLERANCE * UNIT) &&
        overLimit(trial.grants) <= overLimit(best.grants) + (tiny ? TINY_STINT_OVERRUN_ALLOWANCE : 0);
      if (acceptable && (!chosen || trial.cost < chosen.trial.cost)) chosen = { key, trial };
    }
    if (chosen) {
      forbidden.add(chosen.key);
      best = chosen.trial;
    } else {
      for (const key of options) kept.add(key);
    }
  }
  // 2026-10-02, the user (Duncan 23 at centre while Robert Williams plays 25 there; Westbrook split
  // between the guard spots while Caruso plays 31): a starter leads his own slot. When a backup outplays
  // him there because the starter's minutes went to another slot, that away stint is dropped (the best
  // re-solve wins) as long as the roster still fills within the soft-cap band.
  const leadOverlap = new Set<string>();
  for (let pass = 0; pass < MAX_CONSOLIDATION_PASSES; pass++) {
    const minutesAt = (id: string, slot: Position) => best.grants.find((g) => g.playerId === id && g.slot === slot)?.minutes ?? 0;
    const offender = STARTER_SLOTS.map((slot) => ({ slot, starter: starterBySlot[slot] }))
      .filter(({ slot, starter }) => {
        if (!starter || leadOverlap.has(starter.id)) return false;
        const own = minutesAt(starter.id, slot);
        const away = best.grants.some((g) => g.playerId === starter.id && g.slot !== slot && g.minutes > 0);
        return away && best.grants.some((g) => g.slot === slot && g.playerId !== starter.id && g.minutes > own);
      })[0];
    if (!offender) break;
    const starterId = offender.starter!.id;
    let chosen: ReturnType<typeof solveMinutes> | null = null;
    let chosenKey = '';
    for (const g of best.grants.filter((x) => x.playerId === starterId && x.slot !== offender.slot && x.minutes > 0)) {
      const key = `${g.playerId}|${g.slot}`;
      forbidden.add(key);
      const trial = solveMinutes(roster, starterBySlot, gameMinutes, maxMinutesPerPlayer, forbidden);
      forbidden.delete(key);
      const acceptable = trial.filled === best.filled && overLimit(trial.grants) <= overLimit(best.grants) + TINY_STINT_OVERRUN_ALLOWANCE;
      if (acceptable && (!chosen || trial.cost < chosen.cost)) {
        chosen = trial;
        chosenKey = key;
      }
    }
    if (chosen) {
      forbidden.add(chosenKey);
      best = chosen;
    } else {
      leadOverlap.add(starterId);
    }
  }
  return best.grants;
}

/**
 * 2026-10-02, the user: a third position is fine only when every stint is a real one (8+ minutes at
 * a position he can really play, competence 0.6+); one backup per slot where possible (a slot's
 * second backup under `SECOND_BACKUP_MIN_MINUTES` is a fragment).
 */
const THIRD_SLOT_MIN_MINUTES = 8;
const THIRD_SLOT_MIN_SCORE = 0.6;
const SECOND_BACKUP_MIN_MINUTES = 10;

function smallestFragment(
  grants: MinuteGrant[],
  homeById: Map<string, Position>,
  kept: Set<string>,
  byId: Map<string, PlayerSpan>,
): (MinuteGrant & { overSlots: boolean; crowded: boolean }) | undefined {
  const byPlayer = new Map<string, MinuteGrant[]>();
  for (const g of grants) byPlayer.set(g.playerId, [...(byPlayer.get(g.playerId) ?? []), g]);
  const tooManySlots = (id: string) => {
    const own = byPlayer.get(id) ?? [];
    if (own.length <= MAX_SLOTS_PER_PLAYER) return false;
    if (own.length > MAX_SLOTS_PER_PLAYER + 1) return true;
    const player = byId.get(id);
    return own.some(
      (g) =>
        g.minutes < THIRD_SLOT_MIN_MINUTES ||
        (player !== undefined && homeById.get(id) !== g.slot && positionCompetenceScore(player, g.slot) < THIRD_SLOT_MIN_SCORE),
    );
  };
  const secondBackup = new Set<MinuteGrant>();
  for (const slot of STARTER_SLOTS) {
    const backups = grants.filter((g) => g.slot === slot && homeById.get(g.playerId) !== slot).sort((a, b) => a.minutes - b.minutes);
    if (backups.length >= 2 && backups[0].minutes < SECOND_BACKUP_MIN_MINUTES) secondBackup.add(backups[0]);
  }
  const candidates = grants
    .filter((g) => homeById.get(g.playerId) !== g.slot && !kept.has(`${g.playerId}|${g.slot}`))
    .map((g) => {
      const original = grants.find((x) => x.playerId === g.playerId && x.slot === g.slot)!;
      return { ...g, overSlots: tooManySlots(g.playerId), crowded: secondBackup.has(original) };
    })
    .filter((g) => g.minutes < MIN_STINT_MINUTES || g.overSlots || g.crowded);
  return candidates.sort((a, b) => a.minutes - b.minutes)[0];
}

function solveMinutes(
  roster: PlayerSpan[],
  starterBySlot: Partial<Record<Position, PlayerSpan>>,
  gameMinutes: number,
  maxMinutesPerPlayer: number,
  forbidden: Set<string>,
): { grants: MinuteGrant[]; cost: number; filled: number } {
  const starterSlotById = new Map<string, Position>();
  for (const slot of STARTER_SLOTS) {
    const starter = starterBySlot[slot];
    if (starter) starterSlotById.set(starter.id, slot);
  }

  // Nodes: source, one per player, one per slot, sink.
  const source = 0;
  const playerNode = (i: number) => 1 + i;
  const slotNode = (j: number) => 1 + roster.length + j;
  const sink = 1 + roster.length + STARTER_SLOTS.length;
  const flow = new MinCostFlow(sink + 1);
  const slotUnits = Math.floor(gameMinutes / UNIT);

  // 2026-10-02, the user (Cliff Robinson's 34 bench minutes "dziwnie wygląda"): a bench player plays
  // at most `BENCH_MINUTES_CAP`, the sixth man (the best bench player) `SIXTH_MAN_MINUTES_CAP`,
  // whatever his tier would allow a starter.
  const sixthManId = roster
    .filter((p) => !starterSlotById.has(p.id))
    .sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0]?.id;

  roster.forEach((player, i) => {
    const profile = minuteProfileForSpan(player);
    const benchCap = starterSlotById.has(player.id) ? Infinity : player.id === sixthManId ? SIXTH_MAN_MINUTES_CAP : BENCH_MINUTES_CAP;
    // The bench cap is firm: past it plus the near-free tolerance a minute costs like one past
    // durability.
    const durability = Math.min(maxSustainableMinutes(player, maxMinutesPerPlayer), maxMinutesPerPlayer, benchCap + MINUTES_CAP_TOLERANCE);
    // An odd limit fills to the next 2-minute unit (`MINUTES_CAP_TOLERANCE`, one minute over).
    const ceiling = Math.min(profile.ceiling, durability, benchCap);
    const talent = effectiveTalent(player);
    const homeSlot = starterSlotById.get(player.id);
    const usefulBench = !homeSlot && player.fga >= 2 && talent >= USEFUL_BENCH_TALENT_FLOOR ? Math.min(USEFUL_BENCH_MINUTES, ceiling) : 0;
    // 2026-09-30, session 4 (the user, on Dwight Howard 24 / Hassan Whiteside 24 and Mourning 24 /
    // Ben Wallace 24): a tier's minimum is a starter's guarantee. A bench All-star has no other slot
    // to take it from, so on the bench it only bought him the starter's own minutes.
    const floor = homeSlot ? Math.min(profile.minimal ?? 0, ceiling) : 0;
    const optimal = Math.min(Math.max(profile.optimal, floor, usefulBench), ceiling);
    // Pieces of this player's supply, cheapest first.
    const pieces: Array<[upTo: number, cost: number]> = [
      [floor, -TIER_FLOOR_BONUS],
      [usefulBench, -USEFUL_BENCH_BONUS],
      [optimal, 0],
      // 2026-10-02, the user (Matisse Thybulle 24 minutes, Ryan Bowen 16): past his optimal minutes a
      // player also pays a flat cost, so a weak bench player's extra minutes are no longer cheap just
      // because his share of a low TAL is small.
      [Math.min(ceiling, Math.max(optimal, HEAVY_LOAD_MINUTES)), talent * PAST_OPTIMAL_TALENT_SHARE + PAST_OPTIMAL_FLAT_COST],
      [ceiling, talent * HEAVY_LOAD_TALENT_SHARE],
      // 2026-10-01, the user: the minutes limit is soft, its overrun priced in three rising bands
      // (`OVERRUN_BANDS`, rotationRoleMinutes.ts) — a minute or two past it costs barely more than a
      // heavy-load minute, three to four is felt, beyond that it is the old past-ceiling price.
      [Math.min(durability, ceiling + OVERRUN_BANDS.freeUpTo), talent * OVERRUN_FREE_TALENT_SHARE],
      [Math.min(durability, ceiling + OVERRUN_BANDS.noticeableUpTo), talent * OVERRUN_NOTICEABLE_TALENT_SHARE],
      [durability, Math.max(PAST_CEILING_COST, talent * OVERRUN_HEAVY_TALENT_SHARE)],
      [maxMinutesPerPlayer, PAST_DURABILITY_COST],
    ];
    let reached = 0;
    for (const [upTo, cost] of pieces) {
      if (upTo <= reached) continue;
      flow.add(source, playerNode(i), Math.floor(upTo / UNIT) - Math.floor(reached / UNIT), cost * UNIT);
      reached = upTo;
    }
    STARTER_SLOTS.forEach((slot, j) => {
      if (forbidden.has(`${player.id}|${slot}`)) return;
      const value = minuteValue(player, slot, homeSlot);
      if (slot === homeSlot) {
        // 2026-10-02, the user (option a: a must-start centre beside another one, started at a
        // four he can't play): a starter off his own position keeps that slot only for the minutes
        // his competence covers there (`offPositionMinutes`; a forced, closed slot counts as
        // `FORCED_CLOSED_SLOT_SCORE`), then fades like any off-position stretch and plays the rest
        // at his own position.
        const offPosition = slot !== player.primaryPosition;
        const score = offPosition ? positionCompetenceScore(player, slot) || FORCED_CLOSED_SLOT_SCORE : 1;
        const limit = offPosition ? offPositionMinutes(score) : GAME_SLOT_MINUTES;
        const core = Math.floor(Math.min(STARTER_CORE_MINUTES, ceiling, limit) / UNIT);
        flow.add(playerNode(i), slotNode(j), core, -(value + OWN_SLOT_BONUS + STARTER_CORE_BONUS) * UNIT);
        if (!offPosition || limit >= GAME_SLOT_MINUTES) {
          flow.add(playerNode(i), slotNode(j), slotUnits, -(value + OWN_SLOT_BONUS) * UNIT);
        } else {
          let reached = core * UNIT;
          // A forced, closed slot is not his position: past his stretch there it is worth nothing,
          // so he stays only for the minutes nobody else covers better (the user kept those).
          const curve: Array<[number, number]> = positionCompetenceScore(player, slot) > 0 ? offPositionCurve(score) : [[GAME_SLOT_MINUTES, 0]];
          for (const [upTo, share] of curve) {
            const units = Math.floor(Math.min(upTo, GAME_SLOT_MINUTES) / UNIT) - Math.floor(reached / UNIT);
            if (units > 0) flow.add(playerNode(i), slotNode(j), units, -(value + OWN_SLOT_BONUS) * share * UNIT);
            reached = Math.max(reached, upTo);
          }
        }
      } else if (value <= 0) {
        flow.add(playerNode(i), slotNode(j), slotUnits, -value * UNIT);
      } else {
        // Off his own position a player's value fades with the minutes he spends there
        // (`offPositionCurve`): a short stretch is nearly free, a whole game is not.
        const curve = offPositionCurve(positionCompetenceScore(player, slot));
        let reached = 0;
        for (const [upTo, share] of curve) {
          const units = Math.floor(Math.min(upTo, GAME_SLOT_MINUTES) / UNIT) - Math.floor(reached / UNIT);
          if (units > 0) flow.add(playerNode(i), slotNode(j), units, (-value * share + (share < 1 ? OFF_POSITION_EXCESS_COST : 0)) * UNIT);
          reached = upTo;
        }
      }
    });
  });
  STARTER_SLOTS.forEach((_, j) => flow.add(slotNode(j), sink, slotUnits, 0));
  const filled = flow.run(source, sink, slotUnits * STARTER_SLOTS.length);
  let cost = 0;
  for (const arcs of flow.graph) for (const arc of arcs) if (arc.initial > 0) cost += (arc.initial - arc.cap) * arc.cost;

  const grants: MinuteGrant[] = [];
  roster.forEach((player, i) => {
    for (const arc of flow.graph[playerNode(i)]) {
      const j = arc.to - (1 + roster.length);
      if (j < 0 || j >= STARTER_SLOTS.length) continue;
      const assigned = arc.initial - arc.cap;
      if (assigned <= 0) continue;
      const slot = STARTER_SLOTS[j];
      const existing = grants.find((g) => g.playerId === player.id && g.slot === slot);
      if (existing) existing.minutes += assigned * UNIT;
      else grants.push({ playerId: player.id, slot, minutes: assigned * UNIT });
    }
  });
  return { grants, cost, filled };
}
