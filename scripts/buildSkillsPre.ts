/**
 * 2026-11-18 (the user: skills before 1997, after the Basketball-Reference totals came in): every
 * window wholly before 1996-97 gets the same 0-100 skills as the 1997+ windows (`skills.json`), from
 * what each era recorded.
 *
 *   npx tsx scripts/buildSkillsPre.ts   → src/data/skillsPre.json  { spanId: { skill: 0-100 } }
 *
 *  1. Two models per skill, fitted on 1997+ windows (their real skill as the target):
 *     A — box + Basketball-Reference advanced (AST%, USG%, STL%, BLK%, ORB%, DRB%, TOV%, DBPM), for
 *         windows that have them (1974-96, USG% from 1978);
 *     B — box only (per-36 points / rebounds / assists against the league, steals and blocks — the
 *         career estimates before 1973-74 — FG% against the league, TS%, FT%, threes, height, weight,
 *         guard / center, age).
 *  2. A bridge: a player with 1997+ windows keeps his mean residual there (shrunk n/(n+1)).
 *  3. The prediction is ranked among his era's pre-1997 windows (middle year ±3, 15+ minutes) — so a
 *     threshold set on the 1997+ skills (rim protector ≥ 93) keeps its meaning.
 * Hold-out printed per skill: fitted on windows from 2003 on, r on 1997-2002 windows (model A, B).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { realSpan } from '../src/engine/realAdvancedLookup';
import { estimatedMinutesPerGame } from '../src/engine/minutesPerGame';
import skillsData from '../src/data/skills.json';
import preStocks from '../src/data/preStocksSeasons.json';

const SK = skillsData as Record<string, Record<string, number>>;
const EST = preStocks as Record<string, [number, number, number]>;
const RAW = resolve(import.meta.dirname, '../src/data/raw');
const csv = (f: string) => { const [h, ...ls] = readFileSync(resolve(RAW, f), 'utf8').trim().split('\n'); const c = h.split(','); return ls.map((l) => { const v = l.split(','); return Object.fromEntries(c.map((k, i) => [k, v[i]])); }); };
const num = (x: string | undefined) => (x === undefined || x === '' ? NaN : Number(x));
const league = new Map<number, { fga: number; trb: number; ast: number; pts: number; fg: number }>();
for (const r of csv('leagueAverages.csv')) { if (r.lg_id !== 'NBA') continue; const row = { fga: num(r.fga_per_g), trb: num(r.trb_per_g), ast: num(r.ast_per_g), pts: num(r.pts_per_g), fg: num(r.fg_pct) }; if (Object.values(row).every(Number.isFinite)) league.set(Number(r.season.slice(0, 4)) + 1, row); }
const bio = new Map<string, { born: number; h: number; w: number; guard: boolean; center: boolean }>();
for (const r of csv('players_bio.csv')) { const born = r.birthDate ? new Date(r.birthDate).getTime() : NaN, h = num(r.heightInches), w = num(r.bodyWeightLbs); if ([born, h, w].every(Number.isFinite)) bio.set(normalizePlayerName(`${r.firstName} ${r.lastName}`), { born, h, w, guard: r.guard === '1', center: r.center === '1' }); }

const ys = (s: PlayerSpan) => spanEndYears(s.spanLabel);
const mid = (s: PlayerSpan) => { const y = ys(s); return (y[0] + y[y.length - 1]) / 2; };
const nearestLeague = (y: number) => { for (let d = 0; d < 10; d++) { const l = league.get(Math.round(y) + d) ?? league.get(Math.round(y) - d); if (l) return l; } return null; };
type W = { s: PlayerSpan; m: number; mpg: number; box: number[] | null; adv: number[] | null };
function features(s: PlayerSpan): W {
  const m = mid(s), mpg = estimatedMinutesPerGame(s) ?? NaN, lg = nearestLeague(m), b = bio.get(normalizePlayerName(s.playerName));
  if (!lg || !b || !(mpg >= 8)) return { s, m, mpg, box: null, adv: null };
  const k = 36 / mpg, x = s.box;
  const est = EST[`${normalizePlayerName(s.playerName)}|${s.spanLabel}`];
  const spg = Math.min(...ys(s)) < 1974 && est ? est[0] : x.spg, bpg = Math.min(...ys(s)) < 1974 && est ? est[1] : x.bpg;
  const age = (Date.UTC(Math.round(m) - 1, 1, 1) - b.born) / 3.15576e10;
  const box = [1, (x.ppg * k) / lg.pts, (x.rpg * k) / lg.trb, (x.apg * k) / lg.ast, spg * k, bpg * k, x.fgPct - lg.fg, x.tsPct || 0.5, Number.isFinite(x.ftPct) && x.ftPct > 0 ? x.ftPct : 0.7, (x.threePA ?? 0) * k, (x.threePA ?? 0) >= 0.5 ? x.threePct : 0, b.h - 80, (b.w - 225) / 25, b.guard ? 1 : 0, b.center ? 1 : 0, age - 27, mpg / 36];
  const r = realSpan(s);
  const advRaw = [r?.ast, r?.usg, r?.stl, r?.blk, r?.orb, r?.drb, r?.tov, r?.dbpm];
  const adv = advRaw.every((v) => typeof v === 'number' && Number.isFinite(v)) ? [...box, ...(advRaw as number[])] : null;
  return { s, m, mpg, box: box.every(Number.isFinite) ? box : null, adv };
}
function wls(X: number[][], y: number[]): number[] {
  const k = X[0].length, A: number[][] = [];
  for (let i = 0; i < k; i++) A.push(new Array(k + 1).fill(0));
  X.forEach((x, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; A[i][k] += x[i] * y[n]; } });
  for (let i = 0; i < k; i++) A[i][i] += 1e-2;
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; const t = A[c]; A[c] = A[p]; A[p] = t; for (let r = 0; r < k; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; } }
  return A.map((row, i) => row[k] / row[i]);
}
const dot = (b: number[], x: number[]) => x.reduce((t, v, i) => t + v * b[i], 0);
const corr = (a: number[], c: number[]) => { const ma = a.reduce((x, y) => x + y) / a.length, mc = c.reduce((x, y) => x + y) / c.length; let ac = 0, aa = 0, cc = 0; a.forEach((v, i) => { ac += (v - ma) * (c[i] - mc); aa += (v - ma) ** 2; cc += (c[i] - mc) ** 2; }); return ac / Math.sqrt(aa * cc); };

const all = draftPool.map(features);
const post = all.filter((w) => Math.min(...ys(w.s)) >= 1997 && SK[w.s.id]);
const pre = all.filter((w) => ys(w.s).length && Math.max(...ys(w.s)) < 1997 && w.box);
const THREE_SKILLS = new Set(['spotUp', 'pullUp3', 'stretch']);
const SKILLS = [...new Set(Object.values(SK).flatMap((r) => Object.keys(r)))];
const out: Record<string, Record<string, number>> = {};
const masked: Record<string, Record<string, number>> = {};
const report: string[] = [];
for (const key of SKILLS) {
  const train = (f: (w: W) => boolean, which: 'box' | 'adv') => { const t = post.filter((w) => w[which] && SK[w.s.id][key] !== undefined && f(w)); return t.length > 100 ? wls(t.map((w) => w[which]!), t.map((w) => SK[w.s.id][key])) : null; };
  // hold-out
  const hold = (which: 'box' | 'adv') => { const b = train((w) => Math.min(...ys(w.s)) >= 2003, which); const t = post.filter((w) => w[which] && SK[w.s.id][key] !== undefined && Math.min(...ys(w.s)) < 2003); return b && t.length > 50 ? corr(t.map((w) => dot(b, w[which]!)), t.map((w) => SK[w.s.id][key])).toFixed(2) : '—'; };
  report.push(`${key.padEnd(14)} hold-out r  A ${hold('adv')}  B ${hold('box')}`);
  const bA = train(() => true, 'adv'), bB = train(() => true, 'box');
  const predict = (w: W) => (w.adv && bA ? dot(bA, w.adv) : w.box && bB ? dot(bB, w.box) : null);
  // 2026-11-25 (the era test): every 1997+ window's skill as the box-era model would read it — fitted on the
  // other half of the 1997+ windows (before / from 2007), no bridge, model A (box + BBRef advanced).
  {
    const early = (w: W) => Math.max(...ys(w.s)) < 2007;
    const bEarly = train(early, 'adv'), bLate = train((w) => !early(w), 'adv');
    const mv = post.filter((w) => w.adv).map((w) => ({ w, v: dot(early(w) ? bLate! : bEarly!, w.adv!) }));
    for (const { w, v } of mv) {
      const peers = mv.filter((q) => Math.abs(q.w.m - w.m) <= 3 && q.w.mpg >= 15).map((q) => q.v);
      if (peers.length >= 30) (masked[w.s.id] ??= {})[key] = Math.round((100 * peers.filter((x) => x < v).length) / peers.length);
    }
  }
  // bridge
  const res = new Map<string, number[]>();
  for (const w of post) { const v = SK[w.s.id][key], p = predict(w); if (v === undefined || p === null) continue; const k = normalizePlayerName(w.s.playerName); res.set(k, [...(res.get(k) ?? []), v - p]); }
  const bridge = (w: W) => { const r = res.get(normalizePlayerName(w.s.playerName)); return r ? (r.reduce((a, b) => a + b, 0) / r.length) * (r.length / (r.length + 1)) : 0; };
  const pv = pre.map((w) => ({ w, v: predict(w) })).filter((x) => x.v !== null).map((x) => ({ ...x, v: x.v! + bridge(x.w) }));
  for (const { w, v } of pv) {
    const peers = pv.filter((q) => Math.abs(q.w.m - w.m) <= 3 && q.w.mpg >= 15).map((q) => q.v);
    if (peers.length < 30) continue;
    // No three-point line before 1979-80: the three-based skills stay out (spacing keeps its label /
    // the game its FT%-based threes). Help without the advanced numbers held out at r 0.44: out too.
    if (THREE_SKILLS.has(key) && Math.min(...ys(w.s)) < 1980) continue;
    if (key === 'help' && !w.adv) continue;
    (out[w.s.id] ??= {})[key] = Math.round((100 * peers.filter((x) => x < v).length) / peers.length);
  }
}
writeFileSync(resolve(import.meta.dirname, '../src/data/skillsPre.json'), JSON.stringify(out));
writeFileSync(resolve(import.meta.dirname, '../src/data/skillsMasked.json'), JSON.stringify(masked));
console.log(report.join('\n'));
console.log(`${Object.keys(out).length} pre-1997 windows written`);
const show = ['Magic Johnson 1986-88', 'Larry Bird 1985-87', 'Michael Jordan 1990-92', 'Hakeem Olajuwon 1992-94', 'John Stockton 1988-90', 'Dennis Rodman 1991-93', 'Bill Russell 1961-63', 'Wilt Chamberlain 1966-68', 'Jerry West 1965-67', 'Oscar Robertson 1963-65', 'Reggie Miller 1993-95', 'Scottie Pippen 1993-95', 'Kareem Abdul-Jabbar 1975-77', 'Walt Frazier 1970-72'];
const head = SKILLS.map((k) => k.slice(0, 6).padStart(6)).join(' ');
console.log('player'.padEnd(28), head);
for (const nm of show) { const w = pre.find((x) => `${x.s.playerName} ${x.s.spanLabel}` === nm); if (!w) continue; console.log(nm.padEnd(28), SKILLS.map((k) => String(out[w.s.id]?.[k] ?? '—').padStart(6)).join(' ')); }
