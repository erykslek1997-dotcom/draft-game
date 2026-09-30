import { boardTargets, dailyGame, dealFor, fanVoteFive, lineupShots, slotFloor, type Lineup } from '../src/engine/bestFive';
import { allStarCount } from '../src/engine/allStarLookup';
import { DAILY_HAND_SIZE, dailyMeta, JOKERS_MAX, JOKERS_MIN, LEGEND_FIVES } from '../src/engine/dailyMeta';
import { CLEAR_FAVOURITE, expectedMargin, legendLineup, simulateLiveGame } from '../src/engine/liveGame';
import { STARTER_SLOTS } from '../src/engine/positions';

/**
 * The daily and the live game. Pins that every legend five resolves; the daily's hidden Jokers (1–3
 * a day, each a legend or a scrub at his position, at the position's middle price, never dealt by
 * `dealFor` — BestFive.tsx lays his card in the hand); that a deal always leaves a card the caps can
 * pay for, however much was spent before (the top-up, 2026-09-30); that a clear favourite always
 * wins the live game; and that its box score adds up to the final.
 */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

for (const legend of LEGEND_FIVES) check(legendLineup(legend) !== null, `${legend.short}: every player is in the pool`);

const DAYS = 8;
const start = new Date('2026-11-01T12:00:00Z');
let legendJokers = 0;
let jokerCount = 0;
for (let i = 0; i < DAYS; i++) {
  const seed = `daily:${new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10)}`;
  const meta = dailyMeta(seed);
  check(meta.order.slice().sort().join() === [...STARTER_SLOTS].sort().join(), `${seed}: the order deals every position once`);
  const game = dailyGame(seed, meta);
  const { jokers } = game;
  check(jokers.length >= JOKERS_MIN && jokers.length <= JOKERS_MAX && new Set(jokers.map((j) => j.slot)).size === jokers.length, `${seed}: ${jokers.length} Jokers, each in his own round`);
  for (const j of jokers) {
    jokerCount++;
    if (j.legend) legendJokers++;
    check(j.span.primaryPosition === j.slot && meta.order[j.round] === j.slot, `${seed}: the ${j.slot} Joker plays his round's position`);
    check(j.legend ? allStarCount(j.span.playerName) >= 6 : allStarCount(j.span.playerName) < 6, `${seed}: ${j.span.playerName} is ${j.legend ? 'a legend' : 'a scrub'}`);
    check(j.card.fga === j.price && j.card.id === j.span.id && j.place >= 0 && j.place < DAILY_HAND_SIZE, `${seed}: his card costs the flat ${j.price}`);
  }
  // Spend big: take the dearest card that still leaves the cheapest players in the game for the
  // rest; every deal must still hold a card the caps can pay for.
  const lineup: Lineup = {};
  for (const slot of meta.order) {
    const hand = dealFor(game.pool, slot, lineup, game.cap, DAILY_HAND_SIZE - (jokers.some((j) => j.slot === slot) ? 1 : 0));
    check(hand.every((c) => !jokers.some((j) => j.card.id === c.id)), `${seed}: ${slot} never deals a Joker itself`);
    const floorRest = STARTER_SLOTS.filter((s) => s !== slot && !lineup[s]).reduce((sum, s) => sum + slotFloor(s), 0);
    const affordable = hand.filter((c) => lineupShots(lineup) + c.fga + floorRest <= game.cap + 1e-9);
    check(affordable.length >= 1, `${seed}: after spending big, the ${slot} deal still has ${affordable.length} affordable card(s)`);
    lineup[slot] = [...affordable].sort((a, b) => b.fga - a.fga)[0];
  }
  check(lineupShots(lineup) <= game.cap + 1e-9, `${seed}: the big spender still ends under the cap (${lineupShots(lineup).toFixed(1)} / ${game.cap})`);
  check(dailyGame(seed, meta) === game, `${seed}: the same seed, the same game`);
}
console.log(`Jokers: ${legendJokers} legends of ${jokerCount}`);

// The live game: margin on average, box score adds up, deterministic.
const seed = 'daily:2026-11-01';
const meta = dailyMeta(seed);
const game = dailyGame(seed, meta);
const targets = boardTargets(game.pool, game.cap);
const legends = legendLineup(meta.opponent)!;
const fan = fanVoteFive(game.pool, game.cap);
const m = expectedMargin(targets.optimalFive, fan, legends);
check(m > expectedMargin(fan, fan, legends), 'the best five is a bigger favourite than the fan-vote five');
{
  // A close game is open: with no edge, the sides split about evenly and land level on average.
  let sum = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const r = simulateLiveGame(targets.optimalFive, legends, 0, `calib-0-${i}`);
    sum += r.final[0] - r.final[1];
  }
  console.log(`even game: average margin ${(sum / N).toFixed(1)}`);
  check(Math.abs(sum / N) <= 3.5, 'an even game lands about level on average');
}
for (const target of [-12, -CLEAR_FAVOURITE, CLEAR_FAVOURITE, 10]) {
  let wins = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    const r = simulateLiveGame(targets.optimalFive, legends, target, `clear-${target}-${i}`);
    if ((r.final[0] > r.final[1]) === target > 0) wins++;
  }
  check(wins === N, `a clear ${Math.abs(target)}-point favourite wins every game (${wins}/${N})`);
}
const a = simulateLiveGame(targets.optimalFive, legends, m, seed);
const b = simulateLiveGame(targets.optimalFive, legends, m, seed);
check(a.final.join() === b.final.join() && a.moments.length === b.moments.length, 'the same five on the same day plays the same game');
for (const side of [0, 1] as const) {
  const pts = Object.values(a.box[side]).reduce((sum, l) => sum + l.pts, 0);
  check(pts === a.final[side], `side ${side}: the box score adds up to the final (${pts})`);
  check(a.quarters[side].reduce((x, y) => x + y, 0) === a.final[side], `side ${side}: the quarters add up to the final`);
}
check(a.final[0] !== a.final[1], 'no ties');
