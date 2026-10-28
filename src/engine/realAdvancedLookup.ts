import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
// .pool.json is realAdvanced.json trimmed to players who ever appear in draftPool.json, the same
// trim as raptor.pool.json; scripts that need the whole league import realAdvanced.json.
import realData from '../data/awards/realAdvanced.pool.json';

/**
 * The real advanced numbers of a span's seasons (`scripts/buildRealAdvanced.ts`, 2026-10-28): BBRef
 * Advanced 1973-74 on, NBA.com hustle 2015-16 on, close defense by zone and tracking 2013-14 on,
 * on/off 2007-08 on. Rates (USG%, AST%, STL%, DBPM...) are averaged over the span's seasons
 * weighted by minutes; counts are summed and given a 36 minutes. A field is missing when no season
 * of the span has it. Not read by TAL or the score yet (weeks 2-3, steps 3-8).
 */
export interface RealSeason {
  name: string;
  season: string;
  team?: string;
  g?: number;
  mp?: number;
  [field: string]: string | number | undefined;
}

export interface RealSpan {
  seasons: number;
  games: number;
  minutes: number;
  mpg: number;
  // BBRef, minutes-weighted
  per?: number;
  ts?: number;
  orb?: number;
  drb?: number;
  ast?: number;
  stl?: number;
  blk?: number;
  tov?: number;
  usg?: number;
  obpm?: number;
  dbpm?: number;
  bpm?: number;
  /** Summed over the span. */
  vorp?: number;
  dws?: number;
  // NBA.com hustle, a 36 minutes
  deflections36?: number;
  contests36?: number;
  contests3pt36?: number;
  charges36?: number;
  looseBalls36?: number;
  screenAssists36?: number;
  boxOuts36?: number;
  // Close defense: points of FG% his shooters made below their own norm (positive = good), and attempts a 36
  rimDiff?: number;
  rimAttempts36?: number;
  lt10Diff?: number;
  gt15Diff?: number;
  twoDiff?: number;
  threeDiff?: number;
  overallDiff?: number;
  // Tracking
  drebChancePct?: number;
  drebContestShare?: number;
  touches36?: number;
  possSeconds36?: number;
  milesDef36?: number;
  // On/off, points per 100 (team with him minus without; defense: positive = better without allowing)
  onOffNet?: number;
  onOffOff?: number;
  onOffDef?: number;
}

const byNameSeason = new Map<string, Map<number, RealSeason>>();
for (const r of realData as RealSeason[]) {
  let m = byNameSeason.get(r.name);
  if (!m) byNameSeason.set(r.name, (m = new Map()));
  m.set(parseInt(r.season.slice(0, 4), 10) + 1, r);
}

/** One player-season, by pool name and season end year. */
export function realSeason(playerName: string, endYear: number): RealSeason | undefined {
  return byNameSeason.get(normalizePlayerName(playerName))?.get(endYear);
}

const cache = new Map<string, RealSpan | null>();

export function realSpan(span: PlayerSpan): RealSpan | null {
  const hit = cache.get(span.id);
  if (hit !== undefined) return hit;
  const seasons = spanEndYears(span.spanLabel)
    .map((y) => realSeason(span.playerName, y))
    .filter((s): s is RealSeason => Boolean(s?.mp));
  if (!seasons.length) {
    cache.set(span.id, null);
    return null;
  }
  const n = (s: RealSeason, f: string) => (typeof s[f] === 'number' ? (s[f] as number) : undefined);
  const weighted = (f: string, weight = 'mp') => {
    let sum = 0;
    let w = 0;
    for (const s of seasons) {
      const x = n(s, f);
      const ws = n(s, weight);
      if (x !== undefined && ws) {
        sum += x * ws;
        w += ws;
      }
    }
    return w ? sum / w : undefined;
  };
  const total = (f: string) => {
    const xs = seasons.map((s) => n(s, f)).filter((x): x is number => x !== undefined);
    return xs.length ? xs.reduce((a, b) => a + b, 0) : undefined;
  };
  // Per 36 over the minutes of the seasons that carry the count (`minutesField`).
  const per36 = (f: string, minutesField: string) => {
    let sum = 0;
    let min = 0;
    for (const s of seasons) {
      const x = n(s, f);
      const m = n(s, minutesField);
      if (x !== undefined && m) {
        sum += x;
        min += m;
      }
    }
    return min >= 300 ? (36 * sum) / min : undefined;
  };
  const ratio = (a: string, b: string, scale = 100) => {
    const x = total(a);
    const y = total(b);
    return x !== undefined && y ? (scale * x) / y : undefined;
  };
  const minutes = total('mp')!;
  const games = total('g') ?? 0;
  const out: RealSpan = {
    seasons: seasons.length,
    games,
    minutes,
    mpg: games ? minutes / games : 0,
    per: weighted('per'),
    ts: weighted('ts'),
    orb: weighted('orb'),
    drb: weighted('drb'),
    ast: weighted('ast'),
    stl: weighted('stl'),
    blk: weighted('blk'),
    tov: weighted('tov'),
    usg: weighted('usg'),
    obpm: weighted('obpm'),
    dbpm: weighted('dbpm'),
    bpm: weighted('bpm'),
    vorp: total('vorp'),
    dws: total('dws'),
    deflections36: per36('defl', 'hMin'),
    contests36: per36('contests', 'hMin'),
    contests3pt36: per36('contests3', 'hMin'),
    charges36: per36('charges', 'hMin'),
    looseBalls36: per36('looseBalls', 'hMin'),
    screenAssists36: per36('screenAst', 'hMin'),
    boxOuts36: per36('boxOuts', 'hMin'),
    rimDiff: ratio('rimSaved', 'rimA'),
    rimAttempts36: per36('rimA', 'tMin'),
    lt10Diff: ratio('lt10Saved', 'lt10A'),
    gt15Diff: ratio('gt15Saved', 'gt15A'),
    twoDiff: ratio('2ptSaved', '2ptA'),
    threeDiff: ratio('3ptSaved', '3ptA'),
    overallDiff: ratio('overallSaved', 'overallA'),
    drebChancePct: ratio('dreb', 'drebChances'),
    drebContestShare: ratio('drebContest', 'dreb'),
    touches36: per36('touches', 'tMin'),
    possSeconds36: (() => {
      const m = per36('possTime', 'tMin');
      return m === undefined ? undefined : m * 60;
    })(),
    milesDef36: per36('milesDef', 'tMin'),
  };
  const onOrtg = weighted('onOrtg', 'onMin');
  const onDrtg = weighted('onDrtg', 'onMin');
  const offOrtg = weighted('offOrtg', 'offMin');
  const offDrtg = weighted('offDrtg', 'offMin');
  if (onOrtg !== undefined && offOrtg !== undefined && onDrtg !== undefined && offDrtg !== undefined) {
    out.onOffOff = onOrtg - offOrtg;
    out.onOffDef = offDrtg - onDrtg;
    out.onOffNet = out.onOffOff + out.onOffDef;
  }
  for (const k of Object.keys(out) as (keyof RealSpan)[]) if (out[k] === undefined) delete out[k];
  cache.set(span.id, out);
  return out;
}
