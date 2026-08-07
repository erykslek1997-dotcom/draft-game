/**
 * Live-playtest-reported bench/backup problems (2026-08-07): "Jon Barry / Pablo Prigioni still
 * in starting 5", "Thybulle backup PG", "Ed Nealy SF" — starters look much better post rotation-
 * aware drafting, but bench assignment still reads as broken. Simulates real 16-team AI-only
 * drafts and flags two distinct failure shapes for direct inspection:
 *   (a) a low-TAL "cap glue" player winning a STARTER slot via `bestPrimaryAssignment` over
 *       teammates who could have played there.
 *   (b) a backup assigned 2+ real positions away from their primary (`positionDistance >= 2`,
 *       only reachable via the true last-resort tier).
 */
import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { ROSTER_SIZE, STARTER_SLOTS, positionDistance, isRealPositionFit } from '../src/engine/positions';

const TEAM_COUNT = 16;
const RUNS = Number(process.argv[2] ?? 3);
const LOW_TAL_STARTER_THRESHOLD = 55;

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

let weakStarterCount = 0;
let severeBackupCount = 0;
let totalStarters = 0;
let totalBackups = 0;
let teamsWithWeakStarter = 0;
let teamsWithSevereBackup = 0;
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

  for (const [teamIdx, roster] of teams.entries()) {
    totalTeams++;
    let teamHasWeakStarter = false;
    let teamHasSevereBackup = false;
    const rotation = autoAssignRotation(roster);
    const starters = primaryStarters({ id: 't', name: 'x', draftSlot: 1, isHuman: false, roster, rotation });
    for (const { slot, player } of starters) {
      totalStarters++;
      const tal = computeTalent(player);
      if (tal < LOW_TAL_STARTER_THRESHOLD) {
        weakStarterCount++;
        teamHasWeakStarter = true;
        // Was there a real-fit teammate available who could have started here instead, with
        // higher talent? If not, this isn't a bug — the roster genuinely lacked anyone better.
        const betterRealFitAlternative = roster.find(
          (p) => p.id !== player.id && isRealPositionFit(p, slot) && computeTalent(p) > tal,
        );
        console.log(
          `[WEAK STARTER] run${run} team${teamIdx} ${slot}: ${player.playerName} (${player.spanLabel}, real pos ${player.primaryPosition}) TAL=${tal}` +
            (betterRealFitAlternative
              ? ` -- BETTER REAL-FIT AVAILABLE: ${betterRealFitAlternative.playerName} TAL=${computeTalent(betterRealFitAlternative)}`
              : ' -- no better real-fit teammate existed (roster genuinely lacked depth here)'),
        );
      }
    }

    for (const slot of STARTER_SLOTS) {
      // BUG FIX (this script only): `totalMinutesForPlayer` sums a player's minutes across
      // EVERY slot, not this one specifically — using it here misattributed every starter's own
      // minutes as "backup minutes" at every OTHER slot too (e.g. a center starting 36 min at C
      // was wrongly flagged as a 36-minute PG/SG/SF/PF "backup" as well). Real per-slot minutes
      // come from `rotation.slots[slot]` directly.
      const entriesHere = rotation.slots[slot];
      for (const entry of entriesHere) {
        if (entry.minutes <= 0) continue;
        const isStarterHere = starters.some((s) => s.slot === slot && s.player.id === entry.playerId);
        if (isStarterHere) continue;
        const p = roster.find((r) => r.id === entry.playerId);
        if (!p) continue;
        const dist = positionDistance(p.primaryPosition, slot);
        if (dist >= 2 && p.secondaryPositions.length === 0) {
          totalBackups++;
          severeBackupCount++;
          teamHasSevereBackup = true;
          console.log(
            `[SEVERE BACKUP] run${run} team${teamIdx} ${slot} backup: ${p.playerName} (${p.spanLabel}, real pos ${p.primaryPosition}, secondaries=[${p.secondaryPositions.join(',')}]) minutes=${entry.minutes}`,
          );
        } else if (dist >= 1) {
          totalBackups++;
        }
      }
    }
    if (teamHasWeakStarter) teamsWithWeakStarter++;
    if (teamHasSevereBackup) teamsWithSevereBackup++;
  }
  console.log(`-- run ${run + 1}/${RUNS} done --`);
}

console.log(`\n=== Summary over ${RUNS} runs (${totalTeams} teams) ===`);
console.log(`Weak (TAL<${LOW_TAL_STARTER_THRESHOLD}) starters: ${weakStarterCount}/${totalStarters} slots (${((weakStarterCount / totalStarters) * 100).toFixed(1)}%)`);
console.log(`Teams with >=1 weak starter: ${teamsWithWeakStarter}/${totalTeams} (${((teamsWithWeakStarter / totalTeams) * 100).toFixed(1)}%)`);
console.log(`Severe (2+ position, no secondary) backups: ${severeBackupCount} (of ${totalBackups} off-position-ish backups)`);
console.log(`Teams with >=1 severe backup: ${teamsWithSevereBackup}/${totalTeams} (${((teamsWithSevereBackup / totalTeams) * 100).toFixed(1)}%)`);
