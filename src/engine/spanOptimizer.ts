import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { effectiveTalent } from './grades';
import { CAP_LIMIT } from './positions';

/**
 * Phase 2 of the "draft the player, then choose their span" mechanic (2026-08-03, user's own
 * design). Phase 1 (`peakDraftPool.ts` + the unchanged `draft.ts`/`aiDrafter.ts`) already
 * guarantees a legal 9-player roster using each player's PEAK span's FGA — so this step is NOT
 * about legality, it's a genuine re-optimization: given the 9 real players a team ended up with,
 * which span of EACH should actually be rostered to maximize total TAL under the same cap,
 * now that the full picture (all 9 picks) is known rather than decided one at a time mid-draft.
 */

/** Every real span option for a given player, across the full (non-peak-only) draft pool. */
export function spanOptionsFor(playerName: string): PlayerSpan[] {
  const key = normalizePlayerName(playerName);
  return draftPool.filter((p) => normalizePlayerName(p.playerName) === key);
}

/** FGA is continuous to one decimal place; discretized to integer "units" of 0.1 FGA for the
 * knapsack DP below — capUnits stays small (~1010 for the real 100.9 cap) regardless of scale,
 * so this costs nothing in practice. */
const FGA_SCALE = 10;
/** A post-draft cap optimization may trade a little peak quality for fit, but it must not turn
 * a third-round star into a completely different, pre-prime version of the same player. */
const MAX_POST_DRAFT_TALENT_DROP = 6;

function peakProtectedOptions(options: PlayerSpan[]): PlayerSpan[] {
  if (options.length === 0) return options;
  const bestTalent = Math.max(...options.map(effectiveTalent));
  return options.filter((option) => effectiveTalent(option) >= bestTalent - MAX_POST_DRAFT_TALENT_DROP);
}

/**
 * Multiple-choice knapsack: choose exactly one span per player (from that player's own real
 * span options) maximizing total TAL, subject to the roster's combined FGA staying at or under
 * `capLimit`. `roster` only needs `playerName` from each entry — whatever specific span each
 * team member happens to be represented by going in (e.g. their Phase 1 peak span) doesn't
 * matter, since every one of their real span options is looked up fresh here.
 *
 * DP over (player index, discretized FGA used so far) -> best total TAL, backtracked at the end
 * to recover which span was chosen for each player. `n` (roster size, 9) x `capUnits` (~1010) x
 * average options per player (~10-15) is a few hundred thousand operations at most — trivial.
 */
export function optimizeSpans(roster: PlayerSpan[], capLimit: number = CAP_LIMIT): PlayerSpan[] {
  const n = roster.length;
  const allOptionsPerPlayer = roster.map((p) => spanOptionsFor(p.playerName));
  const capUnits = Math.round(capLimit * FGA_SCALE);

  function solve(optionsPerPlayer: PlayerSpan[][]): PlayerSpan[] | null {
    if (optionsPerPlayer.some((options) => options.length === 0)) return null;

    const NEG_INF = -Infinity;
    // dp[i][w]: max total TAL using the first i players, with total discretized FGA <= w.
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(capUnits + 1).fill(NEG_INF));
    const choice: number[][] = Array.from({ length: n + 1 }, () => new Array(capUnits + 1).fill(-1));
    dp[0].fill(0); // 0 players chosen: 0 value, valid at every capacity level.

    for (let i = 1; i <= n; i++) {
      const options = optionsPerPlayer[i - 1];
      for (let w = 0; w <= capUnits; w++) {
        for (let oi = 0; oi < options.length; oi++) {
          const cost = Math.round(options[oi].fga * FGA_SCALE);
          if (cost > w) continue;
          const prev = dp[i - 1][w - cost];
          if (prev === NEG_INF) continue;
          const value = prev + effectiveTalent(options[oi]);
          if (value > dp[i][w]) {
            dp[i][w] = value;
            choice[i][w] = oi;
          }
        }
      }
    }

    // Best achievable value using AT MOST capUnits total — scan the final row for the max.
    let bestW = 0;
    for (let w = 0; w <= capUnits; w++) {
      if (dp[n][w] > dp[n][bestW]) bestW = w;
    }

    if (dp[n][bestW] === NEG_INF) return null;

    const result: PlayerSpan[] = new Array(n);
    let w = bestW;
    for (let i = n; i >= 1; i--) {
      const oi = choice[i][w];
      const span = optionsPerPlayer[i - 1][oi];
      result[i - 1] = span;
      w -= Math.round(span.fga * FGA_SCALE);
    }
    return result;
  }

  // First solve within a bounded quality band. Only if that genuinely cannot fit the cap do we
  // reopen every historical span as an emergency legality fallback.
  return solve(allOptionsPerPlayer.map(peakProtectedOptions)) ?? solve(allOptionsPerPlayer) ?? roster;
}
