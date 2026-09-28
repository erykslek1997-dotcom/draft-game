import type { PlayerSpan, Position } from '../data/schema';
import type { Team, Rotation, SlotAssignment } from './types';
import { draftPool } from '../data/draftPool';
import { effectiveTalent } from './grades';
import { allStarCount } from './allStarLookup';
import { talentScore, offenseScore, defenseScore, spacingScore } from './scoring';
import { fitScore } from './fit';
import { STARTER_SLOTS, positionFitMultiplier } from './positions';
import { mulberry32, hashSeed } from './rng';
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
export const POOL_PER_SLOT = 4;

/**
 * Exactly ONE genuine headliner per slot — the tempting "lazy pick" — drawn from the top of the
 * position by talent and weighted toward the most recognisable name. Every board stays winnable
 * (par = grab the five headliners) without the pool being a wall of all-time greats: the old
 * design forced ≥2 top-15-TAL players per slot AND weighted the whole draw toward All-Stars, so
 * Curry + Jordan + LeBron + Garnett + Robinson could all sit on one board. Now a slot is 1 star
 * + 4 starters/role-players, and picking all five stars is explicitly par, not a win.
 */
const HEADLINER_BUCKET = 12;
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
export type DealRole = 'star' | 'value' | 'specialist' | 'surprise';

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
const ROLE_BUCKET = 60;
/** A value card costs at most this share of the bucket's shot costs (30th percentile). */
const VALUE_FGA_QUANTILE = 0.3;
/** Specialist: at or above this position-relative percentile on one axis, at or below the weak
 * line on another. */
const SPECIALIST_HIGH = 0.85;
const SPECIALIST_LOW = 0.35;
/** Surprise, under-the-radar kind: at most this many All-Star picks, inside this talent rank. */
const SLEEPER_MAX_AS = 1;
const SLEEPER_MAX_RANK = 30;
/** Surprise, famous-name kind: a player with this many All-Star picks, in a stretch at least this
 * many TAL below his best one. */
const NAME_TRAP_MIN_AS = 6;
const NAME_TRAP_MIN_DROP = 8;

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

    // Star.
    take(weightedShuffle(ranked.slice(0, HEADLINER_BUCKET), rng, recognisability).find(allowed), 'star');

    // Value: among the cheaper third of the bucket, the most talent per shot is likeliest.
    const fgaCut = [...bucket.map((s) => s.fga)].sort((a, b) => a - b)[Math.floor(bucket.length * VALUE_FGA_QUANTILE)] ?? Infinity;
    take(
      weightedShuffle(bucket.filter((s) => s.fga <= fgaCut && allowed(s)), rng, (s) => Math.pow(effectiveTalent(s) / Math.max(4, s.fga), 3)).at(0),
      'value',
    );

    // Specialist: elite on one axis, weak on another, measured against the bucket.
    const axes = [computeDefensiveTalent, computeSpacing, computeFinishing, computeOffensiveTalent];
    const pct = axes.map((f) => percentileWithin(bucket.map(f)));
    const specialistScore = (s: PlayerSpan) => {
      const p = axes.map((f, i) => pct[i](f(s)));
      const high = Math.max(p[0], p[1], p[2]);
      const low = Math.min(...p.filter((_, i) => i !== p.indexOf(high)));
      return high >= SPECIALIST_HIGH && low <= SPECIALIST_LOW ? high - low : 0;
    };
    take(weightedShuffle(bucket.filter((s) => allowed(s) && specialistScore(s) > 0), rng, specialistScore).at(0), 'specialist');

    // Surprise: a sleeper or a famous name in a lesser stretch, one or the other by coin flip.
    const sleeper = () =>
      weightedShuffle(ranked.slice(0, SLEEPER_MAX_RANK).filter((s) => allowed(s) && allStarCount(s.playerName) <= SLEEPER_MAX_AS), rng, () => 1).at(0);
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

    // Fill any role that found no one (thin positions) with the old obscure-starter draw, then,
    // as a last resort, straight from the ranked list — a slot must always deal POOL_PER_SLOT.
    for (const s of weightedShuffle(ranked.slice(0, BODY_BUCKET), rng, obscurity)) {
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

/** The next position's star (used by tests and the rumor below). */
export function teaserFor(pool: DailyPool, slot: Position): PlayerSpan | undefined {
  return pool.bySlot[slot].find((s) => pool.roles[s.id] === 'star');
}

/**
 * 2026-09-27, the user: instead of naming the next position's star, a line of scouting talk
 * "co może być baitem albo prawdą", two baits per board, no reveal afterwards, cost in words.
 * Every rumor is literally true of one of the next position's four cards, but it does not say
 * which. A true rumor describes that position's star. A bait describes the card that sounds better
 * than it plays: the famous name in a lesser stretch if there is one, otherwise the specialist
 * (only his strength is mentioned). Which positions carry the bait is drawn from the board's seed.
 */
export interface Rumor {
  text: string;
  bait: boolean;
}
const BAITS_PER_BOARD = 2;

/**
 * 2026-09-28, the user ("opisy nic nie mówią bo są zbyt podobne"): every rumor used to be one of a
 * handful of fixed lines, so after a few boards they all read alike. Each part now has several
 * wordings (picked by the rumor's own seed), the strength reads more signals, and about half the
 * rumors add one more true detail — the subject's era or what he did on the glass — so the talk
 * is specific enough to argue with. Still true of exactly the card it describes, still silent on
 * which card that is.
 */
const COST_WORDS: [number, string[]][] = [
  [21, ['He won’t come cheap.', 'He’ll eat a big chunk of the cap.', 'Bring your wallet.']],
  [17, ['Priced like a first option.', 'Not cheap — first-option money.', 'You’ll pay for him.']],
  [12, ['Mid-range price tag.', 'Won’t break the bank, won’t come free.', 'Fair price, if the scouts are right.']],
  [0, ['Cheap, too.', 'And he costs next to nothing.', 'Bargain-bin price.']],
];
function pickFrom<T>(list: T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length)];
}
function costWords(fga: number, rng: () => number): string {
  return pickFrom((COST_WORDS.find(([min]) => fga >= min) ?? COST_WORDS[COST_WORDS.length - 1])[1], rng);
}
function strengthWords(s: PlayerSpan, rng: () => number): string | null {
  const signals: [number, string[]][] = [
    [computeSpacing(s) - 75, ['Can really shoot it.', 'Defenses can’t leave him open.', 'Stretches the floor.']],
    [computeDefensiveTalent(s) - 80, ['Locks people up.', 'Nobody wants to be guarded by him.', 'A real stopper.']],
    [computeFinishing(s) - 80, ['Lives at the rim.', 'Finishes through contact.', 'Gets to the basket at will.']],
    [computeOffensiveTalent(s) - 85, ['Gets buckets.', 'Scores from anywhere.', 'A go-to scorer.']],
    [(s.box.apg - 7.5) * 4, ['Runs the whole show.', 'Makes everyone around him better.', 'A true table-setter.']],
    [(s.box.rpg - 11) * 3, ['Owns the glass.', 'Every rebound is his.', 'A monster on the boards.']],
  ];
  const [edge, words] = signals.reduce((a, b) => (b[0] > a[0] ? b : a));
  return edge > 0 ? pickFrom(words, rng) : null;
}
/** One more true detail about the subject: when he played. */
function eraWords(s: PlayerSpan, rng: () => number): string | null {
  const years = s.spanLabel.match(/\d{4}/g)?.map(Number) ?? [];
  if (years.length === 0) return null;
  const mid = (years[0] + years[years.length - 1]) / 2;
  if (mid < 1980) return pickFrom(['Old-school — from before the three-point line mattered.', 'A name from the seventies or earlier.'], rng);
  if (mid < 1990) return pickFrom(['An eighties guy.', 'Came up in the Magic-and-Bird years.'], rng);
  if (mid < 2000) return pickFrom(['A nineties player.', 'From the Jordan era.'], rng);
  if (mid < 2012) return pickFrom(['From the 2000s.', 'Peaked before the three-point boom.'], rng);
  return pickFrom(['A modern player.', 'From the pace-and-space era.'], rng);
}
/**
 * 2026-09-27, the user ("A 14-time All-Star is in the next deal — za mocno sugeruje, że ktoś
 * mocny"): no counts. The opening line only says whether the subject was ever an All-Star, in
 * words that fit a star and a bait alike, picked by the rumor's own seed.
 */
const ALL_STAR_OPENERS = [
  'Someone in the next deal has been an All-Star.',
  'There’s a familiar face in the next deal.',
  'Scouts keep circling one name in the next deal.',
  'One of the next four has played on the big stage.',
  'The phones are ringing about one of the next four.',
  'A name you know is coming up.',
];
const UNKNOWN_OPENERS = [
  'Someone in the next deal is better than his name.',
  'The box score liked one of the next four more than the fans did.',
  'There’s a quiet one in the next deal the scouts won’t shut up about.',
  'You might not know one of the next four. The tape does.',
];
function identityWords(s: PlayerSpan, rng: () => number): string {
  return pickFrom(allStarCount(s.playerName) >= 1 ? ALL_STAR_OPENERS : UNKNOWN_OPENERS, rng);
}

export function rumorFor(pool: DailyPool, slot: Position): Rumor | undefined {
  const rng = mulberry32(seedFromKey(`${pool.key}:rumor`));
  const baitSlots = new Set(weightedShuffle(STARTER_SLOTS.slice(1), rng, () => 1).slice(0, BAITS_PER_BOARD));
  const cards = pool.bySlot[slot];
  const byRole = (role: DealRole) => cards.find((s) => pool.roles[s.id] === role);
  const star = byRole('star');
  const surprise = byRole('surprise');
  const bestTal = (s: PlayerSpan) => Math.max(...(spansByPlayer().get(s.playerName) ?? [s]).map(effectiveTalent));
  const nameTrap = surprise && allStarCount(surprise.playerName) >= NAME_TRAP_MIN_AS && bestTal(surprise) - effectiveTalent(surprise) >= NAME_TRAP_MIN_DROP ? surprise : undefined;
  const bait = baitSlots.has(slot) ? nameTrap ?? byRole('specialist') : undefined;
  const subject = bait ?? star;
  if (!subject) return undefined;
  // A bait reads exactly like a true rumor: same identity line (All-Star count), same wording.
  const detailRng = mulberry32(seedFromKey(`${pool.key}:rumor:${slot}`));
  const opener = identityWords(subject, detailRng);
  const strength = strengthWords(subject, detailRng);
  const era = detailRng() < 0.5 ? eraWords(subject, detailRng) : null;
  const parts = [opener, era, strength && detailRng() < 0.8 ? strength : null, costWords(subject.fga, detailRng)];
  return { text: parts.filter(Boolean).join(' '), bait: Boolean(bait) };
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
export function computedShotsCap(pool: DailyPool): number {
  const cardOf = (slot: Position, role: DealRole) => pool.bySlot[slot].find((s) => pool.roles[s.id] === role);
  const cheapestOf = (slot: Position) => Math.min(...pool.bySlot[slot].map((p) => p.fga));
  const valueFive = STARTER_SLOTS.reduce((sum, slot) => sum + (cardOf(slot, 'value')?.fga ?? cheapestOf(slot)), 0);
  const starFive = STARTER_SLOTS.reduce((sum, slot) => sum + (cardOf(slot, 'star')?.fga ?? cheapestOf(slot)), 0);
  const cheapest = STARTER_SLOTS.reduce((sum, slot) => sum + cheapestOf(slot), 0);
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
 * puzzle asks you to beat — see `parFor`. `cap`, when given, repairs the naive pick down to a
 * legal one (see `repairToCap`) — the "five biggest names" IS the naive move even under a shots
 * cap, it just might need trimming first. */
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

  const starts: Record<Position, PlayerSpan>[] = [talMaxLineup(pool, cap)];
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

function capCandidates(pool: DailyPool): number[] {
  const cheapest = STARTER_SLOTS.reduce((sum, slot) => sum + Math.min(...pool.bySlot[slot].map((p) => p.fga)), 0);
  const floor = Math.ceil(cheapest + CAP_FLOOR_MARGIN);
  const cap = computedShotsCap(pool);
  return [...new Set([cap, cap + 3, cap - 3].filter((c) => c >= floor))];
}

/** Lower bound on how far the engine's best beats the lazy pick: a short climb from the lazy
 * pick (two passes keep a board check to a few dozen lineup scores on a phone). */
const QUICK_GAP_PASSES = 2;
function quickGap(pool: DailyPool, cap: number): number {
  const sc = cachedScorer();
  const lazy = talMaxLineup(pool, cap);
  return climb(lazy, pool, cap, sc, QUICK_GAP_PASSES).composite - sc(lazy).composite;
}

const boardCache = new Map<string, DailyBoard>();
export function dailyBoard(seed: string = dayKey()): DailyBoard {
  const hit = boardCache.get(seed);
  if (hit) return hit;
  let best: DailyBoard | null = null;
  let bestGap = -Infinity;
  search: for (let attempt = 0; attempt < BOARD_POOL_TRIES; attempt++) {
    const poolKey = attempt === 0 ? seed : `${seed}~${attempt}`;
    const pool = dailyPool(poolKey);
    for (const cap of capCandidates(pool)) {
      const gap = quickGap(pool, cap);
      if (gap > bestGap) {
        bestGap = gap;
        best = { pool, cap };
      }
      if (gap >= BOARD_MIN_GAP) break search;
    }
  }
  boardCache.set(seed, best!);
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
  const lazy = talMaxLineup(pool, cap);

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

export function slotReels(pool: DailyPool, slot: Position, baseLength = 16, stepLength = 5): SlotReels {
  const rng = mulberry32(seedFromKey(`${pool.key}:reel:${slot}`));
  const dealtNames = new Set(pool.bySlot[slot].map((s) => s.playerName));
  const ranked = [...bestSpanByPlayer().values()]
    .filter((s) => s.primaryPosition === slot && !dealtNames.has(s.playerName))
    .sort((a, b) => effectiveTalent(b) - effectiveTalent(a))
    .slice(0, REEL_BUCKET);
  const stars = ranked.filter((s) => allStarCount(s.playerName) >= NEAR_MISS_AS);
  const pickFrom = (list: PlayerSpan[]) => list[Math.floor(rng() * list.length)];
  const nearMisses = new Set<string>();
  const reels = pool.bySlot[slot].map((_, i) => {
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
