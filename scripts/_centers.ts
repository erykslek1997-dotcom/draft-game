// 2026-11-26 (the user's calibration brief: the center in an elite five): six centers in three cores on a shared
// bench (best span by effectiveTalent), autoAssignRotation, scoreTeam, playoff margin vs REF.
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { projectMatchup } from '../src/engine/matchup';
import { buildMatchupCache } from '../src/engine/seasonSimulation';
import type { Team, PlayerSpan } from '../src/engine/types';
const bestOf = (n: string) => draftPool.filter((p) => p.playerName === n).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
const w = (n: string, s: string) => draftPool.find((p) => p.playerName === n && p.spanLabel === s)!;
const bench = ['Jamal Murray', 'Mikal Bridges', 'Robert Covington', 'Tree Rollins'].map(bestOf);
const team = (id: string, five: PlayerSpan[]): Team => { const roster = [...five, ...bench]; return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) }; };
const REF = team('REF', [w('Stephen Curry', '2014-16'), w('Michael Jordan', '1987-89'), w('LeBron James', '2012-14'), w('Kevin Garnett', '2002-04'), w('David Robinson', '1993-95')]);
const cores: Record<string, PlayerSpan[]> = {
  A: [w('Magic Johnson', '1989-91'), w('John Stockton', '1990-92'), w('Larry Bird', '1985-87'), w('Kevin Garnett', '2002-04')],
  B: [w('John Stockton', '1990-92'), bestOf('Michael Jordan'), w('Kawhi Leonard', '2015-17'), bestOf('Scottie Pippen')],
  C: [bestOf('James Harden'), bestOf('Russell Westbrook'), bestOf('Luka Doncic'), bestOf('Dirk Nowitzki')],
};
const centers: [string, PlayerSpan][] = [['Kareem 71-73', w('Kareem Abdul-Jabbar', '1971-73')], ['Robinson 93-95', w('David Robinson', '1993-95')], ['Shaq 99-01', w("Shaquille O'Neal", '1999-01')], ['Jokic 23-25', w('Nikola Jokic', '2023-25')], ['Hakeem best', bestOf('Hakeem Olajuwon')], ['Duncan 01-03', w('Tim Duncan', '2001-03')]];
const out: string[] = [];
for (const [cn, c] of centers) {
  const cells = Object.entries(cores).map(([k, core]) => { const t = team(`${k}-${cn}`, [...core, c]); const b = scoreTeam(t); const cache = buildMatchupCache([t, REF]); const m = projectMatchup(t, REF, cache.get(t.id), cache.get(REF.id), 'playoffs').marginA; return `${k} ${b.overallExact.toFixed(1)} (${b.offenseScore}/${b.defenseScore}/${b.fitScore}, ${m >= 0 ? '+' : ''}${m.toFixed(1)})`; });
  out.push(`${cn.padEnd(15)} ${cells.join(' | ')}`);
}
console.log(out.join('\n'));
