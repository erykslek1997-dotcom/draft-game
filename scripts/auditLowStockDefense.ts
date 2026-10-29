import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { spanEndYears } from '../src/engine/era';
import { realSpan } from '../src/engine/realAdvancedLookup';
import rapmData from '../src/data/awards/peakRapm.json';

/**
 * 2026-10-29 (the user, option C on P.J. Tucker — D-TAL 54-64 against a +1.4 defensive RAPM): do
 * defenders whose value is not in steals and blocks sit under their defensive plus-minus? Each
 * player's best-D-TAL span from 1998 on against his peak defensive RAPM; the reverse fit (RAPM on
 * D-TAL) and each group's RAPM over its D-TAL, in D-TAL points (+ = D-TAL too low), by stocks
 * (STL% + BLK%), position and minutes.
 *
 *   npx tsx scripts/auditLowStockDefense.ts
 */
const key = (n: string) => normalizePlayerName(n).replace(/[^a-z0-9]+/g, ' ').trim();
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const best = new Map<string, PlayerSpan>();
for (const s of draftPool) {
  if (spanEndYears(s.spanLabel)[0] < 1998) continue;
  const k = key(s.playerName);
  if (!best.has(k) || computeDefensiveTalent(s) > computeDefensiveTalent(best.get(k)!)) best.set(k, s);
}
const rows = (rapmData as { name: string; peakDef: number }[]).flatMap((r) => {
  const s = best.get(key(r.name)); const real = s && realSpan(s);
  if (!s || !real || real.stl === undefined || real.blk === undefined || real.mpg < 15) return [];
  return [{ s, d: computeDefensiveTalent(s), y: r.peakDef, stocks: real.stl + real.blk, stl: real.stl, blk: real.blk, mpg: real.mpg, drb: real.drb ?? 0 }];
});
const md = mean(rows.map((r) => r.d)), my = mean(rows.map((r) => r.y));
let a = 0, b = 0, c = 0;
for (const r of rows) { a += (r.d - md) * (r.y - my); b += (r.d - md) ** 2; c += (r.y - my) ** 2; }
const slope = a / b;
const res = (r: (typeof rows)[number]) => (r.y - (my + slope * (r.d - md))) / slope;
console.log(`${rows.length} players (15+ mpg): D-TAL vs peak defensive RAPM r ${(a / Math.sqrt(b * c)).toFixed(3)}, ${slope.toFixed(3)} RAPM per D-TAL point`);
const g = (label: string, f: (r: (typeof rows)[number]) => string, filter = (_: (typeof rows)[number]) => true) => console.log(` by ${label}:`, Object.entries(Object.groupBy(rows.filter(filter), f)).sort().filter(([, v]) => v!.length >= 10).map(([k, v]) => { const x = v!.map(res), m = mean(x), se = Math.sqrt(mean(x.map((q) => (q - m) ** 2)) / x.length); return `${k} ${m.toFixed(1)}±${(1.64 * se).toFixed(1)} (n ${x.length})`; }).join(' · '));
const stockBand = (r: (typeof rows)[number]) => (r.stocks < 2 ? 'a <2' : r.stocks < 3 ? 'b 2-3' : r.stocks < 4 ? 'c 3-4' : r.stocks < 6 ? 'd 4-6' : 'e 6+');
g('STL%+BLK%', stockBand);
g('STL%+BLK% — guards & wings', stockBand, (r) => ['PG', 'SG', 'SF'].includes(r.s.primaryPosition));
g('STL%+BLK% — PF', stockBand, (r) => r.s.primaryPosition === 'PF');
g('STL%+BLK% — C', stockBand, (r) => r.s.primaryPosition === 'C');
g('position', (r) => r.s.primaryPosition);
g('D-TAL band', (r) => (r.d < 50 ? 'a <50' : r.d < 65 ? 'b 50-64' : r.d < 80 ? 'c 65-79' : 'd 80+'));
g('D-TAL band — stocks under 3', (r) => (r.d < 50 ? 'a <50' : r.d < 65 ? 'b 50-64' : r.d < 80 ? 'c 65-79' : 'd 80+'), (r) => r.stocks < 3);
const low = rows.filter((r) => r.stocks < 3.5).sort((p, q) => res(q) - res(p));
console.log('\nlow-stock (<3.5) most under their defensive RAPM:', low.slice(0, 20).map((r) => `${r.s.playerName} ${r.s.spanLabel} ${r.s.primaryPosition} D ${r.d.toFixed(0)} RAPM-D ${r.y} (+${res(r).toFixed(0)})`).join('; '));
const t = rows.find((r) => r.s.playerName === 'P.J. Tucker');
if (t) console.log(`\nP.J. Tucker ${t.s.spanLabel}: D-TAL ${t.d.toFixed(0)}, stocks ${t.stocks.toFixed(1)}, RAPM-D ${t.y} → RAPM reads D-TAL ${(t.d + res(t)).toFixed(0)}`);
