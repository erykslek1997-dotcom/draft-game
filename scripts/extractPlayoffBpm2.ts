/**
 * Extracts the playoff half of the user's real `nba_bpm_2_0_rs_po.csv` master file.
 *
 * The existing `extractBpm2.ts` intentionally keeps regular season only. This companion keeps
 * postseason rows separate so playoff BPM can be audited and calibrated without silently
 * changing the production TAL formula or double-counting the existing playoff TS%-delta signal.
 *
 * Quality floor matches the existing playoff-efficiency pipeline (`buildPlayoffCollapse.ts`):
 * at least 5 playoff games and 100 minutes in a player-season. Confidence and data-status fields
 * are retained; estimated historical rows remain identifiable and receive lower reliability in
 * `playoffBpm2Lookup.ts` rather than being presented as observed data.
 *
 * Run: npx tsx scripts/extractPlayoffBpm2.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';

const MASTER_FILE =
  'C:/Users/Eryks/Documents/Codex/2026-08-03/przeczytaj-start-here-md-agents-md/work/nba-analytics-drag-drop-codex/outputs/bpm_2_0/nba_bpm_2_0_rs_po.csv';

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, ''));
  return rows.slice(1).map((values) =>
    Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])),
  );
}

export interface PlayoffBpm2Row {
  name: string;
  season: string;
  games: number;
  minutes: number;
  bpm: number;
  obpm: number;
  dbpm: number;
  bpmDeltaVsRs: number;
  confidence: string;
  dataStatus: string;
}

const MIN_GAMES = 5;
const MIN_MINUTES = 100;
const parsed = parseCsv(readFileSync(MASTER_FILE, 'utf8'));
const rows: PlayoffBpm2Row[] = [];

for (const source of parsed) {
  if (source.season_type !== 'playoffs') continue;
  const games = Number(source.games);
  const minutes = Number(source.minutes);
  const bpm = Number(source.bpm);
  const obpm = Number(source.obpm);
  const dbpm = Number(source.dbpm);
  const bpmDeltaVsRs = Number(source.bpm_delta_vs_rs);
  if (games < MIN_GAMES || minutes < MIN_MINUTES) continue;
  if (![bpm, obpm, dbpm, bpmDeltaVsRs].every(Number.isFinite)) continue;
  if (!source.player || !source.season) continue;
  rows.push({
    name: source.player,
    season: source.season,
    games,
    minutes,
    bpm,
    obpm,
    dbpm,
    bpmDeltaVsRs,
    confidence: source.confidence,
    dataStatus: source.data_status,
  });
}

const poolNames = new Set(draftPool.map((span) => normalizePlayerName(span.playerName)));
const poolRows = rows.filter((row) => poolNames.has(normalizePlayerName(row.name)));

writeFileSync('src/data/awards/bpm2Playoffs.json', `${JSON.stringify(rows, null, 2)}\n`);
writeFileSync('src/data/awards/bpm2Playoffs.pool.json', `${JSON.stringify(poolRows)}\n`);

console.log(`Playoff BPM2 source rows: ${parsed.length}`);
console.log(`Kept ${rows.length} player-seasons (>=${MIN_GAMES} games, >=${MIN_MINUTES} minutes).`);
console.log(`Production pool: ${poolRows.length} rows for ${new Set(poolRows.map((r) => normalizePlayerName(r.name))).size} players.`);
