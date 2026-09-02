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

/**
 * Exactly ONE genuine headliner per slot — the tempting "lazy pick" — drawn from the top of the
 * position by talent and weighted toward the most recognisable name. Every board stays winnable
 * (par = grab the five headliners) without the pool being a wall of all-time greats: the old
 * design forced ≥2 top-15-TAL players per slot AND weighted the whole draw toward All-Stars, so
 * Curry + Jordan + LeBron + Garnett + Robinson could all sit on one board. Now a slot is 1 star
 * + 8 starters/role-players, and picking all five stars is explicitly par, not a win.
 */
const HEADLINER_BUCKET = 12;
const HEADLINER_PER_SLOT = 1;
/** The other 8 come from the top of the position by talent (all legitimate NBA starters) but
 * weighted the OTHER way — toward players the casual fan has heard LESS of — so the puzzle is
 * about which role players fit, not which superstar to grab. */
const BODY_BUCKET = 42;
/** Hard cap: at most this many multi-time All-Stars (6+ selections) among the 8 body picks, so a
 * board is at most 1 headliner + 2 stars per slot no matter how the weighted draw lands — the
 * weights alone can't guarantee it because the top of a position is inherently decorated. */
const BODY_STAR_CAP = 2;
const BODY_STAR_AS = 6;

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
/** Inverse of `recognisability`, floored so a lesser name is favoured over a 15× All-Star but not
 * by an absurd margin (0 AS → 3.5, 2 AS → 2.5, 5 AS → 1.0, 7+ AS → floor 0.4). */
const obscurity = (s: PlayerSpan) => Math.max(0.4, 3.5 - allStarCount(s.playerName) * 0.5);

export function dailyPool(key: string = dayKey()): DailyPool {
  const rng = mulberry32(seedFromKey(key));
  const best = bestSpanByPlayer();

  const buckets: Record<Position, PlayerSpan[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };
  for (const span of best.values()) buckets[span.primaryPosition].push(span);

  const bySlot = {} as Record<Position, PlayerSpan[]>;
  for (const slot of STARTER_SLOTS) {
    const ranked = buckets[slot].slice().sort((a, b) => effectiveTalent(b) - effectiveTalent(a));

    const chosen: PlayerSpan[] = [];
    const taken = new Set<string>();
    // 1 headliner: a recognisable star from the very top of the position.
    for (const s of weightedShuffle(ranked.slice(0, HEADLINER_BUCKET), rng, recognisability)) {
      if (chosen.length >= HEADLINER_PER_SLOT) break;
      chosen.push(s);
      taken.add(s.playerName);
    }
    // 8 body: legitimate starters from the top of the position, weighted toward LESS-decorated
    // names, with a hard cap on multi-time All-Stars so the board isn't a lineup of all-time greats.
    const body = ranked.slice(0, BODY_BUCKET).filter((s) => !taken.has(s.playerName));
    let bodyStars = 0;
    for (const s of weightedShuffle(body, rng, obscurity)) {
      if (chosen.length >= POOL_PER_SLOT) break;
      const isStar = allStarCount(s.playerName) >= BODY_STAR_AS;
      if (isStar && bodyStars >= BODY_STAR_CAP) continue;
      if (isStar) bodyStars++;
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

/** Graded against `par` (the lazy TAL-max pick) and `optimal` (the engine's best). Eagle needs
 * BOTH — match the engine AND clearly beat the lazy pick — so on a "chalk" board where the five
 * biggest names really are near-optimal, grabbing them is par, never eagle. Birdie is a clear
 * beat of the lazy pick. */
export function gradeVsPar(score: number, par: number, optimal: number): GolfGrade {
  if (score >= optimal - 1 && score >= par + 3) return 'eagle';
  if (score >= par + 3) return 'birdie';
  if (score >= par - 1) return 'par';
  if (score >= par - 5) return 'bogey';
  return 'double-bogey';
}

/** A board where the five biggest names are within a couple of points of the engine's best —
 * there's little room to out-think it, so par is the ceiling for most players. */
export function isChalkBoard(targets: DailyTargets): boolean {
  return targets.optimal - targets.par < 3;
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

// ---------------------------------------------------------------------------
// explaining the result
// ---------------------------------------------------------------------------

export type WeightedAxis = 'talent' | 'offense' | 'defense' | 'fit';

/** The four axes that actually make up the composite, and their weight (renormalised, matches
 * `W` above). `spacing` is shown alongside but is diagnostic — it feeds Offense and Fit, it is
 * not a fifth weighted term. */
export const WEIGHTED_AXES: { key: WeightedAxis; label: string; pct: number }[] = [
  { key: 'talent', label: 'Talent', pct: Math.round((W.talent / WSUM) * 100) },
  { key: 'offense', label: 'Offense', pct: Math.round((W.offense / WSUM) * 100) },
  { key: 'defense', label: 'Defense', pct: Math.round((W.defense / WSUM) * 100) },
  { key: 'fit', label: 'Fit', pct: Math.round((W.fit / WSUM) * 100) },
];

export const AXIS_GLOSSARY: { label: string; text: string }[] = [
  { label: 'Talent', text: 'Raw individual quality of the five — the mean of their TAL ratings.' },
  { label: 'Offense', text: 'How much the unit scores: shot-making, shot creation, efficiency.' },
  { label: 'Defense', text: 'How much the unit stops: rim protection, on-ball defense, activity.' },
  { label: 'Spacing', text: 'Floor spacing from three-point shooting and gravity. Diagnostic — it feeds Offense and Fit, not the score directly.' },
  { label: 'Fit', text: 'How the pieces complement each other: position balance, shot-creation overlap, defensive coverage, spacing gaps. Five stars who all need the ball fit badly.' },
];

const WEAK_AXIS_REASON: Record<WeightedAxis, (s: LineupScore) => string> = {
  talent: () => 'The five just don’t have the raw individual quality — better players were on the board.',
  offense: (s) =>
    s.spacing < 70
      ? 'Not enough scoring punch, and thin floor spacing (Spacing ' + Math.round(s.spacing) + ') lets defenders help off.'
      : 'Not enough shot creation or efficiency across the unit.',
  defense: (s) =>
    s.weakLink
      ? 'Thin on the defensive end — ' + s.weakLink + ' especially can be hunted.'
      : 'Short on rim protection and point-of-attack defense.',
  fit: (s) =>
    s.notes[0]
      ? 'The pieces don’t complement each other: ' + s.notes[0].charAt(0).toLowerCase() + s.notes[0].slice(1)
      : 'The pieces don’t complement each other — overlapping roles, or no floor spacing, drags the five even when the names are big.',
};

export interface ResultExplanation {
  /** Lowest of the four weighted axes for the player's five, with a plain-English reason. */
  weakest: { axis: WeightedAxis; label: string; value: number; reason: string };
  /** Where the engine's own best five beats the player's, biggest gap first (empty ⇒ you matched
   * or beat it on every axis). */
  engineEdge: { axis: WeightedAxis; label: string; delta: number }[];
  /** Slots where the engine's pick differs from the player's. */
  swaps: { slot: Position; yours: string; engine: string }[];
  /** The player took the lazy "five biggest names" lineup. */
  tookLazyPick: boolean;
}

export function explainResult(lineup: Lineup, pool: DailyPool, targets: DailyTargets): ResultExplanation {
  const score = scoreLineup(lineup);
  const optScore = scoreLineup(targets.optimalFive);
  const lazy = talMaxLineup(pool);

  const weakestKey = [...WEIGHTED_AXES].sort((a, b) => score[a.key] - score[b.key])[0];
  const engineEdge = WEIGHTED_AXES.map((a) => ({
    axis: a.key,
    label: a.label,
    delta: Math.round(optScore[a.key] - score[a.key]),
  }))
    .filter((e) => e.delta >= 2)
    .sort((a, b) => b.delta - a.delta);

  const swaps = STARTER_SLOTS.flatMap((slot) => {
    const yours = lineup[slot];
    const engine = targets.optimalFive[slot];
    return yours && engine && yours.id !== engine.id
      ? [{ slot, yours: yours.playerName, engine: engine.playerName }]
      : [];
  });

  const tookLazyPick = STARTER_SLOTS.every((slot) => lineup[slot]?.id === lazy[slot].id);

  return {
    weakest: {
      axis: weakestKey.key,
      label: weakestKey.label,
      value: Math.round(score[weakestKey.key]),
      reason: WEAK_AXIS_REASON[weakestKey.key](score),
    },
    engineEdge,
    swaps,
    tookLazyPick,
  };
}
