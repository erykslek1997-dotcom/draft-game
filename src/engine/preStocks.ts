/**
 * 2026-11-18 (the user: "mosty i podobieństwa" — Elmore Smith blocked 4.9 a game in 1973-74, the first
 * season the league counted): steals and blocks were not recorded before 1973-74, so a window wholly
 * before then came into the game with none — Russell, Wilt, Thurmond as no rim protectors at all.
 * The game reads such a window's stocks from:
 *  - a bridge: the same player's nearest window wholly from 1973-74 on, blocks scaled by his rebounds,
 *    steals by his scoring + assists (on 1974-92 windows 3+ seasons apart, r 0.931 blocks, 0.885 steals);
 *  - else a regression on rebounds, assists, points, FG%, FT% and position, fitted on 1974-86
 *    (`scripts/_fitStocks.ts`; r 0.745 / 0.770 on 1974-92).
 * In today's game terms (`modernBox`'s pace and league scaling): the bridge window's own ratio, else
 * the pool's. Only the game reads it (`liveDefense`, `liveGame`); TAL and D-TAL are untouched.
 * `SIM_PRE_STOCKS=0` = off.
 */
import type { PlayerSpan } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { spanEndYears } from './era';
import { envVar } from './env';
import { modernBox } from './modernBox';
import { getHeightInches, getBodyWeightLbs } from '../data/heightLookup';

const ON = envVar('SIM_PRE_STOCKS') !== '0';
const FIRST_FULL = 1974;
const REG = {
  bpg: [0.482, 0.079, -0.026, 0.009, 0.838, -1.117, 0.024, -0.058, 0.015, 0.661],
  spg: [1.35, 0.06, 0.126, 0.007, -0.779, -0.536, -0.008, -0.255, -0.484, -0.698],
};
const POS = ['SG', 'SF', 'PF', 'C'];
const MODERN_RATIO = 0.88;

const years = (s: PlayerSpan) => spanEndYears(s.spanLabel);
const mid = (s: PlayerSpan) => { const y = years(s); return (y[0] + y[y.length - 1]) / 2; };
let fullByName: Map<string, PlayerSpan[]> | null = null;
function fullWindows(name: string): PlayerSpan[] {
  if (!fullByName) {
    fullByName = new Map();
    for (const s of draftPool) if (years(s).length && Math.min(...years(s)) >= FIRST_FULL) fullByName.set(s.playerName, [...(fullByName.get(s.playerName) ?? []), s]);
  }
  return fullByName.get(name) ?? [];
}
const cache = new WeakMap<PlayerSpan, { spg: number; bpg: number }>();

/** Steals and blocks a game in today's terms, as the game reads them. */
export function gameStocks(span: PlayerSpan): { spg: number; bpg: number } {
  let c = cache.get(span);
  if (!c) {
    const m = modernBox(span);
    const ys = years(span);
    if (!ON || !ys.length || Math.max(...ys) >= FIRST_FULL) c = { spg: m.spg, bpg: m.bpg };
    else {
      const b = span.box;
      const bridge = fullWindows(span.playerName).sort((x, y) => Math.abs(mid(x) - mid(span)) - Math.abs(mid(y) - mid(span)))[0];
      if (bridge) {
        const bm = modernBox(bridge);
        c = {
          bpg: bm.bpg * (b.rpg + 1) / (bridge.box.rpg + 1),
          spg: bm.spg * (b.ppg + b.apg + 3) / (bridge.box.ppg + bridge.box.apg + 3),
        };
      } else {
        const x = [1, b.rpg, b.apg, b.ppg, b.fgPct, b.ftPct, ...POS.map((p) => (span.primaryPosition === p ? 1 : 0))];
        const f = (w: number[]) => Math.max(0, x.reduce((t, v, i) => t + v * w[i], 0)) * MODERN_RATIO;
        const byHeight = heightBlocks(span);
        c = { bpg: byHeight ?? f(REG.bpg), spg: f(REG.spg) };
      }
    }
    cache.set(span, c);
  }
  return c;
}

/**
 * Blocks without a bridge (2026-11-18, the user: Wilt and Russell at 2.5 "w swoich czasach?"): the box
 * alone shrinks the best shot blockers to the middle (top-10 of 1974-92 read 1.8 against a real 4.3).
 * Height and weight carry most of it: a log model on height, height², weight, rebounds, assists, FG%
 * and FT% (fitted on 1974-86, `scripts/_fitBlkH.ts`), then the window's rank among his era's windows
 * (±3 seasons, so the 1960s' pace-inflated rebounds don't lift everyone) read on the real 1974-86
 * distribution: r 0.800 on 1974-92, top-10 4.84 against 4.31. Wilt, Russell, Kareem 1971-73 ~5.1,
 * Bellamy 3.3, Thurmond 2.8 (his first counted season 2.9), Unseld 2.0 — before today's scaling.
 */
const HB = new Array(8).fill(0);
let heightModel: { b: number[]; real: number[]; byYear: Map<number, { name: string; v: number }[]> } | null = null;
const hFeat = (s: PlayerSpan): number[] | null => {
  const h = getHeightInches(s.playerName), w = getBodyWeightLbs(s.playerName), x = s.box;
  if (h === undefined || w === undefined || ![x.rpg, x.apg, x.fgPct, x.ftPct].every(Number.isFinite)) return null;
  return [1, h - 80, (h - 80) ** 2, (w - 225) / 25, x.rpg, x.apg, x.fgPct, x.ftPct];
};
function fitHeightModel() {
  const rows: { f: number[]; y: number }[] = [];
  for (const s of draftPool) { const y = years(s); if (!y.length || Math.min(...y) < FIRST_FULL || mid(s) > 1986 || !Number.isFinite(s.box.bpg)) continue; const f = hFeat(s); if (f) rows.push({ f, y: s.box.bpg }); }
  const k = HB.length, A: number[][] = [];
  for (let i = 0; i < k; i++) A.push(new Array(k + 1).fill(0));
  for (const { f, y } of rows) { const ly = Math.log(y + 0.1); for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += f[i] * f[j]; A[i][k] += f[i] * ly; } }
  for (let i = 0; i < k; i++) A[i][i] += 1e-3;
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; const t = A[c]; A[c] = A[p]; A[p] = t; for (let r = 0; r < k; r++) { if (r === c) continue; const q = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= q * A[c][j]; } }
  const b = A.map((row, i) => row[k] / row[i]);
  const byYear = new Map<number, { name: string; v: number }[]>();
  for (const s of draftPool) { const f = hFeat(s); if (!f || !years(s).length) continue; const m = Math.round(mid(s)); byYear.set(m, [...(byYear.get(m) ?? []), { name: s.playerName, v: score(b, f) }]); }
  // The k-th best shot blocker of a typical 1974-86 season (each player's best window around that year).
  const perYear: number[][] = [];
  for (let y = 1976; y <= 1985; y++) {
    const best = new Map<string, number>();
    for (const s of draftPool) { const ys = years(s); if (!ys.length || Math.min(...ys) < FIRST_FULL || Math.abs(mid(s) - y) > 1 || !Number.isFinite(s.box.bpg)) continue; best.set(s.playerName, Math.max(best.get(s.playerName) ?? 0, s.box.bpg)); }
    perYear.push([...best.values()].sort((a, c) => c - a));
  }
  const depth = Math.min(...perYear.map((v) => v.length));
  const real = Array.from({ length: depth }, (_, k) => perYear.reduce((t, v) => t + v[k], 0) / perYear.length);
  heightModel = { b, real, byYear };
}
const score = (b: number[], f: number[]) => f.reduce((t, v, i) => t + v * b[i], 0);
function heightBlocks(span: PlayerSpan): number | null {
  const f = hFeat(span);
  if (!f) return null;
  if (!heightModel) fitHeightModel();
  const { b, real, byYear } = heightModel!;
  const m = Math.round(mid(span)), v = score(b, f);
  // League rank: distinct players of his seasons (±1) whose best window scores higher.
  const best = new Map<string, number>();
  for (let y = m - 1; y <= m + 1; y++) for (const x of byYear.get(y) ?? []) if (x.name !== span.playerName) best.set(x.name, Math.max(best.get(x.name) ?? -Infinity, x.v));
  if (best.size < 10) return null;
  const rank = [...best.values()].filter((x) => x > v).length;
  // Leagues of 8-14 teams had fewer such players than 1974-86's 18-23: scale the rank by the pool's size.
  const scaled = Math.round(rank * real.length / best.size);
  return real[Math.min(real.length - 1, scaled)] * MODERN_RATIO;
}
