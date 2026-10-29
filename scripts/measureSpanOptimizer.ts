/**
 * 2026-10-28, step 7: what the post-draft window optimizer (`spanOptimizer.ts`) costs AI teams in
 * Overall against the windows they drafted, and what a local search on Overall itself would add.
 *
 *   npx tsx scripts/measureSpanOptimizer.ts   (env: DRAFTS=6, NEAR=<years>, PASSES=<n>)
 */
import { createDraft, autoFinishDraft } from '../src/engine/draft';
import { optimizeSpans, spanOptionsFor } from '../src/engine/spanOptimizer';
import { autoAssignRotation } from '../src/engine/rotation';
import { CAP_LIMIT } from '../src/engine/positions';
import { scoreTeam } from '../src/engine/scoring';
import type { PlayerSpan } from '../src/data/schema';
const ovr = (r: PlayerSpan[]) => scoreTeam({ id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) } as any).overallExact;
const fga = (r: PlayerSpan[]) => r.reduce((s, p) => s + p.fga, 0);
let t0 = Date.now(), n = 0;
const d1: number[] = [], d2: number[] = [];
const examples: string[] = [];
for (let d = 0; d < Number(process.env.DRAFTS ?? 6); d++) {
  const st = autoFinishDraft(createDraft(false, undefined, undefined, 9000 + d * 7919));
  for (const t of st.teams) {
    const drafted = t.roster;
    const opt = optimizeSpans(drafted, CAP_LIMIT);
    const base = ovr(opt);
    // Local search on Overall: one player's window at a time, cap-legal, keep any gain.
    let cur = [...opt], curV = base, improved = true;
    let passes = 0;
    while (improved && passes++ < Number(process.env.PASSES ?? 99)) {
      improved = false;
      for (let i = 0; i < cur.length; i++)
        for (const o of spanOptionsFor(cur[i].playerName)) {
          if (o.id === cur[i].id || o.primaryPosition !== cur[i].primaryPosition) continue;
          if (process.env.NEAR && Math.abs(parseInt(o.spanLabel) - parseInt(cur[i].spanLabel)) > Number(process.env.NEAR)) continue;
          const cand = cur.map((p, j) => (j === i ? o : p));
          if (fga(cand) > CAP_LIMIT) continue;
          const v = ovr(cand); n++;
          if (v > curV + 0.05) { cur = cand; curV = v; improved = true; }
        }
    }
    d1.push(ovr(drafted) - base); d2.push(curV - base);
    if (curV - base > 1) examples.push(`+${(curV - base).toFixed(1)}: ` + opt.map((p, i) => (p.id !== cur[i].id ? `${p.playerName} ${p.spanLabel}->${cur[i].spanLabel}` : '')).filter(Boolean).join(', '));
  }
}
const m = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
console.log(`teams ${d2.length}; Overall: optimizer vs drafted windows ${(-m(d1)).toFixed(2)}; local search on Overall gains ${m(d2).toFixed(2)} (max ${Math.max(...d2).toFixed(1)}, ${d2.filter((x) => x > 0.5).length} teams > 0.5); ${n} evaluations, ${((Date.now() - t0) / n).toFixed(1)} ms each`);
examples.slice(0, 10).forEach((e) => console.log('  ' + e));
