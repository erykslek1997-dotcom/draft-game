// 2026-11-26 (the user's calibration brief): the best all-time five by Overall — hill climb with restarts
// over the top-N players by TAL (each at his best window), shared bench (Murray, Bridges, Covington,
// Rollins — first spans in draftPool), autoAssignRotation + scoreTeam.  npx tsx scripts/_bestFive.ts [N=80] [restarts=12]
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team, PlayerSpan } from '../src/engine/types';
const N = Number(process.argv[2] ?? 80), R = Number(process.argv[3] ?? 12);
const first = (n: string) => draftPool.find((p) => p.playerName === n)!;
const bench = ['Jamal Murray', 'Mikal Bridges', 'Robert Covington', 'Tree Rollins'].map(first);
const best = new Map<string, PlayerSpan>();
for (const p of draftPool) { const c = best.get(p.playerName); if (!c || effectiveTalent(p) > effectiveTalent(c)) best.set(p.playerName, p); }
const pool = [...best.values()].filter((p) => !bench.some((b) => b.playerName === p.playerName) && !(process.env.EXCLUDE ?? '').split(',').includes(p.playerName)).sort((a, b) => effectiveTalent(b) - effectiveTalent(a)).slice(0, N);
const cache = new Map<string, number>();
const score = (five: PlayerSpan[]) => { const k = five.map((p) => p.id).sort().join('|'); let v = cache.get(k); if (v === undefined) { const roster = [...five, ...bench]; const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) }; v = scoreTeam(t).overallExact; cache.set(k, v); } return v; };
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
// LOCK="Stephen Curry,LeBron James": those players stay in every five (their best windows).
const locked = (process.env.LOCK ?? '').split(',').filter(Boolean).map((n) => best.get(n)!).filter(Boolean);
const results: { v: number; names: string }[] = [];
for (let r = 0; r < R; r++) {
  let five: PlayerSpan[] = [...locked]; while (five.length < 5) { const p = pool[Math.floor(rnd() * pool.length)]; if (!five.includes(p)) five.push(p); }
  let cur = score(five), improved = true;
  while (improved) { improved = false;
    for (let i = locked.length; i < 5; i++) for (const p of pool) { if (five.includes(p)) continue; const t = [...five]; t[i] = p; const v = score(t); if (v > cur + 1e-9) { five = t; cur = v; improved = true; } } }
  results.push({ v: cur, names: five.map((p) => `${p.playerName} ${p.spanLabel}`).sort().join(', ') });
}
const tally = new Map<string, { v: number; n: number }>();
for (const x of results) { const t = tally.get(x.names) ?? { v: x.v, n: 0 }; t.n++; tally.set(x.names, t); }
for (const [names, t] of [...tally.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 4)) console.log(`${t.v.toFixed(2)}  ${t.n}/${R}  ${names}`);
