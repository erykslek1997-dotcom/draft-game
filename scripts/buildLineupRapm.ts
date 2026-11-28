// 2026-11-28 (the user: "nie masz jak odtworzyć RAPM?"): a lineup-level ridge RAPM per season from the pbpstats five-man
// lineups (scripts/fetchPbpLineups.py). Each lineup is one row per side: points per 100 possessions against the league,
// weighted by possessions, regressed on its five players (ridge lambda). Writes src/data/lineupRapm.json in the APBR
// layout { name: { endYear: [poss, ORAPM, DRAPM (+ = better defense), net] } } and, for 2000-19, its agreement with APBR.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const DIR = resolve(import.meta.dirname, '../src/data/raw/pbpLineups');
const LAMBDA = Number(process.env.LAMBDA ?? 3000);
const names = new Map<string, string>();
for (const f of readdirSync(resolve(import.meta.dirname, '../src/data/raw/pbpstats'))) if (f.endsWith('-Player.json')) for (const r of JSON.parse(readFileSync(resolve(import.meta.dirname, '../src/data/raw/pbpstats', f), 'utf8')).multi_row_table_data) names.set(String(r.EntityId), r.Name);
const bySeason = new Map<string, [string, number, number, number, number][]>();
for (const f of readdirSync(DIR)) { const s = f.slice(0, 7); bySeason.set(s, [...(bySeason.get(s) ?? []), ...JSON.parse(readFileSync(resolve(DIR, f), 'utf8'))]); }
const out: Record<string, Record<string, [number, number, number, number]>> = {};
function ridge(rows: { ids: number[]; y: number; w: number }[], n: number): Float64Array {
  // (X'WX + lambda I) b = X'Wy by conjugate gradient; X is 0/1 with five ones per row
  const Ax = (x: Float64Array) => { const r = new Float64Array(n); for (const row of rows) { let s = 0; for (const i of row.ids) s += x[i]; s *= row.w; for (const i of row.ids) r[i] += s; } for (let i = 0; i < n; i++) r[i] += LAMBDA * x[i]; return r; };
  const b = new Float64Array(n); for (const row of rows) for (const i of row.ids) b[i] += row.w * row.y;
  const x = new Float64Array(n); let r = Float64Array.from(b); let p = Float64Array.from(r); let rs = r.reduce((a, v) => a + v * v, 0);
  for (let it = 0; it < 300 && rs > 1e-10; it++) { const Ap = Ax(p); const a = rs / p.reduce((s, v, i) => s + v * Ap[i], 0); for (let i = 0; i < n; i++) { x[i] += a * p[i]; r[i] -= a * Ap[i]; } const rs2 = r.reduce((s, v) => s + v * v, 0); const beta = rs2 / rs; for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i]; rs = rs2; }
  return x;
}
for (const [season, rows] of [...bySeason].sort()) {
  const end = Number(season.slice(0, 4)) + 1; const idx = new Map<string, number>(); const poss = new Map<string, number>();
  const id = (p: string) => { let i = idx.get(p); if (i === undefined) { i = idx.size; idx.set(p, i); } return i; };
  let tp = 0, to = 0, td = 0, tdp = 0;
  for (const [, op, dp, pts, opp] of rows) { tp += op; to += pts; tdp += dp; td += opp; }
  const lgO = (100 * to) / tp, lgD = (100 * td) / tdp;
  const off: { ids: number[]; y: number; w: number }[] = [], def: typeof off = [];
  for (const [ent, op, dp, pts, opp] of rows) { const ps = ent.split('-'); if (ps.length !== 5) continue; const ids = ps.map(id); for (const p of ps) poss.set(p, (poss.get(p) ?? 0) + op + dp);
    if (op > 0) off.push({ ids, y: (100 * pts) / op - lgO, w: op }); if (dp > 0) def.push({ ids, y: lgD - (100 * opp) / dp, w: dp }); }
  const bo = ridge(off, idx.size), bd = ridge(def, idx.size);
  for (const [p, i] of idx) { const nm = names.get(p); if (!nm) continue; (out[nm] ??= {})[String(end)] = [poss.get(p) ?? 0, +bo[i].toFixed(3), +bd[i].toFixed(3), +(bo[i] + bd[i]).toFixed(3)]; }
  console.log(season, 'lineups', rows.length, 'players', idx.size);
}
writeFileSync(resolve(import.meta.dirname, '../src/data/lineupRapm.json'), JSON.stringify(out));
// agreement with APBR, 2000-19, players with 3000+ possessions
const apbr = new Map<string, number>();
for (const f of readdirSync(resolve(import.meta.dirname, '../src/data/raw/apbrRapm'))) { if (f.includes('playoffs')) continue; const end = Number(f.slice(0, 4)) + 1; const rows = JSON.parse(readFileSync(resolve(import.meta.dirname, '../src/data/raw/apbrRapm', f), 'utf8')); for (const r of (Array.isArray(rows) ? rows : Object.values(rows)[0]) as any[]) if (r[3] >= 3000) apbr.set(`${r[1]}|${end}`, r[5]); }
const xs: number[] = [], ys: number[] = [];
for (const [nm, yrs] of Object.entries(out)) for (const [y, v] of Object.entries(yrs)) { const a = apbr.get(`${nm}|${y}`); if (a !== undefined && v[0] >= 3000) { xs.push(v[2]); ys.push(a); } }
const m = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length; const mx = m(xs), my = m(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
console.log(`agreement with APBR defensive RAPM (player-seasons ${xs.length}): r ${(a / Math.sqrt(b * c)).toFixed(3)}, sd ours ${Math.sqrt(b / xs.length).toFixed(2)} APBR ${Math.sqrt(c / xs.length).toFixed(2)}`);
