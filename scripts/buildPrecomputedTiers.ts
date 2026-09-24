/**
 * Writes src/data/precomputedTiers.json — every draft-pool span's tier context + effective talent,
 * plus the pool-wide offense/defense S-grade cutoffs, all computed by the live engine. Run by `npm run build` right before `vite build`; see
 * src/engine/precomputedTiers.ts for why (start-up time) and why it's production-only.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent, liveSThresholds } from '../src/engine/grades';
import { tierContextWithSixthMan } from '../src/engine/sixthMan';
import { contextFromRow, toPrecomputedRow, type PrecomputedTierRow, type PrecomputedTiersFile } from '../src/engine/precomputedTiers';

const t0 = Date.now();
const rows: PrecomputedTierRow[] = draftPool.map((span) =>
  toPrecomputedRow(span, tierContextWithSixthMan(span), effectiveTalent(span)),
);
const out = resolve(import.meta.dirname, '../src/data/precomputedTiers.json');
// Round-trip guard: every row must rebuild exactly the live context the engine would compute
// (optional fields compared as "absent or equal to their default"), or the build fails.
const liveById = new Map(draftPool.map((span) => [span.id, span]));
for (const row of rows) {
  const span = liveById.get(row[0])!;
  const live = tierContextWithSixthMan(span);
  const rebuilt = contextFromRow(span, row);
  const norm = (c: typeof live) => ({
    ...c,
    otalUncapped: c.otalUncapped ?? c.otal,
    playoffCollapse: c.playoffCollapse ?? 0,
    spacing: c.spacing ?? 0,
    apg: c.apg ?? span.box.apg,
    talWithoutEliteDefenseBonus: c.talWithoutEliteDefenseBonus ?? c.tal,
    talWithoutBridge: c.talWithoutBridge ?? c.tal,
    realValueFloor: c.realValueFloor ?? undefined,
    playoffValidatedAllNba: Boolean(c.playoffValidatedAllNba),
    isSixthMan: Boolean(c.isSixthMan),
  });
  const a = JSON.stringify(norm(live), Object.keys(norm(live)).sort());
  const b = JSON.stringify(norm(rebuilt), Object.keys(norm(live)).sort());
  if (a !== b) throw new Error(`precomputed tier context mismatch for ${span.id}:\n live ${a}\n rows ${b}`);
}

const file: PrecomputedTiersFile = { rows, sThresholds: liveSThresholds() };
writeFileSync(out, JSON.stringify(file));
console.log(`precomputedTiers.json: ${rows.length} spans in ${Date.now() - t0}ms`);
