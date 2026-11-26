// 2026-11-26: the top-end test — each pair from _pairs.ts swapped into two fives (an all-star five and a
// role five, at the first player's position); counts how often the first one scores higher.
import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team, PlayerSpan } from '../src/engine/types';
import { PAIRS } from './_pairs';
const w = (n: string, s?: string) => { const p = draftPool.find((x) => x.playerName === n && (!s || x.spanLabel === s)); if (!p) throw new Error(n + s); return p; };
const STAR: Record<string, PlayerSpan> = { PG: w('Chris Paul','2015-17'), SG: w('Dwyane Wade','2008-10'), SF: w('Kawhi Leonard','2015-17'), PF: w('Kevin Garnett','2002-04'), C: w('David Robinson','1994-96') };
const ROLE: Record<string, PlayerSpan> = { PG: w('Mike Conley'), SG: w('Klay Thompson','2014-16'), SF: w('Mikal Bridges'), PF: w('Draymond Green','2015-17'), C: w('Rudy Gobert') };
const bench = ['Jamal Murray','Robert Covington','Tree Rollins','Bobby Portis'].map((n) => w(n));
const score = (core: Record<string, PlayerSpan>, pos: string, p: PlayerSpan) => { const roster = [p, ...Object.entries(core).filter(([k]) => k !== pos).map(([, v]) => v), ...bench]; const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) }; return scoreTeam(t).overallExact; };
let ok = 0, n = 0, margin = 0;
for (const [a, sa, b, sb] of PAIRS) { const A = w(a, sa), B = w(b, sb); const pos = A.primaryPosition;
  const d = [STAR, ROLE].map((c) => score(c, pos, A) - score(c, pos, B)); for (const x of d) { n++; if (x > 0) ok++; margin += Math.min(x, 0); }
  console.log((d.every((x) => x > 0) ? 'ok ' : d.some((x) => x > 0) ? '½  ' : 'BAD') , `${a} ${sa} > ${b} ${sb}`.padEnd(62), d.map((x) => x.toFixed(1)).join(' / ')); }
console.log(`TOP CHECK ${ok}/${n}, shortfall ${margin.toFixed(1)}`);
