import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { fitScore } from '../src/engine/fit';
import type { Team } from '../src/engine/types';
const w = (n: string, s: string) => draftPool.find((x) => x.playerName === n && x.spanLabel === s)!;
const bench = ['Jamal Murray','Robert Covington','Tree Rollins','Bobby Portis'].map((n) => draftPool.find((x) => x.playerName === n)!);
for (const five of [[['Magic Johnson','1989-91'],['Michael Jordan','1987-89'],['Larry Bird','1985-87'],['LeBron James','2012-14'],['Kevin Garnett','2002-04']],[['Stephen Curry','2014-16'],['Michael Jordan','1987-89'],['Larry Bird','1985-87'],['LeBron James','2012-14'],['Kevin Garnett','2002-04']]]) {
  const roster = [...five.map(([n, s]) => w(n, s)), ...bench]; const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const b = scoreTeam(t); const f = fitScore(t); console.log(five.map((x) => x[0].split(' ')[1]).join(','), 'ovr', b.overallExact.toFixed(1), 'T', b.talentScore, 'O', b.offenseScore, 'D', b.defenseScore, 'spc', b.spacingScore, 'fit', b.fitScore, 'spacingCompat', f.components.spacingCompatibility); }
