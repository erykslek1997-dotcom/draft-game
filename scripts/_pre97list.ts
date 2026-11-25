// 2026-11-25: key pre-1997 players (best window by TAL, window ending <= 1996) for defense-reputation labels.
import { writeFileSync } from 'node:fs';
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { effectiveTalent } from '../src/engine/grades';
const best = new Map<string, [string, number, number]>();
for (const p of draftPool) {
  const end = Number(p.spanLabel.slice(0, 4)) + 2; if (end > 1996) continue;
  const t = effectiveTalent(p); const cur = best.get(p.playerName);
  if (!cur || t > cur[2]) best.set(p.playerName, [`${p.playerName} ${p.spanLabel}`, Math.round(computeDefensiveTalent(p)), Math.round(t)]);
}
const list = [...best.values()].sort((a, b) => b[2] - a[2]).slice(0, 150);
writeFileSync(process.argv[2], JSON.stringify(list)); console.log(list.length, list.at(-1));
