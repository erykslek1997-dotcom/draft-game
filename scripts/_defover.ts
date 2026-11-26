// 2026-11-25 (the user: after the offense weight went up, are defenders' TAL too high?): TAL against
// real impact — window BPM (minutes-weighted, 1997+) and APBR RAPM (1997-2019) — by profile (D-TAL minus O-TAL).
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { spanEndYears } from '../src/engine/era';
import { effectiveTalent } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { realSeason } from '../src/engine/realAdvancedLookup';
import { apbrRapmForSpan } from '../src/engine/apbrRapmLookup';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const rows: unknown[] = [];
for (const s of draftPool) {
  const ys = spanEndYears(s.spanLabel); if (Math.min(...ys) < 1997) continue;
  let a = 0, w = 0; for (const y of ys) { const q = realSeason(s.playerName, y); const b = num(q?.bpm), m = num(q?.mp); if (b !== undefined && m) { a += b * m; w += m; } }
  if (w < 3000) continue;
  const r = apbrRapmForSpan(s);
  rows.push({ pos: s.primaryPosition, blk: s.box.bpg, reb: s.box.rpg, ppg: s.box.ppg, ts: s.box.tsPct, n: `${s.playerName} ${s.spanLabel}`, tal: effectiveTalent(s), o: computeOffensiveTalent(s), d: computeDefensiveTalent(s), bpm: a / w, rapm: r && r.poss > 3000 ? r.net : null, ro: r && r.poss > 3000 ? r.o : null, rd: r && r.poss > 3000 ? r.d : null });
}
console.log(JSON.stringify(rows));
