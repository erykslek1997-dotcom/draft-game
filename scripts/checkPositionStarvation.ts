/**
 * User spotted, in a live 8-team playtest, AI rosters with ZERO players eligible for a given
 * starter slot (e.g. no SG at all across 9 picks) while stacking 3 PGs instead - a different
 * failure mode than the previously-accepted "PG/C bench thinness is realistic" call. This
 * checks whether that's a systemic contention problem at higher team counts (shared pool
 * genuinely running dry for some team before its turn) or a one-off unlucky draft.
 */
import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan, Position } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { STARTER_SLOTS, ROSTER_SIZE, isPositionEligible } from '../src/engine/positions';

const TEAM_COUNTS_TO_TEST = [4, 8, 16];
const RUNS_PER_TEAM_COUNT = 15;

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

function simulateOneDraft(teamCount: number): PlayerSpan[][] {
  const teams: PlayerSpan[][] = Array.from({ length: teamCount }, () => []);
  const draftedIds = new Set<string>();

  for (let round = 0; round < ROSTER_SIZE; round++) {
    for (let pickInRound = 0; pickInRound < teamCount; pickInRound++) {
      const teamIdx = snakeOrderIndex(round, pickInRound, teamCount);
      const roster = teams[teamIdx];
      const available = players.filter((p) => !draftedIds.has(p.id));
      if (available.length === 0) continue;
      const currentFgas = roster.map((p) => p.fga);
      const pick = pickForAi(roster, currentFgas, available, teamCount);
      const key = normalizePlayerName(pick.playerName);
      for (const p of players) {
        if (normalizePlayerName(p.playerName) === key) draftedIds.add(p.id);
      }
      roster.push(pick);
    }
  }
  return teams;
}

for (const teamCount of TEAM_COUNTS_TO_TEST) {
  let totalTeams = 0;
  const zeroEligibleBySlot: Record<Position, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  const stackCounts: Record<Position, number[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };

  for (let run = 0; run < RUNS_PER_TEAM_COUNT; run++) {
    const teams = simulateOneDraft(teamCount);
    for (const roster of teams) {
      totalTeams++;
      for (const slot of STARTER_SLOTS) {
        const eligibleCount = roster.filter((p) => isPositionEligible(p, slot)).length;
        stackCounts[slot].push(eligibleCount);
        if (eligibleCount === 0) zeroEligibleBySlot[slot]++;
      }
    }
  }

  console.log(`\n=== ${teamCount} teams (${RUNS_PER_TEAM_COUNT} drafts, ${totalTeams} teams) ===`);
  for (const slot of STARTER_SLOTS) {
    const counts = stackCounts[slot];
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const max = Math.max(...counts);
    console.log(
      `${slot}: zero-eligible teams = ${zeroEligibleBySlot[slot]}/${totalTeams} (${((zeroEligibleBySlot[slot] / totalTeams) * 100).toFixed(1)}%), ` +
      `mean eligible count = ${mean.toFixed(2)}, max = ${max}`,
    );
  }
}
