import type { PlayerSpan, Position } from '../data/schema';
import type { Team, Rotation, SlotAssignment } from './types';
import { draftPool } from '../data/draftPool';
import { effectiveTalent } from './grades';
import { allStarCount } from './allStarLookup';
import { talentScore, offenseScore, defenseScore, spacingScore } from './scoring';
import { fitScore } from './fit';
import { STARTER_SLOTS, positionFitMultiplier } from './positions';

/**
 * "Build the Best 5" — the engine side of the entry-level daily puzzle (see `components/
 * BestFive.tsx`). A deterministic daily pool of ~45 players (9 per position), a way to score a
 * 5-man starting lineup on the engine's own axes, a hill-climb solver for the day's optimal
 * lineup, and golf-style par bands.
 *
 * Deliberately self-contained and depends only on the STABLE public API of `scoring.ts` /
 * `fit.ts` (the exported `talentScore` / `offenseScore` / `defenseScore` / `spacingScore` /
 * `fitScore` functions), never their internal weight constants or line-level details — those
 * files are under active parallel edit and have a documented history of being clobbered. The
 * composite weights below are pinned HERE so churn in `scoreTeam`'s own blend never moves the
 * puzzle's par.
 */

// ---------------------------------------------------------------------------
// seeded RNG + day key (the repo has no seedable PRNG — `teamNames.ts`'s Fisher-Yates uses
// Math.random directly; a daily puzzle needs the same pool for everyone on a given date)
// ---------------------------------------------------------------------------

/** mulberry32 — tiny, fast, good-enough uint32-seeded PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `YYYY-MM-DD` in UTC — the puzzle rotates at UTC midnight so every player worldwide gets the
 * same board on the same calendar date. */
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function seedFromKey(key: string): number {
  // FNV-1a
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// best span per player (the puzzle uses each player's peak season)
// ---------------------------------------------------------------------------

let bestSpanCache: Map<string, PlayerSpan> | null = null;
function bestSpanByPlayer(): Map<string, PlayerSpan> {
  if (bestSpanCache) return bestSpanCache;
  const m = new Map<string, PlayerSpan>();
  for (const s of draftPool) {
    const cur = m.get(s.playerName);
    if (!cur || effectiveTalent(s) > effectiveTalent(cur)) m.set(s.playerName, s);
  }
  bestSpanCache = m;
  return m;
}

// ---------------------------------------------------------------------------
// daily pool
// ---------------------------------------------------------------------------

export const POOL_PER_SLOT = 9;
/** Guarantee at least this many genuine top-tier options per slot so every board is winnable. */
const ELITE_GUARANTEE = 2;
const ELITE_BUCKET = 15;

export interface DailyPool {
  key: string;
  bySlot: Record<Position, PlayerSpan[]>;
}

/** Weighted random order, no replacement (Efraimidis–Spirakis): key each item `rng^(1/weight)`,
 * sort desc. Higher weight ⇒ likelier to sort early. */
function weightedShuffle<T>(items: T[], rng: () => number, weight: (t: T) => number): T[] {
  return items
    .map((t) => ({ t, k: Math.pow(rng(), 1 / Math.max(weight(t), 1e-6)) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.t);
}

const recognisability = (s: PlayerSpan) => allStarCount(s.playerName) + 1;

export function dailyPool(key: string = dayKey()): DailyPool {
  const rng = mulberry32(seedFromKey(key));
  const best = bestSpanByPlayer();

  const buckets: Record<Position, PlayerSpan[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };
  for (const span of best.values()) buckets[span.primaryPosition].push(span);

  const bySlot = {} as Record<Position, PlayerSpan[]>;
  for (const slot of STARTER_SLOTS) {
    const ranked = buckets[slot].slice().sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
    const elite = ranked.slice(0, ELITE_BUCKET);

    const chosen: PlayerSpan[] = [];
    const taken = new Set<string>();
    for (const s of weightedShuffle(elite, rng, recognisability)) {
      if (chosen.length >= ELITE_GUARANTEE) break;
      chosen.push(s);
      taken.add(s.playerName);
    }
    for (const s of weightedShuffle(ranked.filter((s) => !taken.has(s.playerName)), rng, recognisability)) {
      if (chosen.length >= POOL_PER_SLOT) break;
      chosen.push(s);
    }
    // Blind: display order is neutral (alphabetical), never by talent.
    bySlot[slot] = chosen.sort((a, b) => a.playerName.localeCompare(b.playerName));
  }

  return { key, bySlot };
}

// ---------------------------------------------------------------------------
// scoring a 5-man lineup
// ---------------------------------------------------------------------------

/** Pinned here — see the file docstring. Renormalised from `scoreTeam`'s own blend with the
 * bench-depth and rotation axes (both meaningless for a bare starting five) dropped. */
const W = { talent: 0.37, offense: 0.21, defense: 0.21, fit: 0.21 };
const WSUM = W.talent + W.offense + W.defense + W.fit;

export type Lineup = Partial<Record<Position, PlayerSpan>>;

export interface LineupScore {
  composite: number;
  talent: number;
  offense: number;
  defense: number;
  spacing: number;
  fit: number;
  /** Lowest-graded defender the engine flags as a real, huntable weak link (null if none). */
  weakLink: string | null;
  notes: string[];
  complete: boolean;
}

/** A synthetic `Team` with a MANUAL 48-min-per-slot rotation. `autoAssignRotation` is
 * deliberately avoided: on a bare 5-man roster it leaves sub-Starter-tier slots empty and
 * overworks the rest, which zeroes `fitScore` and spams false overwork notes. */
function lineupTeam(lineup: Lineup): Team {
  const slots = {} as Rotation['slots'];
  for (const slot of STARTER_SLOTS) {
    const s = lineup[slot];
    slots[slot] = s ? [{ playerId: s.id, minutes: 48 } satisfies SlotAssignment] : [];
  }
  const roster = STARTER_SLOTS.map((sl) => lineup[sl]).filter((s): s is PlayerSpan => Boolean(s));
  return { id: 'best-five', name: 'Best 5', draftSlot: 1, isHuman: false, roster, rotation: { slots } };
}

export function scoreLineup(lineup: Lineup): LineupScore {
  const complete = STARTER_SLOTS.every((sl) => lineup[sl]);
  const team = lineupTeam(lineup);
  const talent = talentScore(team);
  const offense = offenseScore(team);
  const defense = defenseScore(team);
  const spacing = spacingScore(team);
  const fr = fitScore(team);
  const composite = Math.round((talent * W.talent + offense * W.offense + defense * W.defense + fr.score * W.fit) / WSUM);
  return {
    composite,
    talent,
    offense,
    defense,
    spacing,
    fit: fr.score,
    weakLink: fr.inputs.defensiveWeakLinkIsHuntable ? fr.inputs.defensiveWeakLinkPlayer : null,
    notes: fr.notes,
    complete,
  };
}

/** True only when every slot holds a player whose primary or explicit secondary position is
 * that slot (`positionFitMultiplier >= 0.9`). The picker UI enforces this, so it should always
 * hold on a real submit — kept as a guard. */
export function lineupEligible(lineup: Lineup): boolean {
  return STARTER_SLOTS.every((sl) => {
    const s = lineup[sl];
    return Boolean(s) && positionFitMultiplier(s as PlayerSpan, sl) >= 0.9;
  });
}

// ---------------------------------------------------------------------------
// the day's optimal lineup (hill climb — the pool is tiny, this is sub-second)
// ---------------------------------------------------------------------------

export interface SolvedLineup {
  five: Record<Position, PlayerSpan>;
  score: LineupScore;
}

/** The lazy strategy: highest-`effectiveTalent` player at every slot. This is the baseline the
 * puzzle asks you to beat — see `parFor`. */
export function talMaxLineup(pool: DailyPool): Record<Position, PlayerSpan> {
  return Object.fromEntries(
    STARTER_SLOTS.map((slot) => [
      slot,
      pool.bySlot[slot].slice().sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0],
    ]),
  ) as Record<Position, PlayerSpan>;
}

export function solveDailyOptimal(pool: DailyPool): SolvedLineup {
  const cache = new Map<string, LineupScore>();
  const sc = (five: Record<Position, PlayerSpan>): LineupScore => {
    const key = STARTER_SLOTS.map((s) => five[s].id).join('|');
    let r = cache.get(key);
    if (!r) {
      r = scoreLineup(five);
      cache.set(key, r);
    }
    return r;
  };

  const rng = mulberry32(seedFromKey(`${pool.key}:solve`));

  const starts: Record<Position, PlayerSpan>[] = [talMaxLineup(pool)];
  for (let r = 0; r < 4; r++) {
    starts.push(
      Object.fromEntries(
        STARTER_SLOTS.map((s) => {
          const p = pool.bySlot[s];
          return [s, p[Math.floor(rng() * p.length)]];
        }),
      ) as Record<Position, PlayerSpan>,
    );
  }

  let bestFive: Record<Position, PlayerSpan> | null = null;
  let bestComposite = -1;
  for (const start of starts) {
    let five = { ...start };
    let cur = sc(five).composite;
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 8) {
      improved = false;
      for (const slot of STARTER_SLOTS) {
        for (const cand of pool.bySlot[slot]) {
          if (cand.id === five[slot].id) continue;
          const trial = { ...five, [slot]: cand };
          const s = sc(trial).composite;
          if (s > cur + 1e-6) {
            five = trial;
            cur = s;
            improved = true;
          }
        }
      }
    }
    if (cur > bestComposite) {
      bestComposite = cur;
      bestFive = five;
    }
  }

  return { five: bestFive as Record<Position, PlayerSpan>, score: sc(bestFive as Record<Position, PlayerSpan>) };
}

// ---------------------------------------------------------------------------
// golf par — "can you beat just taking the five biggest names?"
// ---------------------------------------------------------------------------

export interface DailyTargets {
  /** Composite of the lazy "highest talent at every slot" lineup — this is par. */
  par: number;
  /** Composite of the engine's own best lineup from today's pool. Match it for an eagle. */
  optimal: number;
  optimalFive: Record<Position, PlayerSpan>;
}

export function dailyTargets(pool: DailyPool): DailyTargets {
  const solved = solveDailyOptimal(pool);
  return {
    par: scoreLineup(talMaxLineup(pool)).composite,
    optimal: solved.score.composite,
    optimalFive: solved.five,
  };
}

export type GolfGrade = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double-bogey';

/** Graded against `par` (the lazy TAL-max pick) and `optimal` (the engine's best). Matching or
 * beating the engine ⇒ eagle; clearly beating the lazy pick ⇒ birdie; landing on it ⇒ par. */
export function gradeVsPar(score: number, par: number, optimal: number): GolfGrade {
  if (score >= optimal - 1) return 'eagle';
  if (score >= par + 2) return 'birdie';
  if (score >= par - 1) return 'par';
  if (score >= par - 5) return 'bogey';
  return 'double-bogey';
}

export const GRADE_LABEL: Record<GolfGrade, string> = {
  eagle: 'Eagle',
  birdie: 'Birdie',
  par: 'Par',
  bogey: 'Bogey',
  'double-bogey': 'Double bogey',
};

export const GRADE_BLURB: Record<GolfGrade, string> = {
  eagle: 'You matched the engine’s own best lineup from today’s pool.',
  birdie: 'You beat the lazy pick — five biggest names isn’t the answer.',
  par: 'You landed on what just grabbing the five biggest names gets you.',
  bogey: 'A notch below the safe pick — something in the five isn’t fitting.',
  'double-bogey': 'The pieces don’t fit — check spacing and rim protection.',
};
