// 2026-11-26: which gate holds a window at the top of Starter (77)? Every gate's env switch, one at a time.
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent, displayTierForSpan, overallTierForSpan } from '../src/engine/grades';
import { tierContextFor } from '../src/engine/grades';
const p = draftPool.find((x) => x.playerName === (process.argv[2] ?? 'OG Anunoby') && x.spanLabel === (process.argv[3] ?? '2024-26'))!;
const ctx = tierContextFor(p);
console.log(p.playerName, p.spanLabel, 'display', effectiveTalent(p), 'tier', overallTierForSpan(ctx), JSON.stringify({ rawTal: ctx.rawTal, otal: ctx.otal, dtal: ctx.dtal, fga: ctx.fga, minutes: ctx.minutes, teamSrs: ctx.teamSrs }));
