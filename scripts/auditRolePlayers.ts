import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import { spanEndYears } from '../src/engine/era';
import { realSpan } from '../src/engine/realAdvancedLookup';
import primeCareerData from '../src/data/raw/wowyrPrimeCareer.json';
import rapmData from '../src/data/awards/peakRapm.json';

/**
 * 2026-10-29 (the user, export 53023928: "the game likes weak role players, or the ones I do not
 * know are overrated"): role-tier TAL (under 80) against two judges that do not read the box — peak
 * RAPM (1997 on) and prime WOWYR — by TAL band and by era, plus the export's named role players.
 *
 *   npx tsx scripts/auditRolePlayers.ts
 */
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const fit = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return { mx, my, s: a / b, r: a / Math.sqrt(b * c) };
};
const key = (n: string) => normalizePlayerName(n).replace(/[^a-z0-9]+/g, ' ').trim();
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) byName.set(key(s.playerName), [...(byName.get(key(s.playerName)) ?? []), s]);
const best = (spans: PlayerSpan[]) => spans.reduce((a, b) => (computeTalent(b) > computeTalent(a) ? b : a));

// RAPM judge: each player's best span from 1998 on, RAPM on TAL (reverse fit), residual in TAL points.
const rapm = new Map((rapmData as { name: string; peakRapm: number }[]).map((r) => [key(r.name), r.peakRapm]));
const rr = [...byName].flatMap(([k, spans]) => {
  const late = spans.filter((s) => spanEndYears(s.spanLabel)[0] >= 1998);
  if (!late.length || !rapm.has(k)) return [];
  const s = best(late); return [{ s, tal: computeTalent(s), y: rapm.get(k)! }];
});
const f = fit(rr.map((r) => r.tal), rr.map((r) => r.y));
const impliedR = (y: number) => f.mx + (y - f.my) / f.s;
console.log(`RAPM: ${rr.length} players, r ${f.r.toFixed(3)}, ${f.s.toFixed(3)} RAPM per TAL. TAL band → mean (RAPM-implied TAL − TAL), + = TAL too low:`);
for (const [lo, hi] of [[40, 55], [55, 62], [62, 68], [68, 74], [74, 80], [80, 88], [88, 101]]) {
  const g = rr.filter((r) => r.tal >= lo && r.tal < hi); if (g.length < 8) continue;
  const v = g.map((r) => impliedR(r.y) - r.tal), m = mean(v), se = Math.sqrt(mean(v.map((x) => (x - m) ** 2)) / v.length);
  console.log(`  TAL ${lo}-${hi - 1}: n ${String(g.length).padStart(3)}  ${m.toFixed(1).padStart(5)} ±${(1.64 * se).toFixed(1)}`);
}

// WOWYR judge: best span inside the prime, by era of the prime.
const wr = (primeCareerData.rows as string[][]).flatMap((r) => {
  if (r[0].startsWith('np') || Number(r[2]) < 300) return [];
  const spans = byName.get(key(r[0].replace(/\./g, ' '))); if (!spans) return [];
  const b = Number(r[5]), e = Number(r[6]);
  const inPrime = spans.filter((s) => b === 0 || spanEndYears(s.spanLabel).some((y) => y >= b && y <= e)); if (!inPrime.length) return [];
  const s = best(inPrime); return [{ s, tal: computeTalent(s), y: Number(r[1]), year: spanEndYears(s.spanLabel)[0] }];
});
const g = fit(wr.map((r) => r.tal), wr.map((r) => r.y));
const impliedW = (y: number) => g.mx + (y - g.my) / g.s;
console.log(`\nWOWYR: ${wr.length} players, r ${g.r.toFixed(3)}. Role tier (TAL 55-79) by era → mean (WOWYR-implied TAL − TAL):`);
for (const [lo, hi] of [[0, 1980], [1980, 1990], [1990, 1998], [1998, 2010], [2010, 2100]]) {
  const v = wr.filter((r) => r.tal >= 55 && r.tal < 80 && r.year >= lo && r.year < hi).map((r) => impliedW(r.y) - r.tal);
  if (v.length < 8) continue; const m = mean(v), se = Math.sqrt(mean(v.map((x) => (x - m) ** 2)) / v.length);
  console.log(`  ${lo || '<'}–${hi - 1}: n ${String(v.length).padStart(3)}  ${m.toFixed(1).padStart(5)} ±${(1.64 * se).toFixed(1)}`);
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['Tree Rollins 1981-83', 'Bobby Jones 1982-84', 'Norm Van Lier 1977-79', 'Brian Taylor 1980-82', 'Nate McMillan 1993-95', 'Charlie Ward 1997-99', 'Bo Outlaw 1998-00', 'Kendrick Perkins 2008-10', 'Dennis Johnson 1982-84', 'Tony Allen 2010-12', 'Shane Battier 2007-09', 'Baron Davis 1999-01', 'Jason Kidd 2011-13', 'George Hill 2012-14', 'Michael Cooper 1983-85', 'Patrick Beverley 2018-20', 'Charlie Ward 1997-99', 'Theo Ratliff 2002-04', 'Shawn Bradley 1999-01', 'Robert Horry 1997-99', 'Mike Conley 2021-23', 'Clifford Robinson 1999-01', 'Andrew Bogut 2014-16', 'Chuck Hayes 2007-09', 'Larry Smith 1991-93', 'Dale Schlueter 1975-77', 'Felton Spencer 1997-99', 'T.R. Dunn 1987-89', 'Alton Lister 1995-97', 'Michael Cage 1996-98', 'George Lynch 2001-03', 'Josh Okogie 2024-26', 'Royce O\'Neale 2020-22', 'Alex Caruso 2022-24', 'Matisse Thybulle 2020-22'];
const wByKey = new Map(wr.map((r) => [key(r.s.playerName), r.y]));
console.log('\nplayer                         TAL  BPM  WS48  RAPM→TAL  WOWYR→TAL');
for (const n of [...new Set(names)]) {
  const m = n.match(/^(.*) (\d{4}-\d{2})$/)!; const s = draftPool.find((p) => key(p.playerName) === key(m[1]) && p.spanLabel === m[2]);
  if (!s) { console.log(`  ${n}: not in pool`); continue; }
  const real = realSpan(s), k = key(s.playerName);
  const rp = rapm.get(k), w = wByKey.get(k);
  console.log(`${n.padEnd(30)} ${String(computeTalent(s)).padStart(3)}  ${(real?.bpm ?? NaN).toFixed(1).padStart(4)}  ${(real?.ws48 ?? NaN).toFixed(3)}  ${rp === undefined ? '   -' : `${rp.toFixed(1).padStart(4)}→${impliedR(rp).toFixed(0)}`}   ${w === undefined ? '  -' : `${w.toFixed(1)}→${impliedW(w).toFixed(0)}`}`);
}

// Within TAL 55-87: RAPM band residual by usage (the low-usage lift's group).
console.log('\nRAPM, TAL 55-87 by usage → mean (RAPM-implied TAL − TAL):');
for (const [lab, lo, hi] of [['<14%', 0, 14], ['14-17%', 14, 17], ['17-22%', 17, 22], ['22%+', 22, 99]] as const) {
  const v = rr.filter((r) => r.tal >= 55 && r.tal < 88).filter((r) => { const u = realSpan(r.s)?.usg ?? 20; return u >= lo && u < hi; }).map((r) => impliedR(r.y) - r.tal);
  const m = mean(v), se = Math.sqrt(mean(v.map((x) => (x - m) ** 2)) / v.length);
  console.log(`  usg ${lab.padEnd(7)} n ${String(v.length).padStart(3)}  ${m.toFixed(1).padStart(5)} ±${(1.64 * se).toFixed(1)}`);
}

console.log('\nWOWYR, TAL 55-87 by usage and era (usage read from 1977-78):');
for (const [elab, elo, ehi] of [['1978-97', 1978, 1998], ['1998+', 1998, 2100]] as const)
  for (const [lab, lo, hi] of [['<14%', 0, 14], ['14-17%', 14, 17], ['17-22%', 17, 22], ['22%+', 22, 99]] as const) {
    const v = wr.filter((r) => r.tal >= 55 && r.tal < 88 && r.year >= elo && r.year < ehi).filter((r) => { const u = realSpan(r.s)?.usg; return u !== undefined && u >= lo && u < hi; }).map((r) => impliedW(r.y) - r.tal);
    if (v.length < 6) continue; const m = mean(v), se = Math.sqrt(mean(v.map((x) => (x - m) ** 2)) / v.length);
    console.log(`  ${elab} usg ${lab.padEnd(7)} n ${String(v.length).padStart(3)}  ${m.toFixed(1).padStart(5)} ±${(1.64 * se).toFixed(1)}`);
  }
