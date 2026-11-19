import { draftPool } from '../src/data/draftPool'; import { computeDefensiveTalent } from '../src/engine/defensiveTalent'; import { skill } from '../src/engine/skills'; import '../src/engine/fit';
const comp = (s: any) => { const g = (k: any) => skill(s, k); const poa = g('pointOfAttack'), help = g('help'), rim = g('rimProtect'), act = g('activity'), glass = g('defGlass');
  if ([poa, rim, act].some((v) => v === null)) return null; const h = help ?? 50; const big = s.primaryPosition === 'C' || s.primaryPosition === 'PF';
  return big ? 0.45 * rim! + 0.3 * h + 0.15 * (glass ?? 50) + 0.1 * act! : 0.45 * poa! + 0.35 * h + 0.2 * act!; };
const by: Record<string, { c: number[]; d: number[] }> = {};
for (const s of draftPool) { const c = comp(s); if (c === null) continue; const e = (by[s.primaryPosition] ??= { c: [], d: [] }); e.c.push(c); e.d.push(computeDefensiveTalent(s)); }
const ms = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return [m, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length)]; };
const corr = (a: number[], b: number[]) => { const [ma, sa] = ms(a), [mb, sb] = ms(b); return a.reduce((t, v, i) => t + (v - ma) * (b[i] - mb), 0) / a.length / sa / sb; };
for (const [p, e] of Object.entries(by)) { const [mc, sc] = ms(e.c), [md, sd] = ms(e.d); console.log(p, e.c.length, 'comp', mc.toFixed(1), sc.toFixed(1), 'D', md.toFixed(1), sd.toFixed(1), 'r', corr(e.c, e.d).toFixed(2)); }
