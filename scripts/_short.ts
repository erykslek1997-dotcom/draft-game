// 2026-11-26: every window the short-season rule touches (value >= 78, a short season inside).
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { shortSeasonsIn } from '../src/engine/boxRatesLookup';
for (const p of draftPool) if (shortSeasonsIn(p.playerName, p.spanLabel).length) { const t = effectiveTalent(p); if (t >= 70) console.log(`${p.playerName} ${p.spanLabel}|${Math.round(t)}`); }
