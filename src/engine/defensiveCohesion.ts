import { computeDefensiveTalent } from './defensiveTalent';
import { defensiveHuntability } from './defensiveHuntability';
import { allAssignments, primaryStarters } from './rotation';
import type { Team } from './types';
import type { DefensiveRole } from '../data/schema';
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

/** Maximum extra separation reserved for a complete all-time defensive shell. */
export const MAX_ELITE_SHELL_DEFENSE_BONUS = 9;
/**
 * Maximum structural credit for fielding real POA + wing + rim providers even when the rest of
 * the rotation contains attackable players. This is deliberately separate from the elite-shell
 * ceiling: three excellent layers still matter, but they cannot erase weak-link minutes.
 */
export const MAX_THREE_LAYER_CORE_DEFENSE_BONUS = 12;
/** Two distinct high-minute rim protectors establish a real defensive floor even when the
 * perimeter shell is weak. This is a ceiling/foundation bonus, not a substitute for POA/wing
 * coverage, and therefore stays below the complete-shell treatment. */
export const MAX_BACKLINE_FOUNDATION_DEFENSE_BONUS = 18;
export const BACKLINE_FOUNDATION_DRTG_BLEND = 0.35;
/** Only a small part of a partial core carries into the real-units DRTG projection. */
export const THREE_LAYER_CORE_DRTG_BLEND = 0.15;
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
  const drtgCompleteness = Math.max(
    completeness,
    threeLayerCore * THREE_LAYER_CORE_DRTG_BLEND,
    backlineFoundation * BACKLINE_FOUNDATION_DRTG_BLEND,
  );

  return {
    eliteShell: Math.round(completeness * 100),
    completeness,
    threeLayerCore,
    drtgCompleteness,
    backlineFoundation,
    defenseScoreBonus: Math.max(eliteShellBonus, threeLayerCoreBonus, backlineFoundationBonus),
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
