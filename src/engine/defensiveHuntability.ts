import { RIM_PROTECTOR_ROLES, type Position, type PlayerSpan, type DefensiveRole } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { computeDefensiveTalent, hasEraOverrideDefenseFloor } from './defensiveTalent';
import { effectiveTalent } from './grades';
import { athleticismScoreForSpan } from './athleticismLookup';
import { allAssignments, primaryStarters, GAME_MINUTES } from './rotation';
import type { Team } from './types';

/**
 * 2026-09-05, user-reported: a flat D-TAL ceiling (60, for every position alike) doesn't mean
 * "below average" — it means something different depending on position. `computeDefensiveTalent`
 * rewards rim protection/rebounding heavily, so among real Starter-tier-or-better spans (TAL>=60,
 * the same floor `grades.ts`'s `OVERALL_TIER_FLOORS` uses) the position medians are wildly
 * different: PG 51 / SG 46 / SF 47 / PF 64 / C 71 (measured directly against `draftPool`). A flat
 * 60 called almost every legitimate starting guard/wing "below average" while barely ever
 * flagging a center — the exact position bias this replaces.
 *
 * The reference population is deliberately `draftPool` filtered to `effectiveTalent >=
 * STARTER_TAL_FLOOR`, not the whole pool or the whole span-history dataset: the user's own
 * objection to a population-wide average was that "hundreds of weak non-draftable players" drag
 * it down to a number no real rostered starter resembles. A team-relative average (this roster's
 * own mean) was rejected too — it would flag a merely-least-good starter on a genuinely elite
 * defensive five as "huntable," which the user called out directly as not making sense. This is a
 * fixed, position-specific number computed once from the realistic reference group ("an actual
 * NBA-caliber starter at this position"), not context-dependent on either the specific roster or
 * the pool's replacement-level tail.
 */
const STARTER_TAL_FLOOR = 60;
const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const starterCaliberByPosition: Record<Position, PlayerSpan[]> = Object.fromEntries(
  POSITIONS.map((pos) => [
    pos,
    draftPool.filter(
      (p) =>
        p.primaryPosition === pos &&
        effectiveTalent(p) >= STARTER_TAL_FLOOR &&
        !hasEraOverrideDefenseFloor(p.playerName),
    ),
  ]),
) as Record<Position, PlayerSpan[]>;

/**
 * 2026-09-05, user-reported (Bosh 62 / O'Neale 40 / Embiid 67 flagged as hunt targets they
 * shouldn't clearly be): "below average" was the cohort MEDIAN. A merely somewhat-below-median
 * defender isn't THE weak link opponents scheme around — only a genuinely below-average one is.
 * The bar is now the ~45th percentile of the realistic starter cohort — a small step down from
 * the median, enough to clear the borderline false positives without collapsing the signal for
 * genuinely weak defenders (which a p40 bar started to do — D1 rank correlation moved the wrong
 * way, and Kyle Korver-tier liabilities began slipping through).
 */
const HUNTABLE_COHORT_PERCENTILE = 0.45;
function cohortBar(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * HUNTABLE_COHORT_PERCENTILE)];
}

/** Position-relative "huntable bar" D-TAL — replaces the old flat `TARGETABLE_DTAL_CEILING`. */
const AVERAGE_DTAL_BY_POSITION: Record<Position, number> = Object.fromEntries(
  POSITIONS.map((pos) => [pos, cohortBar(starterCaliberByPosition[pos].map(computeDefensiveTalent))]),
) as Record<Position, number>;

/**
 * 2026-09-05, user-reported follow-up ("da się zrobić podział centrów na interior i perimeter
 * defense?" — can centers be split into interior vs. perimeter defense?): the position-level
 * average above still blends two real, comparably-legitimate defensive archetypes at PF/C.
 * `RIM_PROTECTOR_ROLES` (Anchor Big / Mobile Big) is the existing categorical split this project
 * already uses elsewhere for exactly this question (`anchorDampening` above,
 * `defensiveCohesion.ts`'s `RIM_ROLES`). Measured directly against the Starter-tier-or-better
 * reference group: C Anchor Big median 78 vs C Mobile Big 62 (a 16-point gap); PF Anchor Big 81
 * vs PF Mobile Big 70. A flat C average (71) sits BETWEEN the two — it was quietly grading every
 * real rim-anchor against too LOW a bar (never huntable) and every switchy/mobile big against too
 * HIGH a bar (Mitchell Robinson's 63, this mechanism's own motivating example, is almost exactly
 * the Mobile Big median of 62 — he isn't actually below-average for his real defensive job, only
 * for the wrong reference group).
 *
 * Deliberately scoped to ONLY `RIM_PROTECTOR_ROLES`, not every `defensiveRole` at every position.
 * The guard/wing roles (Point of Attack/Wing Stopper vs. Chaser/Helper/Low Activity) show an even
 * bigger spread (e.g. PG Point of Attack median 69 vs PG Low Activity 35) — but unlike Anchor vs.
 * Mobile Big, that spread is mostly a QUALITY gradient, not two comparably-good alternate jobs:
 * "Low Activity"/"Helper"/"Chaser" describe a weak or passive defensive profile, not a legitimate
 * specialization the way a switch-everything big is a legitimate alternative to a rim-camping one.
 * Splitting guards the same way was tried and rejected on a real measurement: it roughly halved
 * Steve Nash/Dana Barros/Mario Elie's real huntability penalty (10.2 -> 5.5 on the `reported`
 * fixture below) by comparing them only against other already-bad-defender peers — softening
 * exactly the signal this mechanism exists to keep sharp. Bigs are different because
 * `RIM_PROTECTOR_ROLES` really are two separate, both-legitimate jobs; guards' role tags are not.
 *
 * `AVERAGE_DTAL_BY_ROLE_KEY` keys on `${position}|${defensiveRole}`, populated only for
 * `RIM_PROTECTOR_ROLES`; `MIN_ROLE_SAMPLE` guards against noisy small buckets (SF Anchor Big has
 * only 2 real spans in the whole pool) by falling back to the plain position average above.
 */
const MIN_ROLE_SAMPLE = 15;
function roleKey(position: Position, role: DefensiveRole): string {
  return `${position}|${role}`;
}
const starterCaliberByRoleKey = new Map<string, PlayerSpan[]>();
for (const pos of POSITIONS) {
  for (const player of starterCaliberByPosition[pos]) {
    if (!RIM_PROTECTOR_ROLES.includes(player.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number])) continue;
    const key = roleKey(pos, player.defensiveRole);
    const bucket = starterCaliberByRoleKey.get(key);
    if (bucket) bucket.push(player);
    else starterCaliberByRoleKey.set(key, [player]);
  }
}
const AVERAGE_DTAL_BY_ROLE_KEY = new Map<string, number>();
for (const [key, group] of starterCaliberByRoleKey) {
  if (group.length >= MIN_ROLE_SAMPLE) AVERAGE_DTAL_BY_ROLE_KEY.set(key, cohortBar(group.map(computeDefensiveTalent)));
}

/**
 * 2026-09-05, user-reported (Chris Bosh 2012-14, D-TAL 62, tagged `Anchor Big` -> huntable against
 * the elite rim-anchor bar; the user: a mobile switch PF who held up on switches shouldn't be the
 * hunt target, a slow true C would be). The `Anchor Big` tag reads off a big's rim-protection box
 * profile, not whether they can switch — but ATHLETICISM is a real proxy for it. Rather than a
 * hard Anchor/Mobile cliff, a rim-protector-role big's bar is INTERPOLATED between the two cohort
 * bars by their athleticism percentile within their position's starter pool: max-athleticism ->
 * the Mobile Big (switch-capable) bar, min-athleticism -> the Anchor Big bar. Embiid (elite
 * athleticism) lands right at the Mobile Big bar and clears it; a plodding true anchor barely
 * moves off the Anchor Big bar. (Bosh's own athleticism data is only ~38th pctile among starting
 * PFs, so he gets partial relief here, not full — his D-TAL 62 vs a real DARKO of +2.0 is a
 * separate "box + capped bonus undervalue him" question.)
 */
function rimProtectorBar(player: PlayerSpan): number | null {
  const anchor = AVERAGE_DTAL_BY_ROLE_KEY.get(roleKey(player.primaryPosition, 'Anchor Big'));
  const mobile = AVERAGE_DTAL_BY_ROLE_KEY.get(roleKey(player.primaryPosition, 'Mobile Big'));
  if (anchor === undefined || mobile === undefined) {
    return AVERAGE_DTAL_BY_ROLE_KEY.get(roleKey(player.primaryPosition, player.defensiveRole)) ?? null;
  }
  const ath = athleticismScoreForSpan(player);
  const athFrac = ath === null ? 0.35 : percentile(athleticismLadderByPosition[player.primaryPosition], ath) / 100;
  return anchor - athFrac * (anchor - mobile);
}

function averageDtalFor(player: PlayerSpan): number {
  if (RIM_PROTECTOR_ROLES.includes(player.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number])) {
    const bar = rimProtectorBar(player);
    if (bar !== null) return bar;
  }
  return AVERAGE_DTAL_BY_ROLE_KEY.get(roleKey(player.primaryPosition, player.defensiveRole))
    ?? AVERAGE_DTAL_BY_POSITION[player.primaryPosition];
}

/** Same role-aware reference group, used for the athleticism percentile below — comparing a
 * player's tools against realistic peers doing the same defensive job, not just the same
 * position (a rim-camping Anchor Big and a switch-everything Mobile Big are not the same
 * athleticism population), with the same small-bucket position-level fallback. */
const athleticismLadderByPosition: Record<Position, number[]> = Object.fromEntries(
  POSITIONS.map((pos) => [
    pos,
    starterCaliberByPosition[pos]
      .map(athleticismScoreForSpan)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b),
  ]),
) as Record<Position, number[]>;
const athleticismLadderByRoleKey = new Map<string, number[]>();
for (const [key, group] of starterCaliberByRoleKey) {
  if (group.length < MIN_ROLE_SAMPLE) continue;
  const ladder = group.map(athleticismScoreForSpan).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (ladder.length > 0) athleticismLadderByRoleKey.set(key, ladder);
}
function athleticismLadderFor(player: PlayerSpan): number[] {
  return athleticismLadderByRoleKey.get(roleKey(player.primaryPosition, player.defensiveRole))
    ?? athleticismLadderByPosition[player.primaryPosition];
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 50;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
}

/**
 * A below-average defender with genuinely below-average physical tools for their position is a
 * cleaner target than one whose D-TAL reads low for scheme/box reasons despite real athleticism —
 * recovery speed and length let an athletic-but-lower-D-TAL player survive isolations a true
 * unathletic liability can't. Bounded, symmetric ramp around the position's own median
 * (percentile 50 -> neutral 1.0): bottom of the pool -> `AMPLIFY`, top -> `DAMPEN`. Missing
 * athleticism coverage (some older spans) defaults to the neutral midpoint, not a penalty — no
 * data is not evidence of poor tools.
 */
const ATHLETICISM_SHORTFALL_AMPLIFY = 1.25;
const ATHLETICISM_SHORTFALL_DAMPEN = 0.75;

function athleticismShortfallFactor(player: PlayerSpan): number {
  const score = athleticismScoreForSpan(player);
  const pct = score === null ? 50 : percentile(athleticismLadderFor(player), score);
  return ATHLETICISM_SHORTFALL_AMPLIFY - (pct / 100) * (ATHLETICISM_SHORTFALL_AMPLIFY - ATHLETICISM_SHORTFALL_DAMPEN);
}

const MAX_HUNTABILITY_PENALTY = 20;

/**
 * 2026-09-03, user-reported (D2 draft #2: "Jordan + McDaniels + Malone + Howard = Def 48?"). A
 * weak on-ball defender is hunted far less effectively when a DPOY-level rim protector is behind
 * him erasing the drive that the switch/blow-by is supposed to create — the possession the
 * offense engineers just runs into a wall. The linear per-stint sum above has no notion of this:
 * #2 ate a near-max penalty for one attackable perimeter starter (Jaden McDaniels) despite
 * Dwight Howard 2009-11 (D-TAL 95) anchoring the paint.
 *
 * `anchorDampening` scales the final penalty down, up to `MAX_ANCHOR_DAMPENING` (35%), for a
 * role-tagged rim protector (Anchor Big / Mobile Big) whose D-TAL clears `ANCHOR_DTAL_GATE` and
 * who actually plays. The gate is deliberately high — a genuine rim-eraser (Gobert, Mutombo,
 * D-Robinson, Ben Wallace, prime Howard, Mobley-tier and up), not merely a good-sized center.
 * Shaq 1999-01 (D-TAL 80) and Tyson Chandler 2011-13 (86) do NOT clear it, so the existing
 * `reported` fixture is untouched; Gobert 2020-22 (92) does, so `reportedThreeLayerCore` gets a
 * bounded ~12% relief (stays inside its 60-70 band). Distinct lever from
 * `defensiveCohesion.backlineFoundation` (which ADDS a bonus for a two-anchor backline) — this
 * one SOFTENS the weak-link cost, and both are intentionally modest.
 */
const ANCHOR_DTAL_GATE = 88;
const ANCHOR_DTAL_FULL = 100;
const ANCHOR_MINUTES_FOR_FULL = 30;
const MAX_ANCHOR_DAMPENING = 0.35;

function anchorDampening(team: Team, minutesByPlayer: Map<string, number>): number {
  let best = 0;
  for (const player of team.roster) {
    if (!RIM_PROTECTOR_ROLES.includes(player.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number])) continue;
    const minutes = minutesByPlayer.get(player.id) ?? 0;
    if (minutes <= 0) continue;
    const dtal = computeDefensiveTalent(player);
    if (dtal < ANCHOR_DTAL_GATE) continue;
    const dtalFactor = Math.min(1, (dtal - ANCHOR_DTAL_GATE) / (ANCHOR_DTAL_FULL - ANCHOR_DTAL_GATE));
    const minutesFactor = Math.min(1, minutes / ANCHOR_MINUTES_FOR_FULL);
    best = Math.max(best, dtalFactor * minutesFactor);
  }
  return 1 - MAX_ANCHOR_DAMPENING * best;
}

/**
 * 2026-08-30, user-reported (batch feedback follow-up: "are bench players scaled for the fact
 * they're bench players who'll mostly face the opponent's bench, playing fewer minutes?"). They
 * weren't — `computeDefensiveTalent` is a pure, context-free per-player rating with no notion of
 * starter/bench at all, and this penalty previously charged every weak-link minute identically
 * regardless of who's realistically on the floor across from it. A real bench stint is rarely
 * "full bench vs full bench" (rotations stagger, 1-2 starters often remain either way), so this is
 * a real but MODEST relief, not a large one — deliberately smaller than `BENCH_INFLUENCE_BOOST`
 * (scoring.ts), which does the opposite job on purpose (amplifying bench's voice in the team
 * average, not softening its exploitability). First-pass estimate, not measured against a real
 * competition-quality dataset (none exists in this project) — the same honest-starting-point
 * status as every other first-pass constant here until a real report justifies tightening it.
 *
 * 2026-09-05, user's explicit follow-up call: 0.7 was too little relief for how one-sided bench
 * play actually is — tightened to 0.4 (bench weak-link minutes now count for less than half their
 * real minutes toward the penalty).
 */
const BENCH_COMPETITION_DISCOUNT = 0.4;

export interface DefensiveHuntabilityOffender {
  playerId: string;
  playerName: string;
  /** Real assigned minutes — unchanged, still what the UI displays. */
  minutes: number;
  /** `minutes` with the bench portion discounted by `BENCH_COMPETITION_DISCOUNT` — what the
   *  penalty math below actually uses. Equal to `minutes` for a player with no bench minutes. */
  competitionAdjustedMinutes: number;
  defensiveTalent: number;
  shortfall: number;
}

export interface DefensiveHuntabilityResult {
  penalty: number;
  resistance: number;
  targetableMinutes: number;
  offenders: DefensiveHuntabilityOffender[];
}

/** Single scalar for the penalty's own 0-100-ish normalization below — the position bars above
 * differ, but the penalty scale itself needs one fixed denominator, not five. Deliberately still
 * the MEAN OF THE POSITION MEDIANS (~56), not the p45 bars: dropping the bar to p45 (2026-09-05)
 * flags fewer players, but it must not also silently make every flagged minute cost more by
 * shrinking this denominator — the two effects should not compound. */
const NORMALIZATION_DTAL = POSITIONS.reduce((sum, pos) => {
  const vals = starterCaliberByPosition[pos].map(computeDefensiveTalent).sort((a, b) => a - b);
  return sum + vals[Math.floor(vals.length / 2)];
}, 0) / POSITIONS.length;

/**
 * Nonlinear playoff weak-link signal. A minutes-weighted average can hide one or two defenders
 * behind an elite rim protector; opponents cannot. This counts the volume and severity of every
 * below-position-average D-TAL stint (see `AVERAGE_DTAL_BY_POSITION` above), scaled by how
 * exploitable the shortfall really is physically (`athleticismShortfallFactor`), so two huntable
 * perimeter players stack while a 10-minute bench weakness remains much cheaper than a 36-minute
 * starter — and cheaper per minute than an equally weak starter, since bench minutes are
 * discounted by `BENCH_COMPETITION_DISCOUNT` to reflect facing real bench-level opposition on
 * average, not starter-level.
 */
export function defensiveHuntability(team: Team): DefensiveHuntabilityResult {
  const minutesByPlayer = new Map<string, number>();
  // Same starter/bench split `scoring.ts`'s `benchBoostedWeightedAverage` already keys off of —
  // reused here for the opposite adjustment (discount, not boost). A player split across a
  // starter slot and a bench slot (a real possibility with cross-slot backup minutes) gets each
  // portion weighted separately, not an all-or-nothing label.
  const starterKeys = new Set(primaryStarters(team).map((s) => `${s.slot}|${s.player.id}`));
  const benchMinutesByPlayer = new Map<string, number>();
  for (const assignment of allAssignments(team)) {
    minutesByPlayer.set(assignment.player.id, (minutesByPlayer.get(assignment.player.id) ?? 0) + assignment.minutes);
    if (!starterKeys.has(`${assignment.slot}|${assignment.player.id}`)) {
      benchMinutesByPlayer.set(assignment.player.id, (benchMinutesByPlayer.get(assignment.player.id) ?? 0) + assignment.minutes);
    }
  }
  const offenders = team.roster.flatMap((player) => {
    const minutes = minutesByPlayer.get(player.id) ?? 0;
    const benchMinutes = benchMinutesByPlayer.get(player.id) ?? 0;
    const starterMinutes = minutes - benchMinutes;
    const competitionAdjustedMinutes = starterMinutes + benchMinutes * BENCH_COMPETITION_DISCOUNT;
    const defensiveTalent = computeDefensiveTalent(player);
    const rawShortfall = Math.max(0, averageDtalFor(player) - defensiveTalent);
    const shortfall = rawShortfall * athleticismShortfallFactor(player);
    return minutes > 0 && shortfall > 0
      ? [{ playerId: player.id, playerName: player.playerName, minutes, competitionAdjustedMinutes, defensiveTalent, shortfall }]
      : [];
  }).sort((left, right) => right.shortfall * right.competitionAdjustedMinutes - left.shortfall * left.competitionAdjustedMinutes);
  const shortfallMinutes = offenders.reduce((sum, offender) => sum + offender.shortfall * offender.competitionAdjustedMinutes, 0);
  const rawPenalty = Math.min(
    MAX_HUNTABILITY_PENALTY,
    (shortfallMinutes / (NORMALIZATION_DTAL * GAME_MINUTES)) * MAX_HUNTABILITY_PENALTY,
  );
  const penalty =
    rawPenalty * anchorDampening(team, minutesByPlayer);
  return {
    penalty,
    resistance: Math.round(100 - (penalty / MAX_HUNTABILITY_PENALTY) * 100),
    targetableMinutes: offenders.reduce((sum, offender) => sum + offender.minutes, 0),
    offenders,
  };
}

/** Existing real-team regression shrinks one D-TAL point by 0.277 DRTG. Using 0.20 here keeps
 * the nonlinear playoff adjustment smaller than that validated linear relationship. */
export const HUNTABILITY_DRTG_POINTS_PER_PENALTY = 0.20;
