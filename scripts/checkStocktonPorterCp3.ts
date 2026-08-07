import { draftPool as players } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';

const TEAM_COUNT = 16;
const RUNS = 25;

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

const TRACK_NAMES = ['John Stockton', 'Magic Johnson', 'Chris Paul', 'Steve Nash', 'Terry Porter'];
const trackKeys = new Set(TRACK_NAMES.map(normalizePlayerName));
const pickNumbersByName = new Map<string, number[]>();
for (const n of TRACK_NAMES) pickNumbersByName.set(n, []);

for (let run = 0; run < RUNS; run++) {
  const teams: (typeof players)[number][][] = Array.from({ length: TEAM_COUNT }, () => []);
  const draftedIds = new Set<string>();
  let overallPick = 0;
  for (let round = 0; round < 9; round++) {
    for (let pickInRound = 0; pickInRound < TEAM_COUNT; pickInRound++) {
      overallPick++;
      const teamIdx = snakeOrderIndex(round, pickInRound, TEAM_COUNT);
      const roster = teams[teamIdx];
      const available = players.filter((p) => !draftedIds.has(p.id));
      if (available.length === 0) continue;
      const currentFgas = roster.map((p) => p.fga);
      const pick = pickForAi(roster, currentFgas, available, TEAM_COUNT);
      const key = normalizePlayerName(pick.playerName);
      for (const p of players) {
        if (normalizePlayerName(p.playerName) === key) draftedIds.add(p.id);
      }
      roster.push(pick);
      if (trackKeys.has(key)) {
        const canonical = TRACK_NAMES.find((n) => normalizePlayerName(n) === key)!;
        pickNumbersByName.get(canonical)!.push(overallPick);
      }
    }
  }
}

for (const n of TRACK_NAMES) {
  const picks = pickNumbersByName.get(n)!;
  if (picks.length === 0) { console.log(`${n}: never drafted in ${RUNS} runs`); continue; }
  const avg = picks.reduce((s, v) => s + v, 0) / picks.length;
  console.log(`${n.padEnd(16)} n=${picks.length}/${RUNS} avg pick=${avg.toFixed(1)} range=[${Math.min(...picks)}-${Math.max(...picks)}]`);
}
