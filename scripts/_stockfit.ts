import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { fitScore } from '../src/engine/fit';
import { teammateLift } from '../src/engine/teammateLift';
import type { Team } from '../src/engine/types';
const w = (n: string, s: string) => draftPool.find((p) => p.playerName === n && p.spanLabel === s)!;
const bench = ['Jamal Murray', 'Mikal Bridges', 'Robert Covington', 'Tree Rollins'].map((n) => draftPool.find((p) => p.playerName === n)!);
const core = [w('Kawhi Leonard', '2015-17'), w('Larry Bird', '1985-87'), w('Kevin Garnett', '2002-04'), w('Kareem Abdul-Jabbar', '1971-73')];
for (const g of [w('John Stockton', '1990-92'), w('Stephen Curry', '2014-16'), w('Chris Paul', '2015-17')]) {
  const roster = [g, ...core, ...bench];
  const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const f = fitScore(t);
  console.log(g.playerName, 'fit', f.score, JSON.stringify(Object.fromEntries(Object.entries(f.components).map(([k, v]) => [k, Math.round(v as number)]))), '| lift', JSON.stringify(teammateLift(g)));
  console.log('   notes:', (f.notes ?? []).slice(0, 3).join(' / '));
}
