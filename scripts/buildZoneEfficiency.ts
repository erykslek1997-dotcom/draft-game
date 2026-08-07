/**
 * Parses the user-supplied zone-efficiency export (2026-08-07, `feedback 07 08.json` batch —
 * "wrzucam Ci dwie databasy - 3lvl scoring i passing") into a trimmed season-level JSON,
 * `zoneEfficiencyLookup.ts`'s `avgZoneFieldForSpan` reads it the same way `darkoLookup.ts`/
 * `selfCreationLookup.ts` read their own sources.
 *
 * Source: `nba_player_zone_efficiency_all_seasons.csv` — per-player-per-season rim/mid/three
 * attempts+makes+FG%, regular season AND playoffs both present (`season_type` column); filtered
 * here to regular season only, matching every other real-data source in this project
 * (darko.json/raptor.json/matchupDefense.json/bpm2.json all use the same convention).
 *
 * Explicit, user-instructed scope: **feeds `offensiveProfile.ts` only — never `computeTalent`.**
 * "na ten moment niech nie wpływa na TAL, bo za dużo nam namiesza."
 *
 * Coverage starts 1996-97 (confirmed directly against the raw file) — one year earlier than
 * DARKO's 1997-98, but still a hard floor: every pre-1996-97 span (most of the ~13,000-span
 * pool — Wilt, Russell, Jordan's early years, all of the 1946-96 dataset) has no zone data at
 * all. `zoneEfficiencyLookup.ts` must return null/neutral for those, same contract as every
 * other post-hoc real-data source here.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE_FILE =
  'C:/Users/Eryks/Documents/Codex/2026-08-03/przeczytaj-start-here-md-agents-md/outputs/nba_player_zone_efficiency_all_seasons.csv';

// Same minimal quoted-CSV parser as scripts/extractBpm2.ts — kept local rather than factored
// into a shared util, matching this project's existing one-off-per-extractor convention (see
// extractBpm2.ts/extractDarko.ts, neither of which share a parser either).
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

export interface ZoneEfficiencyRow {
  name: string;
  season: string; // "2013-14"
  rimFgm: number;
  rimFga: number;
  midFgm: number;
  midFga: number;
  threeFgm: number;
  threeFga: number;
}

console.log(`Reading ${SOURCE_FILE} ...`);
const raw = readFileSync(SOURCE_FILE, 'utf-8');
const parsed = parseCsv(raw);
console.log(`Parsed ${parsed.length} raw rows.`);

let skippedNotRegular = 0;
let skippedBadNumber = 0;

const rows: ZoneEfficiencyRow[] = [];
for (const r of parsed) {
  if (r.season_type !== 'regular') {
    skippedNotRegular++;
    continue;
  }
  const rimFgm = parseFloat(r.restricted_area_fgm);
  const rimFga = parseFloat(r.restricted_area_fga);
  const midFgm = parseFloat(r.mid_range_fgm);
  const midFga = parseFloat(r.mid_range_fga);
  const threeFgm = parseFloat(r.three_pt_fgm);
  const threeFga = parseFloat(r.three_pt_fga);
  if (!r.player_name || !r.season || [rimFgm, rimFga, midFgm, midFga, threeFgm, threeFga].some(Number.isNaN)) {
    skippedBadNumber++;
    continue;
  }
  rows.push({ name: r.player_name, season: r.season, rimFgm, rimFga, midFgm, midFga, threeFgm, threeFga });
}

console.log(`Kept ${rows.length} regular-season rows.`);
console.log(`Skipped: ${skippedNotRegular} playoffs, ${skippedBadNumber} malformed.`);

const seasons = [...new Set(rows.map((r) => r.season))].sort();
console.log(`Season range: ${seasons[0]} .. ${seasons[seasons.length - 1]}`);
console.log(`Distinct players (by raw name): ${new Set(rows.map((r) => r.name)).size}`);

const outPath = 'src/data/awards/zoneEfficiency.json';
writeFileSync(outPath, JSON.stringify(rows));
console.log(`Wrote ${outPath}`);
