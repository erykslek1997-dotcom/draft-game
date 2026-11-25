// 2026-11-25: AI starters with O-TAL under 50 (the Horry case) and AI mean Overall, N drafts.
import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { aiRotation } from '../src/engine/finalizeAiRoster';
import { scoreTeam } from '../src/engine/scoring';
import { STARTER_SLOTS } from '../src/engine/positions';
import { computeOffensiveTalent } from '../src/engine/talent';
const N = Number(process.env.N ?? 4); let low = 0, st = 0; const ov: number[] = [];
for (let d = 0; d < N; d++) {
  const s = autoFinishDraft(createDraft(false, activeDraftPool, 'Test', 7_000 + d));
  for (const t of s.teams) {
    const rot = aiRotation(t.roster); const ids = new Set(STARTER_SLOTS.map((x) => rot.slots[x][0]?.playerId));
    for (const p of t.roster) if (ids.has(p.id)) { st++; if (computeOffensiveTalent(p) < 50) low++; }
    ov.push(scoreTeam({ ...t, rotation: rot }).overallExact);
  }
}
console.log(`starters O<50: ${low}/${st} | AI mean Overall ${(ov.reduce((a, b) => a + b, 0) / ov.length).toFixed(2)}`);
