import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Imports Basketball-Reference's historical series table into a compact team-
 * season outcome file. This is deliberately a one-shot data import: the game
 * consumes the generated JSON, while re-running this script refreshes it.
 *
 * Usage: npx tsx scripts/importPlayoffSeries.ts [html-path]
 * If no path is supplied, the current Basketball-Reference page is downloaded.
 */

const SOURCE_URL = 'https://www.basketball-reference.com/playoffs/series.html';
const inputPath = process.argv[2];
const html = inputPath
  ? readFileSync(inputPath, 'utf8')
  : await fetch(SOURCE_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then((r) => {
      if (!r.ok) throw new Error(`Basketball-Reference returned ${r.status}`);
      return r.text();
    });

const text = (value: string) => value
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

interface SeriesRow {
  season: number;
  league: string;
  round: string;
  winner: string;
  winnerCode: string;
  winnerWins: number;
  loser: string;
  loserCode: string;
  loserWins: number;
}

const rows: SeriesRow[] = [];
for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const body = row[1];
  const cell = (stat: string) => body.match(new RegExp(`<[^>]+data-stat=["']${stat}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'))?.[1] ?? '';
  const season = Number(text(cell('season')));
  const league = text(cell('lg'));
  const round = text(cell('series'));
  const winnerCell = cell('winner');
  const loserCell = cell('loser');
  const winner = text(winnerCell).replace(/\s+\(\d+\)$/, '');
  const loser = text(loserCell).replace(/\s+\(\d+\)$/, '');
  const winnerCode = winnerCell.match(/\/teams\/([A-Z0-9]+)\//i)?.[1]?.toUpperCase() ?? '';
  const loserCode = loserCell.match(/\/teams\/([A-Z0-9]+)\//i)?.[1]?.toUpperCase() ?? '';
  const winnerWins = Number(text(cell('wins_winner')));
  const loserWins = Number(text(cell('wins_loser')));
  if (!Number.isInteger(season) || season < 1997 || league !== 'NBA' || !round || !winnerCode || !loserCode) continue;
  rows.push({ season, league, round, winner, winnerCode, winnerWins, loser, loserCode, loserWins });
}

type Outcome = {
  season: number;
  teamCode: string;
  team: string;
  playoffRoundReached: string;
  seriesWins: number;
  seriesLosses: number;
  isChampion: boolean;
  isFinalist: boolean;
  isConferenceFinalist: boolean;
};

const roundRank = (round: string) => round === 'Finals' ? 4 : round.includes('Conf Finals') ? 3 : round.includes('Conf Semifinals') ? 2 : 1;
// Basketball-Reference keeps historical franchise abbreviations; normalize
// the few codes that differ in the team_advanced export used by this project.
const normalizeTeamCode = (code: string) => ({ BRK: 'BKN', CHO: 'CHA', PHO: 'PHX', WSB: 'WAS' } as Record<string, string>)[code] ?? code;
const outcomes = new Map<string, Outcome>();
for (const row of rows) {
  const upsert = (teamCode: string, team: string, wins: number, losses: number, won: boolean) => {
    const key = `${row.season}:${teamCode}`;
    const prior = outcomes.get(key);
    const reached = prior && roundRank(prior.playoffRoundReached) >= roundRank(row.round) ? prior.playoffRoundReached : row.round;
    outcomes.set(key, {
      season: row.season,
      teamCode,
      team,
      playoffRoundReached: reached,
      seriesWins: (prior?.seriesWins ?? 0) + (won ? 1 : 0),
      seriesLosses: (prior?.seriesLosses ?? 0) + (won ? 0 : 1),
      isChampion: prior?.isChampion || (row.round === 'Finals' && won) || false,
      isFinalist: prior?.isFinalist || row.round === 'Finals',
      isConferenceFinalist: prior?.isConferenceFinalist || row.round.includes('Conf Finals'),
    });
  };
  upsert(normalizeTeamCode(row.winnerCode), row.winner, row.winnerWins, row.loserWins, true);
  upsert(normalizeTeamCode(row.loserCode), row.loser, row.loserWins, row.winnerWins, false);
}

const output = [...outcomes.values()].sort((a, b) => a.season - b.season || a.teamCode.localeCompare(b.teamCode));
writeFileSync('src/data/playoffSeriesOutcomes.json', JSON.stringify(output, null, 2) + '\n');
console.log(`Imported ${rows.length} NBA series and ${output.length} team-season outcomes (1997+).`);
