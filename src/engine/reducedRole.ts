import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { players } from '../data/players';
import { resolveSourceName, seasonEndYearOf } from '../data/sourceNameResolver';
import { spanEndYears } from './era';
import { envVar } from './env';
import { realSpan } from './realAdvancedLookup';
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
const MAX_CAREER_SEASON = Number(envVar('RR_MAX_SEASON') ?? 9);
/** 2026-11-27 (the user: "jeśli gracz w mniejszej roli jest taki sam, mając wcześniej potwierdzenie… czy
 * powinniśmy go karać?" — Durant in Golden State, his OKC windows had Westbrook): `RR_ANY=1` lets the
 * earlier window have a star teammate too — what counts is that he carried more shots there. 0 = off. */
const RR_ANY = (envVar('RR_ANY') ?? '0') === '1';
/** 2026-11-27 (Durant: 38.5 → 33.8 minutes, 28 points a 36 in both): `RR_PER36=1` reads the reduced role
 * from minutes too (`MPG_DROP` fewer, or `FGA_DROP` fewer shots) with points a 36 held within `PTS36_TOL`,
 * and lets the earlier window sit up to `RR_GAP` seasons back (linear fade). 0 = off. */
const RR_PER36 = (envVar('RR_PER36') ?? '0') === '1';
const MPG_DROP = 3;
const PTS36_TOL = 1.5;
const RR_GAP = Number(envVar('RR_GAP') ?? 4);
const mpgOf = (s: PlayerSpan) => realSpan(s)?.mpg ?? 34;
const pts36 = (s: PlayerSpan) => (s.box.ppg * 36) / Math.max(10, mpgOf(s));

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
function reducedRoleReference(span: PlayerSpan): ReducedRoleReference | null {
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
        return y.length > 0 && Math.max(...y) < start && (RR_ANY ? (RR_PER36 ? s.fga >= span.fga + FGA_DROP || mpgOf(s) >= mpgOf(span) + MPG_DROP : s.fga >= span.fga + FGA_DROP) : starSeasonShare(s) === 0);
      })
      .sort((a, b) => Math.max(...spanEndYears(b.spanLabel)) - Math.max(...spanEndYears(a.spanLabel)))[0];
    const reduced = (p: PlayerSpan) => RR_PER36
      ? (span.fga <= p.fga - FGA_DROP || mpgOf(span) <= mpgOf(p) - MPG_DROP) && pts36(span) >= pts36(p) - PTS36_TOL
      : span.fga <= p.fga - FGA_DROP;
    if (prior && reduced(prior) && span.box.tsPct >= prior.box.tsPct - TS_TOLERANCE) {
      const gap = start - Math.max(...spanEndYears(prior.spanLabel));
      const weight = LIFT_SHARE * share * (RR_PER36 ? Math.max(0, 1 - (gap - 1) / RR_GAP) : Math.max(0, 1 - (gap - 1) * GAP_DECAY));
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
