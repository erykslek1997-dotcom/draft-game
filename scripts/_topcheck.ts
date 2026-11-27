// 2026-11-26: the top-end test — each pair from _pairs.ts swapped into two fives (an all-star five and a
// role five, at the first player's position); counts how often the first one scores higher.
import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team, PlayerSpan } from '../src/engine/types';
import { PAIRS, MARGINS } from './_pairs';
const w = (n: string, s?: string) => { const p = draftPool.find((x) => x.playerName === n && (!s || x.spanLabel === s)); if (!p) throw new Error(n + s); return p; };
const STAR: Record<string, PlayerSpan> = { PG: w('Chris Paul','2015-17'), SG: w('Dwyane Wade','2008-10'), SF: w('Kawhi Leonard','2015-17'), PF: w('Kevin Garnett','2002-04'), C: w('David Robinson','1994-96') };
const ROLE: Record<string, PlayerSpan> = { PG: w('Mike Conley'), SG: w('Klay Thompson','2014-16'), SF: w('Mikal Bridges'), PF: w('Draymond Green','2015-17'), C: w('Rudy Gobert') };
const bench = ['Jamal Murray','Robert Covington','Tree Rollins','Bobby Portis'].map((n) => w(n));
const parts = (core: Record<string, PlayerSpan>, pos: string, p: PlayerSpan) => { const roster = [...fiveWith(core, p), ...bench]; const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) }; const b = scoreTeam(t); return [b.talentScore, b.fitScore, b.offenseScore, b.defenseScore]; };
// 2026-11-26 (the user: LeBron as PF/SF, wherever he fits best).
const fiveWith = (core: Record<string, PlayerSpan>, p: PlayerSpan): PlayerSpan[] => {
  // He replaces whichever core player makes the best team (the drafter's own choice of position).
  let best: PlayerSpan[] = [], bestScore = -Infinity;
  for (const out of Object.values(core)) {
    const five = [p, ...Object.values(core).filter((c) => c !== out && c.playerName !== p.playerName)].slice(0, 5);
    const roster = [...five, ...bench];
    const v = scoreTeam({ id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) }).overallExact;
    if (v > bestScore) { bestScore = v; best = five; }
  }
  return best;
};
const score = (core: Record<string, PlayerSpan>, pos: string, p: PlayerSpan) => { const roster = [...fiveWith(core, p), ...bench]; const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) }; return scoreTeam(t).overallExact; };
let ok = 0, n = 0, margin = 0;
for (const [a, sa, b, sb] of PAIRS) { const A = w(a, sa), B = w(b, sb); const pos = A.primaryPosition;
  const m = MARGINS[`${a}>${b}`] ?? {}; const lo = m.min ?? 0, hi = m.max ?? Infinity;
  // 2026-11-27: a core that already holds A or B (Kawhi in the star five) let B play BESIDE A; that core
  // member is swapped for a like-for-like stand-in so both are judged on the same four teammates.
  const SUB: Record<string, PlayerSpan> = { 'Kawhi Leonard': w('Scottie Pippen','1990-92'), 'Kevin Garnett': w('Chris Webber','2000-02'), 'David Robinson': w('Patrick Ewing','1993-95'), 'Dwyane Wade': w('Clyde Drexler','1990-92'), 'Chris Paul': w('Gary Payton','1995-97'), 'Klay Thompson': w('Ray Allen','2000-02'), 'Draymond Green': w('Shawn Marion','2004-06'), 'Rudy Gobert': w('Ben Wallace','2002-04') };
  const clean = (c: Record<string, PlayerSpan>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, (v.playerName === a || v.playerName === b) && SUB[v.playerName] ? SUB[v.playerName] : v]));
  const d = [clean(STAR), clean(ROLE)].map((c) => score(c, pos, A) - score(c, pos, B)); for (const x of d) { n++; if (x > lo && x <= hi) ok++; margin += Math.min(x - lo, 0) + Math.min(hi - x, 0); }
  console.log((d.every((x) => x > lo && x <= hi) ? 'ok ' : d.some((x) => x > lo && x <= hi) ? '½  ' : 'BAD') , `${a} ${sa} > ${b} ${sb}`.padEnd(62), d.map((x) => x.toFixed(1)).join(' / '), process.env.PARTS ? [STAR, ROLE].map((c) => { const x = parts(c, pos, A), y = parts(c, pos, B); return 'T F O D ' + x.map((v, i) => v - y[i]).join(' '); }).join(' | ') : ''); }
console.log(`TOP CHECK ${ok}/${n}, shortfall ${margin.toFixed(1)}`);
