import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { resolveSourceName, seasonEndYearOf } from '../data/sourceNameResolver';
import { spanEndYears } from './era';
import rsData from '../data/awards/bpm2.json';
import poData from '../data/awards/bpm2Playoffs.json';
import seriesData from '../data/playoffSeriesOutcomes.json';
import teamDefenseData from '../data/awards/teamDefense.json';
import careerData from '../data/cardCareerMetadata.json';
import finalsMvpData from '../data/awards/finalsMvp.json';

/**
 * 2026-09-26, the user's playoffs -> TAL rebuild ("playoffs to jednak ważny element sezonu";
 * "nawet jeśli Malone byłby tak samo karany, to przydałoby się odzwierciedlenie w ocenie offense i
 * defense"). Replaces the TS%-only ±5 term (`playoffPerformanceLookup.ts`, 59% coverage, scoring
 * efficiency only, plus binary -2/-4 tier caps and six named exceptions) with playoff BPM2 split
 * into offense and defense:
 *
 * - Per season: playoff OBPM / DBPM minus the regular season's, minus the change EXPECTED for a
 *   player of that regular-season level (a weighted fit over every player-season: stars regress —
 *   an extraordinary +11 season is not punished for landing at +8), and for offense minus the
 *   expected effect of the opponents' defensive strength (rivals reconstructed from each team's
 *   conference bracket in `playoffSeriesOutcomes.json`, strength from `teamDefense.json`, 1997+).
 * - Elite-level shield: a drop is softened as the playoff BPM itself climbs from +4 to +8 — an
 *   elite playoff run against an even more extreme regular season is still an elite run (SGA
 *   2025: +11 -> +8.1 while winning the title).
 * - Seasons weighted by minutes and depth (games / 16), shrunk by `m / (m + 400)` playoff minutes,
 *   scaled to TAL points (`TAL_POINTS_PER_BPM`), capped per side at `MAX_COMPONENT` (reached from
 *   800 playoff minutes; a short run's cap is proportionally lower).
 * - The offense part feeds O-TAL, the defense part D-TAL, both feed TAL; a Finals MVP adds
 *   `FINALS_MVP_POINTS` per season in the window (capped) — team success counts only there, where
 *   the award itself names the player (the project's no-ring-counting rule otherwise stands).
 */
const TAL_POINTS_PER_BPM = 4;
const RELIABILITY_MINUTES = 400;
/** The per-side cap grows with the playoff sample: full `MAX_COMPONENT` from this many minutes. */
const FULL_CAP_MINUTES = 800;
const MAX_COMPONENT = 10;
const MIN_SEASON_MINUTES_FOR_FIT = 150;
const SHIELD_START_BPM = 4;
const SHIELD_FULL_BPM = 8;
const FINALS_MVP_POINTS = 2;
const FINALS_MVP_MAX = 5;
const MERGED_PLAYOFF_YEAR = 2021;

interface RsRow { name: string; season: string; bpm: number; dbpm: number }
interface PoRow { name: string; season: string; games: number; minutes: number; bpm: number; obpm: number; dbpm: number }

let built: {
  rs: Map<string, RsRow>;
  po: Map<string, PoRow>;
  fitO: { a: number; b: number; c: number };
  fitD: { a: number; b: number };
  toughness: Map<string, number>;
  teamOf: Map<string, string>;
  finalsMvp: Set<string>;
} | null = null;

function solve(rows: number[][], y: number[], w: number[]): number[] {
  const n = rows[0].length;
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  rows.forEach((v, i) => {
    for (let a = 0; a < n; a++) {
      b[a] += w[i] * v[a] * y[i];
      for (let c = 0; c < n; c++) S[a][c] += w[i] * v[a] * v[c];
    }
  });
  const M = S.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const roundOf = (label: string) => (label === 'Finals' ? 4 : label.endsWith('Conf Finals') ? 3 : label.endsWith('Semifinals') ? 2 : 1);
const confOf = (label: string) => (label.startsWith('Eastern') ? 'E' : label.startsWith('Western') ? 'W' : '?');
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

function buildToughness(): Map<string, number> {
  const strength = (teamDefenseData as { teamStrength: Record<string, number> }).teamStrength;
  const teams = (seriesData as { season: number; teamCode: string; playoffRoundReached: string }[]).map((x) => ({
    code: x.teamCode, season: x.season, reached: roundOf(x.playoffRoundReached), conf: confOf(x.playoffRoundReached),
  }));
  const out = new Map<string, number>();
  for (const season of new Set(teams.map((t) => t.season))) {
    const st = teams.filter((t) => t.season === season);
    const finalists = st.filter((t) => t.reached === 4);
    for (const f of finalists) {
      for (const c of ['E', 'W']) {
        const hasFinalist = finalists.some((g) => g !== f && g.conf === c);
        if (f.conf === '?' && !hasFinalist && st.some((t) => t.conf === c && t.reached === 3)) f.conf = c;
      }
    }
    const leagueAvg = mean(st.map((t) => strength[`${season}|${t.code}`]).filter((v) => v !== undefined));
    if (Number.isNaN(leagueAvg)) continue;
    for (const t of st) {
      const opp: number[] = [];
      for (let r = 1; r <= Math.min(t.reached, 3); r++) {
        const conf = st.filter((u) => u.conf === t.conf && u !== t);
        const pool = t.reached > r ? conf.filter((u) => u.reached === r) : conf.filter((u) => u.reached > r);
        const v = mean(pool.map((u) => strength[`${season}|${u.code}`]).filter((x) => x !== undefined));
        if (!Number.isNaN(v)) opp.push(v);
      }
      if (t.reached === 4) {
        const other = finalists.find((g) => g !== t);
        const v = other ? strength[`${season}|${other.code}`] : undefined;
        if (v !== undefined) opp.push(v);
      }
      if (opp.length) out.set(`${season}|${t.code}`, mean(opp) - leagueAvg);
    }
  }
  return out;
}

function data() {
  if (built) return built;
  const rs = new Map<string, RsRow>();
  for (const r of rsData as RsRow[]) {
    const y = seasonEndYearOf(r.season);
    rs.set(`${resolveSourceName(r.name, y)}|${y}`, r);
  }
  const po = new Map<string, PoRow>();
  for (const r of poData as PoRow[]) {
    const y = seasonEndYearOf(r.season);
    po.set(`${resolveSourceName(r.name, y)}|${y}`, r);
    // The source has no 2019-20 rows: its '2020-21' rows hold the 2020 bubble and the 2021
    // playoffs together (LeBron: 27 games = 21 + 6). Serve that row for both years; a window
    // holding both counts it once (`playoffImpactForSpan`).
    if (y === MERGED_PLAYOFF_YEAR) po.set(`${resolveSourceName(r.name, y - 1)}|${y - 1}`, r);
  }
  const teamOf = new Map<string, string>();
  for (const [name, m] of Object.entries(careerData as Record<string, { seasons: { seasonEnd: number; team: string }[] }>)) {
    for (const s of m.seasons) teamOf.set(`${normalizePlayerName(name)}|${s.seasonEnd}`, s.team);
  }
  const toughness = buildToughness();
  const toughFor = (key: string, year: number) => {
    const team = teamOf.get(`${key}|${year}`);
    return team ? toughness.get(`${year}|${team}`) ?? 0 : 0;
  };
  const xo: number[][] = [], yo: number[] = [], xd: number[][] = [], yd: number[] = [], w: number[] = [];
  for (const [key, p] of po) {
    const r = rs.get(key);
    const [name, year] = key.split('|');
    if (!r || p.minutes < MIN_SEASON_MINUTES_FOR_FIT || Number(year) === MERGED_PLAYOFF_YEAR - 1) continue;
    const rsO = r.bpm - r.dbpm;
    xo.push([1, rsO, toughFor(name, Number(year))]);
    yo.push(p.obpm - rsO);
    xd.push([1, r.dbpm]);
    yd.push(p.dbpm - r.dbpm);
    w.push(p.minutes);
  }
  const [oa, ob, oc] = solve(xo, yo, w);
  const [da, db] = solve(xd, yd, w);
  const finalsMvp = new Set(
    (finalsMvpData as { winners: { season: number; name: string }[] }).winners.map(
      (f) => `${resolveSourceName(f.name, f.season)}|${f.season}`,
    ),
  );
  built = { rs, po, fitO: { a: oa, b: ob, c: oc }, fitD: { a: da, b: db }, toughness, teamOf, finalsMvp };
  return built;
}

export interface PlayoffImpact {
  /** TAL points added to O-TAL (and TAL). */
  offense: number;
  /** TAL points added to D-TAL (and TAL). */
  defense: number;
  /** TAL points for Finals MVP seasons in the window. */
  finalsMvp: number;
  playoffMinutes: number;
}

const cache = new Map<string, PlayoffImpact>();
export function playoffImpactForSpan(span: PlayerSpan): PlayoffImpact {
  const key = normalizePlayerName(span.playerName);
  const cacheKey = `${key}|${span.spanLabel}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const d = data();
  let sumO = 0, sumD = 0, weight = 0, minutes = 0, mvps = 0;
  const used = new Set<PoRow>();
  for (const year of spanEndYears(span.spanLabel)) {
    if (d.finalsMvp.has(`${key}|${year}`)) mvps++;
    const p = d.po.get(`${key}|${year}`);
    const r = d.rs.get(`${key}|${year}`) ?? (year === MERGED_PLAYOFF_YEAR - 1 ? d.rs.get(`${key}|${year + 1}`) : undefined);
    if (!p || !r || used.has(p)) continue;
    used.add(p);
    const rsO = r.bpm - r.dbpm;
    const team = d.teamOf.get(`${key}|${year}`);
    const tough = team ? d.toughness.get(`${year}|${team}`) ?? 0 : 0;
    let resO = p.obpm - rsO - (d.fitO.a + d.fitO.b * rsO + d.fitO.c * tough);
    let resD = p.dbpm - r.dbpm - (d.fitD.a + d.fitD.b * r.dbpm);
    const shield = Math.max(0, Math.min(1, (p.bpm - SHIELD_START_BPM) / (SHIELD_FULL_BPM - SHIELD_START_BPM)));
    if (resO < 0) resO *= 1 - shield;
    if (resD < 0) resD *= 1 - shield;
    const seasonWeight = p.minutes * (0.5 + 0.5 * Math.min(1, p.games / 16));
    sumO += resO * seasonWeight;
    sumD += resD * seasonWeight;
    weight += seasonWeight;
    minutes += p.minutes;
  }
  const reliability = minutes / (minutes + RELIABILITY_MINUTES);
  const cap = MAX_COMPONENT * Math.min(1, minutes / FULL_CAP_MINUTES);
  const clampSide = (v: number) => Math.max(-cap, Math.min(cap, v));
  const result: PlayoffImpact = {
    offense: weight > 0 ? clampSide((sumO / weight) * reliability * TAL_POINTS_PER_BPM) : 0,
    defense: weight > 0 ? clampSide((sumD / weight) * reliability * TAL_POINTS_PER_BPM) : 0,
    finalsMvp: Math.min(FINALS_MVP_MAX, mvps * FINALS_MVP_POINTS),
    playoffMinutes: Math.round(minutes),
  };
  cache.set(cacheKey, result);
  return result;
}

/** Everything the playoffs add to TAL: both sides plus the Finals MVP credit. */
export function playoffTalentTerm(span: PlayerSpan): number {
  const p = playoffImpactForSpan(span);
  return p.offense + p.defense + p.finalsMvp;
}
