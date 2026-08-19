/**
 * 2026-08-19, follow-up to `checkBenchPositionBalance.ts` (PF/C still thin 20-24% of the time
 * after the lottery-narrowing fix, even with a widened/relaxed in-lottery search — that
 * experiment showed candidates weren't being missed by ranking, so the real question is whether
 * they exist as `pickForAi` candidates at all). Measures the REAL in-game draftPool.json for how
 * many distinct players per position clear a genuine material-backup bar (FGA<=9, TAL>=52 — the
 * same band `pickForAi`'s own bench-quality gate uses).
 *
 * User-reported ask, checked directly before acting on it: raising `buildDraftPool.ts`'s
 * `VALUE_PER_POSITION` quota (tried PG/SG/SF/PF/C up to 90-100 each, target pool size up to 800,
 * via a temp dry-run against the full ~14,000-span archive, not kept) left the
 * material-backup-capable count EXACTLY unchanged for SG (22), PF (11) and C (38), and only
 * moved PG/SF by a few (43->46-48, 22->24-26). Root cause: the value tier already filters
 * candidates to `cheapestFga <= VALUE_FGA_CEILING` (9) — every player it can possibly add
 * already clears the FGA side of "material backup"; raising the per-position count only pulls in
 * MORE real players below the TAL>=52 floor (true cap-glue, a different, already-served tier),
 * not more who clear both bars at once. The archive itself — the full real historical dataset,
 * not a selection-algorithm limit — simply contains only 11 real players whose primary position
 * is PF and who ALSO have a genuine FGA<=9-and-TAL>=52 span. This is not a pipeline bug to fix;
 * per this project's own non-negotiable rule, no more real PF spans can be manufactured to close
 * it. Re-run this after any future data/pipeline change to confirm the constraint still holds.
 */
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import type { Position } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';

const ALL_POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const byName = new Map<string, typeof draftPool>();
for (const p of draftPool) {
  const key = normalizePlayerName(p.playerName);
  const arr = byName.get(key);
  if (arr) arr.push(p);
  else byName.set(key, [p]);
}

for (const slot of ALL_POSITIONS) {
  let totalPeakInSlot = 0;
  let materialBackupCount = 0;
  let trueGlueCount = 0;
  for (const [, spans] of byName) {
    let best = spans[0];
    for (const s of spans) if (computeTalent(s) > computeTalent(best)) best = s;
    if (best.primaryPosition !== slot) continue;
    totalPeakInSlot++;
    if (spans.some((s) => s.fga <= 9 && computeTalent(s) >= 52)) materialBackupCount++;
    if (spans.some((s) => s.fga < 2)) trueGlueCount++;
  }
  console.log(
    `${slot}: distinct players (peak-position)=${totalPeakInSlot}  material-backup-capable(FGA<=9,TAL>=52)=${materialBackupCount}  true-glue(FGA<2)=${trueGlueCount}`,
  );
}
