import { createDraft, resolveAiPickIfNeeded } from '../src/engine/draft';
const run = () => { let s = createDraft(false, undefined, undefined, 777); s = { ...s, teams: s.teams.map((t) => ({ ...t, isHuman: false })) }; for (let i = 0; i < 20; i++) s = resolveAiPickIfNeeded(s) ?? s; return s.history.map((h) => h.playerId); };
const a = run(), b = run();
const at = a.findIndex((x, i) => x !== b[i]);
console.log('first difference at pick', at, at >= 0 ? `${a[at]} vs ${b[at]}` : '(none in 20)');
