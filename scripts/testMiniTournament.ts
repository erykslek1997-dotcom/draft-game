import { createQuickDraft, autoFinishQuickDraft, finalizeQuickRotation } from '../src/engine/quickDraft';
import { scoreLineup, type Lineup } from '../src/engine/bestFive';
import { simulateMiniTournament, playMiniGame, MINI_ROUNDS } from '../src/engine/miniTournament';
import type { Position } from '../src/data/schema';

/** The Mini tournament: 16 teams, 15 games, one champion, every game replays the same. */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}
let upsets = 0;
let games = 0;
let oneSeedTitles = 0;
const RUNS = 6;
for (let run = 0; run < RUNS; run++) {
  const state = autoFinishQuickDraft(createQuickDraft(undefined, 1000 + run));
  const seeded = state.teams
    .map((t) => {
      const f = finalizeQuickRotation(t);
      const lineup: Lineup = {};
      for (const [slot, a] of Object.entries(f.rotation!.slots) as [Position, { playerId: string }[]][]) lineup[slot] = f.roster.find((p) => p.id === a[0]?.playerId);
      return { team: f, score: scoreLineup(lineup).composite };
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.team);
  const t = simulateMiniTournament(seeded, String(state.seed));
  check(t.rounds.map((r) => r.length).join() === '8,4,2,1', `run ${run}: 8, 4, 2, 1 games in ${MINI_ROUNDS.length} rounds`);
  const all = t.rounds.flat();
  check(all.every((g) => g.final[0] !== g.final[1]), `run ${run}: no ties`);
  const replay = playMiniGame(seeded, t.rounds[3][0])!;
  check(replay.final.join() === t.rounds[3][0].final.join(), `run ${run}: the final replays the same`);
  for (const g of all) {
    games++;
    if (g.winnerId !== g.teamAId) upsets++;
  }
  if (t.championId === t.seeds[0]) oneSeedTitles++;
  console.log(`  champion #${t.seeds.indexOf(t.championId) + 1}`);
}
console.log(`upsets ${upsets}/${games}, 1 seed won ${oneSeedTitles}/${RUNS}`);
check(upsets > 0 && upsets < games / 2, 'upsets happen, but less than half the time');
