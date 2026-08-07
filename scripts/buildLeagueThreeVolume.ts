import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { players } from '../src/data/players';
import { spanEndYears } from '../src/engine/era';

/**
 * Builds per-season league-average 3PA/game, the denominator `threeVolumeEraScale` needs to
 * put a player's 3-point volume on a common footing across eras.
 *
 * Why this file exists at all: 3-point ATTEMPT volume has grown ~20x since the line was added
 * in 1979-80 (~0.2 3PA/game per player then, ~4.0 now), a far bigger shift than the 3P%
 * baseline `seasonBaselines.json` already tracks (which has moved only ~28% -> ~36%). Judging
 * raw attempt volume against one fixed scale therefore reads every pre-2010 shooter as a
 * non-shooter regardless of how much they actually bent a defense relative to their peers.
 *
 * Derived from the project's own span dataset rather than an external export, deliberately:
 * the scale factor is applied to `span.box.threePA` from this same dataset, so any systematic
 * quirk in how these spans were built cancels out of the ratio. Spans are rolling multi-season
 * windows and overlap heavily, so a season's average is taken over every span covering it —
 * that weights each player-season roughly evenly, which is what a league average wants.
 *
 * Run: npx tsx scripts/buildLeagueThreeVolume.ts
 */

const totals = new Map<number, { threePA: number; spans: number }>();

for (const span of players) {
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) continue;
  for (const year of years) {
    const entry = totals.get(year) ?? { threePA: 0, spans: 0 };
    entry.threePA += span.box.threePA;
    entry.spans += 1;
    totals.set(year, entry);
  }
}

// Pre-1980 seasons predate the 3-point line entirely (average is a true 0, not missing data).
// They are written out anyway so the consumer can distinguish "no line yet" from "no coverage"
// — `threeVolumeEraScale` treats a zero as unscalable and falls back to 1.
const rows = [...totals.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([seasonEndYear, { threePA, spans }]) => ({
    seasonEndYear,
    avgThreePA: Number((threePA / spans).toFixed(4)),
    spanCount: spans,
  }));

const outPath = join(process.cwd(), 'src/data/awards/leagueThreeVolume.json');
writeFileSync(outPath, JSON.stringify(rows, null, 2) + '\n');

console.log(`Wrote ${rows.length} seasons to ${outPath}`);
console.log('\nSeason  avgThreePA  spans');
for (const r of rows.filter((r) => r.seasonEndYear >= 1980)) {
  console.log(`${r.seasonEndYear}   ${r.avgThreePA.toFixed(2).padStart(6)}   ${String(r.spanCount).padStart(5)}`);
}
