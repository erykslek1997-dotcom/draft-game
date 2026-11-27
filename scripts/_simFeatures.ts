// 2026-11-26: simulated leagues the game's way; per team the same features as the real dump, plus win %, series won.
import { writeFileSync } from 'node:fs';
import { activeDraftPool, autoFinishDraft, createDraft, draftCapLimit } from '../src/engine/draft';
import { aiRotation, finalizeAiRoster } from '../src/engine/finalizeAiRoster';
import { simulateLiveSeason, simulateLivePlayoffs } from '../src/engine/liveSeason';
import { teamFeatures } from './_features';
const N = Number(process.argv[2] ?? 30), from = Number(process.argv[3] ?? 5000), out = process.argv[4] ?? 'sim.json';
const rows: Record<string, number | string>[] = [];
for (let seed = from; seed < from + N; seed++) {
  const s = autoFinishDraft(createDraft(false, activeDraftPool, 'Test', seed));
  const teams = s.teams.map((t) => { const roster = finalizeAiRoster(t, draftCapLimit(s)); return { ...t, roster, rotation: aiRotation(roster) }; });
  const season = simulateLiveSeason(teams); const po = simulateLivePlayoffs(teams, season.standings);
  const sw = new Map<string, number>(); for (const r of po?.rounds ?? []) for (const x of r) sw.set(x.winnerId, (sw.get(x.winnerId) ?? 0) + 1);
  for (const t of teams) { const st = season.standings.find((r) => r.teamId === t.id)!;
    rows.push({ league: seed, winPct: st.wins / (st.wins + st.losses), margin: (st.pointsFor - st.pointsAgainst) / (st.wins + st.losses), seriesWins: sw.get(t.id) ?? 0, champion: po?.championId === t.id ? 1 : 0, ...teamFeatures(t) }); }
  writeFileSync(out, JSON.stringify(rows));
}
console.log('teams', rows.length);
