import { slotFloor, DEAL_SIZE, POOL_PER_SLOT, dailyBoard, dealFor, dealHint, isChalkBoard, lineupShots, boardTargets, talMaxLineup, teaserFor, type Lineup } from '../src/engine/bestFive';
import type { PlayerSpan, Position } from '../src/data/schema';
import { STARTER_SLOTS } from '../src/engine/positions';

/**
 * Daily Deal board selection (2026-09-27): before it, 65% of daily boards were chalk (the five
 * biggest names, trimmed to the cap, within 3 points of the engine's best). Pins that the chosen
 * boards stay mostly non-chalk, deterministic per seed, and solvable under their cap.
 */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const DAYS = 20;
const start = new Date('2026-10-01T12:00:00Z');
let chalk = 0;
for (let i = 0; i < DAYS; i++) {
  const key = new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10);
  const board = dailyBoard(key);
  if (i === 0) {
    const again = dailyBoard(`${key}`);
    check(STARTER_SLOTS.every((s) => again.pool.bySlot[s].map((p) => p.id).join() === board.pool.bySlot[s].map((p) => p.id).join()) && again.cap === board.cap, 'the same seed deals the same board');
  }
  check(STARTER_SLOTS.every((s) => board.pool.bySlot[s].length === POOL_PER_SLOT), `${key}: ${POOL_PER_SLOT} players in every slot`);
  check(lineupShots(talMaxLineup(board.pool, board.cap)) <= board.cap, `${key}: the lazy pick can be trimmed under the cap`);
  check(STARTER_SLOTS.every((s) => teaserFor(board.pool, s) !== undefined), `${key}: every position has a star to show face up`);
  check(STARTER_SLOTS.every((s) => board.pool.bySlot[s].every((p) => board.pool.roles[p.id] !== undefined)), `${key}: every dealt card has a role`);
  if (isChalkBoard(boardTargets(board.pool, board.cap))) chalk++;
}
check(chalk <= 2, `at most 2 of ${DAYS} daily boards are chalk (got ${chalk})`);

/**
 * 2026-09-28, the reactive deal: each position shows DEAL_SIZE of its POOL_PER_SLOT cards, dealt for
 * the five so far. Along random paths through 20 boards: the star is always dealt, at least two
 * cards always fit the caps left, the five always completes under the cap, the best five is never
 * worse than the fan-vote five, and there is no hint before the first pick. Same picks, same deal.
 */
let seenChalk = 0;
let paths = 0;
for (let i = 0; i < DAYS; i++) {
  const key = new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10);
  const { pool, cap } = dailyBoard(key);
  for (let path = 0; path < 4; path++) {
    let r = (i * 7 + path * 13 + 1) % 97;
    const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
    const lineup: Lineup = {};
    const deals: Partial<Record<Position, PlayerSpan[]>> = {};
    for (const slot of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
      const hand = dealFor(pool, slot, lineup, cap);
      deals[slot] = hand;
      const again = dealFor(pool, slot, { ...lineup }, cap);
      if (hand.map((c) => c.id).join() !== again.map((c) => c.id).join()) throw new Error(`FAIL: ${key}: the same picks deal the same ${slot}`);
      if (hand.length !== DEAL_SIZE) throw new Error(`FAIL: ${key}: ${slot} deals ${hand.length} cards`);
      const star = pool.bySlot[slot].find((c) => pool.roles[c.id] === 'star');
      if (star && !hand.includes(star)) throw new Error(`FAIL: ${key}: ${slot} deal is missing its star`);
      const hint = dealHint(pool, slot, lineup, cap);
      if (hint && lineup.PG === undefined) throw new Error(`FAIL: ${key}: a hint before any pick`);
      const openAfter = (['PG', 'SG', 'SF', 'PF', 'C'] as Position[]).filter((s) => s !== slot && !lineup[s]);
      // 2026-09-30: what the open positions must still cost is their cheapest player in the whole
      // game (`slotFloor`) — the deal tops up from outside the board when it has to.
      const room = cap - lineupShots(lineup) - openAfter.reduce((sum, s) => sum + slotFloor(s), 0);
      const affordable = hand.filter((c) => c.fga <= room + 1e-9);
      if (affordable.length < 2) throw new Error(`FAIL: ${key}: ${slot} deal has ${affordable.length} affordable cards`);
      lineup[slot] = affordable[Math.floor(rnd() * affordable.length)];
    }
    if (lineupShots(lineup) > cap + 1e-9) throw new Error(`FAIL: ${key}: a path finished over the cap`);
    const targets = boardTargets(pool, cap);

    if (targets.optimal + 1e-9 < targets.par) throw new Error(`FAIL: ${key}: the seen board's best five is below its fan-vote five`);
    if (isChalkBoard(targets)) seenChalk++;
    paths++;
  }
}
// The path that follows the best five sees every card of it.
for (let i = 0; i < DAYS; i++) {
  const key = new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10);
  const { pool, cap } = dailyBoard(key);
  const best = boardTargets(pool, cap).optimalFive;
  const lineup: Lineup = {};
  for (const slot of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
    if (!dealFor(pool, slot, lineup, cap).includes(best[slot])) throw new Error(`FAIL: ${key}: the best five's ${slot} is not dealt on its own path`);
    lineup[slot] = best[slot];
  }
}
check(true, `${DAYS} boards: the best five is dealt, card by card, to a player who follows it`);
check(true, `${paths} random paths: stars always dealt, two affordable cards every deal, every five completes under the cap`);
console.log(`(info) boards that are chalk against the path-independent targets: ${seenChalk} of ${paths}`);
console.log('Daily Deal tests complete.');
