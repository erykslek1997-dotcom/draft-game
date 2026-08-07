/**
 * Parses the user-supplied playmaking export (2026-08-07 batch, Thinking Basketball box-creation
 * + passer-rating blend) into a trimmed player-level JSON. Unlike every other real-data source in
 * this project (DARKO/RAPTOR/BPM2/matchup-defense/self-creation — all season-by-season), this
 * export is **one row per distinct player: their single best/selected season**
 * (`selected_season_rule` = "thinking_basketball_source_season" or an estimated fallback), not a
 * full time series. `playmakingLookup.ts` is therefore name-keyed only, no year matching — a
 * single "how real is this player's self-creation gravity, at their best" read, not a per-span
 * number. Fine for this project's actual use (a coarse archetype-level tag feeding
 * `offensiveProfile.ts`'s synergy signals), explicitly NOT a TAL input.
 *
 * Only ~2,439 distinct players are covered (the export's own name — "playmaking_score_expanded"
 * — implies a curated/ranked list, not the full league-history population); most of the ~13,000-
 * span draft pool will miss and must read as neutral, same contract as every other lookup here.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE_FILE =
  'C:/Users/Eryks/Documents/Codex/2026-08-03/przeczytaj-start-here-md-agents-md/outputs/nba_playmaking_score_expanded_2seasons_110games.csv';

// Same minimal quoted-CSV parser as scripts/extractBpm2.ts / buildZoneEfficiency.ts — this
// source needs it for real: `model_neighbors_top5` embeds comma-separated player names inside
// quoted fields.
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

export interface PlaymakingRow {
  name: string;
  score: number; // 0-100, playmaking_score
  tier: string; // "elite" | "very_good" | ...
  selectedSeason: string;
}

console.log(`Reading ${SOURCE_FILE} ...`);
const raw = readFileSync(SOURCE_FILE, 'utf-8');
const parsed = parseCsv(raw);
console.log(`Parsed ${parsed.length} raw rows.`);

let skippedBadNumber = 0;
const rows: PlaymakingRow[] = [];
for (const r of parsed) {
  const score = parseFloat(r.playmaking_score);
  if (!r.player || Number.isNaN(score)) {
    skippedBadNumber++;
    continue;
  }
  rows.push({ name: r.player, score, tier: r.tier, selectedSeason: r.selected_season });
}

console.log(`Kept ${rows.length} rows. Skipped ${skippedBadNumber} malformed.`);
console.log(`Distinct players (by raw name): ${new Set(rows.map((r) => r.name)).size}`);
console.log(`Score range: ${Math.min(...rows.map((r) => r.score)).toFixed(1)} .. ${Math.max(...rows.map((r) => r.score)).toFixed(1)}`);

const outPath = 'src/data/awards/playmaking.json';
writeFileSync(outPath, JSON.stringify(rows));
console.log(`Wrote ${outPath}`);
