import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import type { Team } from '../src/engine/types';
const w = (n: string, s?: string) => draftPool.find((x) => x.playerName === n && (!s || x.spanLabel === s))!;
for (const s of ['2012-14','2008-10']) { const p = w('LeBron James', s); console.log(s, p.primaryPosition, p.secondaryPositions);
 const roster = [p, w('Chris Paul','2015-17'), w('Dwyane Wade','2008-10'), w('Kevin Garnett','2002-04'), w('David Robinson','1994-96'), w('Kawhi Leonard','2015-17'), ...['Jamal Murray','Robert Covington','Tree Rollins','Bobby Portis'].map((n)=>w(n))];
 const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
 console.log(primaryStarters(t).map((a) => `${a.slot}:${a.player.playerName}`).join(', ')); }
