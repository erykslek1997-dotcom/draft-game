/**
 * Build src/data/awards/teamDefense.json from the Desktop game-level advanced exports:
 *  - team_advanced.csv  -> per (season, team) mean DEFRTG -> z-scored "team defense strength"
 *  - advanced.csv       -> per (pool player, season) { team, minutes } so a span can be mapped
 *                          to the actual defenses that player anchored, minutes-weighted.
 * Regular season only. Coverage ~1997+ (same cliff as DARKO/RAPTOR). See teamDefenseLookup.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';

const TEAM_CSV = 'C:/Users/Eryks/Desktop/team_advanced.csv';
const PLAYER_CSV = 'C:/Users/Eryks/Desktop/advanced.csv';

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

// --- team defense strength per season ---
const teamGames = new Map<string, number[]>(); // `${season}|${team}` -> [defrtg]
for (const row of parseCsv(readFileSync(TEAM_CSV, 'utf8'))) {
  if (row.type !== 'regular') continue;
  const drtg = Number(row.DEFRTG);
  if (!Number.isFinite(drtg)) continue;
  const key = `${row.season}|${row.team}`;
  (teamGames.get(key) ?? teamGames.set(key, []).get(key)!).push(drtg);
}
const bySeason = new Map<string, { team: string; drtg: number }[]>();
for (const [key, arr] of teamGames) {
  const [season, team] = key.split('|');
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  (bySeason.get(season) ?? bySeason.set(season, []).get(season)!).push({ team, drtg: mean });
}
const teamStrength: Record<string, number> = {}; // `${season}|${team}` -> z (positive = better D)
for (const [season, teams] of bySeason) {
  const mu = teams.reduce((a, t) => a + t.drtg, 0) / teams.length;
  const sd = Math.sqrt(teams.reduce((a, t) => a + (t.drtg - mu) ** 2, 0) / teams.length) || 1;
  for (const t of teams) teamStrength[`${season}|${t.team}`] = Math.round(((mu - t.drtg) / sd) * 1000) / 1000;
}

// --- pool player -> season -> {team, minutes} ---
const poolNames = new Set(draftPool.map((p) => normalizePlayerName(p.playerName)));
const playerSeasonTeamMin = new Map<string, Map<string, Map<string, number>>>(); // norm -> season -> team -> min
for (const row of parseCsv(readFileSync(PLAYER_CSV, 'utf8'))) {
  if (row.type !== 'regular') continue;
  const norm = normalizePlayerName(row.player ?? '');
  if (!poolNames.has(norm)) continue;
  const min = Number(row.MIN);
  if (!Number.isFinite(min) || min <= 0) continue;
  const seasonMap = playerSeasonTeamMin.get(norm) ?? playerSeasonTeamMin.set(norm, new Map()).get(norm)!;
  const teamMap = seasonMap.get(row.season) ?? seasonMap.set(row.season, new Map()).get(row.season)!;
  teamMap.set(row.team, (teamMap.get(row.team) ?? 0) + min);
}
const playerSeasons: Record<string, Record<string, { team: string; min: number }>> = {};
for (const [norm, seasonMap] of playerSeasonTeamMin) {
  playerSeasons[norm] = {};
  for (const [season, teamMap] of seasonMap) {
    let bestTeam = ''; let bestMin = 0; let totalMin = 0;
    for (const [team, m] of teamMap) { totalMin += m; if (m > bestMin) { bestMin = m; bestTeam = team; } }
    playerSeasons[norm][season] = { team: bestTeam, min: Math.round(totalMin) };
  }
}

writeFileSync(
  'src/data/awards/teamDefense.json',
  JSON.stringify({ note: 'built by scripts/buildTeamDefense.ts from Desktop team_advanced.csv + advanced.csv; z-strength positive = better team D; regular season; ~1997+', teamStrength, playerSeasons }, null, 0),
);
const seasons = [...bySeason.keys()].sort();
console.log(`teams: ${Object.keys(teamStrength).length} (${seasons[0]}..${seasons.at(-1)})  |  pool players with season-team data: ${Object.keys(playerSeasons).length}`);
console.log('LAL 2009:', teamStrength['2009|LAL'], ' 2010:', teamStrength['2010|LAL'], ' SAS 2004:', teamStrength['2004|SAS']);
console.log('Pau Gasol seasons:', JSON.stringify(playerSeasons[normalizePlayerName('Pau Gasol')]));
