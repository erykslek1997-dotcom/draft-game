/**
 * Validates the AI drafting behavior (including the new RAPM-calibrated position-correction
 * in computeTalent) at team counts beyond the real game's fixed 4 — the production DraftState
 * (src/engine/draft.ts) hardcodes 4 teams via createInitialTeams(), so this script builds its
 * own lightweight N-team snake draft loop, calling pickForAi/canFillFromLookup's teamCount
 * parameter directly instead. Every team is AI-controlled (there's no "human" team to fill in
 * for at team counts the real UI doesn't support), so this measures the AI's own drafting
 * quality/safety, not human-vs-AI dynamics.
 */
import { activeDraftPool as players } from '../src/engine/draft';
import type { PlayerSpan, Position } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation } from '../src/engine/rotation';
import { CAP_LIMIT, ROSTER_SIZE, STARTER_SLOTS, isPositionEligible } from '../src/engine/positions';

const TEAM_COUNTS_TO_TEST = [4, 8, 12, 16];
const RUNS_PER_TEAM_COUNT = 10;

interface SimTeam {
  roster: PlayerSpan[];
}

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

function simulateOneDraft(teamCount: number): { teams: SimTeam[]; stuck: boolean } {
  const teams: SimTeam[] = Array.from({ length: teamCount }, () => ({ roster: [] }));
  const draftedIds = new Set<string>();
  let stuck = false;

  for (let round = 0; round < ROSTER_SIZE; round++) {
    for (let pickInRound = 0; pickInRound < teamCount; pickInRound++) {
      const teamIdx = snakeOrderIndex(round, pickInRound, teamCount);
      const team = teams[teamIdx];
      const available = players.filter((p) => !draftedIds.has(p.id));
      if (available.length === 0) {
        stuck = true;
        continue;
      }
      const currentFgas = team.roster.map((p) => p.fga);
      const pick = pickForAi(team.roster, currentFgas, available, teamCount);
      // Mirrors makePick's dedup: every span of the same real player leaves the pool together.
      const key = normalizePlayerName(pick.playerName);
      for (const p of players) {
        if (normalizePlayerName(p.playerName) === key) draftedIds.add(p.id);
      }
      team.roster.push(pick);
    }
  }

  return { teams, stuck };
}

for (const teamCount of TEAM_COUNTS_TO_TEST) {
  let overCapTeams = 0;
  let totalTeams = 0;
  let maxOverage = 0;
  const overageSamples: number[] = [];
  let stuckDrafts = 0;

  let totalBackupAssignments = 0;
  let offPositionBackups = 0;

  const talentScoresByTeam: number[] = [];
  const posCounts: Record<Position, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };

  for (let run = 0; run < RUNS_PER_TEAM_COUNT; run++) {
    const { teams, stuck } = simulateOneDraft(teamCount);
    if (stuck) stuckDrafts++;

    for (const team of teams) {
      totalTeams++;
      const totalFga = team.roster.reduce((sum, p) => sum + p.fga, 0);
      const overage = totalFga - CAP_LIMIT;
      if (overage > 0) {
        overCapTeams++;
        overageSamples.push(overage);
        maxOverage = Math.max(maxOverage, overage);
      }

      const totalTalent = team.roster.reduce((sum, p) => sum + computeTalent(p), 0);
      talentScoresByTeam.push(totalTalent / team.roster.length);

      const { slots } = autoAssignRotation(team.roster);
      for (const slot of STARTER_SLOTS) {
        for (const a of slots[slot].slice(1)) {
          const player = team.roster.find((p) => p.id === a.playerId)!;
          totalBackupAssignments++;
          if (!isPositionEligible(player, slot)) offPositionBackups++;
        }
        const primary = slots[slot][0];
        if (primary) {
          const player = team.roster.find((p) => p.id === primary.playerId);
          if (player && isPositionEligible(player, slot)) posCounts[slot]++;
        }
      }
    }
  }

  const meanTalent = talentScoresByTeam.reduce((s, x) => s + x, 0) / talentScoresByTeam.length;
  const variance = talentScoresByTeam.reduce((s, x) => s + (x - meanTalent) ** 2, 0) / talentScoresByTeam.length;
  const stdDev = Math.sqrt(variance);

  console.log(`\n=== ${teamCount} teams (${RUNS_PER_TEAM_COUNT} drafts, ${totalTeams} teams total) ===`);
  console.log(`Stuck/dead-end drafts: ${stuckDrafts}`);
  console.log(`Teams over cap: ${overCapTeams} / ${totalTeams} (${((overCapTeams / totalTeams) * 100).toFixed(1)}%)`);
  console.log(`Max overage: ${maxOverage.toFixed(1)} FGA | Mean overage (when over): ${(overageSamples.reduce((a, b) => a + b, 0) / (overageSamples.length || 1)).toFixed(1)} FGA`);
  console.log(`Off-position backup assignments: ${offPositionBackups} / ${totalBackupAssignments} (${((offPositionBackups / totalBackupAssignments) * 100).toFixed(1)}%)`);
  console.log(`Avg per-team talent (mean of per-player avg): ${meanTalent.toFixed(1)}, stdDev across teams: ${stdDev.toFixed(2)} (lower = more balanced/competitive teams)`);
  console.log(`Filled starter slots by position (out of ${totalTeams} teams x 1 each): ${STARTER_SLOTS.map((s) => `${s}=${posCounts[s]}`).join(', ')}`);
}
