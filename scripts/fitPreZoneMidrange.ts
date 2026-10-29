import { draftPool } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { midrangeGravitySpacing } from '../src/engine/midrangeGravity';
import { runtimeZoneTotalsForSpan } from '../src/engine/runtimeSpanLookups';
import { realSpan } from '../src/engine/realAdvancedLookup';
import { getHeightInches } from '../src/data/heightLookup';
import { spanEndYears } from '../src/engine/era';
import { writeFileSync } from 'node:fs';

/**
 * 2026-10-29 (the user, on the hand-set pre-1997 midrange list: "to będzie długo z bólem robiona
 * sesja, chyba że masz jakiś pomysł"): can box-score numbers every era has predict the midrange
 * gravity zone data gives from 1996-97 on? Trains on 2005-on spans with zone data, tests on
 * 1997-2004, and compares the hand-set reputation list with what the model reads for those names.
 *
 *   npx tsx scripts/fitPreZoneMidrange.ts [--write]   (--write: src/data/preZoneMidrange.json)
 */
const POS = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 } as const;
function features(p: PlayerSpan): number[] | null {
  const b = p.box;
  if (!b.tsPct || !b.fgPct || p.fga < 3) return null;
  const fta = Math.max(0, (b.ppg / (2 * b.tsPct) - p.fga) / 0.44);
  const twoPA = Math.max(0.1, p.fga - b.threePA);
  const twoPct = Math.max(0, (b.fgPct * p.fga - b.threePA * (b.threePct ?? 0)) / twoPA);
  const real = realSpan(p);
  const mpg = Math.max(12, real?.mpg ?? 30);
  return [
    b.ftPct ?? 0.7,
    fta / p.fga,
    (twoPA * 36) / mpg,
    twoPct,
    real?.orb ?? (b.rpg * 36) / mpg / 2.2,
    getHeightInches(p.playerName) ?? 78,
    POS[p.primaryPosition as keyof typeof POS] ?? 2,
    real?.ast ?? 15,
  ];
}
const endYear = (p: PlayerSpan) => Math.max(...spanEndYears(p.spanLabel));
type Row = { p: PlayerSpan; x: number[]; y: number };
const rows: Row[] = [];
for (const p of draftPool) {
  const z = runtimeZoneTotalsForSpan(p);
  if (!z || z.rimFga + z.midFga + z.threeFga < 150) continue;
  const x = features(p);
  if (x) rows.push({ p, x, y: midrangeGravitySpacing(p) });
}
const train = rows.filter((r) => endYear(r.p) >= 2005);
const test = rows.filter((r) => endYear(r.p) < 2005);
const k = Number(process.env.K ?? 25);
const dims = train[0].x.length;
const mu = Array.from({ length: dims }, (_, i) => train.reduce((s, r) => s + r.x[i], 0) / train.length);
const sd = Array.from({ length: dims }, (_, i) => Math.sqrt(train.reduce((s, r) => s + (r.x[i] - mu[i]) ** 2, 0) / train.length) || 1);
const z = (x: number[]) => x.map((v, i) => (v - mu[i]) / sd[i]);
const trainZ = train.map((r) => ({ ...r, z: z(r.x) }));
function knn(x: number[], skipSelf?: Row): number {
  const q = z(x);
  const near = trainZ
    .filter((r) => r.p !== skipSelf?.p)
    .map((r) => ({ y: r.y, d: Math.hypot(...r.z.map((v, i) => v - q[i])) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
  return near.reduce((s, n) => s + n.y, 0) / near.length;
}
// Quantile map: the model's order, the zone data's spread (kNN averages pull everything to the middle).
const trainPred = train.map((r) => knn(r.x, r)).sort((a, b) => a - b);
const trainY = train.map((r) => r.y).sort((a, b) => a - b);
const QUANTILE = process.env.Q !== '0';
export function predict(x: number[]): number {
  const raw = knn(x);
  if (!QUANTILE) return raw;
  let lo = 0, hi = trainPred.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (trainPred[m] < raw) lo = m + 1; else hi = m; }
  return trainY[Math.min(trainY.length - 1, Math.floor((lo / trainPred.length) * trainY.length))];
}
const r2 = (ys: number[], ps: number[]) => {
  const m = ys.reduce((a, b) => a + b, 0) / ys.length;
  return 1 - ys.reduce((s, y, i) => s + (y - ps[i]) ** 2, 0) / ys.reduce((s, y) => s + (y - m) ** 2, 0);
};
const corr = (a: number[], b: number[]) => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  const c = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0);
  return c / Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0));
};
const tp = test.map((r) => predict(r.x));
console.log(`train ${train.length} spans (2005-) · test ${test.length} (1997-2004) · k ${k}`);
console.log(`test R² ${r2(test.map((r) => r.y), tp).toFixed(3)} · r ${corr(test.map((r) => r.y), tp).toFixed(3)} · mean target ${(test.reduce((s, r) => s + r.y, 0) / test.length).toFixed(1)}`);
// Known names in the test years, as a sanity read.
for (const n of ['Kevin Garnett', 'Chris Webber', 'Karl Malone', 'Tim Duncan', "Shaquille O'Neal", 'Dirk Nowitzki', 'Allen Iverson', 'Michael Jordan', 'Reggie Miller', 'Dikembe Mutombo']) {
  const r = test.find((t) => t.p.playerName === n);
  if (r) console.log(`  ${n.padEnd(18)} ${r.p.spanLabel}: zones ${r.y.toFixed(0).padStart(2)} · model ${predict(r.x).toFixed(0)}`);
}
// Pre-zone spans: the model against the hand list.
const HAND: Record<string, number> = { 'jerry west': 75, 'michael jordan': 75, 'george gervin': 70, 'bob mcadoo': 72, 'rick barry': 65, 'alex english': 65, 'pete maravich': 65, 'karl malone': 60, 'oscar robertson': 60, 'bernard king': 55, 'patrick ewing': 55, 'john havlicek': 55, 'dominique wilkins': 50, 'adrian dantley': 45, 'hakeem olajuwon': 45, 'david robinson': 45, 'isiah thomas': 40, 'clyde drexler': 40, 'kareem abdul-jabbar': 25, 'julius erving': 35, 'kevin mchale': 25, 'charles barkley': 20, 'larry bird': -1, 'magic johnson': -1, 'moses malone': -1, 'wilt chamberlain': -1, 'bill russell': -1, 'kiki vandeweghe': 70, 'dan issel': 50, 'bob lanier': 50, 'kevin johnson': 35, 'james worthy': 35 };
const pre = draftPool.filter((p) => !runtimeZoneTotalsForSpan(p) && endYear(p) < 1997);
const best = new Map<string, { p: PlayerSpan; v: number }>();
for (const p of pre) {
  const x = features(p);
  if (!x) continue;
  const v = predict(x);
  const key = normalizePlayerName(p.playerName);
  if (!best.has(key) || p.fga > best.get(key)!.p.fga) best.set(key, { p, v });
}
const pairs = Object.entries(HAND).filter(([n, v]) => v >= 0 && best.has(n)).map(([n, v]) => [v, best.get(n)!.v]);
console.log(`hand list vs model on ${pairs.length} names: r ${corr(pairs.map((x) => x[0]), pairs.map((x) => x[1])).toFixed(2)}`);
for (const [n, v] of Object.entries(HAND)) { const b = best.get(n); if (b) console.log(`  ${n.padEnd(20)} ${b.p.spanLabel}: hand ${v < 0 ? ' –' : String(v).padStart(2)} · model ${b.v.toFixed(0)}`); }
const nonzero = [...best.values()].filter((b) => b.v >= 20).length;
console.log(`pre-zone players the model gives 20+: ${nonzero} of ${best.size} (hand list: ${Object.keys(HAND).length} named)`);

if (process.argv.includes('--write')) {
  const out: Record<string, number> = {};
  for (const p of pre) {
    const x = features(p);
    if (!x) continue;
    const v = Math.round(predict(x));
    if (v >= 5) out[p.id] = v;
  }
  writeFileSync('src/data/preZoneMidrange.json', JSON.stringify(out));
  console.log(`wrote ${Object.keys(out).length} spans → src/data/preZoneMidrange.json`);
}
