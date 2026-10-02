/**
 * Writes src/data/spanContext.json — for every draft-pool span, the context the player actually
 * played in, read by `contextStats.ts` to re-scale his numbers to a new lineup:
 *   [teammates' three-point rate, usage rate, rim share of his two-point attempts], each x1000.
 *
 * 2026-10-02, stage 2 (live game), the user: "realne skalowanie statystyk na to jaki jest skład —
 * Kobe grał w deadball, ale mając nowoczesny skład miałby więcej miejsca". Teammates come from the
 * player-season team data we have (`awards/teamDefense.json` with minutes from 1997,
 * `cardCareerMetadata.json` before that); their real three-point attempts from `awards/boxRates.json`;
 * the part of the team we cannot name is filled with that season's league rate. Before the 1980
 * three-point line (and in the bricked-in early 80s) spacing came from long twos, so the rate is
 * floored at `ORIGINAL_SPACING_FLOOR`. Usage from `awards/usage.json` (1997 on), else estimated from
 * plays per minute against the season's pace.
 *
 * Run: npx tsx scripts/buildSpanContext.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { estimatedMinutesPerGame } from '../src/engine/minutesPerGame';
import { runtimeZoneTotalsForSpan } from '../src/engine/runtimeSpanLookups';
import boxRates from '../src/data/awards/boxRates.json';
import usage from '../src/data/awards/usage.json';
import baselines from '../src/data/awards/seasonBaselines.json';
import teamDefense from '../src/data/awards/teamDefense.json';
import career from '../src/data/cardCareerMetadata.json';

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

const playerSeasons = (teamDefense as { playerSeasons: Record<string, Record<string, { team: string; min: number }>> }).playerSeasons;
const careers = career as Record<string, { seasons: { seasonEnd: number; team: string }[] }>;
const rosters = new Map<string, Set<string>>();
const addToRoster = (end: number, team: string, name: string) => {
  const key = `${end}|${team}`;
  rosters.set(key, (rosters.get(key) ?? new Set()).add(name));
};
for (const [name, seasons] of Object.entries(playerSeasons)) for (const [end, v] of Object.entries(seasons)) addToRoster(Number(end), v.team, name);
for (const [name, v] of Object.entries(careers)) for (const s of v.seasons) addToRoster(s.seasonEnd, s.team, norm(name));
const teamOf = (name: string, end: number) =>
  playerSeasons[norm(name)]?.[String(end)]?.team ?? careers[name]?.seasons.find((s) => s.seasonEnd === end)?.team ?? null;

function teammatesThreeRate(span: PlayerSpan): number {
  let threes = 0;
  let shots = 0;
  for (const end of spanEndYears(span.spanLabel)) {
    const season = seasonOf(end);
    const l = league.get(season);
    const leagueRate = l && l.fga > 0 ? l.tpa / l.fga : 0;
    const teamShots = (pace.get(season) ?? 100) * FGA_PER_POSSESSION * 82;
    const own = box.get(`${norm(span.playerName)}|${season}`)?.fga ?? 0;
    let knownShots = 0;
    let knownThrees = 0;
    const team = teamOf(span.playerName, end);
    for (const mate of team ? rosters.get(`${end}|${team}`) ?? [] : []) {
      if (mate === norm(span.playerName)) continue;
      const row = box.get(`${mate}|${season}`);
      if (row) {
        knownShots += row.fga;
        knownThrees += row.threePA;
      }
    }
    const unknown = Math.max(0, teamShots - own - knownShots);
    threes += knownThrees + unknown * leagueRate;
    shots += knownShots + unknown;
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
