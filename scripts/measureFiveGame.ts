/**
 * 2026-10-28, step 8: five-only games (Draw Five, daily) between random TAL-70+ fives — points, final
 * gap, how often the favourite wins, close games. `npx tsx scripts/measureFiveGame.ts` (MIN_TAL=70)
 */
import { draftPool } from '../src/data/draftPool';
import { headToHeadMargin, simulateLiveGame } from '../src/engine/liveGame';
import { computeTalent } from '../src/engine/talent';
let seed = 1;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const byPos: Record<string, any[]> = {};
for (const s of draftPool) if (computeTalent(s) >= Number(process.env.MIN_TAL ?? 70)) (byPos[s.primaryPosition] ??= []).push(s);
const five = () => Object.fromEntries(['PG', 'SG', 'SF', 'PF', 'C'].map((p) => [p, byPos[p][Math.floor(rnd() * byPos[p].length)]])) as any;
let fav = 0, n = 0, pts = 0, gap = 0, upsets = 0, close = 0;
for (let g = 0; g < 400; g++) {
  const a = five(), b = five();
  const m = headToHeadMargin(a, b);
  const r = simulateLiveGame(a, b, m, `t${g}`);
  pts += (r.final[0] + r.final[1]) / 2;
  gap += Math.abs(r.final[0] - r.final[1]);
  if (Math.abs(m) >= 3) { n++; if ((r.final[0] > r.final[1]) === (m > 0)) fav++; else upsets++; }
  if (Math.abs(r.final[0] - r.final[1]) <= 5) close++;
}
console.log(`five-only game: points a team ${(pts / 400).toFixed(1)}, mean final gap ${(gap / 400).toFixed(1)}, favourite (engine margin 3+) wins ${(100 * fav / n).toFixed(0)}% of ${n}, games within 5: ${(100 * close / 400).toFixed(0)}%`);
