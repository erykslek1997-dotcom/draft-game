/**
 * 2026-11-11, the daily leaderboard's points (the user agreed to try: about half for the draft,
 * half for the season, a streak bonus, Mini on its own table). Places and the margin over the day's
 * median rather than raw Overall, because the day's rule and cap move the whole league's level.
 *
 * All-Time / Bomb, up to 100: draft place (40 down to 4) + Overall over the league median (up to
 * +10) + regular season (win share × 25) + playoffs (Champions 22 … missed 0). Mini (no season),
 * up to 100: the draft part doubled. Plus +2 for every day of the current streak after the first,
 * up to +10.
 */

/** 1st 40, 2nd 34, 3rd 30, then evenly down to 4 for last (2 a place in a 16-team league). */
export function placePoints(place: number, field: number): number {
  if (place <= 1) return 40;
  if (place === 2) return 34;
  if (place === 3) return 30;
  const step = field > 3 ? 26 / (field - 3) : 0;
  return Math.max(4, Math.round((30 - (place - 3) * step) * 10) / 10);
}

export function overPoints(overall: number, median: number | undefined): number {
  if (median === undefined) return 0;
  return Math.round(Math.max(0, Math.min(10, overall - median)) * 10) / 10;
}

const PLAYOFF_POINTS: [RegExp, number][] = [
  [/^Champions/, 22],
  [/Finals$/, 16],
  [/Semifinals$/, 10],
  [/Quarterfinals$|first round|round/i, 5],
];
export function seasonPoints(wins: number, losses: number, playoffs: string): number {
  const games = wins + losses;
  const regular = games > 0 ? (wins / games) * 25 : 0;
  const post = PLAYOFF_POINTS.find(([re]) => re.test(playoffs))?.[1] ?? 0;
  return Math.round((regular + post) * 10) / 10;
}

export function streakBonus(streak: number): number {
  return Math.min(10, Math.max(0, streak - 1) * 2);
}

export interface PointsBreakdown {
  draft: number;
  season: number;
  streak: number;
  total: number;
}

export function dailyPoints(input: {
  mode: 'mini' | 'alltime' | 'bomb';
  place: number;
  field: number;
  overall: number;
  median?: number;
  season?: { wins: number; losses: number; playoffs: string };
  streak: number;
}): PointsBreakdown {
  const draftRaw = placePoints(input.place, input.field) + overPoints(input.overall, input.median);
  const draft = input.mode === 'mini' ? draftRaw * 2 : draftRaw;
  const season = input.mode !== 'mini' && input.season ? seasonPoints(input.season.wins, input.season.losses, input.season.playoffs) : 0;
  const streak = streakBonus(input.streak);
  const round = (n: number) => Math.round(n * 10) / 10;
  return { draft: round(draft), season: round(season), streak, total: round(draft + season + streak) };
}

export function medianOf(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
