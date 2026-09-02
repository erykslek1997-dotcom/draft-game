import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = process.env.PLAYER_DATA_DIR ?? 'C:\\Users\\Eryks\\Desktop\\player-data';
const DRAFT_POOL_PATH = path.resolve(__dirname, '../src/data/draftPool.json');
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/cardCareerMetadata.json');
const CHAMPIONS_SOURCE = 'https://www.basketball-reference.com/playoffs/series.html';

interface RawSeason {
  seasonEnd: number;
  team: string;
}

interface RawPlayer {
  name: string;
  spans: Array<{ seasons: RawSeason[] }>;
}

interface DraftSpan {
  playerName: string;
}

interface CardCareerMetadata {
  teams: string[];
  championships: number;
  seasons: Array<RawSeason & { champion: boolean }>;
}

const normalize = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const PLAYER_NAME_ALIASES: Record<string, string> = {
  'ron artest': 'metta world peace',
};

const playerKey = (value: string) => PLAYER_NAME_ALIASES[normalize(value)] ?? normalize(value);

const normalizeTeam = (team: string) => ({
  BRK: 'BKN',
  CHO: 'CHA',
  PHO: 'PHX',
  WSB: 'WAS',
} as Record<string, string>)[team] ?? team;

const stripHtml = (value: string) => value
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

async function championBySeason(): Promise<Map<number, string>> {
  const response = await fetch(CHAMPIONS_SOURCE, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`Basketball-Reference returned ${response.status}`);
  const html = await response.text();
  const champions = new Map<number, string>();

  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = row[1];
    const cell = (stat: string) => body.match(
      new RegExp(`<[^>]+data-stat=["']${stat}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'),
    )?.[1] ?? '';
    const season = Number(stripHtml(cell('season')));
    const league = stripHtml(cell('lg'));
    const round = stripHtml(cell('series'));
    const winnerCell = cell('winner');
    const winnerCode = winnerCell.match(/\/teams\/([A-Z0-9]+)\//i)?.[1]?.toUpperCase();
    if (Number.isInteger(season) && (league === 'NBA' || league === 'BAA') && round === 'Finals' && winnerCode) {
      champions.set(season, normalizeTeam(winnerCode));
    }
  }
  return champions;
}

function uniqueSeasons(player: RawPlayer): RawSeason[] {
  const seasons = new Map<string, RawSeason>();
  for (const span of player.spans ?? []) {
    for (const season of span.seasons ?? []) {
      const team = normalizeTeam(season.team);
      if (!team || team === 'TOT' || /^\dTM$/.test(team)) continue;
      seasons.set(`${season.seasonEnd}:${team}`, { seasonEnd: season.seasonEnd, team });
    }
  }
  return [...seasons.values()].sort((a, b) => a.seasonEnd - b.seasonEnd);
}

const draftPool = JSON.parse(fs.readFileSync(DRAFT_POOL_PATH, 'utf8')) as DraftSpan[];
const draftNames = [...new Set(draftPool.map((span) => span.playerName))];
const rawByName = new Map<string, RawPlayer>();

for (const file of fs.readdirSync(RAW_DIR).filter((entry) => entry.endsWith('.json'))) {
  try {
    const player = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8')) as RawPlayer;
    if (player.name) rawByName.set(playerKey(player.name), player);
  } catch {
    // One malformed source file should not prevent metadata for the rest of the collection.
  }
}

const champions = await championBySeason();
const output: Record<string, CardCareerMetadata> = {};
const missing: string[] = [];

for (const name of draftNames.sort((a, b) => a.localeCompare(b))) {
  const raw = rawByName.get(playerKey(name));
  if (!raw) {
    output[name] = { teams: [], championships: 0, seasons: [] };
    missing.push(name);
    continue;
  }

  const seasons = uniqueSeasons(raw);
  const teams = [...new Set(seasons.map((season) => season.team))];
  const championships = seasons.filter(
    (season) => champions.get(season.seasonEnd) === season.team,
  ).length;
  output[name] = {
    teams,
    championships,
    seasons: seasons.map((season) => ({
      ...season,
      champion: champions.get(season.seasonEnd) === season.team,
    })),
  };
}

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${Object.keys(output).length} card metadata rows to ${OUTPUT_PATH}`);
console.log(`Championship seasons: ${champions.size}; unmatched players: ${missing.length}`);
if (missing.length) console.log(`Unmatched: ${missing.join(', ')}`);
