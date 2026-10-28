import { dailyGame } from '../src/engine/bestFive';
import { dailyMeta } from '../src/engine/dailyMeta';
import { effectiveTalent } from '../src/engine/grades';

/**
 * Daily Jokers over 1000 days (TODO, the Joker bug: Magic 1987-89 cost 14.3 face up under a 14.4
 * Joker). Every legend has talent 75+ and costs at least 3 caps more face up than the Joker's flat
 * price; every scrub costs less face up than the price. Also counts days that dealt fewer Jokers
 * than planned (a round with no fitting player) and how often a Joker is a legend.
 */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const DAYS = 1000;
const start = new Date('2026-10-01T12:00:00Z');
let jokers = 0;
let legends = 0;
let badLegend = 0;
let badScrub = 0;
let noJoker = 0;
for (let i = 0; i < DAYS; i++) {
  const key = new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10);
  const game = dailyGame(key, dailyMeta(key));
  if (game.jokers.length === 0) noJoker++;
  for (const j of game.jokers) {
    jokers++;
    if (j.legend) {
      legends++;
      if (effectiveTalent(j.span) < 75 || j.span.fga < j.price + 3) {
        badLegend++;
        console.log(`  ${key} legend ${j.span.playerName} ${j.span.spanLabel}: TAL ${effectiveTalent(j.span).toFixed(0)}, ${j.span.fga} face up vs ${j.price}`);
      }
    } else if (j.span.fga >= j.price) {
      badScrub++;
      console.log(`  ${key} scrub ${j.span.playerName} ${j.span.spanLabel}: ${j.span.fga} face up vs ${j.price}`);
    }
  }
}
console.log(`${jokers} Jokers in ${DAYS} days, ${legends} legends (${((100 * legends) / jokers).toFixed(1)}%), ${noJoker} days with none`);
check(badLegend === 0, 'every legend Joker has talent 75+ and costs 3+ caps more face up');
check(badScrub === 0, 'every scrub Joker is cheaper face up than the Joker');
check(noJoker === 0, 'every day deals at least one Joker');
check(legends / jokers > 0.4 && legends / jokers < 0.6, 'legends are about half of the Jokers');
