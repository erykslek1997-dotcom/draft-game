/**
 * Guard for `src/data/runtimePercentiles.json` (built by `npm run build:runtime-percentiles`). The
 * D-TAL->TAL bridge and portability read the D-TAL / implied-defense percentiles from that baked
 * artifact, so any D-TAL change that skips the rebuild silently decouples TAL from the D-TAL the
 * user sees. 2026-09-24: it was found 20 days stale (last rebuilt 2026-09-04, five D-TAL commits
 * since; 3551 spans off by > 5 percentile points, Valančiūnas 2022-24 baked 0.03 vs 0.78 now).
 * Recomputes both percentiles exactly as the build script does and fails on any mismatch.
 */
import { players } from '../src/data/players';
import type { Position } from '../src/data/schema';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { normalizedDefenseForFit } from '../src/engine/talent';
import { runtimeDefenseTalentPercentile, runtimeImpliedDefensePercentile } from '../src/engine/runtimePercentiles';

function sortedByPosition(valueOf: (p: (typeof players)[number]) => number): Map<Position, number[]> {
  const m = new Map<Position, number[]>();
  for (const p of players) (m.get(p.primaryPosition) ?? m.set(p.primaryPosition, []).get(p.primaryPosition)!).push(valueOf(p));
  for (const v of m.values()) v.sort((a, b) => a - b);
  return m;
}

const dValue = new Map(players.map((p) => [p.id, computeDefensiveTalent(p)]));
const iValue = new Map(players.map((p) => [p.id, normalizedDefenseForFit(p)]));
const dSorted = sortedByPosition((p) => dValue.get(p.id)!);
const iSorted = sortedByPosition((p) => iValue.get(p.id)!);

let staleD = 0;
let staleI = 0;
let worst = 0;
for (const p of players) {
  const ds = dSorted.get(p.primaryPosition)!;
  const dv = dValue.get(p.id)!;
  const dNow = ds.filter((x) => x < dv).length / ds.length;
  const is = iSorted.get(p.primaryPosition)!;
  const iv = iValue.get(p.id)!;
  const iNow = (is.filter((x) => x < iv).length + is.filter((x) => x <= iv).length) / (2 * is.length);
  const dGap = Math.abs(dNow - runtimeDefenseTalentPercentile(p));
  const iGap = Math.abs(iNow - runtimeImpliedDefensePercentile(p));
  if (dGap > 1e-6) staleD++;
  if (iGap > 1e-6) staleI++;
  worst = Math.max(worst, dGap, iGap);
}

if (staleD > 0 || staleI > 0) {
  console.error(
    `FAIL: runtimePercentiles.json is stale (${staleD} D-TAL / ${staleI} implied-defense percentiles differ, worst gap ${worst.toFixed(2)}). Run \`npm run build:runtime-percentiles\`.`,
  );
  process.exit(1);
}
console.log(`PASS: runtimePercentiles.json matches the current engine for all ${players.length} spans`);
