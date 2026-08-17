/**
 * 2026-08-16, user-supplied real height export — two candidate sources were tried, this one won:
 *
 * - `Players.csv` (`personId,firstName,lastName,birthDate,school,country,heightInches,
 *   bodyWeightLbs,jersey,guard,forward,center,dleagueFlag,nbaFlag,gamesPlayedFlag,draftYear,
 *   draftRound,draftNumber,fromYear,toYear` — 6692 rows, `src/data/raw/players_bio.csv`):
 *   **96.3% archive coverage** (2120 of 2202 distinct players matched by normalized name) — real,
 *   deep historical coverage (Kareem 1969-88, Zaid Abdul-Aziz 1968-77 both present), not just a
 *   modern-era combine export. Used as the sole source.
 * - `wingspan_all_2026-08-16.csv` (`src/data/raw/wingspan.csv`, tried first): only 30.5% archive
 *   coverage (671/2202) — a real draft-combine/wingspan-tracking export, which only exists for
 *   players measured at a combine, mostly a modern-era population. Kept in `src/data/raw/` for a
 *   future wingspan-specific ask, but NOT used here — `Players.csv`'s much deeper coverage made it
 *   the clear choice for the height-based position-eligibility rules this file backs (see
 *   `applyHeightBasedSecondaryPositions` in `src/data/players.ts`).
 *
 * Same "user provides the export, never scrape it" convention every other real-data source in
 * this project follows (DARKO, WOWYR, league 3PT volume).
 *
 * Run: npx tsx scripts/buildHeightLookup.ts
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePlayerName } from '../src/data/schema';

const CSV_PATH = join(process.cwd(), 'src/data/raw/players_bio.csv');
const OUT_PATH = join(process.cwd(), 'src/data/awards/height.json');

const lines = readFileSync(CSV_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
const header = lines[0].split(',');
const firstIdx = header.indexOf('firstName');
const lastIdx = header.indexOf('lastName');
const heightIdx = header.indexOf('heightInches');

const byName = new Map<string, number>();
let skippedNoHeight = 0;
let skippedDuplicate = 0;
for (const line of lines.slice(1)) {
  const cols = line.split(',');
  const first = cols[firstIdx];
  const last = cols[lastIdx];
  const heightIn = parseFloat(cols[heightIdx]);
  if (!first || !last || !Number.isFinite(heightIn)) {
    skippedNoHeight++;
    continue;
  }
  const key = normalizePlayerName(`${first} ${last}`);
  // Same "keep the first seen, don't overwrite" rule as every other name-keyed lookup in this
  // project — a handful of normalized-name collisions across genuinely different real players
  // (multiple "Mike Smith"s etc.) is an accepted small-sample gap, not worth a bigger
  // disambiguation effort for ~6700 rows.
  if (byName.has(key)) {
    skippedDuplicate++;
    continue;
  }
  byName.set(key, heightIn);
}

const out: Record<string, number> = {};
for (const [key, value] of byName) out[key] = value;

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
console.log(
  `Wrote ${byName.size} players to ${OUT_PATH} (skipped ${skippedNoHeight} rows with no height, ${skippedDuplicate} duplicate-name collisions)`,
);
