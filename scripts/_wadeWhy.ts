import { createDraft, resolveAiPickIfNeeded } from '../src/engine/draft';
import { setAiDraftDebug } from '../src/engine/aiDrafter';
setAiDraftDebug(true);
const seed = Number(process.argv[2] ?? 104), at = Number(process.argv[3] ?? 30), who = process.argv[4] ?? 'Dwyane Wade';
let st = createDraft(false, undefined, undefined, seed);
st = { ...st, teams: st.teams.map((t) => ({ ...t, isHuman: false })) };
let pick = 0;
(globalThis as any).__aiScoredHook = (roster: any[], e: any[]) => {
  if (pick !== at) return;
  const fmt = (x: any) => `${x.player.playerName} ${x.player.spanLabel} v ${x.value.toFixed(1)} | ` + Object.entries(x.debug ?? {}).filter(([, v]) => typeof v === 'number' && Math.abs(v as number) >= 0.3).map(([k, v]) => `${k} ${(v as number).toFixed(1)}`).join(' ');
  console.log(`pick ${pick}, roster: ${roster.map((p) => p.playerName.split(' ').pop()).join(', ')}`);
  e.slice(0, 3).forEach((x) => console.log('  TOP ', fmt(x)));
  e.filter((x) => x.player.playerName === who).sort((a, b) => b.value - a.value).slice(0, 3).forEach((x) => console.log('  ' + who.split(' ').pop() + ' ', fmt(x), ` rank ${e.indexOf(x) + 1}`));
};
const orig = console.log; console.log = (...a: any[]) => { if (typeof a[0] === 'string' && (a[0].startsWith('pick ') || a[0].startsWith('  '))) orig(...a); };
while (!st.complete && pick <= at) { pick++; const n = resolveAiPickIfNeeded(st); if (!n) break; st = n; }
