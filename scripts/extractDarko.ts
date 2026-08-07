/**
 * Parses the user's 29 DARKO season CSVs (C:\Users\Eryks\Desktop\DARKO\*.csv, one file per
 * season 1997-98 through 2025-26, ~19 columns each: rank, Player, Team, Pos, DPM, ODPM, DDPM,
 * Box, On/Off DPM, MPG, Pace, Pts per 100, Ast per 100, FG%, 3P%, FT%, $ Value, Salary,
 * Surplus Value) into one clean season-level JSON. Unlike the earlier peak-RAPM Excel import
 * (one row per player, whichever tracking-era seasons happened to be their "peak"), this is
 * real per-season granularity across 29 years, so it can be matched directly against a
 * PlayerSpan's actual covered years instead of only against a player's best available window.
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SRC_DIR = 'C:/Users/Eryks/Desktop/DARKO';

interface DarkoSeasonRow {
  name: string;
  season: string; // "2000-01"
  pos: string;
  dpm: number;
  odpm: number;
  ddpm: number;
  box: number;
  onOffDpm: number;
  mpg: number;
  pace: number;
  ptsPer100: number;
  astPer100: number;
  fgPct: number;
  threePct: number;
  ftPct: number;
}

function seasonLabelFromFilename(filename: string): string {
  const m = filename.match(/darko(\d{2,4})-(\d{2,4})\.csv$/);
  if (!m) throw new Error(`Unrecognized DARKO filename: ${filename}`);
  let startYear = parseInt(m[1], 10);
  if (m[1].length === 2) startYear += startYear <= 30 ? 2000 : 1900;
  const endSuffix = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endSuffix}`;
}

function parsePercent(s: string): number {
  return parseFloat(s.replace('%', '')) / 100;
}

function parseSigned(s: string): number {
  return parseFloat(s.replace('+', ''));
}

const files = readdirSync(SRC_DIR).filter((f) => f.startsWith('darko') && f.endsWith('.csv'));
console.log(`Found ${files.length} DARKO season files.`);

const rows: DarkoSeasonRow[] = [];
let skipped = 0;

for (const file of files) {
  const season = seasonLabelFromFilename(file);
  const raw = readFileSync(join(SRC_DIR, file), 'utf-8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0].split(',');
  if (header.length !== 19) {
    console.log(`WARNING: ${file} header has ${header.length} columns, expected 19 - skipping file`);
    continue;
  }

  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    if (cols.length !== 19) {
      skipped++;
      continue;
    }
    const [, name, , pos, dpm, odpm, ddpm, box, onOffDpm, mpg, pace, ptsPer100, astPer100, fgPct, threePct, ftPct] = cols;
    const posClean = /^[A-Z]+(-[A-Z]+)*$/.test(pos) ? pos : '';
    rows.push({
      name,
      season,
      pos: posClean,
      dpm: parseSigned(dpm),
      odpm: parseSigned(odpm),
      ddpm: parseSigned(ddpm),
      box: parseSigned(box),
      onOffDpm: parseSigned(onOffDpm),
      mpg: parseFloat(mpg),
      pace: parseFloat(pace),
      ptsPer100: parseFloat(ptsPer100),
      astPer100: parseFloat(astPer100),
      fgPct: parsePercent(fgPct),
      threePct: parsePercent(threePct),
      ftPct: parsePercent(ftPct),
    });
  }
}

console.log(`Parsed ${rows.length} player-seasons across ${files.length} files (${skipped} malformed rows skipped).`);
console.log(`Distinct seasons: ${new Set(rows.map((r) => r.season)).size}`);
console.log(`Distinct players (by raw name): ${new Set(rows.map((r) => r.name)).size}`);

const seasons = [...new Set(rows.map((r) => r.season))].sort();
console.log(`Season range: ${seasons[0]} .. ${seasons[seasons.length - 1]}`);

const outPath = join(process.cwd(), 'src', 'data', 'awards', 'darko.json');
writeFileSync(outPath, JSON.stringify(rows));
console.log(`Wrote ${outPath}`);
