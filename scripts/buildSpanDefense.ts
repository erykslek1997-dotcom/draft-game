/**
 * Writes src/data/spanDefense.json — for every draft-pool span, what the live game's defense needs
 * beyond the box score the pool already carries:
 *   [foul index, offensive share of his rebounds], each x1000.
 * - Foul index: his personal fouls per minute over the league's that season (1.0 = average). From
 *   1980 on from the box-score minutes; before that the old box scores miss minutes unevenly
 *   (Russell 1963-64 shows 29 a game, he played 45), so his fouls per game over his estimated
 *   minutes are set against the league's fouls per team game (games per team from
 *   `raw/playerSeasonTeams.csv`) spread over five players.
 * - Offensive share: OREB / REB from 1973-74, when the league began keeping them; before that the
 *   typical share at his position.
 *
 * Source: the user's export of the Kaggle "Historical NBA Data and Player Box Scores" per player
 * and season (`src/data/raw/playerSeasonStats.csv`, 2026-10-07). Its shooting columns are unusable
 * before ~1978 (missing attempts), its fouls and rebounds are not.
 *
 * Run: npx tsx scripts/buildSpanDefense.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { spanEndYears } from '../src/engine/era';
import { estimatedMinutesPerGame } from '../src/engine/minutesPerGame';

const FIRST_REBOUND_SPLIT_SEASON = 1974;
/** Offensive share of a player's rebounds by position, 1974-2026 league medians (this file). */
const OREB_SHARE_BY_POSITION: Record<string, number> = { PG: 0.16, SG: 0.18, SF: 0.24, PF: 0.29, C: 0.31 };
const MIN_MINUTES = 200;
const FIRST_MINUTES_SEASON = 1980;
const MIN_GAMES = 10;

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

type Row = { name: string; season: number; games: number; minutes: number; fouls: number; oreb: number; dreb: number; reb: number };
const rows: Row[] = [];
{
  const lines = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonStats.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const at = (n: string) => header.indexOf(n);
  const num = (cells: string[], n: string) => Number(cells[at(n)]) || 0;
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    rows.push({
      name: norm(c[at('name')]),
      season: Number(c[at('seasonEnd')]),
      games: num(c, 'games'),
      minutes: num(c, 'numMinutes'),
      fouls: num(c, 'foulsPersonal'),
      oreb: num(c, 'reboundsOffensive'),
      dreb: num(c, 'reboundsDefensive'),
      reb: num(c, 'reboundsTotal'),
    });
  }
}

/** Team games per season: every team's most games by any of its players. */
const teamGames = new Map<number, number>();
{
  const lines = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const most = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    const key = `${c[header.indexOf('seasonEnd')]}|${c[header.indexOf('team')]}`;
    most.set(key, Math.max(most.get(key) ?? 0, Number(c[header.indexOf('games')]) || 0));
  }
  for (const [key, g] of most) {
    const season = Number(key.split('|')[0]);
    teamGames.set(season, (teamGames.get(season) ?? 0) + g);
  }
}

const bySeason = new Map<number, { fouls: number; minutes: number; oreb: number; reb: number; allFouls: number }>();
const byPlayer = new Map<string, Row>();
for (const r of rows) {
  const l = bySeason.get(r.season) ?? { fouls: 0, minutes: 0, oreb: 0, reb: 0, allFouls: 0 };
  l.allFouls += r.fouls;
  if (r.minutes > 0) {
    l.fouls += r.fouls;
    l.minutes += r.minutes;
  }
  l.oreb += r.oreb;
  l.reb += r.oreb + r.dreb;
  bySeason.set(r.season, l);
  // A name shared by two players in one season keeps the bigger line.
  const key = `${r.name}|${r.season}`;
  const prev = byPlayer.get(key);
  if (!prev || r.minutes > prev.minutes) byPlayer.set(key, r);
}

const out: Record<string, number[]> = {};
let matched = 0;
for (const span of draftPool) {
  let foulRatioSum = 0;
  let foulWeight = 0;
  let oreb = 0;
  let split = 0;
  for (const end of spanEndYears(span.spanLabel)) {
    const r = byPlayer.get(`${norm(span.playerName)}|${end}`);
    const l = bySeason.get(end);
    if (!r || !l) continue;
    if (end >= FIRST_MINUTES_SEASON) {
      if (r.minutes >= MIN_MINUTES && l.minutes > 0 && l.fouls > 0) {
        foulRatioSum += (r.fouls / r.minutes / (l.fouls / l.minutes)) * r.minutes;
        foulWeight += r.minutes;
      }
    } else if (r.games >= MIN_GAMES && (teamGames.get(end) ?? 0) > 0) {
      const mpg = estimatedMinutesPerGame(span) ?? 30;
      const mine = r.fouls / r.games / (mpg / 48);
      const league = l.allFouls / teamGames.get(end)! / 5;
      foulRatioSum += (mine / league) * r.games * mpg;
      foulWeight += r.games * mpg;
    }
    if (end >= FIRST_REBOUND_SPLIT_SEASON && r.oreb + r.dreb > 0) {
      oreb += r.oreb;
      split += r.oreb + r.dreb;
    }
  }
  if (foulWeight > 0) matched++;
  const foulIndex = foulWeight > 0 ? foulRatioSum / foulWeight : 1;
  const orebShare = split >= 100 ? oreb / split : OREB_SHARE_BY_POSITION[span.primaryPosition] ?? 0.24;
  out[span.id] = [Math.round(foulIndex * 1000), Math.round(orebShare * 1000)];
}

writeFileSync(resolve(import.meta.dirname, '../src/data/spanDefense.json'), `${JSON.stringify(out).replace(/\],"/g, '],\n"')}\n`);
const modern = [2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => bySeason.get(y)!).filter(Boolean);
const foulsPer48 = modern.reduce((s, l) => s + l.fouls, 0) / modern.reduce((s, l) => s + l.minutes, 0) * 240;
const orebShare = modern.reduce((s, l) => s + l.oreb, 0) / modern.reduce((s, l) => s + l.reb, 0);
console.log(`spanDefense.json: ${Object.keys(out).length} spans, ${matched} with real fouls; today: ${foulsPer48.toFixed(1)} fouls per team game, ${(100 * orebShare).toFixed(1)}% of rebounds offensive`);
