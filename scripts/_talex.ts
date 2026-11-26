// 2026-11-26: TAL examples, today vs the defense-credit gate (DEF_GATE_O1=55), all eras, TAL 60+.
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
for (const p of draftPool) { const t = effectiveTalent(p); if (t >= 58) console.log(`${p.playerName} ${p.spanLabel}|${Math.round(t)}|${computeOffensiveTalent(p)}|${computeDefensiveTalent(p)}`); }
