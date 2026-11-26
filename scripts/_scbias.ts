// 2026-11-26 (the user: Rick Barry 100 vs Bird 83 self-creation): does the box-era model (skillsMasked.json,
// cross-fitted on 1997+) under-read tall, rebounding forwards who created their own shot? True vs masked.
import { draftPool } from '../src/data/draftPool';
import skills from '../src/data/skills.json';
import masked from '../src/data/skillsMasked.json';
import { getHeightInches } from '../src/data/heightLookup';
const S = skills as Record<string, Record<string, number>>, M = masked as Record<string, Record<string, number>>;
const rows = draftPool.filter((p) => S[p.id]?.selfCreation !== undefined && M[p.id]?.selfCreation !== undefined).map((p) => ({ n: `${p.playerName} ${p.spanLabel}`, t: S[p.id].selfCreation, m: M[p.id].selfCreation, h: getHeightInches(p.playerName) ?? 0, reb: p.box.rpg, ppg: p.box.ppg, pos: p.primaryPosition }));
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const grp = (f: (r: typeof rows[number]) => boolean, name: string) => { const g = rows.filter(f); console.log(`${name.padEnd(44)} n ${String(g.length).padStart(4)}  true - model ${mean(g.map((r) => r.t - r.m)).toFixed(1)}`); };
grp(() => true, 'all');
grp((r) => r.h >= 80 && r.ppg >= 20, 'tall (6-8+) scorers 20+ ppg');
grp((r) => r.h >= 80 && r.ppg >= 20 && r.reb >= 7, 'tall scorers 20+ ppg, 7+ reb');
grp((r) => r.h < 80 && r.ppg >= 20, 'shorter scorers 20+ ppg');
for (const n of ['Dirk Nowitzki','Kevin Durant','Carmelo Anthony','Paul George','Paul Pierce','LeBron James','Kawhi Leonard','Jayson Tatum']) { const g = rows.filter((r) => r.n.startsWith(n)); if (g.length) console.log(`  ${n.padEnd(18)} true ${Math.round(mean(g.map((r) => r.t)))} model ${Math.round(mean(g.map((r) => r.m)))}`); }
