import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { players } from '../src/data/players';
import { spanEndYears } from '../src/engine/era';

/**
 * Builds per-season league-average SPG/game, the denominator a dedicated steal era-scale needs
 * — same technique as buildLeagueThreeVolume.ts. Steals weren't officially tracked before
 * 1973-74 (see the "Known, accepted gaps" note in project memory), so seasons before that are
 * omitted entirely rather than written as a false zero.
 *
 * Run: npx tsx scripts/buildLeagueSteals.ts
 */
const totals = new Map<number, { spg: number; spans: number }>();

for (const span of players) {
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) continue;
  for (const year of years) {
    if (year < 1974) continue;
    const entry = totals.get(year) ?? { spg: 0, spans: 0 };
    entry.spg += span.box.spg;
    entry.spans += 1;
    totals.set(year, entry);
  }
}

const rows = [...totals.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([seasonEndYear, { spg, spans }]) => ({
    seasonEndYear,
    avgSpg: Number((spg / spans).toFixed(4)),
    spanCount: spans,
  }));

const outPath = join(process.cwd(), 'src/data/awards/leagueSteals.json');
writeFileSync(outPath, JSON.stringify(rows, null, 2) + '\n');
console.log(`Wrote ${rows.length} seasons to ${outPath}`);
