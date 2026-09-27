import { POOL_PER_SLOT, dailyBoard, dailyTargets, isChalkBoard, lineupShots, rumorFor, talMaxLineup, teaserFor } from '../src/engine/bestFive';
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
  const rumors = STARTER_SLOTS.slice(1).map((s) => rumorFor(board.pool, s));
  check(rumors.every((r) => r && r.text.length > 20), `${key}: every later position has a rumor`);
  check(rumors.filter((r) => r?.bait).length <= 2, `${key}: at most two rumors are bait`);
  if (isChalkBoard(dailyTargets(board.pool, board.cap))) chalk++;
}
check(chalk <= 2, `at most 2 of ${DAYS} daily boards are chalk (got ${chalk})`);
console.log('Daily Deal tests complete.');
