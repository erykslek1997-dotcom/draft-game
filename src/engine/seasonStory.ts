import type { BoxLineStats } from './liveGame';
import type { LiveSeasonResult } from './liveSeason';
import type { InsightCategory, RosterInsight } from './insights';

/**
 * 2026-10-09, descriptions plan ("Akcept"): the season told in a few hard facts, and the draft's
 * report held up against it. Only what stands out — a top-three or bottom-three place in the league
 * — and at most one sentence per subject. The report's lines are checked against the stat their
 * subject is about: "the Analyst worried about your bigs' shooting" meets the team's threes.
 */
export interface StoryStat {
  key: 'offense' | 'defense' | 'threes' | 'boards' | 'bench' | 'close';
  /** League place, 1 = best for this team. */
  place: number;
  of: number;
  value: number;
  text: string;
}

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const f1 = (n: number) => n.toFixed(1);
const poss = (b: BoxLineStats) => b.fga + 0.44 * b.fta + b.tov;

function teamStats(season: LiveSeasonResult) {
  return season.teamSeasons.map((t) => {
    const g = Math.max(1, t.games);
    const bench = season.players.filter((l) => l.teamId === t.teamId && !l.starter).reduce((s, l) => s + l.totals.pts, 0) / g;
    return {
      id: t.teamId,
      offense: (100 * t.for.pts) / Math.max(1, poss(t.for)),
      defense: (100 * t.against.pts) / Math.max(1, poss(t.against)),
      threes: t.for.tpa / g,
      threePct: t.for.tpm / Math.max(1, t.for.tpa),
      boards: (t.for.reb - t.against.reb) / g,
      bench,
      closeW: t.closeWins,
      closeL: t.closeLosses,
    };
  });
}

/** Every story stat for one team, with its league place (1 = best for the team). */
export function storyStats(season: LiveSeasonResult, teamId: string): StoryStat[] {
  const all = teamStats(season);
  const me = all.find((t) => t.id === teamId);
  if (!me) return [];
  const n = all.length;
  const placeOf = (value: (t: (typeof all)[number]) => number, lowerIsBetter = false) =>
    1 + all.filter((t) => (lowerIsBetter ? value(t) < value(me) : value(t) > value(me))).length;
  const closeGames = me.closeW + me.closeL;
  const closePct = (t: (typeof all)[number]) => (t.closeW + 0.5) / (t.closeW + t.closeL + 1);
  return [
    { key: 'offense', place: placeOf((t) => t.offense), of: n, value: me.offense, text: `${f1(me.offense)} points per 100 possessions` },
    { key: 'defense', place: placeOf((t) => t.defense, true), of: n, value: me.defense, text: `${f1(me.defense)} allowed per 100 possessions` },
    { key: 'threes', place: placeOf((t) => t.threes), of: n, value: me.threes, text: `${f1(me.threes)} threes a game at ${f1(100 * me.threePct)}%` },
    { key: 'boards', place: placeOf((t) => t.boards), of: n, value: me.boards, text: `${me.boards >= 0 ? '+' : ''}${f1(me.boards)} rebounds a game` },
    { key: 'bench', place: placeOf((t) => t.bench), of: n, value: me.bench, text: `${f1(me.bench)} points a night from the bench` },
    ...(closeGames >= 6
      ? [{ key: 'close' as const, place: placeOf(closePct), of: n, value: closePct(me), text: `${me.closeW}-${me.closeL} in games decided by five or fewer` }]
      : []),
  ];
}

const STANDS_OUT = 3;
const isTop = (s: StoryStat) => s.place <= STANDS_OUT;
const isBottom = (s: StoryStat) => s.place > s.of - STANDS_OUT;

/** Which story stat a report line's subject is about. */
const SUBJECT: Partial<Record<InsightCategory, StoryStat['key']>> = {
  spacing: 'threes',
  shooting: 'threes',
  rebounding: 'boards',
  perimeter_defense: 'defense',
  rim_protection: 'defense',
  defensive_structure: 'defense',
  creation: 'offense',
  usage: 'offense',
  depth: 'bench',
  rotation: 'bench',
};

const SUBJECT_NAME: Record<StoryStat['key'], string> = {
  offense: 'the offense',
  defense: 'the defense',
  threes: 'the shooting',
  boards: 'the rebounding',
  bench: 'the bench',
  close: 'the late-game five',
};

/**
 * The season in 2-4 sentences: the draft report's calls that the season settled (a warning that
 * came true or never showed, a strength that held), then what stood out on its own.
 */
export function seasonStory(season: LiveSeasonResult, teamId: string, report: RosterInsight[] = []): string[] {
  const stats = storyStats(season, teamId);
  const byKey = new Map(stats.map((s) => [s.key, s]));
  const used = new Set<StoryStat['key']>();
  const out: string[] = [];

  for (const line of report) {
    const key = SUBJECT[line.category];
    if (!key || used.has(key)) continue;
    const s = byKey.get(key);
    if (!s || !(isTop(s) || isBottom(s))) continue;
    const where = `${ord(s.place)} of ${s.of}`;
    if (line.type === 'concern') {
      out.push(
        isBottom(s)
          ? `The Analyst's warning about ${SUBJECT_NAME[key]} came true: ${s.text}, ${where}.`
          : `The worry about ${SUBJECT_NAME[key]} never showed: ${s.text}, ${where}.`,
      );
    } else {
      out.push(
        isTop(s)
          ? `The Coach was right about ${SUBJECT_NAME[key]}: ${s.text}, ${where}.`
          : `${SUBJECT_NAME[key][0].toUpperCase()}${SUBJECT_NAME[key].slice(1)} didn't hold up the way the draft said: ${s.text}, ${where}.`,
      );
    }
    used.add(key);
    if (out.length >= 2) break;
  }

  // What stood out on its own: the best and the worst place left, best first.
  const rest = stats.filter((s) => !used.has(s.key) && (isTop(s) || isBottom(s))).sort((a, b) => a.place - b.place);
  const best = rest.find(isTop);
  const worst = [...rest].reverse().find(isBottom);
  if (best) out.push(best.place === 1 ? `Best in the league in one thing: ${best.text}.` : `${best.text[0].toUpperCase()}${best.text.slice(1)}, ${ord(best.place)} in the league.`);
  if (worst && out.length < 4) out.push(`The weak spot: ${worst.text}, ${ord(worst.place)} of ${worst.of}.`);
  return out.slice(0, 4);
}

/** What your side's strength meets on theirs: offense against their defense and back, boards against boards. */
const OPPOSITE: Partial<Record<StoryStat['key'], StoryStat['key']>> = { offense: 'defense', defense: 'offense', threes: 'defense', boards: 'boards' };

/**
 * Two sentences before a series: the opponent's best weapon against what you have for it, and
 * yours against theirs. Places only, so the numbers can be checked in the standings.
 */
export function seriesPreview(season: LiveSeasonResult, youId: string, oppId: string): string[] {
  const mine = new Map(storyStats(season, youId).map((s) => [s.key, s]));
  const theirs = new Map(storyStats(season, oppId).map((s) => [s.key, s]));
  const best = (stats: Map<StoryStat['key'], StoryStat>, skip: StoryStat['key'][]) =>
    [...stats.values()].filter((s) => s.key in OPPOSITE && !skip.includes(s.key)).sort((a, b) => a.place - b.place)[0];
  const name = (key: StoryStat['key']) => SUBJECT_NAME[key].replace('the ', '');
  const out: string[] = [];
  const theirBest = best(theirs, []);
  const used: StoryStat['key'][] = [];
  if (theirBest) {
    const counter = mine.get(OPPOSITE[theirBest.key]!);
    out.push(
      `Their weapon is ${SUBJECT_NAME[theirBest.key]}: ${theirBest.text}, ${ord(theirBest.place)} in the league.${counter ? ` Against it, your ${name(counter.key)} (${ord(counter.place)}).` : ''}`,
    );
    // That matchup is told; your own best weapon is a different one.
    if (counter) used.push(counter.key);
  }
  const yourBest = best(mine, used);
  if (yourBest) {
    const counter = theirs.get(OPPOSITE[yourBest.key]!);
    out.push(`Yours is ${SUBJECT_NAME[yourBest.key]}: ${yourBest.text}, ${ord(yourBest.place)}${counter ? `, against their ${name(counter.key)} (${ord(counter.place)})` : ''}.`);
  }
  return out;
}

/** One sentence once a series is over: how it was won or lost. Margins from your side. */
export function seriesVerdict(finals: [number, number][], youWon: boolean): string {
  const margins = finals.map(([a, b]) => a - b);
  const wins = margins.filter((m) => m > 0).length;
  const losses = margins.length - wins;
  const avg = margins.reduce((s, m) => s + m, 0) / Math.max(1, margins.length);
  const close = margins.filter((m) => Math.abs(m) <= 5).length;
  const record = youWon ? `${wins}-${losses}` : `${losses}-${wins}`;
  if (youWon) {
    return close >= 2
      ? `Won ${record}, the hard way: ${close} of the ${margins.length} games were decided by five or fewer.`
      : `Won ${record}, by ${f1(Math.abs(avg))} points a game.`;
  }
  return close >= 2
    ? `Lost ${record}. ${close} of the ${margins.length} games came down to five points or fewer.`
    : `Lost ${record}, outscored by ${f1(Math.abs(avg))} a game.`;
}
