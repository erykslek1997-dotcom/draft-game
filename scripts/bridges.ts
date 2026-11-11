/**
 * 2026-11-11, "Siła epoki" by bridges (the user: "takie mosty wydają mi się lepszym rozwiązaniem").
 * The same player measures two leagues: from one season to the next, his league-relative number
 * (PER, normalised to a league average of 15 every season; WS/48; BPM from 1973-74) changes by
 * his aging plus the change in the league around him. Over every player-season pair:
 *
 *   delta = aging(age) + league(year) + noise
 *
 * fitted by least squares on age and season dummies, weighted by the pair's minutes. A league(year)
 * below zero means everybody, at every age, lost ground that season: the league got stronger.
 * Cumulated, it is a league-strength curve.
 *
 * One thing the deltas cannot tell apart: a league that gets a little stronger every year from
 * players who age a little worse every year. That overall slope needs an anchor on the aging curve;
 * the standard one is "no change from 27 to 28" (the peak). Shown with anchors at 26, 27 and 28 so
 * the reader sees how much of the long-run trend rests on it. The year-to-year shape (expansions,
 * the 1976 merger) does not depend on the anchor.
 *
 *   npx tsx scripts/bridges.ts [--metric=per|ws48|bpm] [--min=500]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const METRIC = args.metric ?? 'per';
const MIN = Number(args.min ?? 500);
const IDX = { per: 2, ws48: 3, bpm: 4 }[METRIC as 'per' | 'ws48' | 'bpm'];
const SCALE = METRIC === 'ws48' ? 100 : 1; // WS/48 in hundredths, so its numbers read like PER's
// League average of each metric (PER is normalised to 15; WS/48 ~0.100; BPM 0).
const LEAGUE_MEAN = { per: 15, ws48: 0.1, bpm: 0 }[METRIC as 'per' | 'ws48' | 'bpm'];
// Regression to the mean: a player measured high one season reads lower the next for luck alone,
// and good seasons buy the minutes that put a pair in the sample. Without a term for it that pull
// reads as "the league got stronger" every season. `--rtm=0` turns the term off.
const RTM = args.rtm !== '0';

// [age, minutes, PER, WS/48, BPM] by playerId|seasonEnd
const DATA = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/bbrefBridges.json'), 'utf8')) as Record<string, (number | null)[]>;
const byPlayer = new Map<string, Map<number, (number | null)[]>>();
for (const [k, v] of Object.entries(DATA)) {
  const [id, y] = k.split('|');
  if (!byPlayer.has(id)) byPlayer.set(id, new Map());
  byPlayer.get(id)!.set(Number(y), v);
}

const AGE_MIN = 20, AGE_MAX = 37;
type Pair = { age: number; year: number; delta: number; w: number; level: number };
const pairs: Pair[] = [];
for (const seasons of byPlayer.values()) {
  for (const [y, a] of seasons) {
    const b = seasons.get(y + 1);
    if (!b) continue;
    const va = a[IDX!], vb = b[IDX!];
    if (va == null || vb == null || (a[1] as number) < MIN || (b[1] as number) < MIN) continue;
    const age = Math.max(AGE_MIN, Math.min(AGE_MAX, a[0] as number));
    const w = 2 / (1 / (a[1] as number) + 1 / (b[1] as number)); // harmonic mean of the minutes
    pairs.push({ age, year: y + 1, delta: ((vb as number) - (va as number)) * SCALE, w, level: ((va as number) - LEAGUE_MEAN) * SCALE });
  }
}
const years = [...new Set(pairs.map((p) => p.year))].sort((a, b) => a - b);
const ages = Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => AGE_MIN + i);
console.log(`${METRIC}: ${pairs.length} season-to-season pairs (both seasons ${MIN}+ minutes), seasons ${years[0] - 1}-${years[years.length - 1]}`);

// Weighted least squares: one coefficient per age (full set) and per season but the first.
const P = ages.length + years.length - 1 + (RTM ? 1 : 0);
const col = (p: Pair): number[] => {
  const x = new Array(P).fill(0);
  x[p.age - AGE_MIN] = 1;
  const yi = years.indexOf(p.year);
  if (yi > 0) x[ages.length + yi - 1] = 1;
  if (RTM) x[P - 1] = p.level;
  return x;
};
const A = Array.from({ length: P }, () => new Array(P + 1).fill(0));
for (const p of pairs) {
  const x = col(p);
  for (let i = 0; i < P; i++) {
    if (!x[i]) continue;
    for (let j = 0; j < P; j++) if (x[j]) A[i][j] += p.w * x[i] * x[j];
    A[i][P] += p.w * x[i] * p.delta;
  }
}
for (let i = 0; i < P; i++) {
  let piv = i;
  for (let r = i + 1; r < P; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
  [A[i], A[piv]] = [A[piv], A[i]];
  const d = A[i][i];
  if (Math.abs(d) < 1e-9) continue;
  for (let j = i; j <= P; j++) A[i][j] /= d;
  for (let r = 0; r < P; r++) if (r !== i && A[r][i] !== 0) { const f = A[r][i]; for (let j = i; j <= P; j++) A[r][j] -= f * A[i][j]; }
}
const beta = A.map((r) => r[P]);
const agingRaw = ages.map((_, i) => beta[i]);
if (RTM) console.log(`regression to the mean: ${beta[P - 1].toFixed(3)} a point above the league average`);
const seasonRaw = years.map((_, i) => (i === 0 ? 0 : beta[ages.length + i - 1]));

// Anchor: aging(anchorAge) = 0. Moving c from aging to every season keeps the fit identical.
function curve(anchorAge: number) {
  const c = agingRaw[anchorAge - AGE_MIN];
  const aging = agingRaw.map((a) => a - c);
  const season = seasonRaw.map((s) => s + c);
  // League strength: minus the cumulated season effect (players losing ground = a stronger league).
  let cum = 0;
  const strength = new Map<number, number>();
  strength.set(years[0] - 1, 0);
  years.forEach((y, i) => { cum -= season[i]; strength.set(y, cum); });
  return { aging, season, strength };
}

const base = curve(27);
console.log('\nAging, change a season (anchor: 27 -> 28 = 0):');
console.log('  ' + ages.filter((a) => a <= 36).map((a) => `${a}: ${base.aging[a - AGE_MIN] >= 0 ? '+' : ''}${base.aging[a - AGE_MIN].toFixed(2)}`).join('  '));

console.log(`\nSeason effect (- = the whole league lost ground that season, i.e. it got stronger), anchor 27:`);
const events: Record<number, string> = {
  1950: 'NBA formed (BAA+NBL)', 1955: 'shot clock year 1', 1962: 'Chicago expansion', 1967: 'expansion + ABA founded',
  1968: 'expansion', 1969: 'expansion', 1971: 'expansion (3 teams)', 1975: 'New Orleans expansion', 1977: 'ABA merger',
  1981: 'Dallas', 1989: 'Charlotte, Miami', 1990: 'Orlando, Minnesota', 1996: 'Toronto, Vancouver',
  1999: 'lockout', 2005: 'Charlotte', 2012: 'lockout',
};
for (let i = 0; i < years.length; i++) {
  const y = years[i];
  const e = base.season[i];
  const n = pairs.filter((p) => p.year === y).length;
  const mark = Math.abs(e) >= 0.3 ? ' <<' : '';
  if (events[y] || Math.abs(e) >= 0.3) console.log(`  ${y - 1}-${String(y).slice(2)}  ${(e >= 0 ? '+' : '') + e.toFixed(2)}  (n ${n})${events[y] ? '  ' + events[y] : ''}${mark}`);
}

console.log(`\nLeague strength, ${METRIC} points above the ${years[0] - 1} league (+ = stronger), by aging anchor:`);
const curves = [26, 27, 28].map((a) => ({ a, c: curve(a) }));
console.log('  season   ' + curves.map(({ a }) => `anchor ${a}`.padStart(10)).join(''));
for (const y of [1951, 1955, 1960, 1965, 1970, 1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025]) {
  if (!base.strength.has(y)) continue;
  console.log(`  ${y - 1}-${String(y).slice(2)}  ` + curves.map(({ c }) => c.strength.get(y)!.toFixed(1).padStart(10)).join(''));
}
