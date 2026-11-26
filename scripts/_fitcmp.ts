import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { fitScore } from '../src/engine/fit';
import type { Team } from '../src/engine/types';
const w = (n: string, s: string) => draftPool.find((p) => p.playerName === n && p.spanLabel === s)!;
const bench = ['Jamal Murray', 'Mikal Bridges', 'Robert Covington', 'Tree Rollins'].map((n) => draftPool.find((p) => p.playerName === n)!);
const core = [w('Kawhi Leonard', '2015-17'), w('Larry Bird', '1985-87'), w('Kevin Garnett', '2002-04'), w('Kareem Abdul-Jabbar', '1971-73')];
for (const g of [w('John Stockton','1990-92'), w('Stephen Curry','2014-16')]) { const roster=[g,...core,...bench]; const t: Team={id:'x',name:'x',draftSlot:1,isHuman:false,roster,rotation:autoAssignRotation(roster)}; const f=fitScore(t);
 console.log(g.playerName, f.score, JSON.stringify(f.components), 'pen', f.inputs.lineupPenalty, 'demand', f.inputs.onBallDemand.toFixed(2), 'weak', f.inputs.defensiveWeakLinkPlayer, f.inputs.defensiveWeakLinkIsHuntable, f.notes.slice(0,6)); }
