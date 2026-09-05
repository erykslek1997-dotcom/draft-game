import type { Team } from './types';
import { projectedNetRating } from './netRatingProjection';
import { fitScore } from './fit';
import { defensiveHuntability, HUNTABILITY_DRTG_POINTS_PER_PENALTY } from './defensiveHuntability';

/**
 * Pairwise matchup projection — "how would roster A actually do against roster B," the one large
 * piece flagged as genuinely missing in [[net_rating_model_and_spec_reviews]]'s spec review
 * (2026-08-14). Built on top of `projectedNetRating` rather than anything new/unvalidated:
 *
 * 1. Projected point margin for A vs B is A's net rating minus B's net rating, PLUS the mismatch
 *    adjustment below. The net-rating differential alone falls out of the standard "opponent-
 *    adjusted" matchup formula (subtract league average from each side, apply the opponent's
 *    deviation as an adjustment) once you do the algebra — the league average term cancels
 *    exactly. Same idea Dean Oliver's "Basketball on Paper" (one of this project's own cited
 *    methodology sources) uses for matchup projection, and the same logic behind Basketball-
 *    Reference's SRS.
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
 * The net-rating differential itself traces back to `computeOffensiveTalent`/
 * `computeDefensiveTalent` through the already-validated net rating regression (r=0.76 vs real
 * net rating, out-of-sample stable) — no new unvalidated machinery there. The ONE deliberate
 * exception, added 2026-09-05 per the user's explicit request, is `mismatchAdjustment` below: a
 * genuine per-matchup (not per-team) term, the first this file has ever carried. See its own
 * docstring for the reasoning and the honest "first-pass, not fit against real data" caveat that
 * comes with it — same status as `netRatingProjection.ts`'s own playoff weak-link correction.
 */

const HUNTING_POTENTIAL_NEUTRAL = 50;
/** How much of the defender's existing huntability penalty a real mismatch hunter can swing up
 * or down, relative to the neutral assumption already baked into their own standalone
 * `projectedNetRating` (which — per `defensiveHuntability.ts`'s own docstring, "opponents cannot
 * hide a weak defender" — implicitly assumes a fully capable NBA-average attacker). First-pass
 * estimate, not fit against a real dataset (none exists for this specific interaction) — same
 * honest-starting-point status as `defensiveHuntability.ts`'s own `BENCH_COMPETITION_DISCOUNT`
 * before it was tightened on user feedback. */
const MISMATCH_PENALTY_SWING = 0.5;

/**
 * 2026-09-05, user's explicit request, in three steps over one conversation: (1) "if defense
 * penalizes a huntable player, it should also evaluate whether the ATTACKING team has real
 * hunting potential" (2) asked to scope this to actual matchups, where a real opponent exists,
 * not the standalone context-free scores (3) "it should affect BOTH offense and defense — a team
 * with hunting potential is BETTER ON OFFENSE through mismatch creation."
 *
 * `attacker`'s hunting potential (`fitScore(attacker).inputs.huntingPotential` — a best-player-
 * weighted blend of playmaking and self-creation, `fit.ts`'s own docstring; the user's own
 * example: a Doncic-level threat is dangerous both off the pull-up and as a passer) scales
 * `defender`'s EXISTING `defensiveHuntability` penalty up or down for this specific pairing, then
 * converts to real DRTG-equivalent points via the same `HUNTABILITY_DRTG_POINTS_PER_PENALTY`
 * `netRatingProjection.ts` already uses for the standalone number. Zero adjustment when the
 * defender has no real weak link to hunt in the first place (`penalty <= 0`) — a strong hunting
 * offense doesn't invent a mismatch that isn't there.
 *
 * Called once per direction inside `projectMatchup` below: `attacker` exploiting `defender`'s
 * weak link raises `attacker`'s effective margin (real basketball: a live mismatch is an
 * OFFENSIVE weapon, not just a defensive problem for the other side) and by the same amount
 * lowers `defender`'s (their defense is genuinely worse against this specific opponent than their
 * context-free DRTG says) — one shared number naturally captures both halves of the user's ask
 * without double-charging either team's own standalone `offenseScore`/`defenseScore`, which
 * already fold plain playmaking/self-creation quality in on their own (see `scoring.ts`'s
 * `offenseScoreBreakdown` weights) — this is specifically the TACTICAL value of a live mismatch
 * against a real, weaker opponent, not a restatement of baseline offensive quality.
 */
function mismatchAdjustment(attacker: Team, defender: Team): number {
  const defenderHunt = defensiveHuntability(defender);
  if (defenderHunt.penalty <= 0) return 0;
  const huntingPotential = fitScore(attacker).inputs.huntingPotential;
  const factor = Math.max(-1, Math.min(1, (huntingPotential - HUNTING_POTENTIAL_NEUTRAL) / HUNTING_POTENTIAL_NEUTRAL));
  return defenderHunt.penalty * MISMATCH_PENALTY_SWING * factor * HUNTABILITY_DRTG_POINTS_PER_PENALTY;
}

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
  // A hunting B's weak link helps A; B hunting A's weak link helps B — both fold into the one
  // shared margin (see `mismatchAdjustment`'s own docstring).
  const mismatchForA = mismatchAdjustment(teamA, teamB);
  const mismatchForB = mismatchAdjustment(teamB, teamA);
  const marginA = netA - netB + mismatchForA - mismatchForB;
  const gameWinProbA = gameWinProbability(marginA);
  const seriesWinProbA = seriesWinProbability(gameWinProbA);
  return { marginA, gameWinProbA, seriesWinProbA };
}
