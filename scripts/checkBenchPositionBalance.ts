/**
 * 2026-08-18, user-reported pattern across ~7 real drafted rosters — benches repeatedly ended up
 * all-guard (zero real SF/PF/C) or all-big (2+ redundant same-position bigs), leaving a starter's
 * real backup minutes going to an off-position player. Measures final-roster `thinSlots` (real-
 * fit-minutes-covers-the-game, same definition `assessNeeds`/`scoring.ts` use) across many
 * simulated 16-team AI-only drafts to quantify how often each position ends the draft still thin.
 *
 * Root cause found (`pickForAi`, bench-round lottery narrowing): only PG had a hard guarantee
 * (narrow the lottery pool to real fits once thin) — SF/PF/C relied purely on the additive `need`
 * bonus, which a higher-raw-talent guard in the same lottery pool could and did outscore. Fixed by
 * generalizing that narrowing to every starter slot. Baseline (pre-fix, 64 teams): PG 0.0% thin,
 * SG 10.9%, SF 26.6%, PF 34.4%, C 31.3%. After: PG 0.0%, SG 3.1%, SF 14.1%, PF 25.0%, C 15.6% —
 * roughly halved across the board, no new severe-backup regression (checkBenchAbsurdities.ts
 * stayed within its existing 2-9% run-to-run noise band). Kept as a permanent, manually-run
 * regression alongside checkBenchAbsurdities.ts — re-run after any future change to the bench-
 * round need/lottery logic. Usage: `npx tsx scripts/checkBenchPositionBalance.ts [runs=4]`.
 */
import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan, Position } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi, assessNeeds } from '../src/engine/aiDrafter';
import { ROSTER_SIZE, STARTER_SLOTS } from '../src/engine/positions';

const TEAM_COUNT = 16;
const RUNS = Number(process.argv[2] ?? 4);

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

const thinCount: Record<Position, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
const emptyCount: Record<Position, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
let totalTeams = 0;

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
    totalTeams++;
    const needs = assessNeeds(roster);
    for (const slot of STARTER_SLOTS) {
      if (needs.emptySlots.includes(slot)) emptyCount[slot]++;
      else if (needs.thinSlots.includes(slot)) thinCount[slot]++;
    }
  }
}

console.log(`teams=${totalTeams}`);
for (const slot of STARTER_SLOTS) {
  console.log(
    `${slot}: thin=${thinCount[slot]} (${((thinCount[slot] / totalTeams) * 100).toFixed(1)}%)  empty=${emptyCount[slot]} (${((emptyCount[slot] / totalTeams) * 100).toFixed(1)}%)`,
  );
}
