import { computeDefensiveTalent } from './defensiveTalent';
import { defensiveHuntability } from './defensiveHuntability';
import { allAssignments, primaryStarters } from './rotation';
import { STARTER_SLOTS } from './positions';
import type { Team } from './types';
import type { DefensiveRole, Position } from '../data/schema';
import { secondaryDefensiveRoleStrength } from '../data/defensiveRoleProfiles';

const WING_ROLES: DefensiveRole[] = ['Wing Stopper', 'Chaser', 'Switch Big'];
/** Same discount shape `poa` below already applies to a non-exact-tag POA candidate — a real,
 * high-effort perimeter defender tagged Chaser rather than the more specific Wing Stopper still
 * covers real wing duty, just with slightly less confidence than the exact-tag case. */
const WING_ROLE_MULTIPLIER: Record<'Wing Stopper' | 'Chaser' | 'Switch Big', number> = {
  'Wing Stopper': 1,
  Chaser: 0.9,
  // A switch big genuinely covers a wing on a switch, but the perimeter isn't their home base —
  // between the two dedicated wing tags.
  'Switch Big': 0.92,
};
const RIM_ROLES: DefensiveRole[] = ['Anchor Big', 'Mobile Big', 'Switch Big'];

const FULL_PROVIDER_MINUTES = 24;
// 2026-09-07: 75 -> 68 after a D1 (n=15) + D1S2 (n=14) human-vote sweep. `providerReadiness`
// gates BOTH the elite-shell path and the bounded three-layer-core credit; the old 75 hard floor
// meant a lineup with three genuinely credible layers but a weakest link around 70-74 (Magic on
// D1S2 Drużyna 6, LeBron/Russell's Drużyna 1) earned exactly zero structural credit — same as a
// team with no defensive spine at all. Lowering the START to 68 (FULL kept at 85, so the ramp is
// gentler, not just shifted) gives those lineups partial, capped credit while D2/D11/D12-tier
// defenses (a weakest layer well below 68) still read 0. D1S2 overall Spearman 0.762 -> 0.788
// (Drużyna 1 engine #6 -> #4, the biggest miss), D1S2 defense sub 0.587 -> 0.613, D1 overall
// 0.564 -> 0.589 (recovers the Wilt era-override's cost). The elite-shell path is unaffected in
// practice — it still needs `averageDefensiveTalent >= AVERAGE_START` (80), a separate hard gate.
const PROVIDER_START = 68;
const PROVIDER_FULL = 85;
// 2026-08-31: measured against the real (no context-adjustment) D-TAL distribution for
// Anchor Big/Mobile Big spans (1293 spans: p85=81, p90=86, p95=92). Mobley's 2023-25 span (83,
// the weakest of this mechanism's own named motivating examples — Duncan/Robinson/Wembanyama all
// sit at 90-92) needs to clear a real bar here, not one calibrated assuming an extra lift that no
// longer exists. 78/88 spans roughly p73-p92: a merely good rim defender (p75, 72) still reads 0,
// while every named example gets real, mostly-saturated credit.
const BACKLINE_PROVIDER_START = 78;
const BACKLINE_PROVIDER_FULL = 88;
const AVERAGE_START = 80;
const AVERAGE_FULL = 86;

// 2026-09-09, user-reported ("kilka zespołów z 100 def nie ma sensu") + a top-5 human-vs-AI
// comparison where 4/5 elite AI defenses read exactly 100: the PARTIAL credits were doing most of
// the saturating — the AI's routine "draft a cheap 2nd rim protector" pattern maxed
// `backlineFoundation` (+18) on nearly every roster and pinned `defenseScore` to 100. The
// complete-all-time-shell credit is barely touched (9 -> 8, a genuine no-weak-link shell should
// still be able to approach the ceiling); the two partial paths are cut hard (12 -> 8, 18 -> 9)
// so only a real shell — not "two bigs + otherwise fine" — reaches 100. Paired with the new
// `offensiveCohesion` bonus (scoring.ts) so the two axes can reach comparable ceilings. These
// caps only touch the display/fit `defenseScore`; `drtgCompleteness` (the projectedNetRating
// floor) reads the readiness fractions and their own DRTG_BLEND constants, not these.
//
// 2026-09-12, user-reported live, still true after the cut above ("defensywa jest zawyżona,
// nadal zbyt dużo drużyn ma over 90"): measured directly (`scripts/_defenseInflationDiag.ts`,
// deleted after use, 5 seeds x 16 real AI-drafted-and-finalized teams = 80): 16.3% of teams read
// Defense > 90, 33.8% > 80. `threeLayerCore` was the winning (highest) bonus path on 57.5% of ALL
// teams (avg magnitude 5.04 of its 8 max when it wins) — the underlying `PROVIDER_START`=68 gate
// (lowered from 75 on 2026-09-07 for a real undercrediting case) makes it common, not rare, for a
// roster this pool's depth produces, so its bounded ceiling was still doing most of the pushing
// over 90. `backlineFoundation` won 9/80 (avg 7.69 of 9 max — usually near-saturated when it
// fires at all) and was the SOLE contributor on at least one >90 case (a team with zero elite-
// shell/three-layer credit still cleared 90 off backline alone). `weakLinkOvercome` — this same
// session's own new Nash mechanism — won exactly 1/80 and contributed to ZERO of the measured
// >90 cases: confirmed NOT the driver here, left untouched. Cut proportionally, same ~1/3 ratio
// as the 2026-09-09 pass (12->8, 18->9): 8->6, 9->6. `MAX_ELITE_SHELL_DEFENSE_BONUS` (a genuinely
// complete no-weak-link shell) is cut by the smallest margin of the three, same reasoning as
// 2026-09-09 — it should still be able to approach the ceiling; the two PARTIAL-credit paths
// (three-layer, backline) are cut harder since they are what a merely-good, not complete, defense
// was riding into the 90s.

/** Maximum extra separation reserved for a complete all-time defensive shell. */
export const MAX_ELITE_SHELL_DEFENSE_BONUS = 6;
/**
 * Maximum structural credit for fielding real POA + wing + rim providers even when the rest of
 * the rotation contains attackable players. This is deliberately separate from the elite-shell
 * ceiling: three excellent layers still matter, but they cannot erase weak-link minutes.
 */
export const MAX_THREE_LAYER_CORE_DEFENSE_BONUS = 5;
/** Two distinct high-minute rim protectors establish a real defensive floor even when the
 * perimeter shell is weak. This is a ceiling/foundation bonus, not a substitute for POA/wing
 * coverage, and therefore stays below the complete-shell treatment. */
export const MAX_BACKLINE_FOUNDATION_DEFENSE_BONUS = 6;
export const BACKLINE_FOUNDATION_DRTG_BLEND = 0.35;
/** Only a small part of a partial core carries into the real-units DRTG projection. */
export const THREE_LAYER_CORE_DRTG_BLEND = 0.15;

/**
 * 2026-09-12, user's own explicit design requirement, backed by a rigorous isolation test: took a
 * real, actually-drafted #1-overall team (Overall 87) and swapped ONLY its own elite, pass-first
 * PG (Stockton/Chris Paul/Frazier, in three separate leagues) for Steve Nash — same slot, same
 * everything else. Every time: Overall dropped 6-7 points and the team fell out of the top 3,
 * ENTIRELY from `defenseScore`. Broke that down further: `defensiveHuntability`'s penalty and
 * `defensiveCohesion`'s own existing bonuses above were already roughly CANCELING each other out
 * (7.6 vs 7.0) — neither is the actual problem. The real cause is the plain minutes-weighted D-TAL
 * average `defenseScore` starts from: Nash plays real starter minutes (~34-38) at D-TAL 21, and no
 * amount of teammate quality can "hide" those minutes from a linear average the way real NBA
 * scheme/help defense can. Verified this mechanically: even lifting Nash's OWN effective D-TAL to
 * the theoretical max (100) for the averaging step alone recovers at most ~11 points of
 * `defenseScore` (his real minutes are too small a share of the 240-minute team total) — nowhere
 * near the ~15 needed. A minutes-weighted-average fix is the wrong shape for this; a bounded,
 * ADDITIVE credit (the same shape `eliteShellBonus`/`threeLayerCoreBonus`/`backlineFoundationBonus`
 * above already use) can be sized directly instead of fighting that arithmetic ceiling.
 *
 * User's explicit requirement: "jeśli Nash ma greatest peak, to drużyna z nim musi być w stanie
 * wygrać draft" — if the engine's own tier system calls a player's peak "Greatest peak" (one step
 * below GOAT), a team built around him must have a real path to being the league's best, the same
 * way a real NBA team schemes around and conceals one historically extreme defensive liability
 * when everyone else on the floor is elite. Deliberately narrow on BOTH gates so this can't become
 * the same "too many teams read 100 Defense" problem the three existing bonuses above were already
 * tightened once to avoid (see this file's own 2026-09-09 comment): the weak link must be
 * genuinely EXTREME (`WEAK_LINK_EXTREME_DTAL_CEILING` — a merely below-average starter, 40-60
 * range, does not qualify at all), not just "worst of the five," and the other four starters must
 * be genuinely elite on average (`WEAK_LINK_SHELL_DTAL_FLOOR`/`_FULL` — a merely solid defense
 * doesn't unlock this). Participates in the same `Math.max(...)` ensemble as the other three paths
 * below, at a higher ceiling than any of them, since it exists specifically for a more extreme
 * case than any of those three were ever meant to cover.
 */
const WEAK_LINK_EXTREME_DTAL_CEILING = 35;
/** Severity ramps from 0 at the ceiling above to full at this realistic near-rock-bottom
 * reference (Nash himself, 21, is roughly the motivating middle of this range) — not from 0,
 * which would read every merely-extreme case (471, 25, 30...) as barely-qualifying. */
const WEAK_LINK_EXTREME_DTAL_FLOOR = 10;
const WEAK_LINK_SHELL_DTAL_FLOOR = 80;
const WEAK_LINK_SHELL_DTAL_FULL = 90;
export const MAX_WEAK_LINK_OVERCOME_DEFENSE_BONUS = 28;
/**
 * 2026-09-12, code-review finding (fit.ts's `defensiveCohesionComponent` was rescaling
 * `defenseScoreBonus` onto a 0-100 display scale by dividing by `MAX_BACKLINE_FOUNDATION_
 * DEFENSE_BONUS` alone — stale the moment `weakLinkOvercomeBonus`'s 28-point cap became the
 * largest of the four paths, producing values over 100, up to ~467, shown raw to the user):
 * the true ceiling `defenseScoreBonus` can reach is whichever of the four caps above is
 * currently largest. Exported so any consumer rescaling it stays correct automatically if any
 * one of the four is ever retuned again, instead of hardcoding one and silently going stale.
 */
export const MAX_DEFENSE_SCORE_BONUS = Math.max(
  MAX_ELITE_SHELL_DEFENSE_BONUS,
  MAX_THREE_LAYER_CORE_DEFENSE_BONUS,
  MAX_BACKLINE_FOUNDATION_DEFENSE_BONUS,
  MAX_WEAK_LINK_OVERCOME_DEFENSE_BONUS,
);
/** All-time-roster extrapolation target for a complete no-weak-link defensive shell. */
export const ELITE_SHELL_DRTG_TARGET = 85;

export interface DefensiveCohesionResult {
  /** 0-100 completeness of a no-weak-link POA + wing + rim defensive shell. */
  eliteShell: number;
  /** Unrounded 0-1 value used when blending the ordinary-team projection toward its elite tier. */
  completeness: number;
  /** POA + wing + rim structure after a softer weak-link discount, before shell-quality gates. */
  threeLayerCore: number;
  /** Completeness used by DRTG: elite shell, or a tightly capped partial-core contribution. */
  drtgCompleteness: number;
  /** Two-distinct-rim-provider foundation, attenuated but not erased by weak perimeter minutes. */
  backlineFoundation: number;
  /** How completely an elite four-starter shell overcomes ONE genuinely extreme weak-link
   * starter (see `MAX_WEAK_LINK_OVERCOME_DEFENSE_BONUS`'s own docstring) — 0 unless exactly that
   * shape is present. */
  weakLinkOvercome: number;
  defenseScoreBonus: number;
  averageDefensiveTalent: number;
  poaProvider: string | null;
  wingProvider: string | null;
  rimProvider: string | null;
  secondRimProvider: string | null;
  poaStrength: number;
  wingStrength: number;
  rimStrength: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Measures the part an ordinary minutes-weighted D-TAL average cannot express: whether an
 * all-time rotation has a credible point-of-attack defender, primary wing stopper and rim
 * protector. A complete high-average, no-weak-link shell can reach the historical ceiling; a
 * rotation with those same three layers plus attackable players receives only bounded structural
 * credit. Incumbent roles only are accepted; box-only inferred shadow roles cannot unlock this
 * production bonus. A guard with an incumbent Wing Stopper role receives 90% POA transfer credit
 * — Harper/Jrue guarding the ball is a real role overlap, not an inferred box-score invention.
 *
 * 2026-08-30, user-reported (batch feedback: real rosters with a genuine plus wing defender —
 * Nicolas Batum, Khris Middleton — reading `wing: null`, zeroing this entire bonus even with a
 * strong POA and rim provider already present). Root-caused, not guessed: `WING_ROLES` only ever
 * accepted the exact `'Wing Stopper'` tag, while `poa` right below already accepts `'Chaser'` at
 * 90% confidence for the identical "real perimeter defender, not the single most specific tag"
 * case. Batum's actual tag on the reported span is `Chaser` — a real, high-effort perimeter
 * defender the pool tags this way when their profile doesn't fit the more specific Wing Stopper
 * archetype, not "no real wing defense." Extended `WING_ROLES` to accept `Chaser` at the same 90%
 * transfer credit already used for POA. Deliberately NOT touching `PROVIDER_START`/`PROVIDER_FULL`
 * (the numeric floor) in the same pass — a real existing fixture
 * (`scripts/testDefensiveHuntability.ts`'s `reported` roster) relies on OG Anunoby's wing D-TAL
 * (72, just under the 75 floor) staying excluded to keep a genuinely weak-link roster capped at
 * Defense<=50; loosening that floor is a separate, larger tradeoff that needs its own measurement
 * pass, not bundled into this narrower role-tag fix. Also excludes whoever already filled POA
 * from the wing search — `Chaser` now overlaps both roles, and the same do-everything guard
 * filling both slots would only be two real layers of coverage, not three. A
 * 12-minute token specialist also cannot complete a layer — provider strength reaches full
 * availability at 24 assigned minutes.
 */
export function defensiveCohesion(team: Team): DefensiveCohesionResult {
  const assignments = allAssignments(team);
  if (assignments.length === 0) {
    return {
      eliteShell: 0,
      completeness: 0,
      threeLayerCore: 0,
      drtgCompleteness: 0,
      backlineFoundation: 0,
      weakLinkOvercome: 0,
      defenseScoreBonus: 0,
      averageDefensiveTalent: 0,
      poaProvider: null,
      wingProvider: null,
      rimProvider: null,
      secondRimProvider: null,
      poaStrength: 0,
      wingStrength: 0,
      rimStrength: 0,
    };
  }

  const minutesByPlayer = new Map<string, number>();
  const dominantSlotByPlayer = new Map<string, Position>();
  const slotMinutesByPlayer = new Map<string, Map<Position, number>>();
  for (const { player, slot, minutes } of assignments) {
    minutesByPlayer.set(player.id, (minutesByPlayer.get(player.id) ?? 0) + minutes);
    const bySlot = slotMinutesByPlayer.get(player.id) ?? new Map<Position, number>();
    bySlot.set(slot, (bySlot.get(slot) ?? 0) + minutes);
    slotMinutesByPlayer.set(player.id, bySlot);
  }
  for (const [id, bySlot] of slotMinutesByPlayer) {
    let best: Position = 'C';
    let bestMin = -1;
    for (const [s, m] of bySlot) if (m > bestMin) { best = s; bestMin = m; }
    dominantSlotByPlayer.set(id, best);
  }
  const assignedPlayers = team.roster
    .map((player) => {
      const minutes = minutesByPlayer.get(player.id) ?? 0;
      const defensiveTalent = computeDefensiveTalent(player);
      return {
        player,
        minutes,
        defensiveTalent,
        providerStrength: defensiveTalent * Math.min(1, minutes / FULL_PROVIDER_MINUTES),
      };
    })
    .filter(({ minutes }) => minutes > 0);

  const starters = primaryStarters(team).map((entry) => entry.player);
  const averageDefensiveTalent = starters.length > 0
    ? starters.reduce((sum, player) => sum + computeDefensiveTalent(player), 0) / starters.length
    : 0;

  function bestProvider(
    roles: DefensiveRole[],
    multiplierFor: (role: DefensiveRole) => number = () => 1,
    excludePlayerId?: string,
  ) {
    return assignedPlayers
      .filter(({ player }) => player.id !== excludePlayerId && roles.some((role) => secondaryDefensiveRoleStrength(player, role) > 0))
      .map((entry) => {
        const bestRole = [...roles].sort(
          (left, right) => secondaryDefensiveRoleStrength(entry.player, right) - secondaryDefensiveRoleStrength(entry.player, left),
        )[0]!;
        const roleStrength = secondaryDefensiveRoleStrength(entry.player, bestRole);
        // Secondary jobs soften, but do not erase, a player's real defensive quality. A verified
        // Jrue POA assignment should not score like a new player with 90% of Jrue's D-TAL.
        const effectiveStrength = entry.providerStrength * (0.8 + roleStrength * 0.2) * multiplierFor(bestRole);
        return { ...entry, effectiveStrength };
      })
      .sort((left, right) => right.effectiveStrength - left.effectiveStrength)[0] ?? null;
  }

  const poa = assignedPlayers
    .filter(({ player }) =>
      secondaryDefensiveRoleStrength(player, 'Point of Attack') > 0 ||
      player.defensiveRole === 'Chaser' ||
      (player.defensiveRole === 'Wing Stopper' && (player.primaryPosition === 'PG' || player.primaryPosition === 'SG')),
    )
    .map((entry) => ({
      ...entry,
      effectiveStrength: entry.providerStrength * (entry.player.defensiveRole === 'Point of Attack' ? 1 : entry.player.defensiveRole === 'Chaser' ? 0.9 : 0.96),
    }))
    .sort((left, right) => right.effectiveStrength - left.effectiveStrength)[0] ?? null;
  // Excludes whoever already filled POA — `Chaser` now qualifies for both roles (see this
  // function's own docstring), and the three-layer bonus is meant to credit three DISTINCT
  // specialists, not the same do-everything guard counted twice.
  const wing = bestProvider(
    WING_ROLES,
    (role) => WING_ROLE_MULTIPLIER[role as 'Wing Stopper' | 'Chaser' | 'Switch Big'] ?? 0.9,
    poa?.player.id,
  );
  const rim = bestProvider(RIM_ROLES);
  const rimProviders = assignedPlayers
    .filter(({ player }) => RIM_ROLES.includes(player.defensiveRole))
    .map((entry) => ({ ...entry, effectiveStrength: entry.providerStrength }))
    .sort((left, right) => right.effectiveStrength - left.effectiveStrength);
  const secondRim = rimProviders[1] ?? null;
  const poaStrength = poa?.effectiveStrength ?? 0;
  const wingStrength = wing?.effectiveStrength ?? 0;
  const rimStrength = rim?.effectiveStrength ?? 0;
  const providerReadiness = clamp01(
    (Math.min(poaStrength, wingStrength, rimStrength) - PROVIDER_START) /
      (PROVIDER_FULL - PROVIDER_START),
  );
  const averageReadiness = clamp01(
    (averageDefensiveTalent - AVERAGE_START) / (AVERAGE_FULL - AVERAGE_START),
  );
  // Full-rotation huntability attenuates the starter shell continuously instead of acting as a
  // cliff. Bench targets still cost their real minutes in `defensiveHuntability`, but 18 minutes
  // of Charlie Ward cannot erase an otherwise elite five-man defensive structure altogether.
  const resistanceReadiness = defensiveHuntability(team).resistance / 100;
  const completeness = Math.min(providerReadiness, averageReadiness) * resistanceReadiness;
  // A low starter average used to zero the entire structural bonus. That made a roster with
  // Jordan at POA, Roberson on wings and Gobert/Mobley behind them score exactly like a roster
  // with no coherent defensive spine. Keep the full no-weak-link shell gate above, but retain a
  // bounded amount of credit for three genuinely strong layers. The 50% floor applies only to
  // the structural bonus; every weak minute is still charged in `defensiveHuntability`.
  const threeLayerCore = providerReadiness * (0.5 + resistanceReadiness * 0.5);
  const eliteShellBonus = completeness * MAX_ELITE_SHELL_DEFENSE_BONUS;
  const threeLayerCoreBonus = threeLayerCore * MAX_THREE_LAYER_CORE_DEFENSE_BONUS;
  const secondRimReadiness = clamp01(
    ((secondRim?.effectiveStrength ?? 0) - BACKLINE_PROVIDER_START) /
      (BACKLINE_PROVIDER_FULL - BACKLINE_PROVIDER_START),
  );
  // A backline FOUNDATION means two rim anchors actually on the floor together — Duncan at the 4,
  // Robinson at the 5 — not two centers time-sharing one position. Those two things defend very
  // differently but read identically to the strength-only check above: Gobert 26 min + Ben
  // Wallace 22 min, both at the C slot (D1S2 Drużyna 13), was earning the full +18 for a twin
  // tower it never fields. Require the two anchors' dominant slots to differ (one C, one PF).
  const rimSlotsDiffer =
    rimProviders.length >= 2 &&
    dominantSlotByPlayer.get(rimProviders[0].player.id) !==
      dominantSlotByPlayer.get(rimProviders[1].player.id);
  // Opponents can still attack the guards, so hunt resistance affects the ceiling; it cannot
  // erase Duncan+Robinson, Mobley+Gobert or Wembanyama+Robinson as a backline foundation.
  const backlineFoundation = rimSlotsDiffer
    ? secondRimReadiness * (0.65 + resistanceReadiness * 0.35)
    : 0;
  const backlineFoundationBonus = backlineFoundation * MAX_BACKLINE_FOUNDATION_DEFENSE_BONUS;

  // See `MAX_WEAK_LINK_OVERCOME_DEFENSE_BONUS`'s own docstring for the full derivation. Uses the
  // starters' OWN D-TAL directly (not `providerStrength`/role-tag credit like poa/wing/rim above)
  // — this is specifically about the plain averaging problem, so it has to measure the same raw
  // number that problem is made of. Requires ALL FOUR other starters to individually clear a real
  // floor (`shellMin`), not just a high average one outlier could inflate.
  const starterDefTals = starters.map((player) => computeDefensiveTalent(player));
  const minDefTal = starterDefTals.length > 0 ? Math.min(...starterDefTals) : 100;
  const weakLinkIdx = starterDefTals.indexOf(minDefTal);
  const shellDefTals = starterDefTals.filter((_, i) => i !== weakLinkIdx);
  const shellAverageDefTal = shellDefTals.length > 0 ? shellDefTals.reduce((sum, v) => sum + v, 0) / shellDefTals.length : 0;
  const shellMinDefTal = shellDefTals.length > 0 ? Math.min(...shellDefTals) : 0;
  const extremeSeverity = clamp01(
    (WEAK_LINK_EXTREME_DTAL_CEILING - minDefTal) / (WEAK_LINK_EXTREME_DTAL_CEILING - WEAK_LINK_EXTREME_DTAL_FLOOR),
  );
  const shellAverageReadiness = clamp01((shellAverageDefTal - WEAK_LINK_SHELL_DTAL_FLOOR) / (WEAK_LINK_SHELL_DTAL_FULL - WEAK_LINK_SHELL_DTAL_FLOOR));
  // Same floor as the average gate, 8 points softer — the individually-weakest of the other four
  // still has to be genuinely strong, just not held to quite the average's own bar.
  const shellFloorReadiness = clamp01(
    (shellMinDefTal - (WEAK_LINK_SHELL_DTAL_FLOOR - 8)) / (WEAK_LINK_SHELL_DTAL_FULL - (WEAK_LINK_SHELL_DTAL_FLOOR - 8)),
  );
  const weakLinkOvercome =
    starters.length === STARTER_SLOTS.length && minDefTal < WEAK_LINK_EXTREME_DTAL_CEILING
      ? extremeSeverity * shellAverageReadiness * shellFloorReadiness
      : 0;
  const weakLinkOvercomeBonus = weakLinkOvercome * MAX_WEAK_LINK_OVERCOME_DEFENSE_BONUS;

  // 2026-09-12, code-review finding: this used to omit `weakLinkOvercome` entirely, so a Nash-
  // style team's boosted defenseScore/Overall (the whole point of the mechanism — see that
  // constant's own docstring) never reached the season/playoff simulation's real net-rating model
  // (`netRatingProjection.ts` blends `drtgCompleteness` in directly) — the team could rank #1 in
  // the draft-day Power Ranking while still simulating games with its unconcealed, bad defense,
  // contradicting the user's own explicit requirement ("musi być w stanie wygrać draft"). Blended
  // in at the same weight as `completeness` itself (not a smaller fraction like the two softer
  // partial paths below): `weakLinkOvercome`'s own three-factor gate (a genuinely extreme outlier
  // AND a genuinely elite 80-90 shell average AND a real floor across the other four) is at least
  // as strict as `completeness`'s own no-weak-link-shell bar, just scoped to concealing one
  // starter instead of requiring the whole rotation to already be weak-link-free.
  const drtgCompleteness = Math.max(
    completeness,
    threeLayerCore * THREE_LAYER_CORE_DRTG_BLEND,
    backlineFoundation * BACKLINE_FOUNDATION_DRTG_BLEND,
    weakLinkOvercome,
  );

  return {
    eliteShell: Math.round(completeness * 100),
    completeness,
    threeLayerCore,
    drtgCompleteness,
    backlineFoundation,
    weakLinkOvercome,
    defenseScoreBonus: Math.max(eliteShellBonus, threeLayerCoreBonus, backlineFoundationBonus, weakLinkOvercomeBonus),
    averageDefensiveTalent,
    poaProvider: poa?.player.playerName ?? null,
    wingProvider: wing?.player.playerName ?? null,
    rimProvider: rim?.player.playerName ?? null,
    secondRimProvider: secondRim?.player.playerName ?? null,
    poaStrength,
    wingStrength,
    rimStrength,
  };
}
