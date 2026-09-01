/**
 * Builds src/data/awards/salaries.json — real NBA player salaries per season, the raw input for
 * the (planned) salary-cap draft mode's pricing model. See the project memory
 * `usg_possession_cap_plan.md` for the full design.
 *
 * Sources (all on the user's machine, exported manually per the no-scrape rule):
 *   1. C:\Users\Eryks\AppData\Local\Temp\salaries_1985to2018.csv
 *        index,league,player_id,salary,season,season_end,season_start,team
 *        Basketball-Reference player_id keyed (same id the game's generated spans use). 1985-2018,
 *        near-complete (~400-550/season) except 1987 (40 rows) and 1990 (64) which are partial.
 *        385 player-seasons have >1 row (mid-season trade) -> summed here.
 *   2. C:\Users\Eryks\Downloads\NBA Player Salaries_2000-2025.csv
 *        Player,Salary,Season   (Season = season-END year, single int)
 *        Name-keyed, no dupes. Used for the 2019-2025 tail (source 1 stops at 2018) and as a
 *        fallback where source 1 is thin.
 *   3. C:\Users\Eryks\AppData\Local\Temp\players.csv  (bio table, _id = BR id, has `name`)
 *        Only used here to build the name -> BR-id bridge so source 2's name-keyed rows can be
 *        attached to a player id where possible.
 *
 * Output shape:
 *   {
 *     byPlayerId:  { "<brId>": { "<seasonEndYear>": salaryUSD, ... }, ... },
 *     byName:      { "<normalizedName>": { "<seasonEndYear>": salaryUSD, ... }, ... },
 *     leagueMaxByYear: { "<seasonEndYear>": highestSingleSalaryThatSeason, ... },
 *     capByYear:   { "<seasonEndYear>": salaryCapUSD, ... },   // hand table, see note
 *     coverage:    { firstYear, lastYear, idRows, nameRows, bridgedNames }
 *   }
 *
 * The pricing model (rookie-scale override, synthetic pre-1985 fallback, league-max
 * normalization, span aggregation) lives in the engine, NOT here — this file is raw data only,
 * same split as every other src/data/awards/*.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePlayerName } from '../src/data/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../src/data/awards/salaries.json');

const SRC_ID = 'C:\\Users\\Eryks\\AppData\\Local\\Temp\\salaries_1985to2018.csv';
const SRC_NAME = 'C:\\Users\\Eryks\\Downloads\\NBA Player Salaries_2000-2025.csv';
const SRC_BIO = 'C:\\Users\\Eryks\\AppData\\Local\\Temp\\players.csv';

/**
 * NBA salary cap by season-END year, in USD. Assembled from Claude's training knowledge
 * (2026-09-01) — VERIFY against a real source before shipping the mode. 2025-26 ($164,961,000)
 * and 2026-27 confirmed against cbaguide.com/resources/amounts. Older years are approximate to
 * ~1-2%.
 */
const CAP_BY_YEAR: Record<number, number> = {
  1985: 3_600_000, 1986: 4_233_000, 1987: 4_945_000, 1988: 6_164_000, 1989: 7_232_000,
  1990: 9_802_000, 1991: 11_871_000, 1992: 12_500_000, 1993: 14_000_000, 1994: 15_175_000,
  1995: 15_964_000, 1996: 23_000_000, 1997: 24_363_000, 1998: 26_900_000, 1999: 30_000_000,
  2000: 34_000_000, 2001: 35_500_000, 2002: 42_500_000, 2003: 40_271_000, 2004: 43_840_000,
  2005: 43_870_000, 2006: 49_500_000, 2007: 53_135_000, 2008: 55_630_000, 2009: 58_680_000,
  2010: 57_700_000, 2011: 58_044_000, 2012: 58_044_000, 2013: 58_044_000, 2014: 58_679_000,
  2015: 63_065_000, 2016: 70_000_000, 2017: 94_143_000, 2018: 99_093_000, 2019: 101_869_000,
  2020: 109_140_000, 2021: 109_140_000, 2022: 112_414_000, 2023: 123_655_000, 2024: 136_021_000,
  2025: 140_588_000, 2026: 154_647_000, 2027: 164_961_000,
};

function splitClean(text: string): string[][] {
  // Both salary CSVs are verified quote-free with a fixed column count.
  return text
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split(','));
}

/** Minimal quote-aware CSV row parser — players.csv has commas inside quoted fields. */
function parseCsvQuoted(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQ = false;
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQ = true;
      } else if (c === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

// --- 1. id-keyed salaries (1985-2018), sum mid-season-trade rows -------------------------------
const byPlayerId: Record<string, Record<number, number>> = {};
let idRows = 0;
{
  const rows = splitClean(readFileSync(SRC_ID, 'utf8'));
  const header = rows.shift()!;
  const iId = header.indexOf('player_id');
  const iSal = header.indexOf('salary');
  const iEnd = header.indexOf('season_end');
  for (const r of rows) {
    const id = r[iId];
    const sal = Number(r[iSal]);
    const y = Number(r[iEnd]);
    if (!id || !Number.isFinite(sal) || sal <= 0 || !Number.isFinite(y)) continue;
    (byPlayerId[id] ??= {})[y] = (byPlayerId[id][y] ?? 0) + sal;
    idRows++;
  }
}

// --- 2. name-keyed salaries (2000-2025) -------------------------------------------------------
const byNameRaw: Record<string, Record<number, number>> = {};
let nameRows = 0;
{
  const rows = splitClean(readFileSync(SRC_NAME, 'utf8'));
  const header = rows.shift()!;
  const iName = header.indexOf('Player');
  const iSal = header.indexOf('Salary');
  const iSeason = header.indexOf('Season');
  for (const r of rows) {
    const nm = normalizePlayerName(r[iName] ?? '');
    const sal = Number(r[iSal]);
    const y = Number(r[iSeason]);
    if (!nm || !Number.isFinite(sal) || sal <= 0 || !Number.isFinite(y)) continue;
    // keep the LARGER if a name somehow repeats within a season (shouldn't — verified 0 dupes)
    (byNameRaw[nm] ??= {})[y] = Math.max(byNameRaw[nm][y] ?? 0, sal);
    nameRows++;
  }
}

// --- 3. name -> BR id bridge from the bio table ---------------------------------------------
const nameToId: Record<string, string> = {};
{
  const rows = parseCsvQuoted(readFileSync(SRC_BIO, 'utf8'));
  const header = rows.shift()!;
  const iId = header.indexOf('_id');
  const iName = header.indexOf('name');
  for (const r of rows) {
    const id = r[iId];
    const nm = normalizePlayerName(r[iName] ?? '');
    if (id && nm && !nameToId[nm]) nameToId[nm] = id;
  }
}

// --- 4. merge: fold name-keyed rows into byPlayerId where a bridge exists, else keep byName ---
const byName: Record<string, Record<number, number>> = {};
let bridgedNames = 0;
for (const [nm, years] of Object.entries(byNameRaw)) {
  const id = nameToId[nm];
  if (id) {
    bridgedNames++;
    const target = (byPlayerId[id] ??= {});
    for (const [y, sal] of Object.entries(years)) {
      const yr = Number(y);
      // id-keyed source (1) wins for years it already covers (cleaner, explicit season_end);
      // name-keyed fills the 2019-2025 tail and any gap.
      if (target[yr] === undefined) target[yr] = sal;
    }
  }
  // Always keep a byName copy too — pool spans on hand-made ids (artest, battier...) that don't
  // match a BR id still need a name lookup path.
  byName[nm] = { ...(byName[nm] ?? {}), ...years };
}
// also expose the id-keyed data under names, so a byName lookup is complete on its own
for (const [id, years] of Object.entries(byPlayerId)) {
  // reverse-map id -> name via the bridge (best effort)
  const nm = Object.entries(nameToId).find(([, v]) => v === id)?.[0];
  if (!nm) continue;
  byName[nm] = { ...years, ...(byName[nm] ?? {}) };
}

// --- 5. league-max per season (highest single salary that season) ----------------------------
const leagueMaxByYear: Record<number, number> = {};
for (const years of Object.values(byPlayerId)) {
  for (const [y, sal] of Object.entries(years)) {
    const yr = Number(y);
    leagueMaxByYear[yr] = Math.max(leagueMaxByYear[yr] ?? 0, sal);
  }
}
for (const years of Object.values(byNameRaw)) {
  for (const [y, sal] of Object.entries(years)) {
    const yr = Number(y);
    leagueMaxByYear[yr] = Math.max(leagueMaxByYear[yr] ?? 0, sal);
  }
}

const allYears = Object.keys(leagueMaxByYear).map(Number).sort((a, b) => a - b);
const out = {
  byPlayerId,
  byName,
  leagueMaxByYear,
  capByYear: CAP_BY_YEAR,
  coverage: {
    firstYear: allYears[0],
    lastYear: allYears[allYears.length - 1],
    idRows,
    nameRows,
    bridgedNames,
    playerIds: Object.keys(byPlayerId).length,
    names: Object.keys(byName).length,
  },
};

writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`  years ${out.coverage.firstYear}-${out.coverage.lastYear}`);
console.log(`  ${idRows} id-keyed rows -> ${out.coverage.playerIds} players`);
console.log(`  ${nameRows} name-keyed rows, ${bridgedNames} names bridged to a BR id`);
console.log(`  ${out.coverage.names} total names with a salary history`);
const sampleYears = [1991, 2000, 2010, 2019, 2025];
console.log(`  league-max sample: ${sampleYears.map((y) => `${y}:$${((leagueMaxByYear[y] ?? 0) / 1e6).toFixed(1)}M`).join('  ')}`);
