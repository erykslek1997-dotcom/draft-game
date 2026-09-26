import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { players } from '../data/players';
import { resolveSourceName, seasonEndYearOf } from '../data/sourceNameResolver';
import { spanEndYears } from './era';
import rsData from '../data/awards/bpm2.json';
import careerData from '../data/cardCareerMetadata.json';

/**
 * 2026-09-26, the user on Chris Bosh ("Skoro Bosh w Toronto rzucał więcej, a mniej w Miami w
 * LEPSZYM ZESPOLE, to potwierdza że a) jego value w Toronto jest realne, b) jego portability jest
 * realne a value w Miami powinno być podobne do tego co w Toronto"): a player who gives up shots
 * next to a star and keeps his efficiency has not become a worse player — the box score just
 * stopped asking him to create. Such a window reads a share of the gap up to the player's own
 * most recent window WITHOUT a star teammate:
 *
 * - star teammate: another player on the same team that season with regular-season BPM2 ≥
 *   `STAR_TEAMMATE_BPM`; the lift scales with the share of the window's seasons that had one;
 * - reduced role: at least `FGA_DROP` fewer shots per game than that earlier window;
 * - efficiency held: TS% no more than `TS_TOLERANCE` below it;
 * - `LIFT_SHARE` of the gap, halved when a season separates the two windows and gone beyond that;
 * - only up to the `MAX_CAREER_SEASON`-th season of a career (age data is not in the pool; fewer
 *   shots later in a career is mostly decline).
 *
 * Raise only; a window already at or above the earlier one is untouched.
 */
const STAR_TEAMMATE_BPM = 5.5;
const FGA_DROP = 2;
const TS_TOLERANCE = 0.02;
const LIFT_SHARE = 0.8;
const GAP_DECAY = 0.5;
/** A player past this season of his career who takes fewer shots is usually declining, not
 * deferring (Millsap in Denver, Mutombo in Houston) — the rule stays with players in their prime. */
const MAX_CAREER_SEASON = 9;

let teamStars: Map<string, { key: string; bpm: number }[]> | null = null;
let teamOf: Map<string, string> | null = null;
let firstSeason: Map<string, number> | null = null;
let spansByPlayer: Map<string, PlayerSpan[]> | null = null;

function index() {
  if (teamStars && teamOf && spansByPlayer && firstSeason) return { teamStars, teamOf, spansByPlayer, firstSeason };
  teamOf = new Map();
  firstSeason = new Map();
  for (const [name, m] of Object.entries(careerData as Record<string, { seasons: { seasonEnd: number; team: string }[] }>)) {
    const key = normalizePlayerName(name);
    for (const s of m.seasons) {
      teamOf.set(`${key}|${s.seasonEnd}`, s.team);
      firstSeason.set(key, Math.min(firstSeason.get(key) ?? Infinity, s.seasonEnd));
    }
  }
  teamStars = new Map();
  for (const r of rsData as { name: string; season: string; bpm: number }[]) {
    if (r.bpm < STAR_TEAMMATE_BPM) continue;
    const year = seasonEndYearOf(r.season);
    const key = resolveSourceName(r.name, year);
    const team = teamOf.get(`${key}|${year}`);
    if (!team) continue;
    const list = teamStars.get(`${year}|${team}`) ?? [];
    list.push({ key, bpm: r.bpm });
    teamStars.set(`${year}|${team}`, list);
  }
  spansByPlayer = new Map();
  for (const span of players) {
    const key = normalizePlayerName(span.playerName);
    const list = spansByPlayer.get(key) ?? [];
    list.push(span);
    spansByPlayer.set(key, list);
  }
  return { teamStars, teamOf, spansByPlayer, firstSeason };
}

function starSeasonShare(span: PlayerSpan): number {
  const { teamStars, teamOf } = index();
  const key = normalizePlayerName(span.playerName);
  const years = spanEndYears(span.spanLabel);
  if (!years.length) return 0;
  const withStar = years.filter((year) => {
    const team = teamOf.get(`${key}|${year}`);
    return team !== undefined && (teamStars.get(`${year}|${team}`) ?? []).some((s) => s.key !== key);
  });
  return withStar.length / years.length;
}

export interface ReducedRoleReference {
  /** The player's most recent earlier window without a star teammate. */
  prior: PlayerSpan;
  /** Share (0-1) of the gap to `prior` this window is lifted by. */
  weight: number;
}

const cache = new Map<string, ReducedRoleReference | null>();
export function reducedRoleReference(span: PlayerSpan): ReducedRoleReference | null {
  const hit = cache.get(span.id);
  if (hit !== undefined) return hit;
  let result: ReducedRoleReference | null = null;
  const share = starSeasonShare(span);
  const years = spanEndYears(span.spanLabel);
  const start = years.length ? Math.min(...years) : 0;
  const rookieYear = index().firstSeason.get(normalizePlayerName(span.playerName));
  if (share > 0 && rookieYear !== undefined && start - rookieYear + 1 <= MAX_CAREER_SEASON) {
    const prior = (index().spansByPlayer.get(normalizePlayerName(span.playerName)) ?? [])
      .filter((s) => {
        const y = spanEndYears(s.spanLabel);
        return y.length > 0 && Math.max(...y) < start && starSeasonShare(s) === 0;
      })
      .sort((a, b) => Math.max(...spanEndYears(b.spanLabel)) - Math.max(...spanEndYears(a.spanLabel)))[0];
    if (prior && span.fga <= prior.fga - FGA_DROP && span.box.tsPct >= prior.box.tsPct - TS_TOLERANCE) {
      const gap = start - Math.max(...spanEndYears(prior.spanLabel));
      const weight = LIFT_SHARE * share * Math.max(0, 1 - (gap - 1) * GAP_DECAY);
      if (weight > 0) result = { prior, weight };
    }
  }
  cache.set(span.id, result);
  return result;
}

/** `value` lifted toward what the same measure reads for the reference window (raise only). */
export function liftForReducedRole(span: PlayerSpan, value: number, measure: (s: PlayerSpan) => number): number {
  const ref = reducedRoleReference(span);
  if (!ref) return value;
  const target = measure(ref.prior);
  return target > value ? value + (target - value) * ref.weight : value;
}
