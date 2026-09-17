/**
 * Streams the user's real `PlayerStatisticsExtended.csv` (per-GAME box scores, ~838k rows,
 * 453MB, 1996-2026 per [[usg_possession_cap_plan]]) and aggregates minutes-weighted usage% and
 * assisted/unassisted FG% per (playerName, season) into src/data/awards/usage.json.
 *
 * Feeds `starterOnBallDemand` (fit.ts) with the real signal the archetype+FGA-scale proxy stands
 * in for — see [[usg_possession_cap_plan]]'s "THIRD consumer" note (2026-09-17).
 *
 * Streamed line-by-line (readline), never loaded whole — the source comment on that memory note
 * explicitly warns against loading this file in full.
 *
 * Run: npx tsx scripts/extractUsage.ts [--dry-run]
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SOURCE_FILE = 'C:\\Users\\Eryks\\Desktop\\PlayerStatisticsExtended.csv';
const DRY_RUN = process.argv.includes('--dry-run');
const DRY_RUN_LIMIT = 200_000;

/** Minimal CSV line splitter — handles quoted fields (the only text columns here are
 * gameLabel/gameSubLabel/comment, which can contain commas inside quotes). */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
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
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

/** Derives an "YYYY-YY" season label from a game date, matching this project's convention
 * (e.g. "1996-97"). Oct-Dec -> season starting that calendar year; Jan-Sep -> season ending
 * that calendar year (matches [[usg_possession_cap_plan]]'s documented Step 3a rule, widened
 * slightly from "Jan-Jun" to "Jan-Sep" to correctly bucket a June Finals game or a rare
 * Sep preseason-adjacent game into the season that actually just played, not next season). */
function seasonFromDate(dateStr: string): string | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const startYear = month >= 10 ? year : year - 1;
  const endYy = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYy}`;
}

interface Accumulator {
  playerName: string;
  season: string;
  minutesSum: number;
  usgWeightedSum: number;
  assistedFgWeightedSum: number;
  assistedFgWeight: number;
  games: number;
  minutesTotal: number;
  fgMadeTotal: number;
}

const accByKey = new Map<string, Accumulator>();

let headerIndex: Record<string, number> | null = null;
let rowsSeen = 0;
let rowsKept = 0;
let rowsSkippedGameType = 0;
let rowsSkippedParse = 0;
const gameTypesSeen = new Set<string>();

async function run() {
  const rl = createInterface({ input: createReadStream(SOURCE_FILE, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (headerIndex === null) {
      const header = splitCsvLine(line);
      headerIndex = Object.fromEntries(header.map((h, i) => [h, i]));
      continue;
    }
    if (line.trim() === '') continue;
    rowsSeen++;
    if (DRY_RUN && rowsSeen > DRY_RUN_LIMIT) break;

    const fields = splitCsvLine(line);
    const get = (col: string) => fields[headerIndex![col]] ?? '';

    const gameType = get('gameType');
    gameTypesSeen.add(gameType);
    if (gameType !== 'Regular Season') {
      rowsSkippedGameType++;
      continue;
    }

    const firstName = get('firstName');
    const lastName = get('lastName');
    const dateStr = get('gameDateTimeEst');
    const minutes = Number(get('numMinutes'));
    const usg = Number(get('usagePercentage'));
    const assistedPct = Number(get('percentAssistedFieldGoalsMade'));
    const fgMade = Number(get('fieldGoalsMade'));

    if (!firstName || !lastName) {
      rowsSkippedParse++;
      continue;
    }
    const season = seasonFromDate(dateStr);
    if (!season || !Number.isFinite(minutes) || minutes <= 0) {
      rowsSkippedParse++;
      continue;
    }

    const playerName = `${firstName} ${lastName}`;
    const key = `${playerName}|${season}`;
    let acc = accByKey.get(key);
    if (!acc) {
      acc = {
        playerName,
        season,
        minutesSum: 0,
        usgWeightedSum: 0,
        assistedFgWeightedSum: 0,
        assistedFgWeight: 0,
        games: 0,
        minutesTotal: 0,
        fgMadeTotal: 0,
      };
      accByKey.set(key, acc);
    }
    acc.games++;
    acc.minutesTotal += minutes;
    if (Number.isFinite(usg)) {
      acc.usgWeightedSum += usg * minutes;
      acc.minutesSum += minutes;
    }
    // Assisted-FG% is only meaningful on games with real makes; weight by that game's makes
    // (not minutes) so a DNP-ish 1-make game doesn't get the same say as a normal outing.
    if (Number.isFinite(assistedPct) && Number.isFinite(fgMade) && fgMade > 0) {
      acc.assistedFgWeightedSum += assistedPct * fgMade;
      acc.assistedFgWeight += fgMade;
      acc.fgMadeTotal += fgMade;
    }
    rowsKept++;
  }

  const rows = [...accByKey.values()]
    .filter((acc) => acc.games >= 10) // small-sample floor, matches this project's usual bar
    .map((acc) => ({
      name: acc.playerName,
      season: acc.season,
      games: acc.games,
      mpg: Math.round((acc.minutesTotal / acc.games) * 10) / 10,
      usgPct: acc.minutesSum > 0 ? Math.round((acc.usgWeightedSum / acc.minutesSum) * 1000) / 1000 : null,
      assistedFgPct: acc.assistedFgWeight > 0 ? Math.round((acc.assistedFgWeightedSum / acc.assistedFgWeight) * 1000) / 1000 : null,
    }));

  console.log(`Rows seen: ${rowsSeen}`);
  console.log(`Rows kept (Regular Season, parseable): ${rowsKept}`);
  console.log(`Rows skipped (game type): ${rowsSkippedGameType}`);
  console.log(`Rows skipped (parse): ${rowsSkippedParse}`);
  console.log(`Game types seen: ${[...gameTypesSeen].join(', ')}`);
  console.log(`Player-seasons aggregated (>=10 games): ${rows.length}`);
  console.log('Sample:', rows.slice(0, 5));

  if (!DRY_RUN) {
    writeFileSync('src/data/awards/usage.json', `${JSON.stringify(rows)}\n`);
    console.log('Wrote src/data/awards/usage.json');
  } else {
    console.log('DRY RUN — nothing written.');
  }
}

run();
