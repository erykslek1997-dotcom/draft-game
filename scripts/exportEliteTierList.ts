import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';

// One row per distinct real player (their single highest-TAL span in the draft pool) — matches
// how the draft actually treats them (drafting one span removes every other span of that same
// person from the pool). Sorted chronologically (oldest span first, by the span's own earliest
// covered year) rather than by TAL — 2026-08-05, the user's own ask, easier to hand-annotate
// draft tiers era-by-era than jumping around a talent-sorted list.
const bestByPlayer = new Map<string, (typeof players)[number]>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const existing = bestByPlayer.get(key);
  if (!existing || computeTalent(p) > computeTalent(existing)) bestByPlayer.set(key, p);
}

function firstYear(spanLabel: string): number {
  const years = spanEndYears(spanLabel);
  return years.length > 0 ? Math.min(...years) : Infinity;
}

const rows = [...bestByPlayer.values()]
  .map((p) => ({ playerName: p.playerName, spanLabel: p.spanLabel, primaryPosition: p.primaryPosition, TAL: computeTalent(p) }))
  .filter((r) => r.TAL >= 85)
  .sort((a, b) => firstYear(a.spanLabel) - firstYear(b.spanLabel));

const csv = ['playerName,spanLabel,primaryPosition,TAL,draftTier']
  .concat(rows.map((r) => `${r.playerName},${r.spanLabel},${r.primaryPosition},${r.TAL},`))
  .join('\n');

const outPath = join(process.cwd(), 'elite_tier_list.csv');
writeFileSync(outPath, csv + '\n');
console.log(`Wrote ${rows.length} players (TAL>=85) to ${outPath}`);
