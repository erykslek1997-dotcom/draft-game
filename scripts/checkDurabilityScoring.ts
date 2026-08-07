/**
 * End-to-end check that DURABILITY reaches `ScoreBreakdown` and that the minutes weighting does
 * what it claims: the same fragile player should cost far less in a small bench role than as a
 * 36-minute starter.
 */
import { players } from '../src/data/players';
import { scoreTeam, durabilityScore } from '../src/engine/scoring';
import { computeDurability, durabilityBreakdown } from '../src/engine/durability';
import { autoAssignRotation, totalMinutesForPlayer } from '../src/engine/rotation';
import type { Team } from '../src/engine/types';
import type { PlayerSpan } from '../src/data/schema';

function pick(name: string): PlayerSpan {
  const spans = players.filter((p) => p.playerName === name);
  if (!spans.length) throw new Error(`missing ${name}`);
  return spans.reduce((a, b) => (computeDurability(b) > computeDurability(a) ? b : a));
}
function worst(name: string): PlayerSpan {
  const spans = players.filter((p) => p.playerName === name);
  if (!spans.length) throw new Error(`missing ${name}`);
  return spans.reduce((a, b) => (computeDurability(b) < computeDurability(a) ? b : a));
}

function makeTeam(roster: PlayerSpan[]): Team {
  const team: Team = { id: 't', name: 'Test', draftSlot: 1, isHuman: true, roster, rotation: null };
  team.rotation = autoAssignRotation(roster);
  return team;
}

const IRON = ['John Stockton', 'Karl Malone', 'A.C. Green', 'Michael Jordan', 'Wilt Chamberlain',
  'Jason Kidd', 'Bill Russell', 'Robert Horry', 'Shane Battier'];
const ironTeam = makeTeam(IRON.map(pick));
const fragileTeam = makeTeam(['Bill Walton', 'Kyrie Irving', 'Yao Ming', 'Anthony Davis',
  'Vince Carter', 'Brandon Roy', 'Grant Hill', 'Blake Griffin', 'Kawhi Leonard'].map(worst));

for (const [label, team] of [['iron roster', ironTeam], ['fragile roster', fragileTeam]] as const) {
  const b = scoreTeam(team);
  console.log(`\n=== ${label} ===`);
  console.log(`  overall=${b.overall} talent=${b.talentScore} spacing=${b.spacingScore} DURABILITY=${b.durabilityScore} fit=${b.fitScore}`);
  for (const p of team.roster) {
    const d = durabilityBreakdown(p);
    console.log(`    ${p.playerName.padEnd(22)} ${p.spanLabel.padEnd(9)} avail=${d.availability?.toFixed(1).padStart(5)} DUR=${String(computeDurability(p)).padStart(3)} ${d.tier}`);
  }
}
const iron = scoreTeam(ironTeam);
const frag = scoreTeam(fragileTeam);
console.log(`\ndurabilityScore separation: ${iron.durabilityScore} vs ${frag.durabilityScore} (gap ${iron.durabilityScore - frag.durabilityScore})`);
console.log(`overall unaffected by durability (informational only): iron ${iron.overall}, fragile ${frag.overall}`);
console.log(`  -> recompute of overall from its parts: ${Math.round(iron.talentScore * 0.4 + iron.fitScore * 0.45 + iron.rotationScore * 0.15)} (matches ${iron.overall}: ${Math.round(iron.talentScore * 0.4 + iron.fitScore * 0.45 + iron.rotationScore * 0.15) === iron.overall})`);

// Minutes weighting, tested by hand-building the rotation. Draft order can't be used for this:
// `autoAssignRotation` assigns by position and talent, so a lone center keeps 36 minutes no matter
// when he was picked. Two centers, same nine players, only their minutes swapped.
const walton = worst('Bill Walton'); // DUR 4
const wallace = pick('Ben Wallace'); // durable C
const rest = ['A.C. Green', 'Robert Horry', 'Shane Battier', 'Bruce Bowen', 'P.J. Tucker',
  'Danny Green', 'Raja Bell'].map(pick);
const roster = [walton, wallace, ...rest];

function teamWithCenterMinutes(waltonMinutes: number): Team {
  const team = makeTeam(roster);
  const slots = team.rotation!.slots;
  slots.C = [
    { playerId: walton.id, minutes: waltonMinutes },
    { playerId: wallace.id, minutes: 48 - waltonMinutes },
  ];
  return team;
}
const heavy = teamWithCenterMinutes(40);
const light = teamWithCenterMinutes(8);
console.log(`\n=== minutes weighting (Bill Walton DUR ${computeDurability(walton)}, Ben Wallace DUR ${computeDurability(wallace)}) ===`);
console.log(`  Walton ${totalMinutesForPlayer(heavy.rotation, walton.id)} min -> team durabilityScore ${durabilityScore(heavy)}`);
console.log(`  Walton ${totalMinutesForPlayer(light.rotation, walton.id)} min -> team durabilityScore ${durabilityScore(light)}`);
console.log(
  durabilityScore(light) > durabilityScore(heavy)
    ? `  weighting ACTIVE — burying the fragile center gains ${durabilityScore(light) - durabilityScore(heavy)} points`
    : '  FAIL — minutes are not weighting the score',
);
