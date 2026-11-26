// 2026-11-26 (the user: "ten jeden przypadek wygrał ligę"): over many simulated leagues, where do champions and
// finalists sit in their league's spacing? Real NBA since 2010: no finalist in the bottom 6 of 30 by 3PA rate.
import { activeDraftPool, autoFinishDraft, createDraft, draftCapLimit } from '../src/engine/draft';
import { aiRotation, finalizeAiRoster } from '../src/engine/finalizeAiRoster';
import { simulateLiveSeason, simulateLivePlayoffs } from '../src/engine/liveSeason';
import { spacingScore } from '../src/engine/scoring';
const N = Number(process.argv[2] ?? 30), from = Number(process.argv[3] ?? 5000);
let rsBottom = 0, rsN = 0;
let champBottom = 0, finBottom = 0, fin = 0; const champRank: number[] = [];
for (let seed = from; seed < from + N; seed++) {
  const s = autoFinishDraft(createDraft(false, activeDraftPool, 'Test', seed));
  const teams = s.teams.map((t) => { const roster = finalizeAiRoster(t, draftCapLimit(s)); return { ...t, roster, rotation: aiRotation(roster) }; });
  const season = simulateLiveSeason(teams); const po = simulateLivePlayoffs(teams, season.standings); if (!po) continue;
  const spc = new Map(teams.map((t) => [t.id, spacingScore(t)])); const order = [...spc.values()].sort((a, b) => a - b);
  const rank = (id: string) => order.indexOf(spc.get(id)!) + 1; // 1 = worst spacing
  const finalists = po.rounds.at(-1)!.flatMap((x) => [x.teamAId, x.teamBId]);
  const top3 = [...season.standings].sort((a, b) => b.wins - a.wins).slice(0, 3); for (const r of top3) { rsN++; if (rank(r.teamId) <= 3) rsBottom++; }
  champRank.push(rank(po.championId)); if (rank(po.championId) <= 3) champBottom++;
  for (const f of finalists) { fin++; if (rank(f) <= 3) finBottom++; }
}
console.log(`regular season: top-3 records in the bottom 3 by spacing ${rsBottom}/${rsN} (${(100 * rsBottom / rsN).toFixed(0)}%; real NBA since 2010: 12%)`);
console.log(`leagues ${champRank.length}: champions in the bottom 3 of 16 by spacing ${champBottom} (${(100 * champBottom / champRank.length).toFixed(0)}%), finalists ${finBottom}/${fin}; champion spacing rank median ${champRank.sort((a, b) => a - b)[Math.floor(champRank.length / 2)]}/16 (16 = best)`);
