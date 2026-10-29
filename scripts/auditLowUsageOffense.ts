import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { computeOffensiveTalent } from '../src/engine/talent';
import { spanEndYears } from '../src/engine/era';
import { realSpan } from '../src/engine/realAdvancedLookup';
import rapmData from '../src/data/awards/peakRapm.json';

/**
 * 2026-10-29 (the user: "check Tucker's O-TAL" — O-TAL 40 against a +0.8 offensive RAPM): does
 * O-TAL miss the low-usage player who spaces the floor and does not turn it over? Each player's
 * best-O-TAL span from 1998 on against his peak offensive RAPM; the reverse fit and each group's
 * RAPM over its O-TAL, in O-TAL points (+ = O-TAL too low), by usage, three-point rate (box 3PA
 * over FGA), turnover rate, archetype, and O-TAL band.
 *
 *   npx tsx scripts/auditLowUsageOffense.ts
 */
const key = (n: string) => normalizePlayerName(n).replace(/[^a-z0-9]+/g, ' ').trim();
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const best = new Map<string, PlayerSpan>();
for (const s of draftPool) {
  if (spanEndYears(s.spanLabel)[0] < 1998) continue;
  const k = key(s.playerName);
  if (!best.has(k) || computeOffensiveTalent(s) > computeOffensiveTalent(best.get(k)!)) best.set(k, s);
}
const rows = (rapmData as { name: string; peakOff: number }[]).flatMap((r) => {
  const s = best.get(key(r.name)); const real = s && realSpan(s);
  if (!s || !real || real.usg === undefined || real.mpg < 15) return [];
  const b = s.box as unknown as Record<string, number>;
  const tpa = b.tpa ?? b.fg3a ?? b.threePa;
  return [{ s, o: computeOffensiveTalent(s), y: r.peakOff, usg: real.usg, tov: real.tov ?? 12, ts: real.ts ?? 0.55, r3: tpa !== undefined && s.box.fga ? tpa / s.box.fga : NaN }];
});
const mo = mean(rows.map((r) => r.o)), my = mean(rows.map((r) => r.y));
let a = 0, b = 0, c = 0;
for (const r of rows) { a += (r.o - mo) * (r.y - my); b += (r.o - mo) ** 2; c += (r.y - my) ** 2; }
const slope = a / b;
const res = (r: (typeof rows)[number]) => (r.y - (my + slope * (r.o - mo))) / slope;
console.log(`${rows.length} players (15+ mpg): O-TAL vs peak offensive RAPM r ${(a / Math.sqrt(b * c)).toFixed(3)}, ${slope.toFixed(3)} RAPM per O-TAL point`);
type R = (typeof rows)[number];
const g = (label: string, f: (r: R) => string, filter = (_: R) => true) => console.log(` by ${label}:`, Object.entries(Object.groupBy(rows.filter(filter), f)).sort().filter(([, v]) => v!.length >= 10).map(([k, v]) => { const x = v!.map(res), m = mean(x), se = Math.sqrt(mean(x.map((q) => (q - m) ** 2)) / x.length); return `${k} ${m.toFixed(1)}±${(1.64 * se).toFixed(1)} (n ${x.length})`; }).join(' · '));
const usgBand = (r: R) => (r.usg < 12 ? 'a <12' : r.usg < 15 ? 'b 12-15' : r.usg < 18 ? 'c 15-18' : r.usg < 22 ? 'd 18-22' : 'e 22+');
g('usage', usgBand);
g('usage — O-TAL 30-60', usgBand, (r) => r.o >= 30 && r.o < 60);
g('turnover rate — usage under 15', (r) => (r.tov < 10 ? 'a <10' : r.tov < 13 ? 'b 10-13' : r.tov < 16 ? 'c 13-16' : 'd 16+'), (r) => r.usg < 15);
g('TS% — usage under 15', (r) => (r.ts < 0.52 ? 'a <.52' : r.ts < 0.56 ? 'b .52-.56' : r.ts < 0.6 ? 'c .56-.60' : 'd .60+'), (r) => r.usg < 15);
if (rows.some((r) => !Number.isNaN(r.r3))) g('3PA rate — usage under 15', (r) => (r.r3 < 0.2 ? 'a <20%' : r.r3 < 0.4 ? 'b 20-40%' : r.r3 < 0.6 ? 'c 40-60%' : 'd 60%+'), (r) => r.usg < 15 && !Number.isNaN(r.r3));
g('archetype — usage under 15', (r) => r.s.offensiveArchetype, (r) => r.usg < 15);
g('O-TAL band', (r) => (r.o < 30 ? 'a <30' : r.o < 45 ? 'b 30-44' : r.o < 60 ? 'c 45-59' : r.o < 75 ? 'd 60-74' : 'e 75+'));
for (const n of ['P.J. Tucker', 'Shane Battier', 'Bruce Bowen', 'Danny Green', 'Robert Horry', 'Derek Fisher', 'Jae Crowder', 'Trevor Ariza']) {
  const t = rows.find((r) => r.s.playerName === n);
  if (t) console.log(`  ${n} ${t.s.spanLabel}: O-TAL ${t.o.toFixed(0)}, usg ${t.usg.toFixed(0)}, TS ${t.ts.toFixed(3)}, TOV% ${t.tov.toFixed(0)}, 3PA ${(100 * t.r3).toFixed(0)}% · RAPM-O ${t.y} → reads O-TAL ${(t.o + res(t)).toFixed(0)}`);
}
