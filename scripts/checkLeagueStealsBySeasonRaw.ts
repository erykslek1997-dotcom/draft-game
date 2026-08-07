// Diagnostic: real league-average SPG by season (from the project's own span dataset, same
// technique as buildLeagueThreeVolume.ts), and how much of that trend the EXISTING generic pace
// adjustment (defense.ts's paceFactor) already accounts for vs. leaves as residual. Read-only —
// doesn't write any data file yet, this is to decide whether a dedicated steal-era-scale is
// worth building before touching the calibrated computeDefensiveImpact formula.
import { players } from '../src/data/players';
import { spanEndYears, eraBaseline, LEAGUE_PACE_BASELINE } from '../src/engine/era';

const totals = new Map<number, { spg: number; spans: number }>();
for (const span of players) {
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) continue;
  for (const year of years) {
    if (year < 1974) continue; // steals not officially tracked before 1973-74
    const entry = totals.get(year) ?? { spg: 0, spans: 0 };
    entry.spg += span.box.spg;
    entry.spans += 1;
    totals.set(year, entry);
  }
}

const rows = [...totals.entries()].sort((a, b) => a[0] - b[0]);
const modernYears = [2024, 2025, 2026];
const modernAvg =
  modernYears.map((y) => totals.get(y)?.spg! / totals.get(y)!.spans).reduce((a, b) => a + b, 0) / modernYears.length;

console.log(`Modern (2024-26) league-avg SPG (per span dataset): ${modernAvg.toFixed(3)}`);
console.log('\nSeason  avgSPG  rawScale(modern/era)  pace  paceOnlyScale  residualBeyondPace');
for (const [year, { spg, spans }] of rows) {
  if (year % 5 !== 0 && year !== 1990 && year !== 1988) continue; // sample every 5 years for readability
  const avg = spg / spans;
  const rawScale = avg > 0 ? modernAvg / avg : NaN;
  const { pace } = eraBaseline(`${year - 2}-${String(year).slice(2)}`);
  const paceOnlyScale = LEAGUE_PACE_BASELINE / pace;
  const residual = rawScale / paceOnlyScale;
  console.log(
    `${year}    ${avg.toFixed(3)}   ${rawScale.toFixed(2).padStart(5)}                 ${pace.toFixed(1)}  ${paceOnlyScale.toFixed(2)}           ${residual.toFixed(2)}`,
  );
}
