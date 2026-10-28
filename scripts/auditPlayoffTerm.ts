import { draftPool } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { playoffImpactForSpan } from '../src/engine/playoffImpact';
import { computeTalent } from '../src/engine/talent';

/**
 * 2026-10-28, step 6.6 (the user: the playoff term in TAL — keep, shrink, or show apart?). The
 * term is how far a player's playoff BPM ran over what his regular season predicts (offense and
 * defense, with a Finals MVP bonus). If that is a trait, it repeats: a player's term in one window
 * should predict his term in a later window that shares no season. If it does not repeat, it is
 * mostly the noise of 10-20 playoff games, and TAL carries it as if it were skill.
 *
 *   npx tsx scripts/auditPlayoffTerm.ts
 */
const byPlayer = Object.groupBy(draftPool, (s) => s.playerName);
const pairs: { a: number; b: number; ao: number; bo: number; ad: number; bd: number; mins: number; who: string }[] = [];
for (const [name, spans] of Object.entries(byPlayer)) {
  const sorted = [...spans!].sort((x, y) => spanEndYears(x.spanLabel)[0] - spanEndYears(y.spanLabel)[0]);
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const ya = spanEndYears(sorted[i].spanLabel);
      const yb = spanEndYears(sorted[j].spanLabel);
      if (yb[0] <= ya[ya.length - 1]) continue; // overlapping
      const pa = playoffImpactForSpan(sorted[i]);
      const pb = playoffImpactForSpan(sorted[j]);
      if (pa.playoffMinutes < 300 || pb.playoffMinutes < 300) continue;
      pairs.push({ a: pa.offense + pa.defense, b: pb.offense + pb.defense, ao: pa.offense, bo: pb.offense, ad: pa.defense, bd: pb.defense, mins: Math.min(pa.playoffMinutes, pb.playoffMinutes), who: `${name} ${sorted[i].spanLabel} -> ${sorted[j].spanLabel}` });
      break; // the next window that shares no season
    }
}
const corr = (xs: number[], ys: number[]) => {
  const m = (v: number[]) => v.reduce((p, q) => p + q, 0) / v.length;
  const mx = m(xs), my = m(ys);
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};
console.log(`${pairs.length} pairs of non-overlapping windows, both with 300+ playoff minutes`);
console.log(`repeatability (window -> next window): total r ${corr(pairs.map((p) => p.a), pairs.map((p) => p.b)).toFixed(3)}, offense r ${corr(pairs.map((p) => p.ao), pairs.map((p) => p.bo)).toFixed(3)}, defense r ${corr(pairs.map((p) => p.ad), pairs.map((p) => p.bd)).toFixed(3)}`);
const big = pairs.filter((p) => p.mins >= 800);
console.log(`  both 800+ playoff minutes (${big.length}): total r ${corr(big.map((p) => p.a), big.map((p) => p.b)).toFixed(3)}`);

// Who the term moves most: TAL with and without it (TAL adds the term as points).
const rows = draftPool
  .map((s: PlayerSpan) => {
    const p = playoffImpactForSpan(s);
    return { s, term: p.offense + p.defense + p.finalsMvp, o: p.offense, d: p.defense, f: p.finalsMvp, tal: computeTalent(s), min: p.playoffMinutes };
  })
  .filter((r) => r.tal >= 70);
rows.sort((x, y) => y.term - x.term);
const show = (r: (typeof rows)[number]) => `  ${r.s.playerName.padEnd(24)} ${r.s.spanLabel}  TAL ${r.tal.toFixed(0)} -> ${(r.tal - r.term).toFixed(0)} without  (off ${r.o >= 0 ? '+' : ''}${r.o.toFixed(1)}, def ${r.d >= 0 ? '+' : ''}${r.d.toFixed(1)}, FMVP ${r.f.toFixed(1)}, ${Math.round(r.min)} PO min)`;
console.log('\nMost lifted (TAL 70+):');
rows.slice(0, 30).forEach((r) => console.log(show(r)));
console.log('\nMost lowered (TAL 70+):');
rows.slice(-30).reverse().forEach((r) => console.log(show(r)));
const terms = rows.map((r) => r.term).sort((a, b) => a - b);
console.log(`\nterm on TAL 70+ spans: p5 ${terms[Math.floor(terms.length * 0.05)].toFixed(1)}, median ${terms[Math.floor(terms.length / 2)].toFixed(1)}, p95 ${terms[Math.floor(terms.length * 0.95)].toFixed(1)}`);
