import type { Team } from './types';
import { projectedNetRating } from './netRatingProjection';

/**
 * Pairwise matchup projection — "how would roster A actually do against roster B," the one large
 * piece flagged as genuinely missing in [[net_rating_model_and_spec_reviews]]'s spec review
 * (2026-08-14). Built on top of `projectedNetRating` rather than anything new/unvalidated:
 *
 * 1. Projected point margin for A vs B is simply A's net rating minus B's net rating. This falls
 *    out of the standard "opponent-adjusted" matchup formula (subtract league average from each
 *    side, apply the opponent's deviation as an adjustment) once you do the algebra — the league
 *    average term cancels exactly, leaving net-rating differential. Same idea Dean Oliver's
 *    "Basketball on Paper" (one of this project's own cited methodology sources) uses for
 *    matchup projection, and the same logic behind Basketball-Reference's SRS.
 * 2. Single-game win probability from that margin via a normal CDF, using the REAL NBA single-
 *    game point-margin standard deviation — measured directly (`scripts/calibrateMatchupMargin.ts`,
 *    team_advanced.csv, 71,092 real team-games, mean -0.001 confirming the recovery formula is
 *    unbiased) rather than assumed. This is the standard sports-analytics approach (the same
 *    shape FiveThirtyEight/Vegas-style power ratings use to turn a point spread into a win
 *    probability).
 * 3. BO7 series win probability from the single-game probability via the standard closed-form
 *    "race to 4 wins" binomial formula, assuming i.i.d. games (no home-court modeling — this
 *    game has no home/away concept, matches its "neutral 2026 environment" framing).
 *
 * No new unvalidated machinery, no manual per-matchup bonuses — every number here traces back to
 * `computeOffensiveTalent`/`computeDefensiveTalent` through the already-validated net rating
 * regression (r=0.76 vs real net rating, out-of-sample stable).
 */

/** Real NBA single-game point-margin standard deviation, measured 2026-08-14 from 71,092 real
 * regular-season team-games (team_advanced.csv, 1997-2026) via `scripts/calibrateMatchupMargin.ts`.
 * Margin recovered per team-game as NETRTG * PACE / 100 (points per 100 possessions * possessions
 * per game / 100) — mean came out -0.001, confirming the recovery is unbiased. Re-run that script
 * and update this constant after a fresh team_advanced.csv export. */
const MARGIN_STD_DEV = 13.822;

/** Abramowitz-Stegun 7.1.26 approximation of the error function — accurate to ~1.5e-7, the
 * standard closed-form approximation used when no stats library is available. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number, mean: number, stdDev: number): number {
  return 0.5 * (1 + erf((x - mean) / (stdDev * Math.SQRT2)));
}

/** Single-game win probability for the favored/underdog side given a projected point margin
 * (positive = favored to win by that many points). */
export function gameWinProbability(projectedMargin: number): number {
  return normalCdf(projectedMargin, 0, MARGIN_STD_DEV);
}

/** BO7 series win probability from a single-game win probability, via the closed-form "race to
 * 4 wins" binomial formula: P(win series) = p^4 * (1 + 4q + 10q² + 20q³), q = 1-p. Sanity check:
 * p=0.5 -> 0.5 exactly (symmetric); p=0.6 -> ~0.71, matching the commonly-cited "a 60% single-game
 * favorite wins a 7-game series about 71% of the time" reference point. */
export function seriesWinProbability(gameWinProb: number): number {
  const p = gameWinProb;
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q + 20 * q * q * q);
}

export interface MatchupProjection {
  /** Projected point margin, teamA's perspective (positive = A favored). */
  marginA: number;
  /** teamA's single-game win probability. */
  gameWinProbA: number;
  /** teamA's BO7 series win probability. */
  seriesWinProbA: number;
}

export function projectMatchup(teamA: Team, teamB: Team): MatchupProjection {
  const netA = projectedNetRating(teamA).net;
  const netB = projectedNetRating(teamB).net;
  const marginA = netA - netB;
  const gameWinProbA = gameWinProbability(marginA);
  const seriesWinProbA = seriesWinProbability(gameWinProbA);
  return { marginA, gameWinProbA, seriesWinProbA };
}
