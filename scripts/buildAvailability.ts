/**
 * Extracts per-span availability (games played / games the player's teams actually played)
 * from the player-data source folder into src/data/awards/availability.json.
 *
 * The source has carried `games`, `possibleGames` and `availability` on every span since the
 * first export — 13,754 of 13,754 spans, every era — and nothing in the game has ever read
 * them. This is the only physical/durability dimension available with complete historical
 * coverage; combine measurements (wingspan, vertical, agility) exist for neither this source
 * nor any other data the project has, and would only cover post-2000 draftees anyway.
 *
 * Keyed on normalized name + span start/end season-end year rather than the source's span id,
 * because the three span sources in players.ts use three different id schemes
 * (`abdelal01-1991-1992` generated, `russebi01-cw-1957-1958` curated-expanded, `russell-61-63`
 * hand-typed) while all three agree on name and years.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizePlayerName } from '../src/data/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = 'C:\\Users\\Eryks\\Desktop\\player-data';
const OUT_FILE = path.resolve(__dirname, '../src/data/awards/availability.json');

interface RawSpan {
  startSeasonEnd: number;
  endSeasonEnd: number;
  games?: number;
  possibleGames?: number;
  availability?: number;
}
interface RawPlayer {
  name?: string;
  spans?: RawSpan[];
}

export interface AvailabilityRow {
  name: string;
  startYear: number;
  endYear: number;
  games: number;
  possibleGames: number;
  /** games / possibleGames as a percentage. Can exceed 100 when a mid-season trade means the
   * player's two teams played more combined games than either alone — left uncapped here so the
   * extract stays faithful; `durability.ts` clamps it. */
  availability: number;
}

const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
const rows: AvailabilityRow[] = [];
const seen = new Set<string>();
let skippedNoField = 0;
let overHundred = 0;

for (const file of files) {
  let raw: RawPlayer;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    continue;
  }
  if (!raw.name || !raw.spans) continue;
  for (const s of raw.spans) {
    if (s.games == null || s.possibleGames == null || !s.possibleGames) {
      skippedNoField++;
      continue;
    }
    const availability = s.availability ?? (s.games / s.possibleGames) * 100;
    if (availability > 100) overHundred++;
    // Two source spans can share name+years only if the export duplicated them; keep the first.
    const key = `${normalizePlayerName(raw.name)}|${s.startSeasonEnd}|${s.endSeasonEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name: raw.name,
      startYear: s.startSeasonEnd,
      endYear: s.endSeasonEnd,
      games: s.games,
      possibleGames: s.possibleGames,
      availability: Math.round(availability * 10) / 10,
    });
  }
}

/**
 * 2026-08-01: real, user-confirmed availability for spans the source export's vintage doesn't
 * cover at all (Embiid's curated box-score row is newer than this export — see `durability.ts`'s
 * file header) and would otherwise silently fall back to `UNRATED_FALLBACK` (Ironman, the BEST
 * possible tier) despite the real answer being the opposite. Kept in the script itself, not
 * hand-patched into the output JSON, so it survives a re-run rather than being silently wiped.
 * Joel Embiid 2024-2025 (spanLabel "2023-25"): 58 games across the real 2023-24 (39, knee
 * surgery) and 2024-25 (19, more injury) seasons, both normal 82-game seasons — 58/164 = 35.4%,
 * user-confirmed directly rather than sourced from a stats site.
 */
const MANUAL_ROWS: AvailabilityRow[] = [
  { name: 'Joel Embiid', startYear: 2024, endYear: 2025, games: 58, possibleGames: 164, availability: 35.4 },
];
for (const row of MANUAL_ROWS) {
  const key = `${normalizePlayerName(row.name)}|${row.startYear}|${row.endYear}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push(row);
}

rows.sort((a, b) => a.name.localeCompare(b.name) || a.startYear - b.startYear || a.endYear - b.endYear);
fs.writeFileSync(OUT_FILE, JSON.stringify(rows));

const vals = rows.map((r) => r.availability).sort((a, b) => a - b);
const q = (p: number) => vals[Math.floor(p * (vals.length - 1))];
console.log(`wrote ${OUT_FILE}`);
console.log(`spans: ${rows.length}  players: ${new Set(rows.map((r) => normalizePlayerName(r.name))).size}`);
console.log(`skipped (missing games/possibleGames): ${skippedNoField}`);
console.log(`availability > 100 (mid-season trades): ${overHundred}`);
console.log(
  `distribution: min ${vals[0]} p10 ${q(0.1)} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} max ${vals[vals.length - 1]}`,
);
console.log(`year range: ${Math.min(...rows.map((r) => r.startYear))} -> ${Math.max(...rows.map((r) => r.endYear))}`);
