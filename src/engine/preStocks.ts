/**
 * 2026-11-18 (the user: "rób estymacje całych karier"): steals and blocks were not recorded before
 * 1973-74, so a window from before then came into the game with none — Russell, Wilt, Thurmond as no
 * rim protectors, West and Frazier as no ball hawks. The game reads such a window from
 * `preStocksSeasons.json`, built by `scripts/buildPreStocks.ts`:
 *  - a per-window model fitted on 1974+ windows (opportunity rate over the league's FG attempts, age
 *    curve, height, weight, rebounds / assists / points against the league, FG%, FT%, guard / center);
 *  - the player's own 1974+ windows as a bridge (his mean residual there);
 *  - documented counts (`reportedBlocks.ts`: Wilt 8.7 career and 1972-73 at 5.4, Russell ~8).
 * Hold-out on the first windows of 1974+ careers: steals r 0.80, blocks r 0.90 with the bridge.
 * The file is in the era's own per-game numbers; today's game reads them through the window's rebound
 * translation (`modernBox`) — on 1974-86 windows steals and blocks translate exactly as rebounds do
 * (median ratio 1.00 of 606 windows). Only the game reads this (`liveDefense`, `liveGame`); TAL and
 * D-TAL are untouched. `SIM_PRE_STOCKS=0` = off.
 */
import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { draftPool } from '../data/draftPool';
import seasonsData from '../data/preStocksSeasons.json';
import { spanEndYears } from './era';
import { envVar } from './env';
import { modernBox } from './modernBox';

const ON = envVar('SIM_PRE_STOCKS') !== '0';
const FIRST_FULL = 1974;
/** window key (`name|spanLabel`) → [steals, blocks, middle year], per game in the era's numbers. */
const EST = seasonsData as unknown as Record<string, [number, number, number]>;

const years = (s: PlayerSpan) => spanEndYears(s.spanLabel);
const mid = (s: PlayerSpan) => { const y = years(s); return (y[0] + y[y.length - 1]) / 2; };
const keyOf = (s: PlayerSpan) => `${normalizePlayerName(s.playerName)}|${s.spanLabel}`;
const cache = new WeakMap<PlayerSpan, { spg: number; bpg: number }>();

/** The nearest estimated window of the same player (for a 1972-74 window, his 1971-73). */
function nearestEstimate(span: PlayerSpan): [number, number] | null {
  const own = EST[keyOf(span)];
  if (own) return [own[0], own[1]];
  let best: PlayerSpan | null = null;
  for (const s of draftPool) {
    if (s.playerName !== span.playerName || !EST[keyOf(s)]) continue;
    if (!best || Math.abs(mid(s) - mid(span)) < Math.abs(mid(best) - mid(span))) best = s;
  }
  if (!best) return null;
  const e = EST[keyOf(best)];
  return [e[0], e[1]];
}

/** Steals and blocks a game in today's terms, as the game reads them. */
export function gameStocks(span: PlayerSpan): { spg: number; bpg: number } {
  let c = cache.get(span);
  if (!c) {
    const m = modernBox(span);
    const ys = years(span);
    c = { spg: m.spg, bpg: m.bpg };
    const hasPre = ys.length > 0 && Math.min(...ys) < FIRST_FULL;
    const wholePre = hasPre && Math.max(...ys) < FIRST_FULL;
    // A window with both kinds of seasons (1972-74) keeps a stat it carries; only a 0 — nothing
    // recorded for it — takes the estimate.
    if (ON && hasPre && (wholePre || m.spg === 0 || m.bpg === 0)) {
      const e = nearestEstimate(span);
      if (e && span.box.rpg > 0) {
        const t = m.rpg / span.box.rpg;
        c = { spg: wholePre || m.spg === 0 ? e[0] * t : m.spg, bpg: wholePre || m.bpg === 0 ? e[1] * t : m.bpg };
      }
    }
    cache.set(span, c);
  }
  return c;
}
