import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal, availablePlayers } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { CAP_LIMIT } from '../src/engine/positions';
import { normalizePlayerName } from '../src/data/schema';

let s = createDraft();
let guard = 0;
while (!s.complete && guard < 100) {
  const teamIdx = currentTeamIndex(s);
  const team = s.teams[teamIdx];
  const spent = team.roster.reduce((sum, p) => sum + p.fga, 0);
  const isLastPick = team.roster.length === 8; // 9th and final pick for this team

  if (team.isHuman) {
    const legal = players.filter((p) => !s.draftedIds.has(p.id) && isPickLegal(s, p.id)).sort((a, b) => computeTalent(b) - computeTalent(a));
    if (legal.length === 0) break;
    s = makePick(s, legal[0].id);
  } else {
    if (isLastPick) {
      const available = availablePlayers(s);
      const cheapestPerPlayer = new Map<string, number>();
      for (const p of available) {
        const key = normalizePlayerName(p.playerName);
        const cur = cheapestPerPlayer.get(key);
        if (cur === undefined || p.fga < cur) cheapestPerPlayer.set(key, p.fga);
      }
      const cheapest = [...cheapestPerPlayer.values()].sort((a, b) => a - b)[0];
      const capRemaining = CAP_LIMIT - spent;
      console.log(
        `${team.name} LAST PICK: spent=${spent.toFixed(1)} capRemaining=${capRemaining.toFixed(1)} cheapestAvailable=${cheapest.toFixed(1)} ${cheapest <= capRemaining ? 'FITS' : 'DOES NOT FIT -> forces over-cap pick'}`,
      );
    }
    const next = resolveAiPickIfNeeded(s);
    if (!next) break;
    s = next;
  }
  guard++;
}
