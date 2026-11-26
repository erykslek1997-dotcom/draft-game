// 2026-11-26 (the user: "18 PPG scorer wypada jak 10 PPG scorer mimo podobnych skuteczności"): does O-TAL
// pay for scoring volume at equal efficiency the way O-RAPM does? 1997-2019 windows with APBR RAPM.
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { spanEndYears } from '../src/engine/era';
import { computeOffensiveTalent } from '../src/engine/talent';
import { apbrRapmForSpan } from '../src/engine/apbrRapmLookup';
import { realSeason } from '../src/engine/realAdvancedLookup';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const rows: unknown[] = [];
for (const s of draftPool) {
  const ys = spanEndYears(s.spanLabel); if (Math.min(...ys) < 1997) continue;
  const r = apbrRapmForSpan(s); if (!r || r.poss < 3000) continue;
  let mp = 0, g = 0; for (const y of ys) { const q = realSeason(s.playerName, y) as Record<string, unknown> | undefined; const m = num(q?.mp), gg = num(q?.g); if (m && gg) { mp += m; g += gg; } }
  if (!g || mp / g < 20) continue;
  const mpg = mp / g;
  rows.push({ n: `${s.playerName} ${s.spanLabel}`, o: computeOffensiveTalent(s), ro: r.o, pts36: (s.box.ppg * 36) / mpg, ast36: (s.box.apg * 36) / mpg, ts: s.box.tsPct, mid: ys[0] });
}
console.log(JSON.stringify(rows));
