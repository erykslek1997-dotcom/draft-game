/**
 * 2026-09-30, engine calibration session 1 (TODO.md, Etap 1): the eight real rosters the user
 * judged from a live draft, rebuilt from each player's peak window (re-optimized under the cap and
 * given the auto rotation, as the game does) and scored as one league. `--check` asserts the
 * user's verdicts, so a later change can't quietly undo them.
 *
 *   npx tsx scripts/calibrationReference.ts [--full] [--check]
 */
import { spanOptionsFor, optimizeSpans } from '../src/engine/spanOptimizer';
import { effectiveTalent, displayTalentForSpan } from '../src/engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../src/engine/sixthMan';
import type { PlayerSpan } from '../src/data/schema';
import { autoAssignRotation } from '../src/engine/rotation';
import { rankTeams, offenseScoreBreakdown } from '../src/engine/scoring';
import { exportLeagueText } from '../src/engine/teamExport';
import { CAP_LIMIT } from '../src/engine/positions';
import type { Team } from '../src/engine/types';

/** `Name:TAL` — the TAL badge the user's screenshot showed, which picks the player's window; a bare
 * name takes his best window (re-optimized under the cap with the rest of the roster). */
export const REFERENCE_ROSTERS: Record<string, string[]> = {
  Nash: ['Steve Nash', 'Kobe Bryant', 'Scottie Pippen', 'Karl Malone', 'Brook Lopez', 'Derek Fisher', 'James Posey', 'Ben Wallace'],
  Tulsa: ['Chauncey Billups:82', 'Alex Caruso:68', 'Jayson Tatum:87', 'Giannis Antetokounmpo:99', 'Kareem Abdul-Jabbar:94', 'Thabo Sefolosha:49', 'Gerald Wallace:72', 'Mark Eaton:67'],
  Charlotte: ['John Stockton:95', 'Ray Allen:86', 'Jalen Williams:83', 'Kevin Garnett:97', 'Marc Gasol:80', 'Jeff Hornacek:70', 'Robert Horry:68', 'Andrew Bogut:61'],
  DesMoines: ['Jason Kidd:85', 'Ron Harper:74', 'Klay Thompson:85', 'Kawhi Leonard:98', 'Joel Embiid:98', 'David Wesley:66', 'Bo Outlaw:62', 'Robert Williams:64'],
  SaltLake: ['Chris Paul:92', 'Derrick White:71', 'Grant Hill:81', 'Larry Bird:97', 'Bob McAdoo:91', 'Nate McMillan:59', 'Bruce Bowen:48', 'Nene:74'],
  Dayton: ['Magic Johnson:92', 'Anthony Edwards:85', 'Clifford Robinson:73', 'Evan Mobley:83', 'Victor Wembanyama:91', 'Danny Ainge:66', 'Garrett Temple:42', 'Nic Claxton:66'],
  Vermont: ['LeBron James:102', 'Luka Doncic:91', 'Chris Mullin:71', 'Kristaps Porzingis:82', 'Bill Walton:86', 'Brent Barry:59', 'Bryon Russell:58', 'Tiago Splitter:59'],
  Oakland: ['Shai Gilgeous-Alexander:94', 'Donovan Mitchell:85', 'Mikal Bridges:66', 'Anthony Davis:91', 'Rudy Gobert:82', 'Amen Thompson:66', 'Nicolas Batum:62', 'Amir Johnson:54'],
};

function pickSpan(entry: string): { span: PlayerSpan; pinned: boolean } {
  const [name, tal] = entry.split(':');
  const options = spanOptionsFor(name);
  if (options.length === 0) throw new Error(`no spans for ${name}`);
  if (tal === undefined) return { span: [...options].sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0], pinned: false };
  const target = Number(tal);
  const shown = (s: PlayerSpan) => displayTalentForSpan(tierContextFor(s));
  const span = [...options].sort((a, b) => Math.abs(shown(a) - target) - Math.abs(shown(b) - target) || effectiveTalent(b) - effectiveTalent(a))[0];
  return { span, pinned: true };
}

export function referenceTeams(): Team[] {
  return Object.entries(REFERENCE_ROSTERS).map(([name, players], i) => {
    const picks = players.map(pickSpan);
    const roster = picks.every((p) => p.pinned) ? picks.map((p) => p.span) : optimizeSpans(picks.map((p) => p.span), CAP_LIMIT);
    return { id: `ref-${i}`, name, draftSlot: i + 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const teams = referenceTeams();
  if (process.argv.includes('--full')) console.log(exportLeagueText(teams));
  const ranked = rankTeams(teams);
  const by = new Map(ranked.map((r) => [r.team.name, r]));
  for (const { team, breakdown: b, rank } of ranked) {
    const off = offenseScoreBreakdown(team);
    console.log(
      `${rank} ${team.name.padEnd(10)} ${b.overall} T${b.talentScore.toFixed(0)} B${b.benchDepthScore.toFixed(0)} O${b.offenseScore}(${off.raw.toFixed(0)}) D${b.defenseScore} S${b.spacingScore.toFixed(0)} F${b.fitScore.toFixed(0)} R${b.rotationScore.toFixed(0)}`,
    );
  }
  if (process.argv.includes('--check')) {
    const s = (n: string) => by.get(n)!.breakdown;
    // 2026-10-01: offense verdicts compare the exact (unrounded) offense — two teams 0.3 apart in
    // raw offense round to the same displayed number, which made a strict ">" fail on rounding.
    const offense = (n: string) => offenseScoreBreakdown(by.get(n)!.team).raw;
    const checks: [boolean, string][] = [
      [s("Charlotte").overallExact > s("Tulsa").overallExact, 'Charlotte ranks above Tulsa'],
      [by.get('Vermont')!.rank < teams.length, 'LeBron + Luka is not at the bottom'],
      [s('Charlotte').spacingScore > s('Tulsa').spacingScore, 'Charlotte spaces the floor better than Tulsa'],
      [offense('Nash') >= offense('Tulsa') - 0.5, 'Nash-Kobe-Malone scores at least as well as Tulsa'],
      [offense('Vermont') > offense('Tulsa'), 'LeBron + Luka out-scores Tulsa'],
      [s('Nash').fitScore > s('SaltLake').fitScore, 'Nash + Malone fits better than CP3 + Bird + Hill'],
      [s('Nash').fitScore >= s('Tulsa').fitScore, 'Nash + Malone fits at least as well as Giannis + Kareem'],
      [offense('Charlotte') > offense('Tulsa'), 'Stockton + Allen + Garnett out-score Tulsa'],
    ];
    let failed = 0;
    for (const [ok, label] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
      if (!ok) failed++;
    }
    if (failed) process.exitCode = 1;
  }
}
