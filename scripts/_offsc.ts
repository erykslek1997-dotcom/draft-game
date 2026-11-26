// 2026-11-26 (the user: "atak Stocktona jest zbyt mocny w porównaniu do Currego"): team offense parts, same four beside each.
import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { offenseScoreBreakdown } from '../src/engine/scoring';
import { computeOffensiveTalent } from '../src/engine/talent';
import { dataUsageDemand, skill } from '../src/engine/skills';
import type { Team } from '../src/engine/types';
const w = (n: string, s: string) => draftPool.find((p) => p.playerName === n && p.spanLabel === s)!;
const bench = ['Jamal Murray', 'Mikal Bridges', 'Robert Covington', 'Tree Rollins'].map((n) => draftPool.find((p) => p.playerName === n)!);
const core = [w('Kawhi Leonard', '2015-17'), w('Larry Bird', '1985-87'), w('Kevin Garnett', '2002-04'), w('Kareem Abdul-Jabbar', '1971-73')];
for (const g of [w('John Stockton', '1990-92'), w('Stephen Curry', '2014-16')]) {
  const roster = [g, ...core, ...bench];
  const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const ob = offenseScoreBreakdown(t) as unknown as Record<string, number>;
  console.log(g.playerName, 'O-TAL', computeOffensiveTalent(g), 'usage demand', dataUsageDemand(g)?.toFixed(2), 'spotUp', skill(g, 'spotUp'));
  console.log('  ', JSON.stringify(Object.fromEntries(Object.entries(ob).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, Math.round(v * 10) / 10]))));
}
for (const p of core) console.log('  core', p.playerName, 'usage', dataUsageDemand(p)?.toFixed(2), 'spotUp', skill(p, 'spotUp'), 'O', computeOffensiveTalent(p));
