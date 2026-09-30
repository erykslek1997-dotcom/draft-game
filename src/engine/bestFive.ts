import type { PlayerSpan, Position } from '../data/schema';
import type { Team, Rotation, SlotAssignment } from './types';
import { draftPool } from '../data/draftPool';
import { effectiveTalent } from './grades';
import { allStarCount } from './allStarLookup';
import { talentScore, offenseScore, defenseScore, spacingScore } from './scoring';
import { fitScore } from './fit';
import { STARTER_SLOTS, positionFitMultiplier } from './positions';
import { mulberry32, hashSeed } from './rng';
import { DAILY_HAND_SIZE, JOKERS_MAX, JOKERS_MIN } from './dailyMeta';
import { computeOffensiveTalent } from './talent';
import { computeDefensiveTalent } from './defensiveTalent';
import { computeSpacing } from './spacing';
import { computeFinishing } from './finishing';

// Re-exported for API stability — `mulberry32` used to be defined and exported here.
export { mulberry32 } from './rng';

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
// day key (the seeded RNG itself now lives in `./rng`; a daily puzzle needs the same pool for
// everyone on a given date)
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` in UTC — the puzzle rotates at UTC midnight so every player worldwide gets the
 * same board on the same calendar date. */
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

const seedFromKey = hashSeed;

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

/** 2026-09-26, the user: "ograniczmy wybór do 5 graczy" — one headliner plus four, dealt one
 * position at a time (BestFive.tsx reveals each slot's five after the previous pick).
 * 2026-09-27, the user: "można zrobić 4 sloty, obok dźwignia" — four per position, one headliner
 * plus three, so a position's deal fits one row of reels beside the lever. */
export const POOL_PER_SLOT = 8;
/** 2026-09-28, the user ("powinna zawsze być jakaś opcja, generować więcej kart i być reaktywne do
 * tego co brakuje"; chose a fixed pool with a reactive deal): each position has POOL_PER_SLOT
 * cards and the machine shows DEAL_SIZE of them, picked for the five being built (`dealFor`). The
 * pool is the same for everyone on a seed, so challenges stay comparable. */
export const DEAL_SIZE = 4;

/**
 * Exactly ONE genuine headliner per slot — the tempting "lazy pick" — drawn from the top of the
 * position by talent and weighted toward the most recognisable name. Every board stays winnable
 * (par = grab the five headliners) without the pool being a wall of all-time greats: the old
 * design forced ≥2 top-15-TAL players per slot AND weighted the whole draw toward All-Stars, so
 * Curry + Jordan + LeBron + Garnett + Robinson could all sit on one board. Now a slot is 1 star
 * + 4 starters/role-players, and picking all five stars is explicitly par, not a win.
 */
const HEADLINER_BUCKET = 20;
/** Fallback draw for a role that found no one: legitimate starters weighted toward lesser names. */
const BODY_BUCKET = 42;
/** Board-wide budget for genuine all-time greats (8+ All-Stars — roughly "a casual fan names this
 * an all-time great"): at most 2 per board, so a legend is a rare treat and most slots are a
 * choice between good starters. This is what keeps five mega-headliners off one board. Slot order for spending the budget is seed-shuffled so
 * it isn't always PG/SG that get the greats. */
const GREAT_AS = 8;
const GREATS_PER_BOARD = 2;

/**
 * 2026-09-27, the user ("generowanie graczy... żeby gracz miał więcej przemyśleń czy warto iść w
 * tego gracza"; chose four hidden roles, a computed cap and a face-up teaser): each position deals
 * one card of each role, so every pick is a different kind of bet. The role is never shown.
 * - `star`: the headliner — top of the position, recognisable, expensive.
 * - `value`: cheap and solid; saves caps for later positions.
 * - `specialist`: elite at one thing (defense, shooting, finishing) and weak at another, so he is
 *   worth it only if the rest of the five covers the weakness.
 * - `surprise`: either an under-the-radar player rated higher than his name suggests, or a famous
 *   name in one of his lesser stretches, priced like the name.
 */
export type DealRole = 'star' | 'value' | 'specialist' | 'surprise' | 'joker';

export interface DailyPool {
  key: string;
  bySlot: Record<Position, PlayerSpan[]>;
  /** Hidden role of every dealt card, by span id. */
  roles: Record<string, DealRole>;
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

/** The legitimate-starter bucket each role draws from, by the position's own talent order. */
const ROLE_BUCKET = 90;
/** A value card costs at most this share of the bucket's shot costs (30th percentile). */
const VALUE_FGA_QUANTILE = 0.4;
/** Specialist: at or above this position-relative percentile on one axis, at or below the weak
 * line on another. */
const SPECIALIST_HIGH = 0.8;
const SPECIALIST_LOW = 0.4;
/** Surprise, under-the-radar kind: at most this many All-Star picks, inside this talent rank. */
const SLEEPER_MAX_AS = 1;
const SLEEPER_MAX_RANK = 50;
/** Surprise, famous-name kind: a player with this many All-Star picks, in a stretch at least this
 * many TAL below his best one. */
const NAME_TRAP_MIN_AS = 6;
const NAME_TRAP_MIN_DROP = 8;
/** A star or sleeper can be dealt in any of his stretches this close to his best. */
const SPAN_VARIETY_TAL = 4;
/** A bargain: at or above this share of the position on talent per shot AND on talent. */
const BARGAIN_PER_SHOT_Q = 0.8;
const BARGAIN_TAL_Q = 0.6;
/** A bargain's chance in any draw, relative to everyone else's. */
const BARGAIN_WEIGHT = 0.3;

let spansByPlayerCache: Map<string, PlayerSpan[]> | null = null;
function spansByPlayer(): Map<string, PlayerSpan[]> {
  if (spansByPlayerCache) return spansByPlayerCache;
  const m = new Map<string, PlayerSpan[]>();
  for (const s of draftPool) m.set(s.playerName, [...(m.get(s.playerName) ?? []), s]);
  spansByPlayerCache = m;
  return m;
}

function percentileWithin(values: number[]): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  return (v) => {
    let lo = 0;
    while (lo < sorted.length && sorted[lo] <= v) lo++;
    return sorted.length ? lo / sorted.length : 0.5;
  };
}

export function dailyPool(key: string = dayKey()): DailyPool {
  const rng = mulberry32(seedFromKey(key));
  const best = bestSpanByPlayer();

  const buckets: Record<Position, PlayerSpan[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };
  for (const span of best.values()) buckets[span.primaryPosition].push(span);

  const isGreat = (s: PlayerSpan) => allStarCount(s.playerName) >= GREAT_AS;
  let boardGreats = 0;
  const roles: Record<string, DealRole> = {};

  const bySlot = {} as Record<Position, PlayerSpan[]>;
  // Spend the board-wide greats budget in a seed-shuffled slot order, but render PG..C.
  for (const slot of weightedShuffle(STARTER_SLOTS.slice(), rng, () => 1)) {
    const ranked = buckets[slot].slice().sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
    const bucket = ranked.slice(0, ROLE_BUCKET);
    const chosen: PlayerSpan[] = [];
    const taken = new Set<string>();
    const allowed = (s: PlayerSpan) => !taken.has(s.playerName) && !(isGreat(s) && boardGreats >= GREATS_PER_BOARD);
    const take = (s: PlayerSpan | undefined, role: DealRole) => {
      if (!s) return false;
      if (isGreat(s)) boardGreats++;
      chosen.push(s);
      taken.add(s.playerName);
      roles[s.id] = role;
      return true;
    };

    /**
     * 2026-09-28, user-reported ("gracze są dość podobni cały czas"): over 60 boards only 217
     * players ever came up and Bo Outlaw was on 39 of them — every role drew with a steep weight
     * (value by talent-per-shot cubed, specialist by how lopsided he is, star from the top 12), so
     * the same few won every time. Roles now draw evenly from a wider field: the star from the top
     * HEADLINER_BUCKET with a gentle nod to fame, value from the better two thirds of the cheap cards,
     * the specialist from everyone lopsided enough; and a star or sleeper can come in any of his
     * stretches within SPAN_VARIETY_TAL of his best, not always the same one.
     */
    /**
     * 2026-09-28, the user ("gracze będą często wybierać drogie opcje, przez co gra naturalnie
     * będzie rzucać Draymonda czy low fga centra np. Goberta. Te opcje powinny być gorsze … nie
     * chodzi żeby przestały trafiać, po prostu rzadziej"): a bargain — elite talent per shot AND
     * genuinely good — makes spending big on a star nearly free. Bargains still come up, at
     * BARGAIN_WEIGHT of everyone else's chance in every draw.
     */
    const perShotOf = (s: PlayerSpan) => effectiveTalent(s) / Math.max(4, s.fga);
    const perShotSorted = bucket.map(perShotOf).sort((a, b) => a - b);
    const talSorted = bucket.map(effectiveTalent).sort((a, b) => a - b);
    const bargainPerShot = perShotSorted[Math.floor(perShotSorted.length * BARGAIN_PER_SHOT_Q)] ?? Infinity;
    const bargainTal = talSorted[Math.floor(talSorted.length * BARGAIN_TAL_Q)] ?? Infinity;
    const damp = (s: PlayerSpan) => (perShotOf(s) >= bargainPerShot && effectiveTalent(s) >= bargainTal ? BARGAIN_WEIGHT : 1);

    const anySpan = (s: PlayerSpan | undefined) => {
      if (!s) return s;
      const top = effectiveTalent(s);
      const options = (spansByPlayer().get(s.playerName) ?? [s]).filter((o) => o.primaryPosition === slot && top - effectiveTalent(o) <= SPAN_VARIETY_TAL);
      return options[Math.floor(rng() * options.length)] ?? s;
    };

    // Star.
    take(anySpan(weightedShuffle(ranked.slice(0, HEADLINER_BUCKET), rng, (s) => Math.sqrt(recognisability(s)) * damp(s)).find(allowed)), 'star');

    // Value: evenly among the better two thirds (by talent per shot) of the cheaper 40% of the bucket.
    const fgaCut = [...bucket.map((s) => s.fga)].sort((a, b) => a - b)[Math.floor(bucket.length * VALUE_FGA_QUANTILE)] ?? Infinity;
    const perShot = (s: PlayerSpan) => effectiveTalent(s) / Math.max(4, s.fga);
    const cheap = bucket.filter((s) => s.fga <= fgaCut);
    const valueCut = cheap.map(perShot).sort((a, b) => a - b)[Math.floor(cheap.length / 3)] ?? 0;
    const valueCards = () => weightedShuffle(cheap.filter((s) => allowed(s) && perShot(s) >= valueCut), rng, damp).at(0);
    take(valueCards(), 'value');

    // Specialist: elite on one axis, weak on another, measured against the bucket.
    const axes = [computeDefensiveTalent, computeSpacing, computeFinishing, computeOffensiveTalent];
    const pct = axes.map((f) => percentileWithin(bucket.map(f)));
    const specialistScore = (s: PlayerSpan) => {
      const p = axes.map((f, i) => pct[i](f(s)));
      const high = Math.max(p[0], p[1], p[2]);
      const low = Math.min(...p.filter((_, i) => i !== p.indexOf(high)));
      return high >= SPECIALIST_HIGH && low <= SPECIALIST_LOW ? high - low : 0;
    };
    take(weightedShuffle(bucket.filter((s) => allowed(s) && specialistScore(s) > 0), rng, damp).at(0), 'specialist');

    // Surprise: a sleeper or a famous name in a lesser stretch, one or the other by coin flip.
    const sleeper = () =>
      anySpan(weightedShuffle(ranked.slice(0, SLEEPER_MAX_RANK).filter((s) => allowed(s) && allStarCount(s.playerName) <= SLEEPER_MAX_AS), rng, damp).at(0));
    const nameTrap = () => {
      const candidates: PlayerSpan[] = [];
      for (const top of ranked.slice(0, ROLE_BUCKET)) {
        if (!allowed(top) || allStarCount(top.playerName) < NAME_TRAP_MIN_AS) continue;
        const bestTal = effectiveTalent(top);
        for (const other of spansByPlayer().get(top.playerName) ?? []) {
          if (other.primaryPosition === slot && bestTal - effectiveTalent(other) >= NAME_TRAP_MIN_DROP && other.fga >= fgaCut) candidates.push(other);
        }
      }
      return weightedShuffle(candidates, rng, () => 1).at(0);
    };
    const coin = rng() < 0.5;
    take((coin ? nameTrap() : sleeper()) ?? (coin ? sleeper() : nameTrap()), 'surprise');

    // The larger pool (2026-09-28): a second value card and a second specialist, so a deal can
    // always offer something affordable and something that covers what the five is missing.
    take(valueCards(), 'value');
    take(weightedShuffle(bucket.filter((s) => allowed(s) && specialistScore(s) > 0), rng, damp).at(0), 'specialist');

    // Fill any role that found no one (thin positions) with the old obscure-starter draw, then,
    // as a last resort, straight from the ranked list — a slot must always deal POOL_PER_SLOT.
    for (const s of weightedShuffle(ranked.slice(0, BODY_BUCKET), rng, (x) => obscurity(x) * damp(x))) {
      if (chosen.length >= POOL_PER_SLOT) break;
      if (allowed(s)) take(s, 'value');
    }
    for (const s of ranked) {
      if (chosen.length >= POOL_PER_SLOT) break;
      if (!taken.has(s.playerName)) take(s, 'value');
    }
    // Blind: display order is neutral (alphabetical), never by talent or role.
    bySlot[slot] = chosen.slice(0, POOL_PER_SLOT).sort((a, b) => a.playerName.localeCompare(b.playerName));
  }

  return { key, bySlot, roles };
}

/** A position's star (used by tests). */
export function teaserFor(pool: DailyPool, slot: Position): PlayerSpan | undefined {
  return pool.bySlot[slot].find((s) => pool.roles[s.id] === 'star');
}

// ---------------------------------------------------------------------------
// shots-cost twist — 2026-09-11, user's own ask: "dodajemy koszt gracza w shots i oprócz
// codziennej puli graczy będzie losowa liczba między 60 a 90" (add each candidate's shot cost,
// plus a random number between 60-90 alongside the daily pool). Same deterministic-per-day
// pattern as `dailyPool`. Since 2026-09-27 the number is computed from the board instead of
// rolled (see `computedShotsCap`).
// ---------------------------------------------------------------------------

/** 2026-09-26: five players per slot instead of nine, so a rolled cap could fall below the
 * cheapest possible five (5 boards in 120). The cap keeps `CAP_FLOOR_MARGIN` caps above that
 * cheapest five, so every board is solvable with room for at least one real choice. */
const CAP_FLOOR_MARGIN = 12;

/**
 * 2026-09-27 (the user's option B): the cap is computed from the board, no longer rolled. It
 * starts from the five value cards and adds `STAR_BUDGET_SHARE` of what it would cost to swap
 * all five for the stars, so roughly two of the five stars fit and every star is a real decision.
 * Never below the cheapest five plus `CAP_FLOOR_MARGIN`.
 */
const STAR_BUDGET_SHARE = 0.45;
/**
 * 2026-09-28, the user ("daily za dużo fga, mały challenge"; 2026-09-30: "nadal mniej capu"): the
 * daily board's cap is the cheapest possible five plus a fixed room, `DAILY_CAP_ROOM` — about one
 * star's upgrade. It used to be measured from the value cards, but on the live site's precomputed
 * ratings those are often nearly as pricey as the stars, so the cap barely moved.
 */
export const DAILY_CAP_ROOM = 15;
/** The daily board may try a cap this close to its cheapest five, never closer. */
const DAILY_CAP_FLOOR_MARGIN = 10;
export function computedShotsCap(pool: DailyPool, daily = false): number {
  const cardOf = (slot: Position, role: DealRole) => pool.bySlot[slot].find((s) => pool.roles[s.id] === role);
  const cheapestOf = (slot: Position) => Math.min(...pool.bySlot[slot].map((p) => p.fga));
  const cheapest = STARTER_SLOTS.reduce((sum, slot) => sum + cheapestOf(slot), 0);
  if (daily) return Math.ceil(cheapest + DAILY_CAP_ROOM);
  const valueFive = STARTER_SLOTS.reduce((sum, slot) => sum + (cardOf(slot, 'value')?.fga ?? cheapestOf(slot)), 0);
  const starFive = STARTER_SLOTS.reduce((sum, slot) => sum + (cardOf(slot, 'star')?.fga ?? cheapestOf(slot)), 0);
  const cap = Math.round(valueFive + STAR_BUDGET_SHARE * Math.max(0, starFive - valueFive));
  return Math.max(cap, Math.ceil(cheapest + CAP_FLOOR_MARGIN));
}

export function dailyShotsCap(key: string = dayKey()): number {
  return computedShotsCap(dailyPool(key));
}

export function lineupShots(lineup: Partial<Record<Position, PlayerSpan>>): number {
  return STARTER_SLOTS.reduce((sum, sl) => sum + (lineup[sl]?.fga ?? 0), 0);
}

/**
 * Repairs an over-cap five by repeatedly downgrading whichever slot loses the LEAST talent per
 * shot saved, until the total is legal (or no legal downgrade is left — every slot already at
 * its position's cheapest option in the pool). Used both for `talMaxLineup`'s "par" baseline
 * (the naive biggest-names pick, once a cap can make it illegal) and to repair a random hill-climb
 * starting point in `solveDailyOptimal` below — same "grab the big names, then trim the least
 * painful ones until legal" a real player would actually do once told they're over budget.
 */
function repairToCap(five: Record<Position, PlayerSpan>, pool: DailyPool, cap: number): Record<Position, PlayerSpan> {
  const result = { ...five };
  let guard = 0;
  while (lineupShots(result) > cap && guard++ < 50) {
    let bestSlot: Position | null = null;
    let bestReplacement: PlayerSpan | null = null;
    let bestRatio = Infinity; // talent lost per shot saved — lower is a less painful downgrade
    for (const slot of STARTER_SLOTS) {
      const current = result[slot];
      for (const cand of pool.bySlot[slot]) {
        const shotsSaved = current.fga - cand.fga;
        if (cand.id === current.id || shotsSaved <= 0) continue;
        const ratio = (effectiveTalent(current) - effectiveTalent(cand)) / shotsSaved;
        if (ratio < bestRatio) {
          bestRatio = ratio;
          bestSlot = slot;
          bestReplacement = cand;
        }
      }
    }
    if (!bestSlot || !bestReplacement) break; // no legal downgrade left in the pool
    result[bestSlot] = bestReplacement;
  }
  return result;
}

// ---------------------------------------------------------------------------
// scoring a 5-man lineup
// ---------------------------------------------------------------------------

/** Pinned here — see the file docstring. Derived from `scoreTeam`'s blend (talent .30 / bench .10
 * / offense .17 / defense .17 / fit .18 / rotation .08) by dropping the two axes meaningless for a
 * bare starting five (bench, rotation) and re-spreading: talent stays dominant (.37), and
 * offense/defense/fit are flattened to an equal .21 each rather than kept at their exact
 * renormalised ratio (fit's .18/.82 ≈ .22 vs offense/defense's .17/.82 ≈ .21). A deliberate pin,
 * not a mechanical renormalisation — `WSUM` below divides out the rounding so the composite still
 * lands on 0–100. */
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
export function lineupTeam(lineup: Lineup): Team {
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
 * puzzle asks you to beat — see `parFor`. `cap`, when given, repairs the naive pick down to a
 * legal one (see `repairToCap`) — the "five biggest names" IS the naive move even under a shots
 * cap, it just might need trimming first. */
/** 2026-09-28: the fan-vote five is the highest-TAL five among the cards every path is dealt
 * (`namesPool`), trimmed to the cap. It used to read the whole pool; with a reactive deal that
 * could be a card a player never saw. The board's winning card is left out, or the fan-vote five
 * would often simply be the best five. */
export function fanVoteFive(pool: DailyPool, cap?: number): Record<Position, PlayerSpan> {
  return talMaxLineup(namesPool(pool), cap);
}

/** The cards every path is dealt, other than the board's winning card: the star and the cheapest
 * card at each position — what "the biggest names" is picked from. */
function namesPool(pool: DailyPool): DailyPool {
  const bySlot = Object.fromEntries(
    STARTER_SLOTS.map((slot) => {
      const cards = pool.bySlot[slot];
      const core = new Set([cards.find((c) => pool.roles[c.id] === 'star'), [...cards].sort((a, b) => a.fga - b.fga)[0]]);
      return [slot, cards.filter((c) => core.has(c))];
    }),
  ) as Record<Position, PlayerSpan[]>;
  return { key: pool.key, bySlot, roles: pool.roles };
}

export function talMaxLineup(pool: DailyPool, cap?: number): Record<Position, PlayerSpan> {
  const naive = Object.fromEntries(
    STARTER_SLOTS.map((slot) => [
      slot,
      pool.bySlot[slot].slice().sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0],
    ]),
  ) as Record<Position, PlayerSpan>;
  return cap != null ? repairToCap(naive, pool, cap) : naive;
}

type FiveScorer = (five: Record<Position, PlayerSpan>) => LineupScore;
function cachedScorer(): FiveScorer {
  const cache = new Map<string, LineupScore>();
  return (five) => {
    const key = STARTER_SLOTS.map((s) => five[s].id).join('|');
    let r = cache.get(key);
    if (!r) {
      r = scoreLineup(five);
      cache.set(key, r);
    }
    return r;
  };
}

/** Single-swap hill climb from `start`, never leaving the shots cap. */
function climb(
  start: Record<Position, PlayerSpan>,
  pool: DailyPool,
  cap: number | undefined,
  sc: FiveScorer,
  maxPasses = 8,
): { five: Record<Position, PlayerSpan>; composite: number } {
  let five = { ...start };
  let cur = sc(five).composite;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < maxPasses) {
    improved = false;
    for (const slot of STARTER_SLOTS) {
      for (const cand of pool.bySlot[slot]) {
        if (cand.id === five[slot].id) continue;
        const trial = { ...five, [slot]: cand };
        if (cap != null && lineupShots(trial) > cap) continue; // reject illegal swaps
        const s = sc(trial).composite;
        if (s > cur + 1e-6) {
          five = trial;
          cur = s;
          improved = true;
        }
      }
    }
  }
  return { five, composite: cur };
}

export function solveDailyOptimal(pool: DailyPool, cap?: number): SolvedLineup {
  const sc = cachedScorer();

  const rng = mulberry32(seedFromKey(`${pool.key}:solve`));

  // 2026-09-30: the fan-vote five is also a start, so the solved five can never come out below
  // the board's par (a local climb from the other starts could, when a Fit term moved).
  const starts: Record<Position, PlayerSpan>[] = [talMaxLineup(pool, cap), ...(cap != null ? [fanVoteFive(pool, cap)] : [])];
  for (let r = 0; r < 4; r++) {
    const rand = Object.fromEntries(
      STARTER_SLOTS.map((s) => {
        const p = pool.bySlot[s];
        return [s, p[Math.floor(rng() * p.length)]];
      }),
    ) as Record<Position, PlayerSpan>;
    starts.push(cap != null ? repairToCap(rand, pool, cap) : rand);
  }

  let bestFive: Record<Position, PlayerSpan> | null = null;
  let bestComposite = -1;
  for (const start of starts) {
    const { five, composite: cur } = climb(start, pool, cap, sc);
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

export function dailyTargets(pool: DailyPool, cap?: number): DailyTargets {
  const solved = solveDailyOptimal(pool, cap);
  return {
    par: scoreLineup(talMaxLineup(pool, cap)).composite,
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

// ---------------------------------------------------------------------------
// board selection — 2026-09-27, engine audit: 65% of daily boards were chalk (the five biggest
// names, trimmed to the cap, within 3 points of the engine's best), so there was nothing to
// out-think. A board is now the first of a few deterministic (pool, cap) candidates on which
// the lazy pick can be clearly beaten; same seed, same board, for everyone.
// ---------------------------------------------------------------------------

export interface DailyBoard {
  pool: DailyPool;
  cap: number;
}

/** How far a single climb from the lazy pick must get above it for the board to count. */
const BOARD_MIN_GAP = 4;
/** Pool variants tried per seed, each with a few caps, before settling for the best seen. */
const BOARD_POOL_TRIES = 6;

function capCandidates(pool: DailyPool, daily = false): number[] {
  const cheapest = STARTER_SLOTS.reduce((sum, slot) => sum + Math.min(...pool.bySlot[slot].map((p) => p.fga)), 0);
  const floor = Math.ceil(cheapest + (daily ? DAILY_CAP_FLOOR_MARGIN : CAP_FLOOR_MARGIN));
  const cap = computedShotsCap(pool, daily);
  // The daily board never tries a looser cap than its own.
  const tries = daily ? [cap, cap - 3] : [cap, cap + 3, cap - 3];
  return [...new Set(tries.filter((c) => c >= floor))];
}

/** Lower bound on how far the engine's best beats the lazy pick: a short climb from the lazy
 * pick (two passes keep a board check to a few dozen lineup scores on a phone). */
const QUICK_GAP_PASSES = 2;
function quickGap(pool: DailyPool, cap: number): number {
  const sc = cachedScorer();
  const lazy = fanVoteFive(pool, cap);
  return climb(lazy, pool, cap, sc, QUICK_GAP_PASSES).composite - sc(lazy).composite;
}

const boardCache = new Map<string, DailyBoard>();
export function dailyBoard(seed: string = dayKey(), daily = false): DailyBoard {
  const cacheKey = `${seed}|${daily ? 'daily' : ''}`;
  const hit = boardCache.get(cacheKey);
  if (hit) return hit;
  let best: DailyBoard | null = null;
  let bestGap = -Infinity;
  search: for (let attempt = 0; attempt < BOARD_POOL_TRIES; attempt++) {
    const poolKey = attempt === 0 ? seed : `${seed}~${attempt}`;
    const pool = dailyPool(poolKey);
    for (const cap of capCandidates(pool, daily)) {
      const gap = quickGap(pool, cap);
      if (gap > bestGap) {
        bestGap = gap;
        best = { pool, cap };
      }
      if (gap >= BOARD_MIN_GAP) break search;
    }
  }
  boardCache.set(cacheKey, best!);
  return best!;
}

/** 2026-09-27, the user: "bardziej koszykarskie sformułowania". The grade keys stay golf (they are
 * stored in daily progress); what the player reads is where the five would finish a season.
 * 2026-09-27 results audit pack C: the same words the drafts' finish tiers use
 * (`resultTierLabel` in ResultsScreen.tsx), so all three modes speak one language. */
export const GRADE_LABEL: Record<GolfGrade, string> = {
  eagle: 'Dynasty',
  birdie: 'Contender',
  par: 'Playoff Lock',
  bogey: 'Play-In Fight',
  'double-bogey': 'Lottery Team',
};

export const GRADE_BLURB: Record<GolfGrade, string> = {
  eagle: 'You drew up the exact five the film room would start. Hang the banner.',
  birdie: 'You beat the fan-vote five — the biggest names weren’t the best team.',
  par: 'Same number as starting the five biggest names. Solid, but no edge.',
  bogey: 'A step behind the fan-vote five — something in the rotation isn’t clicking.',
  'double-bogey': 'The pieces don’t play together — check the spacing and who protects the rim.',
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

/** 2026-09-11: exported (was module-private) so `QuickFive.tsx`'s own results "why" section can
 * reuse the exact same weakest-axis reasoning instead of a near-duplicate — it's generic over any
 * `LineupScore`, not actually Best-Five-specific in what it says, so reuse keeps the voice
 * consistent between both bare-five modes rather than drifting. */
export const WEAK_AXIS_REASON: Record<WeightedAxis, (s: LineupScore) => string> = {
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
  /** 2026-09-28, the user ("jeśli wybrałem najlepszy możliwy zespół to czy powinny być jakieś
   * słabości wypisywane? Raczej im lepiej tym bardziej w stronę pochwał"): how far the five is from
   * the best five on the board, which sets the film room's tone. */
  gapToBest: number;
  standing: 'best' | 'close' | 'off';
  /** The best five's own axis values — the ceiling of this deal, shown next to yours. */
  bestAxes: Record<WeightedAxis | 'spacing', number>;
  /** The weakest axis is no worse than the best five's (within 2): the deal, not the pick. */
  weakestIsBoardLimit: boolean;
  /** Each of your picks that differs from the best five, by what it costs: the best five's score
   * minus the best five with your player in that spot. Biggest cost first. */
  pickCosts: { slot: Position; yours: string; best: string; cost: number; axis: string; axisDelta: number }[];
}

/** Within this many points of the best five on the board counts as matching it. */
export const BEST_FIVE_TOLERANCE = 1;
/** Within this many points reads as close: praise plus one concrete swap. */
export const CLOSE_TO_BEST = 4;

export function explainResult(lineup: Lineup, pool: DailyPool, targets: DailyTargets, cap?: number): ResultExplanation {
  const score = scoreLineup(lineup);
  const optScore = scoreLineup(targets.optimalFive);
  // Same (possibly cap-repaired) lazy five `targets.par` was scored from — comparing against the
  // pure uncapped naive pick here would make "you took the lazy pick" disagree with par itself.
  const lazy = fanVoteFive(pool, cap);

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

  const gapToBest = Math.max(0, Math.round(targets.optimal - score.composite));
  const standing = gapToBest <= BEST_FIVE_TOLERANCE ? 'best' : gapToBest <= CLOSE_TO_BEST ? 'close' : 'off';
  const axisKeys = ['talent', 'offense', 'defense', 'spacing', 'fit'] as const;
  const bestAxes = Object.fromEntries(axisKeys.map((k) => [k, Math.round(optScore[k])])) as Record<WeightedAxis | 'spacing', number>;
  const pickCosts = STARTER_SLOTS.flatMap((slot) => {
    const yours = lineup[slot];
    const best = targets.optimalFive[slot];
    if (!yours || !best || yours.id === best.id) return [];
    const swapped = scoreLineup({ ...targets.optimalFive, [slot]: yours });
    const [axis] = WEIGHTED_AXES.map((a) => ({ label: a.label, delta: Math.round(swapped[a.key] - optScore[a.key]) }))
      .sort((a, b) => a.delta - b.delta);
    return [{ slot, yours: yours.playerName, best: best.playerName, cost: Math.round(optScore.composite - swapped.composite), axis: axis.label, axisDelta: axis.delta }];
  }).sort((a, b) => b.cost - a.cost);

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
    gapToBest,
    standing,
    bestAxes,
    weakestIsBoardLimit: score[weakestKey.key] >= optScore[weakestKey.key] - 2,
    pickCosts,
  };
}

// ---------------------------------------------------------------------------
// slot-machine reels — 2026-09-26, the user: "losując karty w daily deal, może być naprawdę jak w
// kasynie na maszynie, widzimy jak śmigają nam gracze i co mogliśmy ominąć". Purely cosmetic: the
// deal itself is `dailyPool`; these are the faces that spin past on each of a slot's five reels
// before it stops on the dealt player. Drawn from the same position's top of the board, one big
// name planted just before the stop on some reels (the near miss), deterministic per board.
// ---------------------------------------------------------------------------

export interface SlotReels {
  /** One strip per dealt card, in `pool.bySlot[slot]` order; the dealt player is NOT included. */
  reels: PlayerSpan[][];
  /** Recognisable names that spun past this slot, for the "flew past" line. */
  nearMisses: string[];
}

const REEL_BUCKET = 60;
const NEAR_MISS_AS = 6;

export function slotReels(pool: DailyPool, slot: Position, count = DEAL_SIZE, baseLength = 16, stepLength = 5): SlotReels {
  const rng = mulberry32(seedFromKey(`${pool.key}:reel:${slot}`));
  const dealtNames = new Set(pool.bySlot[slot].map((s) => s.playerName));
  const ranked = [...bestSpanByPlayer().values()]
    .filter((s) => s.primaryPosition === slot && !dealtNames.has(s.playerName))
    .sort((a, b) => effectiveTalent(b) - effectiveTalent(a))
    .slice(0, REEL_BUCKET);
  const stars = ranked.filter((s) => allStarCount(s.playerName) >= NEAR_MISS_AS);
  const pickFrom = (list: PlayerSpan[]) => list[Math.floor(rng() * list.length)];
  const nearMisses = new Set<string>();
  const reels = Array.from({ length: count }, (_, i) => {
    const length = baseLength + i * stepLength;
    const strip: PlayerSpan[] = [];
    for (let k = 0; k < length; k++) {
      let next = pickFrom(ranked);
      while (strip.length > 0 && next.playerName === strip[strip.length - 1].playerName && ranked.length > 1) next = pickFrom(ranked);
      strip.push(next);
    }
    // The near miss: a star one notch above the stop on about half the reels.
    if (stars.length > 0 && rng() < 0.5) {
      const star = pickFrom(stars);
      strip[strip.length - 1] = star;
      nearMisses.add(star.playerName);
    }
    return strip;
  });
  return { reels, nearMisses: [...nearMisses] };
}

// ---------------------------------------------------------------------------
// the reactive deal — 2026-09-28, the user: "powinna zawsze być jakaś opcja, generować więcej kart
// i być reaktywne do tego co brakuje". Of a position's POOL_PER_SLOT cards the machine shows
// DEAL_SIZE, chosen for the five so far. Always in: the star (the temptation), the cheapest card
// (so the cap can always be met) and the board's winning card at this position (so the best five
// is the same for everyone). Then the
// card that best covers what the five lacks, then the rest by the deal's own seed — swapping in
// affordable cards until at least two fit the caps left. Same pool and same picks deal the same
// cards, so a challenge played the same way is the same game.
// ---------------------------------------------------------------------------

const optimalCache = new Map<string, Record<Position, PlayerSpan>>();
const optimalKey = (pool: DailyPool, cap: number) => `${pool.key}|${cap}|${STARTER_SLOTS.map((s) => pool.bySlot[s].length).join()}`;
function boardOptimal(pool: DailyPool, cap: number): Record<Position, PlayerSpan> {
  const key = optimalKey(pool, cap);
  let five = optimalCache.get(key);
  if (!five) {
    five = solveDailyOptimal(pool, cap).five;
    optimalCache.set(key, five);
  }
  return five;
}

export type DealNeed = 'shooting' | 'defense' | 'creation';
/** What the five so far is missing, strongest need first. */
function needsOf(picks: PlayerSpan[]): { key: DealNeed; have: number; score: (s: PlayerSpan) => number }[] {
  if (picks.length === 0) return [];
  const shooters = picks.filter((p) => computeSpacing(p) >= 65).length;
  const stoppers = picks.filter((p) => computeDefensiveTalent(p) >= 75).length;
  const creators = picks.filter((p) => computeOffensiveTalent(p) >= 85 || p.box.apg >= 6).length;
  const needs: [number, DealNeed, number, (s: PlayerSpan) => number][] = [
    [2 - shooters, 'shooting', shooters, computeSpacing],
    [2 - stoppers, 'defense', stoppers, computeDefensiveTalent],
    [1 - creators, 'creation', creators, (s) => computeOffensiveTalent(s) + s.box.apg * 2],
  ];
  return needs.filter(([gap]) => gap > 0).sort((a, b) => b[0] - a[0]).map(([, key, have, score]) => ({ key, have, score }));
}

/**
 * 2026-09-28, the user ("wyrzućmy wszystko, ewentualnie zostawić tylko jakieś drobne
 * podpowiedzi"): the headliner and the rumors are gone; what's left is one small, always-true hint
 * per deal — what the five so far is missing, when the deal has a card that covers it (`dealFor`
 * deals one). It never says which card.
 */
export function dealHint(pool: DailyPool, slot: Position, lineup: Lineup, cap: number): { need: DealNeed; have: number } | undefined {
  const picks = STARTER_SLOTS.map((s) => lineup[s]).filter((p): p is PlayerSpan => Boolean(p));
  const [need] = needsOf(picks);
  if (!need) return undefined;
  const best = [...pool.bySlot[slot]].sort((a, b) => need.score(b) - need.score(a))[0];
  const threshold = need.key === 'shooting' ? (s: PlayerSpan) => computeSpacing(s) >= 65 : need.key === 'defense' ? (s: PlayerSpan) => computeDefensiveTalent(s) >= 75 : (s: PlayerSpan) => computeOffensiveTalent(s) >= 85 || s.box.apg >= 6;
  return dealFor(pool, slot, lineup, cap).some(threshold) && best ? { need: need.key, have: need.have } : undefined;
}

/**
 * 2026-09-30, the user ("mam caps na Griffina, nie powinno mnie blokować"; "reaktywne do wyborów,
 * plansza powinna być przygotowana na każdy wybór"): a pick is never blocked because the board's
 * own cards for later positions would no longer fit. What a later position must cost at least is
 * the cheapest player in the whole game at it (`slotFloor`), and when a deal comes up with too few
 * cards the caps left can pay for, it tops up with the best cheap players from the whole game
 * (`dealFor`) — the board is ready for any path.
 */
const floorCache = new Map<Position, number>();
export function slotFloor(slot: Position): number {
  let floor = floorCache.get(slot);
  if (floor === undefined) {
    floor = Math.min(...[...bestSpanByPlayer().values()].filter((s) => s.primaryPosition === slot).map((s) => s.fga));
    floorCache.set(slot, floor);
  }
  return floor;
}

let spanIndex: Map<string, PlayerSpan> | null = null;
/** Any span in the game by id — for a saved pick that came from the top-up, not the board. */
export function spanById(id: string): PlayerSpan | undefined {
  if (!spanIndex) spanIndex = new Map(draftPool.map((s) => [s.id, s]));
  return spanIndex.get(id);
}

export function dealFor(pool: DailyPool, slot: Position, lineup: Lineup, cap: number, size = DEAL_SIZE): PlayerSpan[] {
  // The daily Joker is never dealt here: `dailyGame` places his face-down card in the hand itself.
  const joker = pool.bySlot[slot].find((s) => pool.roles[s.id] === 'joker');
  const cards = pool.bySlot[slot].filter((s) => s !== joker);
  const picks = STARTER_SLOTS.map((s) => lineup[s]).filter((p): p is PlayerSpan => Boolean(p));
  const rng = mulberry32(seedFromKey(`${pool.key}:deal:${slot}:${picks.map((p) => p.id).join(',')}`));
  const openAfter = STARTER_SLOTS.filter((s) => s !== slot && !lineup[s]);
  const room = cap - lineupShots(lineup) - openAfter.reduce((sum, s) => sum + slotFloor(s), 0);
  const fits = (s: PlayerSpan) => s.fga <= room + 1e-9;

  const hand: PlayerSpan[] = [];
  const add = (s: PlayerSpan | undefined) => {
    if (s && hand.length < size && !hand.includes(s)) hand.push(s);
  };
  add(cards.find((s) => pool.roles[s.id] === 'star'));
  add([...cards].sort((a, b) => a.fga - b.fga)[0]);
  // The board's winning card at this position, dealt on every path — so "best on the board" is the
  // same five for everyone who plays the seed, and a challenge compares like with like. It can be
  // over the caps left (that's the cost of an earlier pick); it only gives way when the deal would
  // otherwise have fewer than two cards to afford.
  const winning = boardOptimal(pool, cap)[slot];
  if (winning !== joker) add(winning);
  const [need] = needsOf(picks);
  if (need) add(cards.filter((s) => !hand.includes(s) && fits(s)).sort((a, b) => need.score(b) - need.score(a))[0]);
  for (const s of weightedShuffle(cards.filter((c) => !hand.includes(c)), rng, () => 1)) add(s);
  // At least two cards the caps left can pay for.
  const star = cards.find((s) => pool.roles[s.id] === 'star');
  const keep = new Set([star, [...cards].sort((a, b) => a.fga - b.fga)[0]].filter(Boolean));
  for (const spare of cards.filter((c) => !hand.includes(c) && fits(c))) {
    if (hand.filter(fits).length >= 2) break;
    const out = hand.findIndex((c) => !fits(c) && !keep.has(c));
    if (out < 0) break;
    hand[out] = spare;
  }
  // Still short of two affordable cards (earlier picks spent big): the best cheap players at this
  // position from the whole game come in, so there is always a real choice left.
  if (hand.filter(fits).length < 2) {
    const onBoard = new Set(STARTER_SLOTS.flatMap((s) => pool.bySlot[s].map((p) => p.playerName)));
    const topUp = [...bestSpanByPlayer().values()]
      .filter((s) => s.primaryPosition === slot && !onBoard.has(s.playerName) && fits(s))
      .sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
    for (const cheap of topUp) {
      if (hand.filter(fits).length >= 2) break;
      // The star stays dealt either way — he's the temptation, affordable or not.
      const out = hand.findIndex((c) => !fits(c) && c !== star);
      if (out >= 0) hand[out] = cheap;
      else if (hand.length < size) hand.push(cheap);
      else break;
    }
  }
  return hand.sort((a, b) => a.playerName.localeCompare(b.playerName));
}

/**
 * What a board is graded against, the same for everyone who plays the seed whatever their path:
 * "best on the board" is the board's winning five (dealt on every path to a player who follows it),
 * and the fan-vote five is the highest-TAL five among the cards every path is dealt
 * (`fanVoteFive`) — never a card someone might not have seen.
 */
export function boardTargets(pool: DailyPool, cap: number): DailyTargets {
  const winning = boardOptimal(pool, cap);
  return { par: scoreLineup(fanVoteFive(pool, cap)).composite, optimal: scoreLineup(winning).composite, optimalFive: winning };
}

// ---------------------------------------------------------------------------
// the daily Jokers — 2026-09-30, the user (fourth take): "pozycyjny; nie wiemy kim jest — 50/50
// między legendą a leszczem; trafiamy go losowo; 5 kart w linii, od 1–3 razy w ciągu gry". The
// daily deals five cards a position. In one to three rounds (the seed's pick) one of the five is a
// face-down Joker: a player at that position who is, even odds, a legend or a scrub, at the flat
// price of the position's middle card. Nobody knows which until he's picked — a legend at that
// price is a steal, a scrub is caps thrown away.
// ---------------------------------------------------------------------------

export interface DailyJoker {
  /** The player under the card. */
  span: PlayerSpan;
  slot: Position;
  /** His round (index in the day's order). */
  round: number;
  /** Where in the five-card hand his card lies. */
  place: number;
  legend: boolean;
  /** The flat price on the face-down card. */
  price: number;
  /** The card as dealt and picked: the player at the flat price. */
  card: PlayerSpan;
}

export interface DailyGame extends DailyBoard {
  order: Position[];
  jokers: DailyJoker[];
}

/** A legend: this many All-Star picks or more. */
const JOKER_LEGEND_AS = 6;
/** A scrub: from the bottom of the position's players by talent, this share of them. */
const JOKER_SCRUB_SHARE = 0.25;

const gameCache = new Map<string, DailyGame>();
/** The day's board, its position order and its hidden Jokers. */
export function dailyGame(seed: string, meta: { order: Position[] }): DailyGame {
  const hit = gameCache.get(seed);
  if (hit) return hit;
  const board = dailyBoard(seed, true);
  const { pool, cap } = board;
  const rng = mulberry32(seedFromKey(`${seed}:jokers`));
  const count = JOKERS_MIN + Math.floor(rng() * (JOKERS_MAX - JOKERS_MIN + 1));
  const rounds = weightedShuffle([0, 1, 2, 3, 4], rng, () => 1).slice(0, count).sort((a, b) => a - b);
  const onBoard = new Set(STARTER_SLOTS.flatMap((s) => pool.bySlot[s].map((p) => p.playerName)));
  const jokers: DailyJoker[] = [];
  for (const round of rounds) {
    const slot = meta.order[round];
    const atSlot = [...bestSpanByPlayer().values()].filter((s) => s.primaryPosition === slot && !onBoard.has(s.playerName));
    const legend = rng() < 0.5;
    const ranked = atSlot.sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
    const field = legend
      ? ranked.filter((s) => allStarCount(s.playerName) >= JOKER_LEGEND_AS)
      : ranked.slice(Math.floor(ranked.length * (1 - JOKER_SCRUB_SHARE)));
    const span = weightedShuffle(field, rng, (s) => (legend ? Math.sqrt(allStarCount(s.playerName)) : 1))[0];
    if (!span) continue;
    const costs = pool.bySlot[slot].map((c) => c.fga).sort((a, b) => a - b);
    const price = Math.round(costs[Math.floor(costs.length / 2)] * 10) / 10;
    onBoard.add(span.playerName);
    jokers.push({ span, slot, round, place: Math.floor(rng() * DAILY_HAND_SIZE), legend, price, card: { ...span, fga: price } });
  }
  const bySlot = { ...pool.bySlot };
  const roles = { ...pool.roles };
  for (const j of jokers) {
    bySlot[j.slot] = [...bySlot[j.slot], j.card];
    roles[j.card.id] = 'joker';
  }
  const augmented: DailyPool = { key: pool.key, bySlot, roles };
  // The board's best five with the Jokers in it: the best five without them, or with one legend
  // Joker if that beats it (a scrub never does).
  const sc = cachedScorer();
  let best = boardOptimal(pool, cap);
  let bestScore = sc(best).composite;
  for (const j of jokers.filter((x) => x.legend)) {
    const withHim = bestWithJoker(pool, cap, j.slot, j.card, 3, sc);
    if (withHim && withHim.composite > bestScore) {
      best = withHim.five;
      bestScore = withHim.composite;
    }
  }
  optimalCache.set(optimalKey(augmented, cap), best);
  const game: DailyGame = { pool: augmented, cap, order: meta.order, jokers };
  gameCache.set(seed, game);
  return game;
}

/** The best five that has `joker` at `slot`, under the cap — null when he can never fit. */
function bestWithJoker(pool: DailyPool, cap: number, slot: Position, joker: PlayerSpan, passes: number, sc: FiveScorer): { five: Record<Position, PlayerSpan>; composite: number } | null {
  const restricted: DailyPool = { ...pool, bySlot: { ...pool.bySlot, [slot]: [joker] } };
  const start = repairToCap({ ...boardOptimal(pool, cap), [slot]: joker }, restricted, cap);
  if (lineupShots(start) > cap) return null;
  return climb(start, restricted, cap, sc, passes);
}
