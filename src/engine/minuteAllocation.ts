import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, positionFitMultiplier } from './positions';
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
  for (let pass = 0; pass < MAX_CONSOLIDATION_PASSES; pass++) {
    const fragment = smallestFragment(best.grants, homeById, kept);
    if (!fragment) break;
    const key = `${fragment.playerId}|${fragment.slot}`;
    forbidden.add(key);
    const trial = solveMinutes(roster, starterBySlot, gameMinutes, maxMinutesPerPlayer, forbidden);
    if (
      trial.filled === best.filled &&
      trial.cost - best.cost <= FRAGMENT_VALUE_TOLERANCE * UNIT &&
      overLimit(trial.grants) <= overLimit(best.grants)
    ) {
      best = trial;
    } else {
      forbidden.delete(key);
      kept.add(key);
    }
  }
  return best.grants;
}

function smallestFragment(grants: MinuteGrant[], homeById: Map<string, Position>, kept: Set<string>): MinuteGrant | undefined {
  const slotCount = new Map<string, number>();
  for (const g of grants) slotCount.set(g.playerId, (slotCount.get(g.playerId) ?? 0) + 1);
  const candidates = grants.filter((g) => {
    if (homeById.get(g.playerId) === g.slot || kept.has(`${g.playerId}|${g.slot}`)) return false;
    return g.minutes < MIN_STINT_MINUTES || (slotCount.get(g.playerId) ?? 0) > MAX_SLOTS_PER_PLAYER;
  });
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

  roster.forEach((player, i) => {
    const profile = minuteProfileForSpan(player);
    const durability = Math.min(maxSustainableMinutes(player, maxMinutesPerPlayer), maxMinutesPerPlayer);
    // An odd limit fills to the next 2-minute unit (`MINUTES_CAP_TOLERANCE`, one minute over).
    const ceiling = Math.min(profile.ceiling, durability);
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
      [Math.min(ceiling, Math.max(optimal, HEAVY_LOAD_MINUTES)), talent * PAST_OPTIMAL_TALENT_SHARE],
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
        const core = Math.floor(Math.min(STARTER_CORE_MINUTES, ceiling) / UNIT);
        flow.add(playerNode(i), slotNode(j), core, -(value + OWN_SLOT_BONUS + STARTER_CORE_BONUS) * UNIT);
        flow.add(playerNode(i), slotNode(j), slotUnits, -(value + OWN_SLOT_BONUS) * UNIT);
      } else {
        flow.add(playerNode(i), slotNode(j), slotUnits, -value * UNIT);
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
