import type { OffensiveArchetype, PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { eraScaledThreePA, spanEndYears } from './era';

/**
 * SPACING — "how much does this player's shooting bend a defense," on the same 0-100 display
 * scale as TAL/O-TAL/D-TAL/POR/IMP.
 *
 * Distinct from `shootingGravity` in shooting.ts, which multiplies raw volume by era-relative
 * efficiency into one unbounded number. That product conflates the two halves: a high-volume
 * average shooter and a low-volume elite one land in the same place, and the raw-volume term
 * means anyone pre-2010 reads as a non-shooter regardless of era context. SPACING instead
 * scores accuracy and volume on separate 0-10 ladders and adds them, so both have to be real
 * for a player to rate — and it scores VOLUME against the player's own era (`eraScaledThreePA`)
 * rather than a fixed modern yardstick.
 *
 * The ladders are per-position because the bar genuinely differs by position: a center hitting
 * 37% on 4 attempts warps a defense more than a guard doing the same, since it drags a rim
 * protector away from the basket. Thresholds were calibrated against the full span dataset,
 * targeting a distribution where roughly the top ~3% of spans reach Great shooter or better
 * (see scripts/calibrateSpacing.ts for the run that set them).
 *
 * The 0-20 sum maps to the six named tiers below; `computeSpacing` rescales that same sum onto
 * 0-100 for display alongside the other judge metrics.
 */

export type SpacingTier =
  | 'Non-shooter'
  | 'Bad shooter'
  | 'Average shooter'
  | 'Good shooter'
  | 'Great shooter'
  | 'Walking gravity'
  | 'Shooting anomaly';

/** Ladder entries are `[minimum value, points]`, ascending; a span scores the points of the
 * highest entry it clears. */
type Ladder = ReadonlyArray<readonly [number, number]>;

/**
 * Rungs sit at percentiles of the real 3P% distribution among spans that clear
 * `MIN_VOLUME_FOR_ACCURACY` (scripts/spacingPercentiles.ts): roughly p10 for 1 point up to
 * ~p98 for 10.
 *
 * These are nearly identical across positions on purpose — the percentile run showed the 3P%
 * distribution barely moves by position once low-volume spans are excluded (median 34.4% for
 * centers vs 35.6% for shooting guards, p95 within a point and a half everywhere). The
 * intuition that bigs are worse 3-point shooters is a selection effect: bigs who can't shoot
 * simply never attempt enough to appear here. So accuracy is judged on close to one common
 * bar, and the genuine positional difference — how MUCH a player is expected to shoot — is
 * carried by `VOLUME_LADDERS`, where the real spread is large.
 *
 * PF and C keep a small downward shift (1.0 and 1.5 points of percentage) because an equally
 * accurate big is worth more spacing than a guard: the defender being pulled out to the arc
 * is a rim protector, which empties the paint behind him.
 */
const ACCURACY_LADDERS: Record<Position, Ladder> = {
  PG: [[0, 0], [0.31, 1], [0.325, 2], [0.335, 3], [0.345, 4], [0.355, 5], [0.365, 6], [0.375, 7], [0.385, 8], [0.4, 9], [0.415, 10]],
  SG: [[0, 0], [0.31, 1], [0.325, 2], [0.335, 3], [0.345, 4], [0.355, 5], [0.365, 6], [0.375, 7], [0.385, 8], [0.4, 9], [0.415, 10]],
  SF: [[0, 0], [0.31, 1], [0.325, 2], [0.335, 3], [0.345, 4], [0.355, 5], [0.365, 6], [0.375, 7], [0.385, 8], [0.4, 9], [0.415, 10]],
  PF: [[0, 0], [0.3, 1], [0.315, 2], [0.325, 3], [0.335, 4], [0.345, 5], [0.355, 6], [0.365, 7], [0.375, 8], [0.39, 9], [0.405, 10]],
  C: [[0, 0], [0.295, 1], [0.31, 2], [0.32, 3], [0.33, 4], [0.34, 5], [0.35, 6], [0.36, 7], [0.37, 8], [0.385, 9], [0.4, 10]],
};

/**
 * Era-scaled 3PA/game (modern-equivalent attempt rates), with rungs at percentiles of the
 * real per-position distribution among spans clearing `MIN_VOLUME_FOR_ACCURACY`.
 *
 * The positional spread here is the large one and it is entirely real: median scaled volume
 * among shooters runs 5.7 for SG and 5.2 for PG down to 2.9 for C. A center at 5 attempts a
 * game is in his position's ~78th percentile; a shooting guard at 5 is below his own median.
 * Scoring both against one ladder would have made high-volume guards look unremarkable and
 * every stretch big look like an outlier.
 */
const VOLUME_LADDERS: Record<Position, Ladder> = {
  PG: [[1, 0], [2, 1], [2.8, 2], [3.6, 3], [4.4, 4], [5.2, 5], [6.2, 6], [7.8, 7], [9.4, 8], [11, 9], [13, 10]],
  SG: [[1, 0], [2.2, 1], [3, 2], [3.9, 3], [4.8, 4], [5.7, 5], [6.8, 6], [8.5, 7], [10, 8], [11.8, 9], [13.5, 10]],
  SF: [[1, 0], [2, 1], [2.8, 2], [3.5, 3], [4.3, 4], [5.1, 5], [6, 6], [7.2, 7], [8.5, 8], [10, 9], [11.5, 10]],
  // PF/C rungs carry a 15% discount (`BIG_VOLUME_RELAX` applied to the measured percentiles) —
  // the user's call, via Lauri Markkanen and Kristaps Porziņģis: a big who takes 8 threes a game
  // has already broken his position's mould, and the marginal spacing value of each additional
  // attempt is higher for him than for a guard, because the man he drags out is a rim protector.
  // The measured p-percentiles are what the *supply* of shooting bigs looks like, not what
  // defending one costs. Numbers below are pre-multiplied so the ladder stays a plain table.
  PF: [[0.68, 0], [1.36, 1], [1.87, 2], [2.38, 3], [2.89, 4], [3.4, 5], [4.08, 6], [4.93, 7], [5.87, 8], [6.97, 9], [8.16, 10]],
  C: [[0.43, 0], [0.85, 1], [1.28, 2], [1.7, 3], [2.13, 4], [2.47, 5], [3.06, 6], [4, 7], [4.68, 8], [5.53, 9], [6.63, 10]],
};

/**
 * Accuracy scores 0 below this many era-scaled attempts per game. Without it, a big who went
 * 2-for-4 across a whole span reads as a 50% shooter and maxes the accuracy ladder — the
 * dataset is full of these (Mark Acres at 100% on 0.07 3PA/game was the worst case found).
 * Volume still scores normally below the floor; it is only accuracy that needs a real sample
 * behind it to mean anything.
 */
const MIN_VOLUME_FOR_ACCURACY = 1;

/**
 * The NBA moved the 3-point line to a uniform, shorter 22 feet for three seasons (1994-95
 * through 1996-97) before reverting to the varied modern distance in 1997-98. League-average 3P%
 * jumped from 33.3%/34.6% in the seasons immediately before/after to 35.9%/36.7%/36.0% during it
 * (`seasonBaselines.json`) — real makes on a real, but temporarily easier, shot.
 *
 * The accuracy ladders above have no era adjustment at all (unlike volume, which is already
 * era-scaled via `eraScaledThreePA`), so a span sitting in these three seasons reads its
 * shortened-line percentage against the same fixed rungs as every other era. This is what let
 * Scottie Pippen's 1995-97 span (37.1% on the shortened line) clear Walking gravity, while his
 * materially similar 1996-98 span (35.2%, mostly on the restored line) correctly read Great
 * shooter — found via the user's 2026-07-30 report that his walking-gravity read looked wrong.
 *
 * Keyed by season END year (1995 = the 1994-95 season, `spanEndYears`'s own convention) to a
 * flat, prorated deduction — prorated the same way `eraBaseline` averages any per-season value
 * over a span's covered years, so a span straddling the boundary (e.g. a hypothetical "1993-95")
 * is only partially discounted for the one shortened season it actually includes.
 */
const SHORTENED_LINE_END_YEARS = new Set([1995, 1996, 1997]);
const SHORTENED_LINE_ACCURACY_DISCOUNT = 0.025;

function shortenedLineAccuracyDiscount(spanLabel: string): number {
  const years = spanEndYears(spanLabel);
  if (years.length === 0) return 0;
  const affected = years.filter((y) => SHORTENED_LINE_END_YEARS.has(y)).length;
  return SHORTENED_LINE_ACCURACY_DISCOUNT * (affected / years.length);
}

/**
 * Volume points may not exceed accuracy points by more than this. Shooting a lot only creates
 * spacing if the shots go in — a defense happily lets a 32% shooter fire away, so those
 * attempts are not gravity, they are just volume. Without the clamp the volume ladder rewarded
 * exactly the players spacing is supposed to identify as problems: Russell Westbrook's 2015-17
 * peak (32.6% on 8.4 era-scaled attempts) scored 2 accuracy + 7 volume and read as an average
 * spacer, when in reality that shot was one his defenders wanted him to take.
 *
 * Set to 3 rather than 0 so real high-volume shooters are still rewarded for the volume half
 * — being a defense's problem does take attempts, not just percentage — while a player whose
 * accuracy never justifies the attempts cannot climb past the lower tiers on volume alone.
 */
const VOLUME_ACCURACY_HEADROOM = 3;

/** Tier floors against the raw 0-20 sum, ascending. `Shooting anomaly` is deliberately absent —
 * it is not a score band anyone can reach, it is a named exception for one player (see
 * `SHOOTING_ANOMALY_PLAYER`). */
/**
 * 2026-09-17, user-reported live: a real drafted team (Nash 2005-07 + Kristaps Porziņģis 2022-24
 * as its two real shooting threats, alongside Jordan/Erving/Mason reading genuine zeros) read a
 * team spacingScore of 27-33 despite having two real, good shooters — because NEITHER Nash
 * (17.2 points) nor Porziņģis (16.0) reached the old `WALKING_GRAVITY_FLOOR` (19), so
 * `spacingScore`'s "two genuine gravity threats" override never fired and the team fell back to a
 * plain weighted average of [86, 25, 0, 0, 80] blended against the bench. Checked the real
 * distribution first: even Reggie Miller (one of the greatest pure shooters ever, `points`=18.0,
 * exempted from the low-real-volume cap by name) didn't clear the old 19 — the bar was reserved
 * for a genuinely tiny top slice (154 of 9451 spans) while a much larger "very good, not elite"
 * band (1129 spans read 15-18.9) got none of the multi-threat credit regardless of how good two of
 * them actually were together.
 *
 * Lowered to 16 (catches Porziņģis exactly, Nash comfortably, Korver's 17.0, Reggie's 18.0) —
 * moved together with `TIER_FLOORS`'s own 'Walking gravity' floor so the tier NAME and the bonus-
 * eligibility NUMBER never diverge (they're two separate constants only because 'Walking gravity'
 * needs its own floor value in this table, not because they were ever meant to differ). 'Great
 * shooter' floor moved 16->14 to keep a real, non-empty band between 'Good shooter' (13) and the
 * new 'Walking gravity' (16) rather than colliding with it.
 */
const TIER_FLOORS: ReadonlyArray<readonly [number, SpacingTier]> = [
  [0, 'Non-shooter'],
  [5, 'Bad shooter'],
  [9, 'Average shooter'],
  [13, 'Good shooter'],
  [14, 'Great shooter'],
  [16, 'Walking gravity'],
];

/** Exported so `scoring.ts` can detect a second real gravity threat without duplicating the
 * threshold — see `spacingScore`'s multi-shooter override. */
export const WALKING_GRAVITY_FLOOR = 16;
const MAX_SPACING_POINTS = 20;

/**
 * Self-creation credit: a three a player generates for himself off the dribble is a harder shot,
 * and a bigger problem for a defense, than the same three taken off a pass.
 *
 * The user's framing (2026-07-30): "most of their shots are self-created, with their 3P FGA
 * attempts they deserve that rating" — for Lillard, Harden, Dončić and Anthony Edwards at
 * Walking gravity, and Haliburton, Brunson, McGrady and Kawhi at Great shooter. The two ladders
 * alone can't see this: they read a 36.5% shooter as a 36.5% shooter whether he was spotting up
 * or rising out of a step-back double. Pull-up 3P% runs roughly 4-5 points below catch-and-shoot
 * league-wide, so grading both against one accuracy bar systematically undersells creators.
 *
 * Three parts, all scaled by the same 0-1 rate so an off-ball shooter is untouched (Klay
 * Thompson, Reggie Miller and every stretch big score exactly what they scored before):
 * - `SELF_CREATION_ACCURACY_DISCOUNT` drops the accuracy bar — the principled half.
 * - `SELF_CREATION_VOLUME_KICKER` treats self-created volume as worth more, but **only above
 *   `SELF_CREATION_RAW_VOLUME_GATE` real (non-era-scaled) attempts**. Taking 10 pull-up threes a
 *   game is a modern phenomenon; era-scaling a 1990s creator's 4 attempts up to a modern-
 *   equivalent 12 and then crediting them as self-created volume too would be double-counting
 *   the same era adjustment. This gate is what keeps McGrady at Great rather than lifting him
 *   past Walking gravity on his era-scaled volume alone.
 * - `SELF_CREATION_BONUS` is proportional to the room left below 20, so it moves a shooter the
 *   ladders undersell (Cade Cunningham, Kawhi) and barely touches one already near the top.
 *
 * Constants grid-searched in `scripts/calibrateSelfCreation.ts` against all 10 of the user's
 * calls plus 12 guardrail players who must not move — of the 90 configs that satisfied every
 * one, this is the least interventionist. Re-run it before touching any of them.
 */
const ARCHETYPE_SELF_CREATION: Partial<Record<OffensiveArchetype, number>> = {
  'Shot Creator': 1,
  'Primary Ball Handler': 0.85,
  Slasher: 0.8,
  'Secondary Ball Handler': 0.55,
};
/** Ramped on FGA, not a cliff: a low-usage player carrying a creator tag isn't creating much. */
const SELF_CREATION_USAGE_FLOOR = 11;
const SELF_CREATION_USAGE_FULL = 16;
const SELF_CREATION_ACCURACY_DISCOUNT = 0.035;
const SELF_CREATION_VOLUME_KICKER = 0.3;
const SELF_CREATION_RAW_VOLUME_GATE = 7;
const SELF_CREATION_BONUS = 4;
/** The bonus needs a real shooter under it — without these floors it lifts high-usage guards who
 * simply miss a lot (Westbrook, Wade), which is the exact failure `VOLUME_ACCURACY_HEADROOM`
 * exists to prevent. */
const SELF_CREATION_BONUS_MIN_ACCURACY = 6;
const SELF_CREATION_BONUS_MIN_VOLUME = 4;

/** Exported for `scripts/compareSelfCreationMeasured.ts`, which weighs this archetype proxy
 * against the measured unassisted-shot rates in `selfCreationLookup.ts`. */
export function selfCreationRate(span: PlayerSpan): number {
  const archetypeWeight = ARCHETYPE_SELF_CREATION[span.offensiveArchetype] ?? 0;
  if (archetypeWeight === 0) return 0;
  const usage = (span.fga - SELF_CREATION_USAGE_FLOOR) / (SELF_CREATION_USAGE_FULL - SELF_CREATION_USAGE_FLOOR);
  return archetypeWeight * Math.max(0, Math.min(1, usage));
}

/**
 * Real 3PA/game below which a span cannot reach Walking gravity, no matter how far era-scaling
 * lifts its modern equivalent — the user's call on Terry Porter: "scaling works good, but should
 * not work that good." Porter's 1991-93 (4.1 real attempts, 40.5%) scales to ~19 modern-
 * equivalent attempts and maxed the ladder outright, which overstates what four threes a game
 * did to a defense even in 1992.
 *
 * The exemptions are the user's too, and they're the players for whom the era-scaled reading is
 * the *correct* one: Mark Price, Reggie Miller and Larry Bird were the shot that teams actually
 * game-planned around in their era, at a time when almost nobody else was.
 *
 * 2026-09-17: added Steve Nash after re-tightening this cap (see `realVolumeFloorCapPoints`'s own
 * note) correctly pushed his real 4.4-3PA-a-game spans back out of Walking gravity — the user's
 * direct call ("Nash ręcznie przypisane walking gravity") that his case belongs on this list too,
 * same reasoning as Price/Miller/Bird: defenses genuinely planned around his jumper at a volume
 * the box score alone undersells.
 */
const REAL_VOLUME_FLOOR_FOR_WALKING_GRAVITY = 4.5;
const REAL_VOLUME_FLOOR_EXEMPT = ['Mark Price', 'Reggie Miller', 'Larry Bird', 'Steve Nash'];

/**
 * 2026-09-17, same-day correction: for a few hours this cap was pinned to a fixed constant
 * (18.9) instead of tracking `WALKING_GRAVITY_FLOOR - 0.1`, on the theory that the rule's job was
 * only to withhold the *label*, not to keep suppressing `points` once the tier floor moved. That
 * theory was wrong — re-read the block above: "a span cannot reach Walking gravity, no matter how
 * far era-scaling lifts its modern equivalent" is unconditional, not pegged to wherever the floor
 * happened to sit when it was written. Pinning the cap above the new, lower floor (16) let every
 * sub-4.5-real-volume span it was built to stop — Rashard Lewis's 2000-02 (4.0 real attempts),
 * caught live by the user asking "Lewis ma walking gravity?" after a completed draft — walk
 * straight into Walking gravity anyway, exactly the outcome this rule exists to prevent.
 *
 * The dynamic form is the correct one: always one tenth of a point under whatever
 * `WALKING_GRAVITY_FLOOR` currently is, so a low-real-volume span can never cross that line
 * regardless of where later recalibration moves it. (Steve Nash's span reading 15.9 instead of
 * his organic 17.2 earlier the same day was this rule working correctly, not the bug it was
 * mistaken for — he's real 4.4 3PA/game, under the 4.5 floor, so he was never supposed to reach
 * Walking gravity either. The team-spacing complaint that motivated lowering the floor is still
 * addressed correctly by Kristaps Porziņģis alone clearing it on real volume.)
 */
function realVolumeFloorCapPoints(): number {
  return WALKING_GRAVITY_FLOOR - 0.1;
}

/**
 * Manual Walking-gravity floors, by player and season range — spans whose *shot profile* the
 * box score can't express. All the user's calls. A floor, never a ceiling: a span already
 * scoring higher keeps its own number.
 *
 * `endYearFrom`/`endYearTo` are season END years (2020 = the 2019-20 season), matched against
 * `spanEndYears`. A span qualifies only when a **strict majority** of its seasons fall inside the
 * range. "Any overlap" drags in a trailing span from before the player developed the shot, and so
 * does "at least half" for the two-season spans that make up most of the dataset — both were
 * tried, and both handed Walking gravity to Jokić's 2018-20 (1.5 real 3PA/game) and Towns's
 * 2015-17 (2.2), off a single overlapping season each.
 *
 * Larry Bird's range is the one deviation from what was written: the user wrote "2012 to 2026",
 * copied from the Durant line above it — Bird's career is 1980-1992, so that's what's used here.
 */
const MANUAL_WALKING_GRAVITY: ReadonlyArray<{ player: string; endYearFrom: number; endYearTo: number }> = [
  { player: 'Nikola Jokic', endYearFrom: 2020, endYearTo: 2026 },
  { player: 'Dirk Nowitzki', endYearFrom: 2000, endYearTo: 2012 },
  { player: 'Kevin Durant', endYearFrom: 2012, endYearTo: 2026 },
  { player: 'Larry Bird', endYearFrom: 1980, endYearTo: 1992 },
  { player: 'Victor Wembanyama', endYearFrom: 2024, endYearTo: 2026 },
  { player: 'Karl-Anthony Towns', endYearFrom: 2017, endYearTo: 2026 },
];

/**
 * The one player whose shooting gets its own tier above Walking gravity, at the user's request.
 * Every other exception in this file is a general rule; this is a label. It fires only on spans
 * that already reach Walking gravity on their own, so his rookie years still read as what they
 * were — and it changes only the tier name, never `points`, so nothing downstream (POR, TAL,
 * `isPlusShooter`) can be moved by it.
 */
const SHOOTING_ANOMALY_PLAYER = 'Stephen Curry';

/** True for the one player `SHOOTING_ANOMALY_PLAYER` names — exported so `scoring.ts` can apply
 * the team-level floor below without a second copy of the name to keep in sync. */
export function isShootingAnomalyPlayer(span: PlayerSpan): boolean {
  return normalizePlayerName(span.playerName) === normalizePlayerName(SHOOTING_ANOMALY_PLAYER);
}

/**
 * Team spacing cannot read below this while the shooting-anomaly player is on the floor — the
 * user's rule, and the point of the tier existing at all: a 30-foot pull-up threat doesn't just
 * space the floor as one of five, he sets where the defense has to start from, so a lineup's
 * spacing is not really the average of its five shooters when one of them is him.
 *
 * Applied in `scoring.ts` over his share of game time, not as a flat override — see
 * `spacingScore`. 85 is inside `Great shooter` (SPC 80-94), i.e. the claim is "a floor with him
 * on it is at worst a well-spaced floor," not "a perfect one."
 */
export const SHOOTING_ANOMALY_TEAM_SPACING_FLOOR = 85;

function ladderScore(ladder: Ladder, value: number): number {
  let points = 0;
  for (const [minimum, awarded] of ladder) {
    if (value >= minimum) points = awarded;
  }
  return points;
}

export interface SpacingBreakdown {
  /** 3PA/game restated on the modern (2024-26) volume scale. */
  scaledThreePA: number;
  accuracyPoints: number;
  /** After the `VOLUME_ACCURACY_HEADROOM` clamp — what actually counts toward `points`. */
  volumePoints: number;
  /** Before the clamp, so callers can see when volume was discounted for poor accuracy. */
  rawVolumePoints: number;
  /** The two ladders plus the self-creation bonus, after the real-volume cap and any manual
   * floor, 0-20 — the number the tiers are cut against. Fractional, unlike the ladder halves. */
  points: number;
  tier: SpacingTier;
}

function hasManualWalkingGravity(span: PlayerSpan): boolean {
  const name = normalizePlayerName(span.playerName);
  const entry = MANUAL_WALKING_GRAVITY.find((e) => normalizePlayerName(e.player) === name);
  if (!entry) return false;
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) return false;
  const inRange = years.filter((y) => y >= entry.endYearFrom && y <= entry.endYearTo).length;
  return inRange * 2 > years.length;
}

/**
 * `selfCreationOverride` exists only so `scripts/compareSelfCreationMeasured.ts` can score a span
 * with a measured self-creation rate instead of the archetype proxy without duplicating the
 * ladders here (a copy would drift). Omitting it is the production path and behaves exactly as
 * before — nothing in `src/` passes it.
 */
export function spacingBreakdown(span: PlayerSpan, selfCreationOverride?: number): SpacingBreakdown {
  const position = span.primaryPosition;
  const scaledThreePA = eraScaledThreePA(span.spanLabel, span.box.threePA);
  const selfCreation = selfCreationOverride ?? selfCreationRate(span);

  const accuracyBar =
    span.box.threePct + SELF_CREATION_ACCURACY_DISCOUNT * selfCreation - shortenedLineAccuracyDiscount(span.spanLabel);
  const accuracyPoints = scaledThreePA < MIN_VOLUME_FOR_ACCURACY ? 0 : ladderScore(ACCURACY_LADDERS[position], accuracyBar);

  const volumeKicker =
    span.box.threePA >= SELF_CREATION_RAW_VOLUME_GATE ? 1 + SELF_CREATION_VOLUME_KICKER * selfCreation : 1;
  const rawVolumePoints = ladderScore(VOLUME_LADDERS[position], scaledThreePA * volumeKicker);
  const volumePoints = Math.min(rawVolumePoints, accuracyPoints + VOLUME_ACCURACY_HEADROOM);

  const ladderPoints = accuracyPoints + volumePoints;
  const selfCreationBonus =
    accuracyPoints >= SELF_CREATION_BONUS_MIN_ACCURACY && volumePoints >= SELF_CREATION_BONUS_MIN_VOLUME
      ? SELF_CREATION_BONUS * selfCreation * (1 - ladderPoints / MAX_SPACING_POINTS)
      : 0;

  let points = Math.min(MAX_SPACING_POINTS, ladderPoints + selfCreationBonus);

  // Order matters: the real-volume floor is a cap on what era-scaling alone can earn, so it has
  // to bite before the manual floors — which are explicit per-player calls and must win outright.
  if (
    span.box.threePA < REAL_VOLUME_FLOOR_FOR_WALKING_GRAVITY &&
    !REAL_VOLUME_FLOOR_EXEMPT.some((name) => normalizePlayerName(name) === normalizePlayerName(span.playerName))
  ) {
    points = Math.min(points, realVolumeFloorCapPoints());
  }
  if (hasManualWalkingGravity(span)) points = Math.max(points, WALKING_GRAVITY_FLOOR);

  let tier: SpacingTier = 'Non-shooter';
  for (const [floor, named] of TIER_FLOORS) {
    if (points >= floor) tier = named;
  }
  if (tier === 'Walking gravity' && normalizePlayerName(span.playerName) === normalizePlayerName(SHOOTING_ANOMALY_PLAYER)) {
    tier = 'Shooting anomaly';
  }

  return { scaledThreePA, accuracyPoints, volumePoints, rawVolumePoints, points, tier };
}

/** SPACING on the 0-100 scale the other judge metrics use. */
export function computeSpacing(span: PlayerSpan): number {
  return Math.round((spacingBreakdown(span).points / MAX_SPACING_POINTS) * 100);
}

export function spacingTier(span: PlayerSpan): SpacingTier {
  return spacingBreakdown(span).tier;
}
