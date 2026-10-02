/**
 * Writes src/data/spanContext.json — for every draft-pool span, the context the player actually
 * played in, read by `contextStats.ts` to re-scale his numbers to a new lineup:
 *   [teammates' three-point rate, usage rate, rim share of his two-point attempts], each x1000.
 *
 * 2026-10-02, stage 2 (live game), the user: "realne skalowanie statystyk na to jaki jest skład —
 * Kobe grał w deadball, ale mając nowoczesny skład miałby więcej miejsca". Teammates come from the
 * real season rosters (`raw/playerSeasonTeams.csv`, every season since 1947); their real
 * three-point attempts from `awards/boxRates.json`; the little of the team we cannot match is filled
 * with that season's league rate. Before the 1980
 * three-point line (and in the bricked-in early 80s) spacing came from long twos, so the rate is
 * floored at `ORIGINAL_SPACING_FLOOR`. Usage from `awards/usage.json` (1997 on), else estimated from
 * plays per minute against the season's pace.
 *
 * Run: npx tsx scripts/buildSpanContext.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { estimatedMinutesPerGame } from '../src/engine/minutesPerGame';
import { runtimeZoneTotalsForSpan } from '../src/engine/runtimeSpanLookups';
import boxRates from '../src/data/awards/boxRates.json';
import usage from '../src/data/awards/usage.json';
import baselines from '../src/data/awards/seasonBaselines.json';

const ORIGINAL_SPACING_FLOOR = 0.15;
const RIM_SHARE_BY_POSITION: Record<string, number> = { PG: 0.42, SG: 0.42, SF: 0.5, PF: 0.6, C: 0.75 };
const FGA_PER_POSSESSION = 0.87;

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const seasonOf = (end: number) => `${end - 1}-${String(end).slice(-2)}`;

type BoxRow = { name: string; season: string; g: number; fga: number; fta: number; threePA: number; tov: number };
const box = new Map<string, BoxRow>();
const league = new Map<string, { fga: number; tpa: number }>();
for (const row of boxRates as BoxRow[]) {
  const key = `${norm(row.name)}|${row.season}`;
  const prev = box.get(key);
  if (!prev || row.fga > prev.fga) box.set(key, row);
  const l = league.get(row.season) ?? { fga: 0, tpa: 0 };
  l.fga += row.fga;
  l.tpa += row.threePA;
  league.set(row.season, l);
}
const pace = new Map((baselines as { season: string; pace: number | null }[]).map((b) => [b.season, b.pace ?? 100]));
const usageRows = new Map<string, { usgPct: number; games: number; mpg: number }>();
for (const row of usage as { name: string; season: string; usgPct: number; games: number; mpg: number }[]) usageRows.set(`${norm(row.name)}|${row.season}`, row);

/**
 * Every player's team(s) and games each season, 1947-2026 — the user's export of the Kaggle
 * "Historical NBA Data and Player Box Scores" box scores, aggregated per player, season and team
 * (`src/data/raw/playerSeasonTeams.csv`). Games, not minutes, weigh a traded player's season:
 * minutes are missing for much of the pre-1970 data.
 */
type SeasonTeamRow = { name: string; seasonEnd: number; team: string; games: number };
const seasonTeamRows: SeasonTeamRow[] = [];
{
  const text = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const at = (name: string) => header.indexOf(name);
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    seasonTeamRows.push({ name: norm(cells[at('name')]), seasonEnd: Number(cells[at('seasonEnd')]), team: cells[at('team')], games: Number(cells[at('games')]) });
  }
}
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
const rosters = new Map<string, { name: string; games: number }[]>();
const teamsOf = new Map<string, { team: string; games: number }[]>();
const seasonGames = new Map<string, number>();
for (const row of seasonTeamRows) {
  const rosterKey = `${row.seasonEnd}|${row.team}`;
  rosters.set(rosterKey, [...(rosters.get(rosterKey) ?? []), { name: row.name, games: row.games }]);
  const playerKey = `${row.name}|${row.seasonEnd}`;
  teamsOf.set(playerKey, [...(teamsOf.get(playerKey) ?? []), { team: row.team, games: row.games }]);
  seasonGames.set(playerKey, (seasonGames.get(playerKey) ?? 0) + row.games);
}

/** Teammates' three-point rate where he really played: every teammate's season attempts, scaled to
 * the share of his season spent on that team; a traded player's teams weighed by his games there. */
function teammatesThreeRate(span: PlayerSpan): number {
  let threes = 0;
  let shots = 0;
  const me = norm(span.playerName);
  for (const end of spanEndYears(span.spanLabel)) {
    const season = seasonOf(end);
    const l = league.get(season);
    const leagueRate = l && l.fga > 0 ? l.tpa / l.fga : 0;
    const teamShots = (pace.get(season) ?? 100) * FGA_PER_POSSESSION * 82;
    const own = box.get(`${me}|${season}`)?.fga ?? 0;
    const stints = teamsOf.get(`${me}|${end}`) ?? [];
    const myGames = stints.reduce((sum, s) => sum + s.games, 0);
    if (myGames === 0) {
      threes += teamShots * leagueRate;
      shots += teamShots;
      continue;
    }
    for (const stint of stints) {
      const weight = stint.games / myGames;
      let knownShots = 0;
      let knownThrees = 0;
      for (const mate of rosters.get(`${end}|${stint.team}`) ?? []) {
        if (mate.name === me) continue;
        const row = box.get(`${mate.name}|${season}`);
        const total = seasonGames.get(`${mate.name}|${end}`) ?? 0;
        if (!row || total === 0) continue;
        const share = mate.games / total;
        knownShots += row.fga * share;
        knownThrees += row.threePA * share;
      }
      const unknown = Math.max(0, teamShots - own - knownShots);
      threes += weight * (knownThrees + unknown * leagueRate);
      shots += weight * (knownShots + unknown);
    }
  }
  return Math.max(ORIGINAL_SPACING_FLOOR, shots > 0 ? threes / shots : 0);
}

function usageRate(span: PlayerSpan): number {
  let weighted = 0;
  let weight = 0;
  for (const end of spanEndYears(span.spanLabel)) {
    const row = usageRows.get(`${norm(span.playerName)}|${seasonOf(end)}`);
    if (row) {
      weighted += row.usgPct * row.games * row.mpg;
      weight += row.games * row.mpg;
    }
  }
  if (weight > 0) return weighted / weight;
  // Before 1997: plays per minute against the team's plays per minute (pace / 48).
  let plays = 0;
  let games = 0;
  let paceGames = 0;
  for (const end of spanEndYears(span.spanLabel)) {
    const row = box.get(`${norm(span.playerName)}|${seasonOf(end)}`);
    if (!row) continue;
    const shotPlays = row.fga + 0.44 * row.fta;
    plays += shotPlays + (row.tov || 0.12 * shotPlays);
    games += row.g;
    paceGames += (pace.get(seasonOf(end)) ?? 100) * row.g;
  }
  const mpg = estimatedMinutesPerGame(span) ?? 34;
  return games > 0 ? plays / games / mpg / (paceGames / games / 48) : 0.2;
}

function rimShareOfTwos(span: PlayerSpan): number {
  const zones = runtimeZoneTotalsForSpan(span);
  if (zones && zones.rimFga + zones.midFga > 0) return zones.rimFga / (zones.rimFga + zones.midFga);
  return RIM_SHARE_BY_POSITION[span.primaryPosition];
}

const out: Record<string, [number, number, number]> = {};
for (const span of [...draftPool].sort((a, b) => a.id.localeCompare(b.id))) {
  out[span.id] = [Math.round(teammatesThreeRate(span) * 1000), Math.round(usageRate(span) * 1000), Math.round(rimShareOfTwos(span) * 1000)];
}
writeFileSync(resolve(import.meta.dirname, '../src/data/spanContext.json'), `${JSON.stringify(out).replace(/\],"/g, '],\n"')}\n`);
console.log(`spanContext.json: ${Object.keys(out).length} spans`);
