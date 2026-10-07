import type { PlayerSpan, Position } from '../data/schema';
import { RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../data/schema';
import defenseData from '../data/spanDefense.json';
import { computeDefensiveTalent } from './defensiveTalent';
import { computeOffensiveTalent } from './talent';
import { positionFitMultiplier, STARTER_SLOTS } from './positions';
import { modernBox } from './modernBox';
import { estimatedMinutesPerGame } from './minutesPerGame';
import { buildSelfCreationYearMap, measuredSelfCreationForSpan } from './selfCreationLookup';
import { rimPressureForFit } from './rimPressure';

/**
 * 2026-10-07, stage 2b step 3 (the user: "obrona jako mechanika", budget 60/28/8/4 from the NBA's
 * four factors): what each defender brings to the live game, and who guards whom.
 *
 * Every number here is a z-score against `REFERENCE` — the rotation players of the bench leagues
 * (`scripts/measureDefenseReference.ts`) — so an average defense changes nothing and the league's
 * scoring stays where it was; a good one takes points away through the shots it contests, the
 * turnovers it forces, the rebounds it keeps and the fouls it does not give.
 */

const DEFENSE = defenseData as unknown as Record<string, [number, number]>;

/** Means and spreads of the inputs over the bench leagues' rotation players (minutes-weighted). */
export const REFERENCE = {
  dtal: { mean: 73.3, sd: 17.5 },
  blk36: { mean: 1.16, sd: 1.04 },
  stl36: { mean: 1.51, sd: 0.54 },
  dreb36: { mean: 5.9, sd: 2.47 },
  oreb36: { mean: 1.79, sd: 1.14 },
  /** The rotation's minutes-weighted foul index: stars foul less per minute than their leagues
   * did, so the average floor reads 0.85, not 1. */
  foulIndex: 0.847,
};

export interface DefenderProfile {
  span: PlayerSpan;
  /** D-TAL as a z-score. */
  dtal: number;
  /** Rim protection, z-score scale (blocks + D-TAL, bigs and rim-protector roles only in full). */
  rim: number;
  /** Ball pressure and closeouts, z-score scale (steals + D-TAL, perimeter roles in full). */
  perimeter: number;
  stl: number;
  /** Rebounds per 36 at each end. */
  dreb36: number;
  oreb36: number;
  /** Personal fouls against his era, over the bench leagues' rotation average (1 = average). */
  foulIndex: number;
}

const z = (v: number, r: { mean: number; sd: number }) => (v - r.mean) / r.sd;
const isBig = (p: Position) => p === 'C' || p === 'PF';
const profileCache = new WeakMap<PlayerSpan, DefenderProfile>();

export function defenderProfile(span: PlayerSpan): DefenderProfile {
  let p = profileCache.get(span);
  if (!p) {
    const m = modernBox(span);
    const per36 = 36 / (estimatedMinutesPerGame(span) ?? 32);
    const [foul, orebShare] = DEFENSE[span.id] ?? [1000, 240];
    const dtal = z(computeDefensiveTalent(span), REFERENCE.dtal);
    const blk = z(m.bpg * per36, REFERENCE.blk36);
    const stl = z(m.spg * per36, REFERENCE.stl36);
    const rimRole = RIM_PROTECTOR_ROLES.includes(span.defensiveRole) || isBig(span.primaryPosition);
    const perimRole = PERIMETER_DEFENDER_ROLES.includes(span.defensiveRole) || !isBig(span.primaryPosition);
    const reb36 = m.rpg * per36;
    p = {
      span,
      dtal,
      rim: (0.55 * blk + 0.45 * dtal) * (rimRole ? 1 : 0.35),
      perimeter: (0.4 * stl + 0.6 * dtal) * (perimRole ? 1 : 0.6),
      stl,
      dreb36: reb36 * (1 - orebShare / 1000),
      oreb36: reb36 * (orebShare / 1000),
      foulIndex: foul / 1000 / REFERENCE.foulIndex,
    };
    profileCache.set(span, p);
  }
  return p;
}

/** How well `defender` can stay in front of a player at `slot`: 1 at his own positions, falling
 * off where he cannot play; a switch big or a stopper guards one position further. */
function guardFit(defender: PlayerSpan, slot: Position): number {
  const fit = positionFitMultiplier(defender, slot);
  const versatile = defender.defensiveRole === 'Switch Big' || defender.defensiveRole === 'Wing Stopper' || defender.defensiveRole === 'Point of Attack';
  return Math.max(fit, versatile ? 0.6 : 0.25);
}

const PERMUTATIONS: number[][] = (() => {
  const out: number[][] = [];
  const go = (rest: number[], acc: number[]) => {
    if (rest.length === 0) out.push(acc);
    for (let i = 0; i < rest.length; i++) go([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
  };
  go([0, 1, 2, 3, 4], []);
  return out;
})();

/**
 * Who guards whom, as a coach would set it (the user: Pippen takes the strong point guard, wherever
 * he plays): every one of the 120 ways to match five defenders to five attackers, the one that puts
 * the most defensive quality on the most dangerous attackers. Danger is a player's share of the ball
 * times his O-TAL; quality his D-TAL on that player's position.
 * Returns, for each attacker (by index), the index of his defender.
 */
export function assignMatchups(attackers: PlayerSpan[], usage: number[], defenders: PlayerSpan[]): number[] {
  // 2026-10-07, stage 2b step 7.5 (the user): the weakest defender hides on the man who can't make
  // anything of him — Bruce Bowen, Shane Battier: guarded close, but their shots come from others —
  // not on a non-shooter who beats him another way (Simmons off the dribble, Rodman on the glass).
  const danger = attackers.map((a, i) => usage[i] * computeOffensiveTalent(a) * (0.6 + 0.4 * exploitsMismatch(a, usage[i])));
  const quality = defenders.map((d) => attackers.map((a, i) => (50 + 10 * defenderProfile(d).dtal) * guardFit(d, STARTER_SLOTS[i] ?? a.primaryPosition)));
  let best = PERMUTATIONS[0];
  let bestScore = -Infinity;
  for (const perm of PERMUTATIONS) {
    if (perm.length !== attackers.length || defenders.length !== attackers.length) break;
    let score = 0;
    for (let i = 0; i < attackers.length; i++) score += danger[i] * quality[perm[i]][i];
    if (score > bestScore) {
      bestScore = score;
      best = perm;
    }
  }
  return attackers.map((_, i) => (defenders.length === attackers.length ? best[i] : Math.min(i, defenders.length - 1)));
}

const UNASSISTED_FG = buildSelfCreationYearMap('unassistedFg');
const exploitCache = new WeakMap<PlayerSpan, number>();
/** How well an attacker punishes a weak defender, 0-1: the best of making his own shot (share of
 * unassisted makes, play-by-play since 1996-97, else from his usage), attacking the rim, and
 * crashing the offensive glass. */
export function exploitsMismatch(span: PlayerSpan, usage: number): number {
  let e = exploitCache.get(span);
  if (e === undefined) {
    const own = measuredSelfCreationForSpan(span, UNASSISTED_FG) ?? Math.max(0, Math.min(1, 0.3 + 1.2 * (usage - 0.2)));
    e = Math.max(0, Math.min(1, Math.max((own - 0.15) / 0.45, rimPressureForFit(span) / 80, defenderProfile(span).oreb36 / 4)));
    exploitCache.set(span, e);
  }
  return e;
}

/** A five's defense at once. */
export interface FiveDefense {
  profiles: DefenderProfile[];
  /** Best rim protector on the floor plus a share of the second. */
  rim: number;
  /** Average perimeter pressure. */
  perimeter: number;
  /** Average steal z-score. */
  stl: number;
  dreb36: number;
  /** Index of the defender the offense hunts, and how far below the rest he is (z). */
  weakest: number;
  weakGap: number;
}

export function fiveDefense(defenders: PlayerSpan[]): FiveDefense {
  const profiles = defenders.map(defenderProfile);
  const rims = profiles.map((p) => p.rim).sort((a, b) => b - a);
  const dtals = profiles.map((p) => p.dtal);
  const weakest = dtals.indexOf(Math.min(...dtals));
  const others = dtals.filter((_, i) => i !== weakest);
  return {
    profiles,
    rim: (rims[0] ?? 0) + 0.35 * (rims[1] ?? 0),
    perimeter: profiles.reduce((s, p) => s + p.perimeter, 0) / profiles.length,
    stl: profiles.reduce((s, p) => s + p.stl, 0) / profiles.length,
    dreb36: profiles.reduce((s, p) => s + p.dreb36, 0),
    weakest,
    weakGap: Math.max(0, others.reduce((s, v) => s + v, 0) / Math.max(1, others.length) - dtals[weakest]),
  };
}
