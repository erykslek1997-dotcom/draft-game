import { boardTargets, dailyGame } from '../src/engine/bestFive';
import { dailyMeta } from '../src/engine/dailyMeta';
import { gameCalls, sayPlay } from '../src/engine/gameCalls';
import { legendLineup, simulateLiveGame } from '../src/engine/liveGame';

/**
 * The live game's commentator (gameCalls.ts): the same game says the same lines, never more than
 * two after one play, often enough to be heard and not so often it drowns the plays; every name it
 * says played in the game; and a reworded play keeps its player, its passer and its rebounder.
 */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const seed = 'daily:2026-11-01';
const meta = dailyMeta(seed);
const daily = dailyGame(seed, meta);
const five = boardTargets(daily.pool, daily.cap).optimalFive;
const legends = legendLineup(meta.opponent)!;
const N = 30;
let lines = 0;
let plays = 0;
let crowded = 0;
let strangers = 0;
let reworded = 0;
let broken = 0;
for (let i = 0; i < N; i++) {
  const game = simulateLiveGame(five, legends, (i % 5) * 3 - 6, `calls-${i}`);
  const short: [string, string] = ['You', 'Legends'];
  const calls = gameCalls(game, short);
  if (i === 0) check(JSON.stringify(gameCalls(game, short)) === JSON.stringify(calls), 'the same game, the same lines');
  lines += calls.length;
  plays += game.moments.filter((m) => m.play && !m.play.quiet).length;
  const per = new Map<number, number>();
  for (const c of calls) per.set(c.at, (per.get(c.at) ?? 0) + 1);
  crowded += [...per.values()].filter((v) => v > 2).length;
  const names = new Set([...game.labels[0], ...game.labels[1]]);
  for (const c of calls) {
    const said = /^(?:(?:Double|Triple)-double for (.+?):|(.+?) has )/.exec(c.text);
    const who = said?.[1] ?? said?.[2];
    if (who && !names.has(who) && !short.includes(who)) strangers++;
  }
  game.moments.forEach((m, at) => {
    if (!m.play) return;
    const label = game.labels[m.play.side].find((l) => m.play!.text.startsWith(`${l} `));
    if (!label) return;
    const said = sayPlay(m.play.text, label, at);
    if (said !== m.play.text) reworded++;
    const tail = (t: string) => /(\(.+ assist\)|— .+ (?:offensive )?rebound)$/.exec(t)?.[1] ?? '';
    if (!said.startsWith(`${label} `) || tail(said) !== tail(m.play.text)) broken++;
  });
}
const share = lines / plays;
console.log(`commentator: ${(lines / N).toFixed(1)} lines a game, one per ${(1 / share).toFixed(1)} plays; ${reworded} plays reworded`);
check(crowded === 0, 'never more than two lines after one play');
check(share > 0.04 && share < 0.2, `heard but not drowning the plays (${(100 * share).toFixed(1)}% of plays)`);
check(strangers === 0, 'every player named played in the game');
check(reworded > 0 && broken === 0, 'a reworded play keeps its player, passer and rebounder');
