/**
 * Parses the user's own "BPM 2.0" export (from a separate project, `nba-analytics-drag-drop-codex`)
 * into a clean season-level JSON, mirroring extractDarko.ts/extractRaptor.py's shape exactly so
 * `bpm2Lookup.ts`/`blendedDefenseLookup.ts` can match it the same way.
 *
 * Source: `nba_bpm_2_0_rs_po.csv` — the master/union file, already covering everything the two
 * era-sliced sibling files (pre-1977-estimated, 1977-1996) contain, so only this one is read.
 * 1951-52 through 2025-26, RS+playoffs — filtered here to regular season only (RS-only convention
 * already used by darko.json/raptor.json/matchupDefense.json).
 *
 * Extracts `dbpm` (defense) and total `bpm`; confidence/status are retained alongside both.
 * DBPM feeds the defensive correction; total BPM is retained for the fallback total-value
 * correction after independent validation (`scripts/validateBpm2Total.ts`).
 *
 * Deliberately does NOT filter by `confidence`/`data_status` (same convention as every other real
 * source here — darko.json/raptor.json/matchupDefense.json carry no reliability flag either, they
 * ARE the ground truth once past their own extraction floor). This is a real, disclosed tradeoff:
 * it's exactly what lets bpm2.json cover the pre-1974 `estimated_similarity`/low-confidence era —
 * the whole reason this source is being extracted. Confidence and data status remain attached
 * to every output row; `minutes >= 500` is the only quality floor.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MASTER_FILE =
  'C:/Users/Eryks/Documents/Codex/2026-08-03/przeczytaj-start-here-md-agents-md/work/nba-analytics-drag-drop-codex/outputs/bpm_2_0/nba_bpm_2_0_rs_po.csv';

// Minimal quoted-CSV parser — some fields (team names on multi-team seasons) contain commas
// inside quotes.
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
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, ''));
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => (obj[h] = r[idx] ?? ''));
    return obj;
  });
}

interface Bpm2Row {
  name: string;
  season: string; // "2003-04"
  dbpm: number;
  bpm: number;
  confidence: string;
  dataStatus: string;
}

console.log(`Reading ${MASTER_FILE} ...`);
const raw = readFileSync(MASTER_FILE, 'utf-8');
const parsed = parseCsv(raw);
console.log(`Parsed ${parsed.length} raw rows.`);

const MIN_MINUTES = 500;
let skippedNotRegular = 0;
let skippedLowMinutes = 0;
let skippedBadNumber = 0;

const rows: Bpm2Row[] = [];
for (const r of parsed) {
  if (r.season_type !== 'regular') {
    skippedNotRegular++;
    continue;
  }
  const minutes = parseFloat(r.minutes);
  if (!(minutes >= MIN_MINUTES)) {
    skippedLowMinutes++;
    continue;
  }
  const dbpm = parseFloat(r.dbpm);
  const bpm = parseFloat(r.bpm);
  if (!r.player || !r.season || Number.isNaN(dbpm) || Number.isNaN(bpm)) {
    skippedBadNumber++;
    continue;
  }
  rows.push({
    name: r.player,
    season: r.season,
    dbpm,
    bpm,
    confidence: r.confidence,
    dataStatus: r.data_status,
  });
}

console.log(`Kept ${rows.length} regular-season rows (>= ${MIN_MINUTES} minutes).`);
console.log(`Skipped: ${skippedNotRegular} playoffs, ${skippedLowMinutes} under-minutes, ${skippedBadNumber} malformed.`);

const seasons = [...new Set(rows.map((r) => r.season))].sort();
console.log(`Season range: ${seasons[0]} .. ${seasons[seasons.length - 1]}`);
console.log(`Distinct players (by raw name): ${new Set(rows.map((r) => r.name)).size}`);

const outPath = 'src/data/awards/bpm2.json';
writeFileSync(outPath, JSON.stringify(rows));
console.log(`Wrote ${outPath}`);
