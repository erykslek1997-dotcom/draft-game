// 2026-11-25: among each AI league's top eight by Overall, how often the playoff projection
// favours the team with the lower Overall, and how far apart the series odds are.
import benchTeams from '../src/data/benchTeams.json';
import { spanById } from '../src/engine/bestFive';
import { projectMatchup } from '../src/engine/matchup';
import { buildMatchupCache } from '../src/engine/seasonSimulation';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';
let flips = 0, pairs = 0, bigFlip = 0; const spreads: number[] = [];
for (const lg of (benchTeams as { teams: { name: string; ids: string[] }[] }[]).slice(0, Number(process.argv[2] ?? 8))) {
  const teams: Team[] = lg.teams.map((t, i) => { const r = t.ids.map(spanById).filter(Boolean) as any[]; return { id: `${i}`, name: t.name, draftSlot: i + 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) }; });
  const ovr = new Map(teams.map((t) => [t.id, scoreTeam(t).overallExact]));
  const top = [...teams].sort((a, b) => ovr.get(b.id)! - ovr.get(a.id)!).slice(0, 8);
  const cache = buildMatchupCache(top);
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    const p = projectMatchup(top[i], top[j], cache.get(top[i].id), cache.get(top[j].id), 'playoffs').seriesWinProbA; // top[i] has the higher Overall
    pairs++; if (p < 0.5) { flips++; if (p < 0.35) bigFlip++; } spreads.push(Math.abs(p - 0.5));
  }
}
console.log(`pairs ${pairs}: the lower Overall favoured ${(100 * flips / pairs).toFixed(0)}% (by 65%+ ${(100 * bigFlip / pairs).toFixed(0)}%)`);
