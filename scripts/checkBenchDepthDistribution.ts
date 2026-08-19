import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { ROSTER_SIZE } from '../src/engine/positions';

const TEAM_COUNT = 16;
const RUNS = Number(process.argv[2] ?? 4);
const TOP_CORE_SIZE = 5;

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

const bottomAverages: number[] = [];

for (let run = 0; run < RUNS; run++) {
  const teams: PlayerSpan[][] = Array.from({ length: TEAM_COUNT }, () => []);
  const draftedIds = new Set<string>();
  for (let round = 0; round < ROSTER_SIZE; round++) {
    for (let pickInRound = 0; pickInRound < TEAM_COUNT; pickInRound++) {
      const teamIdx = snakeOrderIndex(round, pickInRound, TEAM_COUNT);
      const roster = teams[teamIdx];
      const available = players.filter((p) => !draftedIds.has(p.id));
      if (available.length === 0) continue;
      const currentFgas = roster.map((p) => p.fga);
      const pick = pickForAi(roster, currentFgas, available, TEAM_COUNT);
      const key = normalizePlayerName(pick.playerName);
      for (const p of players) if (normalizePlayerName(p.playerName) === key) draftedIds.add(p.id);
      roster.push(pick);
    }
  }
  for (const roster of teams) {
    const tals = roster.map((p) => computeTalent(p)).sort((a, b) => b - a);
    const depth = tals.slice(TOP_CORE_SIZE);
    if (depth.length === 0) continue;
    bottomAverages.push(depth.reduce((s, t) => s + t, 0) / depth.length);
  }
}

bottomAverages.sort((a, b) => a - b);
const pct = (p: number) => bottomAverages[Math.floor((bottomAverages.length - 1) * p)];
console.log(`ROSTER_SIZE=${ROSTER_SIZE}, teams=${bottomAverages.length}`);
console.log('bottom-N-avg TAL: min=' + bottomAverages[0], 'p10=' + pct(0.1), 'p50=' + pct(0.5), 'p90=' + pct(0.9), 'max=' + bottomAverages[bottomAverages.length - 1]);
