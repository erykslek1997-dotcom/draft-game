// 2026-11-26 (the user: is OG Anunoby's O too low?): O-TAL against window OBPM (minutes-weighted), 1997+; residuals for named players.
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { spanEndYears } from '../src/engine/era';
import { computeOffensiveTalent } from '../src/engine/talent';
import { realSeason } from '../src/engine/realAdvancedLookup';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const rows: { n: string; o: number; ob: number; ts?: number; usg?: number }[] = [];
for (const s of draftPool) {
  const ys = spanEndYears(s.spanLabel); if (Math.min(...ys) < 1997) continue;
  let a = 0, w = 0, u = 0; for (const y of ys) { const q = realSeason(s.playerName, y) as Record<string, unknown> | undefined; const b = num(q?.obpm), m = num(q?.mp); if (b !== undefined && m) { a += b * m; w += m; u += (num(q?.usg_pct) ?? 0) * m; } }
  if (w < 3000) continue;
  rows.push({ n: `${s.playerName} ${s.spanLabel}`, o: computeOffensiveTalent(s), ob: a / w, usg: u / w, ts: s.box.tsPct });
}
const mx = rows.reduce((t, r) => t + r.o, 0) / rows.length, my = rows.reduce((t, r) => t + r.ob, 0) / rows.length;
const b = rows.reduce((t, r) => t + (r.o - mx) * (r.ob - my), 0) / rows.reduce((t, r) => t + (r.o - mx) ** 2, 0);
const want = (process.argv[2] ?? 'OG Anunoby').split(',');
for (const r of rows) if (want.some((w) => r.n.startsWith(w))) { const d = r.ob - my - b * (r.o - mx); console.log(`${r.n.padEnd(28)} O-TAL ${r.o}  OBPM ${r.ob.toFixed(1)}  TS ${(r.ts! * 100).toFixed(1)}  USG ${r.usg!.toFixed(1)}  OBPM vs expected ${d >= 0 ? '+' : ''}${d.toFixed(2)} (= ${(d / b) >= 0 ? '+' : ''}${(d / b).toFixed(0)} O-TAL)`); }
console.log(`n ${rows.length}, OBPM per O-TAL point ${b.toFixed(3)}`);
