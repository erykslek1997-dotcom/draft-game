/**
 * 2026-11-18 (the user: "rób estymacje całych karier"): steals and blocks for every season before the
 * NBA counted them (1973-74), season by season, so a player's windows come from one career curve.
 *
 *   npx tsx scripts/buildPreStocks.ts            → writes src/data/preStocksSeasons.json
 *
 * Three layers:
 *  1. A per-season model fitted on 1974+ seasons (400+ minutes): the stat per 36 minutes over the
 *     league's FG attempts a team-game — an opportunity rate, so the 1960s' 110 attempts (today 89) are
 *     carried by the league line, not guessed. Log rate on age, age², height, weight, rebounds /
 *     assists / points per 36 relative to the league, FG% against the league, FT%, guard / center.
 *  2. A player effect (the bridge): a player with 1974+ seasons keeps his mean residual there (shrunk
 *     by n/(n+1) seasons) in his earlier seasons.
 *  3. Documented counts (`reportedBlocks.ts`): the career is scaled to the reported average, and a
 *     season counted in full is set to its count (Wilt 1972-73: 446 blocks).
 * Printed: the hold-out check — on 1974-92 careers, the first seasons predicted with and without the
 * player effect from seasons 3+ years later.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizePlayerName } from '../src/data/schema';
import { REPORTED_BLOCKS } from '../src/data/reportedBlocks';
import { draftPool } from '../src/data/draftPool';
import { spanEndYears } from '../src/engine/era';
import { estimatedMinutesPerGame } from '../src/engine/minutesPerGame';
const windowKey = new Map<object, string>();

const RAW = resolve(import.meta.dirname, '../src/data/raw');
const csv = (f: string) => {
  const [head, ...lines] = readFileSync(resolve(RAW, f), 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
};
const num = (x: string | undefined) => (x === undefined || x === '' ? NaN : Number(x));

// League line per season end year: FGA, rebounds, assists, points a team-game, FG%.
const league = new Map<number, { fga: number; trb: number; ast: number; pts: number; fg: number }>();
for (const r of csv('leagueAverages.csv')) {
  if (r.lg_id !== 'NBA') continue;
  const end = Number(r.season.slice(0, 4)) + 1;
  const row = { fga: num(r.fga_per_g), trb: num(r.trb_per_g), ast: num(r.ast_per_g), pts: num(r.pts_per_g), fg: num(r.fg_pct) };
  if (Object.values(row).every(Number.isFinite)) league.set(end, row);
}
const bio = new Map<string, { born: number; h: number; w: number; guard: boolean; center: boolean }>();
for (const r of csv('players_bio.csv')) {
  const born = r.birthDate ? new Date(r.birthDate).getTime() : NaN;
  const h = num(r.heightInches), w = num(r.bodyWeightLbs);
  if (!Number.isFinite(born) || !Number.isFinite(h) || !Number.isFinite(w)) continue;
  bio.set(r.personId, { born, h, w, guard: r.guard === '1', center: r.center === '1' });
}

interface Season { id: string; name: string; year: number; g: number; min: number; x: number[]; stl: number; blk: number; lgFga: number }
const seasons: Season[] = [];
// 2026-11-18: built on the pool's windows, not playerSeasonStats.csv — that file is incomplete before the
// 1980s (1974: 3,371 steals against the league's ~6,060; 1960: 22.6k minutes against ~140k; Frazier 1974
// at 21 steals). A "season" here is a window at its middle year; g = 82 per season in it.
const bioByName = new Map<string, { born: number; h: number; w: number; guard: boolean; center: boolean }>();
for (const r of csv('players_bio.csv')) { const b = bio.get(r.personId); if (b) bioByName.set(normalizePlayerName(`${r.firstName} ${r.lastName}`), b); }
for (const sp of draftPool) {
  const ys = spanEndYears(sp.spanLabel); if (!ys.length) continue;
  const year = Math.round((ys[0] + ys[ys.length - 1]) / 2), lg = league.get(year), b = bioByName.get(normalizePlayerName(sp.playerName));
  const mpg = estimatedMinutesPerGame(sp) ?? NaN;
  if (!lg || !b || !(mpg >= 12)) continue;
  const k = 36 / mpg, x0 = sp.box;
  const age = (Date.UTC(year - 1, 1, 1) - b.born) / (365.25 * 86400000);
  const x = [
    1, age - 27, (age - 27) ** 2, b.h - 80, (b.w - 225) / 25,
    (x0.rpg * k) / lg.trb, (x0.apg * k) / lg.ast, (x0.ppg * k) / lg.pts,
    x0.fgPct - lg.fg, Number.isFinite(x0.ftPct) && x0.ftPct > 0 ? x0.ftPct : 0.7,
    b.guard ? 1 : 0, b.center ? 1 : 0,
  ];
  if (!x.every(Number.isFinite)) continue;
  const full = Math.min(...ys) >= 1974;
  seasons.push({ id: normalizePlayerName(sp.playerName), name: sp.playerName, year: full ? year : Math.max(...ys) < 1974 ? year : -year, g: 82 * ys.length, min: mpg * 82 * ys.length, x, stl: full ? x0.spg * k : NaN, blk: full ? x0.bpg * k : NaN, lgFga: lg.fga });
  windowKey.set(seasons[seasons.length - 1], `${normalizePlayerName(sp.playerName)}|${sp.spanLabel}`);
}

function wls(X: number[][], y: number[], w: number[]): number[] {
  const k = X[0].length, A: number[][] = [];
  for (let i = 0; i < k; i++) A.push(new Array(k + 1).fill(0));
  X.forEach((x, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += w[n] * x[i] * x[j]; A[i][k] += w[n] * x[i] * y[n]; } });
  for (let i = 0; i < k; i++) A[i][i] += 1e-3;
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    const t = A[c]; A[c] = A[p]; A[p] = t;
    for (let r = 0; r < k; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((row, i) => row[k] / row[i]);
}
const dot = (b: number[], x: number[]) => x.reduce((t, v, i) => t + v * b[i], 0);
const corr = (a: number[], c: number[]) => { const ma = a.reduce((x, y) => x + y) / a.length, mc = c.reduce((x, y) => x + y) / c.length; let ac = 0, aa = 0, cc = 0; a.forEach((v, i) => { ac += (v - ma) * (c[i] - mc); aa += (v - ma) ** 2; cc += (c[i] - mc) ** 2; }); return ac / Math.sqrt(aa * cc); };

const EPS = 0.002;
const counted = seasons.filter((s) => s.year >= 1974 && Number.isFinite(s.stl) && Number.isFinite(s.blk));
const out: Record<string, [number, number, number]> = {};
const report: string[] = [];
const effects: Record<'stl' | 'blk', Map<string, number>> = { stl: new Map(), blk: new Map() };
const models: Record<'stl' | 'blk', number[]> = { stl: [], blk: [] };
const smear: Record<'stl' | 'blk', number> = { stl: 1, blk: 1 };
const specOf: Record<'stl' | 'blk', Set<string>> = { stl: new Set(), blk: new Set() };
const ageCurves: Record<'stl' | 'blk', { spec: number[]; rest: number[] }> = { stl: { spec: [0, 0], rest: [0, 0] }, blk: { spec: [0, 0], rest: [0, 0] } };
const fullPred = (key: 'stl' | 'blk', x: number[], spec: boolean) => dot(models[key], x.map((v, i) => (i === 1 || i === 2 ? 0 : v))) + (spec ? ageCurves[key].spec : ageCurves[key].rest).reduce((t, c, j) => t + c * x[j + 1], 0);

for (const key of ['stl', 'blk'] as const) {
  const rate = (s: Season) => Math.log(s[key] / s.lgFga + EPS);
  // 2026-11-18 (the user: Thurmond at 3.6 beside Wilt and Russell's 8): the age curve across players
  // came out flat (Thurmond peak / 32-33 ~0.8), while the same blockers lose about 43% from 25-27 to
  // 32-33 (median of 34 since 1974, both 1974-89 and 1990+ peaks: 0.57). The bridge carries a player
  // across his own career, so the age terms are fitted WITHIN players (each player's windows centred
  // on his own means), the rest across players with the age part held fixed.
  const AGE = [1, 2];
  // Specialists (a window of 2+ a 36 at 25-29) age much faster than the rest: blocking and steals ride
  // on athleticism. Two within-player curves; a pre-1974 player takes the specialists' curve when his
  // estimate at 27 reaches the same 2 a 36.
  const byPlayer = new Map<string, Season[]>();
  for (const q of counted) byPlayer.set(q.id, [...(byPlayer.get(q.id) ?? []), q]);
  const SPEC = 2.0;
  const isSpec = (list: Season[]) => list.some((q) => q.x[1] >= -2 && q.x[1] <= 2 && q[key] >= SPEC);
  const fitAge = (spec: boolean) => {
    const wx: number[][] = [], wy: number[] = [], ww: number[] = [];
    for (const list of byPlayer.values()) {
      if (list.length < 3 || isSpec(list) !== spec) continue;
      const W = list.reduce((t, q) => t + q.min, 0);
      const ma = AGE.map((i) => list.reduce((t, q) => t + q.min * q.x[i], 0) / W), my = list.reduce((t, q) => t + q.min * rate(q), 0) / W;
      for (const q of list) { wx.push(AGE.map((i) => q.x[i] - ma[AGE.indexOf(i)])); wy.push(rate(q) - my); ww.push(q.min); }
    }
    return wls(wx, wy, ww);
  };
  const ageSpec = fitAge(true), ageRest = fitAge(false);
  specOf[key] = new Set([...byPlayer].filter(([, l]) => isSpec(l)).map(([id]) => id));
  ageCurves[key] = { spec: ageSpec, rest: ageRest };
  const ageOf = (x: number[], spec: boolean) => AGE.reduce((t, i, j) => t + (spec ? ageSpec : ageRest)[j] * x[i], 0);
  const rest = wls(counted.map((q) => q.x.map((v, i) => (AGE.includes(i) ? 0 : v))), counted.map((q) => rate(q) - ageOf(q.x, specOf[key].has(q.id))), counted.map((q) => q.min));
  const b = rest;
  const ageB = ageSpec;
  const r32 = (a: number[]) => Math.exp(a[0] * 6.5 + a[1] * (5.5 ** 2 - 1)).toFixed(2);
  report.push(`${key}: within-player age, 32.5 vs 26 — specialists x${r32(ageSpec)} (${specOf[key].size} players), the rest x${r32(ageRest)}`);
  models[key] = b;
  // Duan's smearing: exp of a fitted log is a median, not a mean — scale back by the mean of exp(residual).
  const wsum = counted.reduce((t, s) => t + s.min, 0);
  smear[key] = counted.reduce((t, s) => t + s.min * Math.exp(rate(s) - fullPred(key, s.x, specOf[key].has(s.id))), 0) / wsum;
  const predMean = counted.reduce((t, s) => t + s.min * ((Math.exp(fullPred(key, s.x, specOf[key].has(s.id))) * smear[key] - EPS) * s.lgFga), 0) / wsum;
  const realMean = counted.reduce((t, s) => t + s.min * s[key], 0) / wsum;
  report.push(`${key}: smearing x${smear[key].toFixed(3)}; 1974+ minute-weighted per 36 — model ${predMean.toFixed(3)}, real ${realMean.toFixed(3)}`);
  // Player effect from 1974+ seasons, shrunk by n/(n+1).
  const res = new Map<string, number[]>();
  for (const s of counted) res.set(s.id, [...(res.get(s.id) ?? []), rate(s) - fullPred(key, s.x, specOf[key].has(s.id))]);
  for (const [id, r] of res) effects[key].set(id, (r.reduce((a, c) => a + c, 0) / r.length) * (r.length / (r.length + 1)));
  // Hold-out: careers starting 1974-80 with 6+ seasons; first 3 seasons predicted, effect from seasons 3+ years after.
  const byId = new Map<string, Season[]>();
  for (const s of counted) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
  const truth: number[] = [], bare: number[] = [], bridged: number[] = [];
  for (const list of byId.values()) {
    list.sort((p, q) => p.year - q.year);
    if (list.length < 6 || list[0].year > 1980) continue;
    const first = list.slice(0, 3), later = list.filter((s) => s.year >= first[2].year + 3);
    if (!later.length) continue;
    const r = later.map((s) => rate(s) - fullPred(key, s.x, specOf[key].has(s.id)));
    const u = (r.reduce((a, c) => a + c, 0) / r.length) * (r.length / (r.length + 1));
    for (const s of first) { truth.push(s[key] * 36 / 36); bare.push((Math.exp(fullPred(key, s.x, specOf[key].has(s.id))) - EPS) * s.lgFga); bridged.push((Math.exp(fullPred(key, s.x, specOf[key].has(s.id)) + u) - EPS) * s.lgFga); }
  }
  report.push(`${key}: hold-out on ${truth.length} early seasons — model alone r ${corr(bare, truth).toFixed(3)}, with the bridge r ${corr(bridged, truth).toFixed(3)}`);
}

// Estimates for every season before 1973-74, per game (per 36 × his minutes a game).
const pre = seasons.filter((s) => s.year > 0 && s.year < 1974);
const est = new Map<string, { name: string; year: number; g: number; min: number; stl: number; blk: number; key: string }[]>();
for (const s of pre) {
  const mpg = s.min / s.g;
  const f = (key: 'stl' | 'blk') => {
    const u = effects[key].get(s.id) ?? 0;
    // Specialist if he is one in his 1974+ windows, or if his estimate at 27 reaches 2 a 36.
    const at27 = s.x.map((v, i) => (i === 1 || i === 2 ? 0 : v));
    const spec = specOf[key].has(s.id) || (Math.exp(fullPred(key, at27, false) + u) * smear[key] - EPS) * s.lgFga >= 2.0;
    return Math.max(0, (Math.exp(fullPred(key, s.x, spec) + u) * smear[key] - EPS) * s.lgFga) * (mpg / 36);
  };
  est.set(s.id, [...(est.get(s.id) ?? []), { name: s.name, year: s.year, g: s.g, min: s.min, stl: f('stl'), blk: f('blk'), key: windowKey.get(s)! }]);
}
// Documented counts: the career scaled to the reported average; a fully counted season replaces its
// share of every window it sits in (Wilt 1971-73 = two estimated seasons and 1972-73's 5.4).
for (const [name, r] of Object.entries(REPORTED_BLOCKS)) {
  const list = est.get(normalizePlayerName(name));
  if (!list) { report.push(`reported ${name}: no windows found`); continue; }
  const fixed = Object.entries(r.seasons ?? {}).map(([y, v]) => [Number(y), v] as const);
  const years = (q: { key: string }) => spanEndYears(q.key.split('|')[1]);
  const valueAt = (q: (typeof list)[number], k: number) => { const ys = years(q); return ys.reduce((t, y) => t + (fixed.find(([fy]) => fy === y)?.[1] ?? q.blk * k), 0) / ys.length; };
  const mean = (k: number) => list.reduce((t, q) => t + valueAt(q, k) * q.g, 0) / list.reduce((t, q) => t + q.g, 0);
  let lo = 0, hi = 20;
  for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (mean(m) < r.bpg) lo = m; else hi = m; }
  for (const q of list) q.blk = valueAt(q, lo);
  report.push(`reported ${name}: career ${r.bpg} over ${list.length} windows, model scaled x${lo.toFixed(2)}`);
}
for (const list of est.values()) for (const s of list) out[s.key] = [+s.stl.toFixed(2), +s.blk.toFixed(2), s.year];

writeFileSync(resolve(import.meta.dirname, '../src/data/preStocksSeasons.json'), JSON.stringify(out));
console.log(report.join('\n'));
console.log(`${Object.keys(out).length} seasons before 1973-74 written`);
for (const n of ['Wilt Chamberlain', 'Bill Russell', 'Nate Thurmond', 'Jerry West', 'Walt Frazier', 'Oscar Robertson', 'Bob Cousy', 'George Mikan']) {
  const rows = Object.entries(out).filter(([k]) => k.startsWith(normalizePlayerName(n) + '|')).sort();
  console.log(n.padEnd(18), rows.map(([k, v]) => `${k.split('|')[1]}:${v[0].toFixed(1)}/${v[1].toFixed(1)}`).join(' '));
}
if (process.argv.includes('--debug')) {
  for (const n of ['Walt Frazier', 'Jerry West']) {
    for (const s of seasons.filter((q) => q.name === n)) {
      const p = (Math.exp(dot(models.stl, s.x)) * smear.stl - EPS) * s.lgFga;
      console.log(n, s.year, 'mpg', (s.min / s.g).toFixed(1), 'real stl36', s.stl.toFixed(2), 'model stl36', p.toFixed(2), 'effect', (effects.stl.get(s.id) ?? 0).toFixed(2), 'x', s.x.map((v) => v.toFixed(2)).join(' '));
    }
  }
}
