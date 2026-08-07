import { players } from '../src/data/players';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

function findAll(ids: string[]) {
  return ids.map((id) => {
    const p = players.find((pl) => pl.id === id);
    if (!p) throw new Error(`missing ${id}`);
    return p;
  });
}

// Redundant team (still cap-legal!): 4 high-usage starters at PG/SG/SF/PF, no spacing among starters.
const redundantRoster = findAll([
  'morant-19-20', // PG, Slasher (high-usage)
  'harden-12-14', // SG, Shot Creator (high-usage)
  'pippen-94-96', // SF, Shot Creator (high-usage)
  'barkley-87-89', // PF, Slasher (high-usage)
  'gobert-16-18', // C, rim protector filler
  'allen-t-14-16',
  'green-18-20',
  'korver-16-18',
  'rodman-95-97',
]);

// Balanced team (cap-legal): one primary creator, spacing, rim protection, perimeter defense.
const balancedRoster = findAll([
  'cp3-08-10', // PG, primary ball handler / point of attack
  'klay-14-16', // SG, movement shooter, wing stopper
  'kawhi-15-17', // SF, slasher/shot creator, wing stopper
  'giannis-17-19', // PF, slasher, helper
  'gobert-16-18', // C, rim protector
  'korver-13-15', // stationary shooter, cheap FGA
  'green-13-15', // 3&D wing, cheap FGA
  'allen-t-14-16', // cheap perimeter defense depth
  'draymond-18-20', // helper big, cheap FGA
]);

function buildTeam(name: string, roster: ReturnType<typeof findAll>): Team {
  return { id: name, name, isHuman: false, roster, rotation: autoAssignRotation(roster) };
}

const redundant = buildTeam('Redundant (5 ball-dominant scorers)', redundantRoster);
const balanced = buildTeam('Balanced (fit-first)', balancedRoster);

for (const team of [redundant, balanced]) {
  const totalFga = team.roster.reduce((s, p) => s + p.fga, 0);
  const breakdown = scoreTeam(team);
  console.log(`\n=== ${team.name} === total FGA: ${totalFga.toFixed(1)}`);
  console.log(
    'Starters:',
    primaryStarters(team).map((s) => `${s.slot}: ${s.player.playerName} (${s.minutes}min)`),
  );
  console.log(breakdown);
}
