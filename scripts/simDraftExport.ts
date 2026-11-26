// 2026-11-26 (the user: "symulacja dwóch draftów tak samo jak w grze do oceny"): a full draft the game's
// way — 16 AI teams with planning (autoFinishDraft), the post-draft roster finalizer and the AI rotation,
// title odds, the live season and playoffs — written as the game's full export text.
//   npx tsx scripts/simDraftExport.ts <seed> [out]
import { writeFileSync } from 'node:fs';
import { activeDraftPool, autoFinishDraft, createDraft, draftCapLimit } from '../src/engine/draft';
import { aiRotation, finalizeAiRoster } from '../src/engine/finalizeAiRoster';
import { evaluateLeague } from '../src/engine/leagueSimulation';
import { simulateLiveSeason, simulateLivePlayoffs } from '../src/engine/liveSeason';
import { exportFullDraft } from '../src/engine/draftExport';
import { teamCodes } from '../src/engine/teamNames';
const seed = Number(process.argv[2] ?? 1);
const s = autoFinishDraft(createDraft(false, activeDraftPool, 'Test', seed));
const teams = s.teams.map((t) => { const roster = finalizeAiRoster(t, draftCapLimit(s)); return { ...t, roster, rotation: aiRotation(roster) }; });
const odds = new Map(evaluateLeague(teams, 2000).map((e) => [e.teamId, e.championshipProbability]));
const season = simulateLiveSeason(teams);
const playoffs = simulateLivePlayoffs(teams, season.standings);
const text = exportFullDraft({ seed, teams, history: s.history, codes: teamCodes(teams), titleOdds: odds, voices: () => [], season, playoffs });
writeFileSync(process.argv[3] ?? `reports/drafts/draft-${seed}.txt`, text);
console.log('wrote', process.argv[3] ?? `reports/drafts/draft-${seed}.txt`, text.length);
