/**
 * Parses the user-supplied per-game box-score export (2026-09-04, "baza z ft i oreb" —
 * `PlayerStatistics.csv`, ~1.67M rows, one row per player per game, back to 1953) into a trimmed
 * name+season JSON of the two box fields the curated `BoxLine` never had: free throws and the
 * offensive/defensive rebound split. `boxRatesLookup.ts` reads it the same way
 * `zoneEfficiencyLookup.ts` / `selfCreationLookup.ts` read their own sources — raw counts summed
 * across a span's covered years, rates derived after.
 *
 * Source is 372 MB so this streams line-by-line (readline) rather than `readFileSync` + a
 * char-by-char parser like the smaller extractors (buildZoneEfficiency / extractDarko).
 *
 * Regular season only, matching every other real-data source here (darko/raptor/zoneEfficiency/
 * bpm2 all filter to regular season). Coverage: FTA/FTM back to 1946-47 (always tracked); OREB/
 * DREB only from 1973-74 (the league did not record the split before then — pre-1974 rows carry
 * 0/0, so `boxRatesLookup` must treat OREB as absent for those spans, same contract as the
 * pre-1974 blocks/steals gap the engine already handles).
 *
 * Scope: feeds `rimPressure.ts` (FT-rate as a foul-drawing signal, esp. the pre-1997 proxy) and
 * a team offensive-rebounding signal in `fit.ts`. Does NOT feed `computeTalent` directly.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SOURCE_FILE = process.argv[2] ?? 'C:/Users/Eryks/Downloads/PlayerStatistics.csv';

// 0-based column indices in PlayerStatistics.csv (40 cols)
const COL = {
  firstName: 0, lastName: 1, gameType: 9, points: 16,
  fga: 20, fgm: 21, threePA: 23, threePM: 24,
  fta: 26, ftm: 27, rebD: 29, rebO: 30, rebTot: 31, tov: 33, gameDate: 39,
} as const;

/** "2026-06-13 ..." on a June game -> "2025-26"; on a Nov game -> "2026-27". Aug+ starts a season. */
function seasonLabel(gameDate: string): string | null {
  const m = gameDate.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

interface Acc {
  g: number; fta: number; ftm: number; fga: number; fgm: number;
  threePA: number; threePM: number; pts: number; oreb: number; dreb: number; rebTot: number; tov: number;
}
const byKey = new Map<string, Acc>(); // `${name}\u241f${season}` -> Acc

const rl = createInterface({ input: createReadStream(SOURCE_FILE, { encoding: 'utf-8' }), crlfDelay: Infinity });

let lineNo = 0;
let kept = 0;
let skippedType = 0;
let skippedMalformed = 0;

rl.on('line', (line) => {
  lineNo++;
  if (lineNo === 1) return; // header
  // Names/teams in this export contain no commas and `comment` is effectively always empty, so a
  // plain split is safe; a row that doesn't land on 40 fields is malformed -> skip.
  const f = line.split(',');
  if (f.length < 40) { skippedMalformed++; return; }
  if (f[COL.gameType] !== 'Regular Season') { skippedType++; return; }
  const season = seasonLabel(f[COL.gameDate]);
  if (!season) { skippedMalformed++; return; }
  const name = `${f[COL.firstName]} ${f[COL.lastName]}`.trim();
  if (!name || name === ' ') { skippedMalformed++; return; }
  const num = (i: number) => {
    const v = parseFloat(f[i]);
    return Number.isFinite(v) ? v : 0;
  };
  const key = `${name}\u241f${season}`;
  let a = byKey.get(key);
  if (!a) {
    a = { g: 0, fta: 0, ftm: 0, fga: 0, fgm: 0, threePA: 0, threePM: 0, pts: 0, oreb: 0, dreb: 0, rebTot: 0, tov: 0 };
    byKey.set(key, a);
  }
  a.g += 1;
  a.fta += num(COL.fta);
  a.ftm += num(COL.ftm);
  a.fga += num(COL.fga);
  a.fgm += num(COL.fgm);
  a.threePA += num(COL.threePA);
  a.threePM += num(COL.threePM);
  a.pts += num(COL.points);
  a.oreb += num(COL.rebO);
  a.dreb += num(COL.rebD);
  a.rebTot += num(COL.rebTot);
  a.tov += num(COL.tov);
  kept++;
});

rl.on('close', () => {
  console.log(`Lines: ${lineNo}. Kept ${kept} regular-season game rows into ${byKey.size} name-season groups.`);
  console.log(`Skipped: ${skippedType} non-regular, ${skippedMalformed} malformed.`);

  const rows = [...byKey.entries()]
    .map(([key, a]) => {
      const [name, season] = key.split('\u241f');
      // The OREB/DREB split is patchy for 1974-1985 (many games carry only reboundsTotal): flag
      // rows where the summed split covers <90% of total rebounds so the lookup can fall back to
      // neutral rather than trust a halved OREB count (Moses Malone 1978-79 reads 3.2 vs a real
      // ~7.2 this way). Reliable ~1985-86 onward and for essentially every modern row.
      const rebSplitCoverage = a.rebTot > 0 ? (a.oreb + a.dreb) / a.rebTot : 0;
      return {
        name,
        season,
        g: a.g,
        fta: Math.round(a.fta),
        ftm: Math.round(a.ftm),
        fga: Math.round(a.fga),
        fgm: Math.round(a.fgm),
        threePA: Math.round(a.threePA),
        pts: Math.round(a.pts),
        oreb: Math.round(a.oreb),
        dreb: Math.round(a.dreb),
        rebTot: Math.round(a.rebTot),
        orebOk: rebSplitCoverage >= 0.9 ? 1 : 0,
        tov: Math.round(a.tov),
      };
    })
    // drop scrap rows: a name-season with almost no minutes is noise, not a real span input
    .filter((r) => r.g >= 5 || r.fga >= 30)
    .sort((x, y) => x.season.localeCompare(y.season) || x.name.localeCompare(y.name));

  const seasons = [...new Set(rows.map((r) => r.season))].sort();
  console.log(`Output rows: ${rows.length}. Season range: ${seasons[0]} .. ${seasons[seasons.length - 1]}`);
  console.log(`Distinct players (raw name): ${new Set(rows.map((r) => r.name)).size}`);

  const withOreb = rows.filter((r) => r.oreb > 0).length;
  const firstOrebSeason = rows.filter((r) => r.oreb > 0).map((r) => r.season).sort()[0];
  console.log(`Rows with OREB > 0: ${withOreb} / ${rows.length} (earliest: ${firstOrebSeason})`);

  const outPath = 'src/data/awards/boxRates.json';
  writeFileSync(outPath, JSON.stringify(rows));
  console.log(`Wrote ${outPath} (${(JSON.stringify(rows).length / 1e6).toFixed(1)} MB)`);
});
