import { boardTargets, dailyGame, dealFor, fanVoteFive, type Lineup } from '../src/engine/bestFive';
import { dailyMeta, jokerPriceAt, LEGEND_FIVES } from '../src/engine/dailyMeta';
import { expectedMargin, legendLineup, simulateLiveGame } from '../src/engine/liveGame';
import { STARTER_SLOTS } from '../src/engine/positions';

/**
 * Daily Slot Machine 2.0 (2026-09-28): the Joker, the daily position order and the live game
 * against the opponent of the day. Pins that every legend five resolves, the Joker never comes in
 * the first two positions and is never dealt (since Draw Five he sits on the table at a dropping
 * price), the live game lands on the model's margin on average, and its box score always adds up to
 * the final.
 */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

for (const legend of LEGEND_FIVES) check(legendLineup(legend) !== null, `${legend.short}: every player is in the pool`);

const DAYS = 8;
const start = new Date('2026-11-01T12:00:00Z');
let worth = 0;
for (let i = 0; i < DAYS; i++) {
  const seed = `daily:${new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10)}`;
  const meta = dailyMeta(seed);
  check(meta.order.slice().sort().join() === [...STARTER_SLOTS].sort().join(), `${seed}: the order deals every position once`);
  check(meta.order.indexOf(meta.jokerSlot) >= 2, `${seed}: the Joker is not in the first two positions`);
  const game = dailyGame(seed, meta);
  check(game.joker !== null, `${seed}: there is a Joker`);
  const joker = game.joker!;
  if (joker.worth) worth++;
  check(joker.availableUntil <= joker.round && (meta.jokerLeavesAfter === null || joker.availableUntil === Math.min(meta.jokerLeavesAfter, joker.round)), `${seed}: the Joker is on the table until round ${joker.availableUntil + 1}`);
  check(joker.bestPrice <= joker.span.fga && joker.bestPrice === jokerPriceAt(joker.span.fga, joker.availableUntil, joker.round), `${seed}: best price ${joker.bestPrice} (full ${joker.span.fga})`);
  const targets = boardTargets(game.pool, game.cap);
  check(joker.worth === (targets.optimalFive[joker.slot].id === joker.span.id), `${seed}: "worth it" matches whether the best five takes him`);
  // Follow the best five in the day's order.
  const lineup: Lineup = {};
  for (const slot of meta.order) {
    const hand = dealFor(game.pool, slot, lineup, game.cap);
    check(hand.length === 4 && hand.every((c) => c.id !== joker.span.id), `${seed}: ${slot} deals four, never the Joker (he sits on the table)`);
    lineup[slot] = targets.optimalFive[slot];
  }
  check(dailyGame(seed, meta) === game, `${seed}: the same seed, the same game`);
}
console.log(`Joker worth it on ${worth}/${DAYS} days`);

// The live game: margin on average, box score adds up, deterministic.
const seed = 'daily:2026-11-01';
const meta = dailyMeta(seed);
const game = dailyGame(seed, meta);
const targets = boardTargets(game.pool, game.cap);
const legends = legendLineup(meta.opponent)!;
const fan = fanVoteFive(game.pool, game.cap);
const m = expectedMargin(targets.optimalFive, fan, legends);
check(m > expectedMargin(fan, fan, legends), 'the best five is a bigger favourite than the fan-vote five');
for (const target of [-12, 0, 10]) {
  let sum = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const r = simulateLiveGame(targets.optimalFive, legends, target, `calib-${target}-${i}`);
    sum += r.final[0] - r.final[1];
  }
  const avg = sum / N;
  console.log(`target ${target}: average margin ${avg.toFixed(1)}`);
  // The tilt is one constant for every pair of fives, so how far a blowout lands varies a little
  // with who's playing; within 3.5 points of the model is the bar.
  check(Math.abs(avg - target) <= 3.5, `a ${target}-point favourite wins by about ${target} on average`);
}
const a = simulateLiveGame(targets.optimalFive, legends, m, seed, game.joker?.span.id);
const b = simulateLiveGame(targets.optimalFive, legends, m, seed, game.joker?.span.id);
check(a.final.join() === b.final.join() && a.moments.length === b.moments.length, 'the same five on the same day plays the same game');
for (const side of [0, 1] as const) {
  const pts = Object.values(a.box[side]).reduce((sum, l) => sum + l.pts, 0);
  check(pts === a.final[side], `side ${side}: the box score adds up to the final (${pts})`);
  check(a.quarters[side].reduce((x, y) => x + y, 0) === a.final[side], `side ${side}: the quarters add up to the final`);
}
check(a.final[0] !== a.final[1], 'no ties');
