// 2026-11-26: Fit components of two players swapped into the top-check fives.
import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { fitScore } from '../src/engine/fit';
import type { Team, PlayerSpan } from '../src/engine/types';
const w = (n: string, s?: string) => draftPool.find((x) => x.playerName === n && (!s || x.spanLabel === s))!;
const STAR: Record<string, PlayerSpan> = { PG: w('Chris Paul','2015-17'), SG: w('Dwyane Wade','2008-10'), SF: w('Kawhi Leonard','2015-17'), PF: w('Kevin Garnett','2002-04'), C: w('David Robinson','1994-96') };
const bench = ['Jamal Murray','Robert Covington','Tree Rollins','Bobby Portis'].map((n) => w(n));
const [a, sa, b, sb] = process.argv.slice(2);
for (const p of [w(a, sa), w(b, sb)]) { const pos = w(a, sa).primaryPosition; const roster = [p, ...Object.entries(STAR).filter(([k]) => k !== pos).map(([, v]) => v), ...bench];
  const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) }; const f = fitScore(t);
  console.log(p.playerName, f.score, JSON.stringify(f.components), 'pen', f.inputs.lineupPenalty, f.notes.filter((n) => /crowd|cost|ball|overlap/i.test(n)).join(' | ')); }
