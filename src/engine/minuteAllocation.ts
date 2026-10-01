import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, positionFitMultiplier } from './positions';
import { effectiveTalent } from './grades';
import { maxSustainableMinutes } from './durability';
import { minuteProfileForSpan } from './rotationRoleMinutes';

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
      [durability, PAST_CEILING_COST],
      [maxMinutesPerPlayer, PAST_DURABILITY_COST],
    ];
    let reached = 0;
    for (const [upTo, cost] of pieces) {
      if (upTo <= reached) continue;
      flow.add(source, playerNode(i), Math.floor(upTo / UNIT) - Math.floor(reached / UNIT), cost * UNIT);
      reached = upTo;
    }
    STARTER_SLOTS.forEach((slot, j) => {
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
  flow.run(source, sink, slotUnits * STARTER_SLOTS.length);

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
  return grants;
}
