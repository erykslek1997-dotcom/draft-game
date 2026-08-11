import type { PlayerSpan } from '../data/schema';
import { runtimeZoneTotalsForSpan } from './runtimeSpanLookups';
import { playmakingScoreForPlayer } from './playmakingLookup';

/**
 * "Shot diet + gravity" — the 2026-08-07 CSV batch's actual purpose, per the user's own a-d
 * framework:
 *   a) LeBron: shoots from everywhere but best at the rim, elite playmaking -> pair him with
 *      shooters (rim gravity draws help, kickouts need to be live).
 *   b) Curry: three-heavy -> already IS the floor-spacer; teammates don't need to shoot.
 *   c) Shaq/Giannis: huge rim volume at elite efficiency -> surround with shooters.
 *   d) Nash: shoots from every level roughly evenly, elite playmaking, self-sufficient ->
 *      needs two-way/rim-finishing complements, not more offensive talent.
 *
 * Explicit user instruction: this feeds `fitScore`/`aiDrafter` team-building signals ONLY.
 * **Never wired into `computeTalent`** ("na ten moment niech nie wpływa na TAL, bo za dużo nam
 * namiesza") — nothing in this file is imported by talent.ts, and it must stay that way.
 *
 * The three-heavy/floor-spacer side (b) is deliberately NOT re-derived here — `spacing.ts`'s
 * `isShootingAnomalyPlayer`/`WALKING_GRAVITY_FLOOR` already answers "is this player himself the
 * spacing solution" correctly and is reused as-is by callers. This module adds only what the
 * codebase genuinely didn't have before: the rim/mid side of the shot diet, and a playmaking-
 * balance read of self-sufficiency.
 */

export interface OffensiveProfile {
  hasZoneData: boolean;
  hasPlaymakingData: boolean;
  /** Shares of CLASSIFIED half-court shot attempts (rim+mid+three), not of total FGA. */
  rimShare: number;
  midShare: number;
  threeShare: number;
  /** 0-100 normalized-entropy read of how evenly split the three shares are: 0 = every shot
   * from one zone, 100 = a perfect three-way split. Neutral (50) when there's no zone data. */
  zoneSpread: number;
  /** Estimated rim attempts per game (rimShare * the span's own real FGA/game). */
  rimVolume: number;
  /** Restricted-area FG%, 0-100. */
  rimAccuracy: number;
  /** 0-100, from the playmaking export; 50 (neutral) when the player isn't covered. */
  playmakingGravity: number;
}

/** A span needs real classified-shot volume across its covered years before its zone SHARES
 * mean anything — same "rate over a handful of shots is noise" principle as
 * `selfCreationLookup.ts`'s `MIN_FIELD_GOALS_MADE_FOR_RATE`. Roughly half a full season at
 * moderate usage, summed across whichever years of the span the export actually covers. */
const MIN_CLASSIFIED_FGA_FOR_PROFILE = 150;

const NEUTRAL_PROFILE: OffensiveProfile = {
  hasZoneData: false,
  hasPlaymakingData: false,
  rimShare: 0,
  midShare: 0,
  threeShare: 0,
  zoneSpread: 50,
  rimVolume: 0,
  rimAccuracy: 0,
  playmakingGravity: 50,
};

function entropySpread(shares: number[]): number {
  const nonZero = shares.filter((s) => s > 0);
  if (nonZero.length <= 1) return 0;
  const entropy = -nonZero.reduce((sum, p) => sum + p * Math.log(p), 0);
  const maxEntropy = Math.log(shares.length);
  return Math.max(0, Math.min(100, (entropy / maxEntropy) * 100));
}

export function computeOffensiveProfile(span: PlayerSpan): OffensiveProfile {
  const playmakingGravity = playmakingScoreForPlayer(span);
  const totals = runtimeZoneTotalsForSpan(span);
  if (!totals) {
    return { ...NEUTRAL_PROFILE, hasPlaymakingData: playmakingGravity !== null, playmakingGravity: playmakingGravity ?? 50 };
  }
  const classifiedFga = totals.rimFga + totals.midFga + totals.threeFga;
  if (classifiedFga < MIN_CLASSIFIED_FGA_FOR_PROFILE) {
    return { ...NEUTRAL_PROFILE, hasPlaymakingData: playmakingGravity !== null, playmakingGravity: playmakingGravity ?? 50 };
  }
  const rimShare = totals.rimFga / classifiedFga;
  const midShare = totals.midFga / classifiedFga;
  const threeShare = totals.threeFga / classifiedFga;
  return {
    hasZoneData: true,
    hasPlaymakingData: playmakingGravity !== null,
    rimShare,
    midShare,
    threeShare,
    zoneSpread: entropySpread([rimShare, midShare, threeShare]),
    rimVolume: rimShare * span.fga,
    rimAccuracy: totals.rimFga > 0 ? (totals.rimFgm / totals.rimFga) * 100 : 0,
    playmakingGravity: playmakingGravity ?? 50,
  };
}

/** Real, high-volume, high-efficiency rim gravity — the PLURALITY zone in the player's own shot
 * diet, not necessarily a majority. Checked directly against real spans (`scripts/
 * checkOffensiveProfileTargets.ts`): Shaq (rim 0.78) and Giannis (0.58) clear any reasonable
 * absolute floor, but LeBron's real 2008-10 diet is rim 0.38 / mid 0.35 / three 0.27 — a genuine
 * but THIN plurality, exactly the user's own "shoots from everywhere but best at the rim" (a)
 * description, and an absolute-share floor (first tried at 0.42) wrongly excluded him. A pure
 * margin-over-the-next-best-zone check catches all three real cases without also firing on
 * statistical noise (two zones within a point of each other isn't a real plurality). Volume and
 * accuracy floors still apply so a small-sample or genuinely non-rim-oriented player with a
 * technical 1-point plurality doesn't qualify. */
const RIM_GRAVITY_MARGIN = 0.02;
const RIM_GRAVITY_VOLUME_FLOOR = 6;
const RIM_GRAVITY_ACCURACY_FLOOR = 55;

export function isRimGravityScorer(span: PlayerSpan): boolean {
  const p = computeOffensiveProfile(span);
  if (!p.hasZoneData) return false;
  const isPluralityZone = p.rimShare >= p.midShare + RIM_GRAVITY_MARGIN && p.rimShare >= p.threeShare + RIM_GRAVITY_MARGIN;
  return isPluralityZone && p.rimVolume >= RIM_GRAVITY_VOLUME_FLOOR && p.rimAccuracy >= RIM_GRAVITY_ACCURACY_FLOOR;
}

/** Elite playmaking + no dominant zone (shoots from everywhere roughly evenly) — the Nash case
 * per the user's (d) example: self-sufficient enough to generate his own offense, so the team's
 * real need shifts to two-way/rim-finishing complements rather than more offensive talent.
 *
 * 2026-08-07 follow-up: a rim-gravity span (LeBron) CAN also qualify — rim dominance and
 * playmaking-driven self-sufficiency aren't mutually exclusive, per the user's own explicit
 * call — but only at a higher playmaking bar than the non-rim-gravity case. The user's own
 * framing: LeBron still needs shooters (his rim gravity doesn't stop needing that), but if his
 * playmaking is elite enough ON TOP of that, he separately also doesn't need extra offensive
 * talent stacked around him — both needs can be true on the same player at once. No zoneSpread
 * check for this branch: a rim-gravity span's spread is often naturally lower (that's what rim
 * dominance means), so gating on it here would just re-exclude the exact population this branch
 * exists to include. */
const SELF_SUFFICIENT_PLAYMAKING_FLOOR = 85; // roughly the export's own "elite" tier cutoff
const RIM_GRAVITY_SELF_SUFFICIENT_PLAYMAKING_FLOOR = 90;
const SELF_SUFFICIENT_SPREAD_FLOOR = 60;

export function isSelfSufficientEngine(span: PlayerSpan): boolean {
  const p = computeOffensiveProfile(span);
  if (!p.hasPlaymakingData) return false;
  if (isRimGravityScorer(span)) {
    return p.playmakingGravity >= RIM_GRAVITY_SELF_SUFFICIENT_PLAYMAKING_FLOOR;
  }
  if (p.playmakingGravity < SELF_SUFFICIENT_PLAYMAKING_FLOOR) return false;
  // No zone data at all (pre-1996-97) can't confirm a balanced diet either way — fall back to
  // playmaking alone rather than silently failing every pre-1996-97 elite playmaker (Magic,
  // Stockton's early years, Cousy) out of a signal their own real skill clearly earns.
  if (!p.hasZoneData) return true;
  return p.zoneSpread >= SELF_SUFFICIENT_SPREAD_FLOOR;
}
