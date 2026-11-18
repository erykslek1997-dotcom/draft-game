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
        c = { bpg: f(REG.bpg), spg: f(REG.spg) };
      }
    }
    cache.set(span, c);
  }
  return c;
}
