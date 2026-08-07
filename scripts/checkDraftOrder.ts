import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { computeTalent } from '../src/engine/talent';
import { draftPool as pool } from '../src/data/draftPool';

let s = createDraft();
let guard = 0;
const order: string[] = [];
while (!s.complete && guard < 600) {
  const teamIdx = currentTeamIndex(s);
  const beforeCount = s.history.length;
  if (s.teams[teamIdx].isHuman) {
    const legal = pool.filter((p) => !s.draftedIds.has(p.id) && isPickLegal(s, p.id)).sort((a, b) => computeTalent(b) - computeTalent(a));
    if (legal.length === 0) break;
    s = makePick(s, legal[0].id);
  } else {
    const next = resolveAiPickIfNeeded(s);
    if (!next) break;
    s = next;
  }
  if (s.history.length > beforeCount) {
    const last = s.history[s.history.length - 1];
    const p = pool.find((pp) => pp.id === last.playerId)!;
    order.push(`${s.history.length}. ${p.playerName} (${p.spanLabel}) TAL=${computeTalent(p)}`);
  }
  guard++;
}
console.log(order.slice(0, 35).join('\n'));
