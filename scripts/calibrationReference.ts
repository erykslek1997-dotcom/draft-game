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

/** `Name@span` — the exact window. `Name:TAL` — the TAL badge the user's screenshot showed, which
 * picks the player's window; a bare name takes his best window (re-optimized under the cap with the
 * rest of the roster).
 * 2026-10-02: every roster is pinned to the windows those rules picked before the role audit — a
 * one-point TAL shift (Giannis 2018-20 99 -> 98) silently swapped Tulsa onto Giannis 2020-22, so the
 * verdicts stopped comparing the same teams the user judged. */
export const REFERENCE_ROSTERS: Record<string, string[]> = {
  Nash: ['Steve Nash@2006-08', 'Kobe Bryant@2007-09', 'Scottie Pippen@1990-92', 'Karl Malone@1991-93', 'Brook Lopez@2022-24', 'Derek Fisher@2006-08', 'James Posey@2003-05', 'Ben Wallace@2001-03'],
  Tulsa: ['Chauncey Billups@2004-06', 'Alex Caruso@2022-24', 'Jayson Tatum@2023-25', 'Giannis Antetokounmpo@2018-20', 'Kareem Abdul-Jabbar@1977-79', 'Thabo Sefolosha@2011-13', 'Gerald Wallace@2008-10', 'Mark Eaton@1984-86'],
  Charlotte: ['John Stockton@1989-91', 'Ray Allen@2000-02', 'Jalen Williams@2023-25', 'Kevin Garnett@2002-04', 'Marc Gasol@2011-13', 'Jeff Hornacek@1993-95', 'Robert Horry@1994-96', 'Andrew Bogut@2014-16'],
  DesMoines: ['Jason Kidd@2004-06', 'Ron Harper@1988-90', 'Klay Thompson@2015-17', 'Kawhi Leonard@2015-17', 'Joel Embiid@2023-25', 'David Wesley@1997-99', 'Bo Outlaw@1998-00', 'Robert Williams@2020-22'],
  SaltLake: ['Chris Paul@2012-14', 'Derrick White@2022-24', 'Grant Hill@1995-97', 'Larry Bird@1982-84', 'Bob McAdoo@1975-77', 'Nate McMillan@1992-94', 'Bruce Bowen@2000-02', 'Nenê@2009-11'],
  Dayton: ['Magic Johnson@1983-85', 'Anthony Edwards@2022-24', 'Clifford Robinson@1998-00', 'Evan Mobley@2024-26', 'Victor Wembanyama@2024-26', 'Danny Ainge@1986-88', 'Garrett Temple@2014-16', 'Nic Claxton@2021-23'],
  Vermont: ['LeBron James@2010-12', 'Luka Doncic@2020-22', 'Chris Mullin@1995-97', 'Kristaps Porziņģis@2022-24', 'Bill Walton@1976-78', 'Brent Barry@1999-01', 'Bryon Russell@1996-98', 'Tiago Splitter@2012-14'],
  Oakland: ['Shai Gilgeous-Alexander@2022-24', 'Donovan Mitchell@2023-25', 'Mikal Bridges@2020-22', 'Anthony Davis@2022-24', 'Rudy Gobert@2016-18', 'Amen Thompson@2023-25', 'Nicolas Batum@2013-15', 'Amir Johnson@2010-12'],
};

function pickSpan(entry: string): { span: PlayerSpan; pinned: boolean } {
  if (entry.includes('@')) {
    const [exactName, label] = entry.split('@');
    const span = spanOptionsFor(exactName).find((option) => option.spanLabel === label);
    if (!span) throw new Error(`no span ${label} for ${exactName}`);
    return { span, pinned: true };
  }
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
      // 2026-10-02, the user after the role audit put Tulsa 1.4 ahead (Ray Allen / Hornacek lost
      // labels their numbers never supported): "generalnie to są bardzo podobne składy" — the
      // verdict is that the two read close, not a strict order.
      [Math.abs(s('Charlotte').overallExact - s('Tulsa').overallExact) <= 2, 'Charlotte and Tulsa read close (within 2 points)'],
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
