import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';

let s = createDraft();
let guard = 0;
while (!s.complete && guard < 100) {
  const teamIdx = currentTeamIndex(s);
  const team = s.teams[teamIdx];
  if (team.isHuman) {
    const legal = players
      .filter((p) => !s.draftedIds.has(p.id) && isPickLegal(s, p.id))
      .sort((a, b) => computeTalent(b) - computeTalent(a));
    if (legal.length === 0) break;
    s = makePick(s, legal[0].id);
  } else {
    const beforeRoster = team.roster.map((p) => p.primaryPosition).join(',');
    const next = resolveAiPickIfNeeded(s);
    if (!next) break;
    const picked = next.teams[teamIdx].roster[next.teams[teamIdx].roster.length - 1];
    console.log(
      `${team.name} pick #${team.roster.length + 1}: picked ${picked.playerName} (${picked.primaryPosition}, TAL=${computeTalent(picked)}, FGA=${picked.fga}) | roster before: [${beforeRoster}]`,
    );
    s = next;
  }
  guard++;
}
