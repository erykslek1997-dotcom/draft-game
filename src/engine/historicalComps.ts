import { computeOffensiveTalent } from './talent';
import { effectiveTalent } from './grades';
import { primaryStarters } from './rotation';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { offenseScoreBreakdown, type ScoreBreakdown } from './scoring';
import type { FitScoreResult } from './fit';
import type { Team } from './types';
import quantiles from '../data/teamStyleQuantiles.json';

/**
 * 2026-09-25, the user ("drużyna podobna do X może mieć tag 'Plays like 2004 Detroit Pistons'"):
 * a "Plays like" comp against real historical teams, alongside the style tags. Each team is read
 * as a handful of features the engine already computes, each turned into a PERCENTILE against
 * seeded AI-drafted rosters (`teamStyleQuantiles.json`, `scripts/buildTeamStyleQuantiles.ts`) —
 * raw scores sit on different scales (Offense averages ~85, Defense ~72), percentiles don't. A
 * profile names only the features that define that team (the 2004 Pistons are elite defense, no
 * star scorer, mediocre offense) and the match is 100 minus the RMS percentile gap over them.
 */
export type StyleFeature =
  | 'offense' | 'defense' | 'spacing' | 'rimPressure' | 'playmaking' | 'creation'
  | 'primaryCreation' | 'switchability' | 'rebounding' | 'size' | 'rimProtectors'
  | 'topStar' | 'starCount' | 'bigPlaymaking';

export const STYLE_FEATURES: readonly StyleFeature[] = [
  'offense', 'defense', 'spacing', 'rimPressure', 'playmaking', 'creation', 'primaryCreation',
  'switchability', 'rebounding', 'size', 'rimProtectors', 'topStar', 'starCount', 'bigPlaymaking',
];

export function teamStyleFeatures(team: Team, breakdown: ScoreBreakdown, fit: FitScoreResult): Record<StyleFeature, number> {
  const starters = primaryStarters(team).map((entry) => entry.player);
  const offense = offenseScoreBreakdown(team);
  const bigs = starters.filter((p) => p.primaryPosition === 'PF' || p.primaryPosition === 'C');
  return {
    offense: breakdown.offenseScore,
    defense: breakdown.defenseScore,
    spacing: breakdown.spacingScore,
    rimPressure: fit.components.rimPressureTeam,
    playmaking: offense.playmaking,
    creation: fit.components.creationStructure,
    primaryCreation: fit.inputs.primaryCreationSignal,
    switchability: fit.inputs.switchability,
    rebounding: fit.components.reboundingBalance,
    size: fit.components.sizeCoverage,
    rimProtectors: starters.filter((p) => p.defensiveRole === 'Anchor Big' || p.defensiveRole === 'Mobile Big').length,
    topStar: Math.max(0, ...starters.map(computeOffensiveTalent)),
    starCount: starters.filter((p) => effectiveTalent(p) >= 85).length,
    bigPlaymaking: Math.max(0, ...bigs.map((p) => playmakingScoreForPlayer(p) ?? 0)),
  };
}

const QUANTILES = quantiles as Record<StyleFeature, number[]>;

/** Percentile (0-100) of `value` in the baked distribution, interpolated between quantile knots. */
export function featurePercentile(feature: StyleFeature, value: number): number {
  const q = QUANTILES[feature];
  if (!q || q.length < 2) return 50;
  const step = 100 / (q.length - 1);
  if (value < q[0]) return 0;
  if (value > q[q.length - 1]) return 100;
  // Ties (count features like rimProtectors) read as the middle of the tied band.
  let lo = 0;
  while (lo < q.length - 1 && q[lo + 1] < value) lo++;
  let hi = lo + 1;
  while (hi < q.length - 1 && q[hi + 1] <= value) hi++;
  if (q[hi] === value) {
    let first = hi;
    while (first > 0 && q[first - 1] === value) first--;
    return ((first + hi) / 2) * step;
  }
  const t = (value - q[lo]) / (q[hi] - q[lo]);
  return (lo + t * (hi - lo)) * step;
}

export interface HistoricalComp {
  id: string;
  team: string;
  blurb: string;
  /** Target percentiles for the features that define this team; the rest are ignored. */
  profile: Partial<Record<StyleFeature, number>>;
}

export const HISTORICAL_COMPS: readonly HistoricalComp[] = [
  { id: 'pistons-2004', team: '2004 Detroit Pistons', blurb: 'elite team defense, no superstar scorer', profile: { defense: 95, offense: 35, topStar: 15, switchability: 75, starCount: 20 } },
  { id: 'bulls-1996', team: '1996 Chicago Bulls', blurb: 'an alpha scorer on top of an elite defense', profile: { defense: 90, offense: 85, topStar: 99, primaryCreation: 95, switchability: 80 } },
  { id: 'lakers-1987', team: '1987 Showtime Lakers', blurb: 'fast-break passing and pressure at the rim', profile: { offense: 95, playmaking: 99, rimPressure: 90, creation: 95 } },
  { id: 'pistons-1989', team: '1989 Bad Boys Pistons', blurb: 'physical defense and the glass, little shooting', profile: { defense: 90, rebounding: 90, spacing: 25, offense: 45 } },
  { id: 'suns-2005', team: '2005 Phoenix Suns', blurb: 'pace, space and a passing engine', profile: { spacing: 95, playmaking: 95, offense: 90, defense: 30 } },
  { id: 'spurs-1999', team: '1999 San Antonio Spurs', blurb: 'two towers owning the paint', profile: { rimProtectors: 99, size: 95, rebounding: 90, defense: 90, spacing: 35 } },
  { id: 'spurs-2014', team: '2014 San Antonio Spurs', blurb: 'the ball moves, nobody dominates it', profile: { playmaking: 85, creation: 90, spacing: 85, topStar: 35, starCount: 80 } },
  { id: 'rockets-2018', team: '2018 Houston Rockets', blurb: 'one heliocentric creator and a ring of shooters', profile: { primaryCreation: 99, spacing: 95, topStar: 95, rimProtectors: 35 } },
  { id: 'warriors-2016', team: '2016 Golden State Warriors', blurb: 'switch everything, shoot everything', profile: { spacing: 99, switchability: 95, offense: 95, rimProtectors: 10 } },
  { id: 'lakers-2001', team: '2001 Los Angeles Lakers', blurb: 'a dominant big and a star wing', profile: { topStar: 95, rimProtectors: 85, size: 90, offense: 80, spacing: 35 } },
  { id: 'clippers-2014', team: '2014 LA Clippers', blurb: 'a pass-first point guard feeding the rim', profile: { rimPressure: 95, playmaking: 95, rebounding: 70 } },
  { id: 'grizzlies-2013', team: '2013 Memphis Grizzlies', blurb: 'grind-it-out defense and bully bigs', profile: { defense: 85, rebounding: 95, spacing: 10, offense: 30, size: 90 } },
  { id: 'heat-2013', team: '2013 Miami Heat', blurb: 'star creators and a switching, swarming defense', profile: { switchability: 85, primaryCreation: 95, rimPressure: 90, defense: 80, starCount: 90 } },
  { id: 'rockets-1994', team: '1994 Houston Rockets', blurb: 'a post hub surrounded by shooters', profile: { rimProtectors: 80, spacing: 75, primaryCreation: 70, bigPlaymaking: 80, defense: 80 } },
  { id: 'celtics-2008', team: '2008 Boston Celtics', blurb: 'three stars buying into defense', profile: { defense: 97, starCount: 95, spacing: 70, offense: 70 } },
  { id: 'nuggets-2023', team: '2023 Denver Nuggets', blurb: 'offense run through a passing big', profile: { bigPlaymaking: 99, playmaking: 90, offense: 90, spacing: 70 } },
  // 2026-09-26, the user ("można zwiększyć"): twelve more, each defined by a feature mix none of
  // the sixteen above already uses as its core.
  { id: 'bucks-1971', team: '1971 Milwaukee Bucks', blurb: 'a dominant big fed by a great passer', profile: { topStar: 99, playmaking: 85, rimProtectors: 80, offense: 90 } },
  { id: 'knicks-1970', team: '1970 New York Knicks', blurb: 'team defense and the extra pass, no one star', profile: { playmaking: 85, defense: 90, switchability: 80, topStar: 30 } },
  { id: 'blazers-1977', team: '1977 Portland Trail Blazers', blurb: 'a passing center anchoring both ends', profile: { bigPlaymaking: 95, defense: 80, rebounding: 85, topStar: 30 } },
  { id: 'sixers-1983', team: '1983 Philadelphia 76ers', blurb: 'athletes attacking the rim and owning the glass', profile: { defense: 90, rimPressure: 90, rebounding: 90, size: 85, spacing: 25 } },
  { id: 'celtics-1986', team: '1986 Boston Celtics', blurb: 'a passing frontcourt with stars at every spot', profile: { offense: 90, defense: 80, bigPlaymaking: 90, playmaking: 90, starCount: 90 } },
  { id: 'magic-1995', team: '1995 Orlando Magic', blurb: 'a force in the paint and shooters around him', profile: { topStar: 90, rimPressure: 90, spacing: 85, defense: 35 } },
  { id: 'jazz-1998', team: '1998 Utah Jazz', blurb: 'pick-and-roll precision over star power', profile: { playmaking: 95, offense: 80, rebounding: 75, starCount: 35, spacing: 60 } },
  { id: 'mavericks-2011', team: '2011 Dallas Mavericks', blurb: 'a stretch-big star and a floor full of shooters', profile: { spacing: 92, topStar: 85, rimProtectors: 45, defense: 60 } },
  { id: 'thunder-2012', team: '2012 Oklahoma City Thunder', blurb: 'young scorers who get downhill', profile: { topStar: 95, rimPressure: 90, starCount: 90, playmaking: 40, defense: 70 } },
  { id: 'raptors-2019', team: '2019 Toronto Raptors', blurb: 'long, switching defenders around one closer', profile: { defense: 85, switchability: 85, spacing: 75, starCount: 45 } },
  { id: 'lakers-2020', team: '2020 Los Angeles Lakers', blurb: 'a point forward and two bigs walling off the rim', profile: { size: 95, rimProtectors: 90, playmaking: 90, defense: 90, spacing: 30 } },
  { id: 'bucks-2021', team: '2021 Milwaukee Bucks', blurb: 'size and downhill force at every position', profile: { rimPressure: 95, size: 85, defense: 85, spacing: 55 } },
];

export interface HistoricalCompMatch {
  comp: HistoricalComp;
  /** 0-100 — 100 minus the RMS percentile gap over the comp's defining features. */
  match: number;
}

const COMP_TEAM_CODES: Record<string, string> = {
  pistons: 'DET', bulls: 'CHI', lakers: 'LAL', suns: 'PHX', spurs: 'SAS', rockets: 'HOU', warriors: 'GSW',
  clippers: 'LAC', grizzlies: 'MEM', heat: 'MIA', celtics: 'BOS', nuggets: 'DEN', bucks: 'MIL', knicks: 'NYK',
  blazers: 'POR', sixers: 'PHI', magic: 'ORL', jazz: 'UTA', mavericks: 'DAL', thunder: 'OKC', raptors: 'TOR',
};

/** Franchise code and season for a comp's team badge (`TeamTile`), from its id ("pistons-2004"). */
export function compBadge(comp: HistoricalComp): { code: string; seasonEnd: number } | null {
  const [nickname, year] = comp.id.split('-');
  const code = COMP_TEAM_CODES[nickname];
  return code && Number(year) ? { code, seasonEnd: Number(year) } : null;
}

/** Below this, no comp is shown — the roster doesn't look like any of them. */
export const HISTORICAL_COMP_MIN_MATCH = 70;

const TOP_PERCENTILE = Object.fromEntries(
  STYLE_FEATURES.map((f) => {
    const q = QUANTILES[f];
    if (!q || q.length < 2) return [f, 100];
    const top = q[q.length - 1];
    const first = q.indexOf(top);
    return [f, first === q.length - 1 ? 100 : ((first + q.length - 1) / 2) * (100 / (q.length - 1))];
  }),
) as Record<StyleFeature, number>;

export function historicalCompsFor(features: Record<StyleFeature, number>): HistoricalCompMatch[] {
  const pct = Object.fromEntries(STYLE_FEATURES.map((f) => [f, featurePercentile(f, features[f])])) as Record<StyleFeature, number>;
  return HISTORICAL_COMPS.map((comp) => {
    const entries = Object.entries(comp.profile) as [StyleFeature, number][];
    // A saturated feature (Rim pressure, Primary creation: a third of rosters read 100) can't reach
    // a top-percentile target — its 100s share one tied band — so the target is capped at the
    // band's own percentile rather than charging every roster the same unreachable gap.
    const rms = Math.sqrt(entries.reduce((sum, [f, target]) => sum + (pct[f] - Math.min(target, TOP_PERCENTILE[f])) ** 2, 0) / entries.length);
    return { comp, match: Math.round(100 - rms) };
  }).sort((a, b) => b.match - a.match);
}

export function bestHistoricalComp(team: Team, breakdown: ScoreBreakdown, fit: FitScoreResult): HistoricalCompMatch | null {
  const best = historicalCompsFor(teamStyleFeatures(team, breakdown, fit))[0];
  return best && best.match >= HISTORICAL_COMP_MIN_MATCH ? best : null;
}
