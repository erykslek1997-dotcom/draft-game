// 2026-11-26: a draft the game's way, rosters + rotations saved as JSON (scripts/_scoreRosters.ts re-scores them under knobs).
import { writeFileSync } from 'node:fs';
import { activeDraftPool, autoFinishDraft, createDraft, draftCapLimit } from '../src/engine/draft';
import { aiRotation, finalizeAiRoster } from '../src/engine/finalizeAiRoster';
const seed = Number(process.argv[2]);
const s = autoFinishDraft(createDraft(false, activeDraftPool, 'Test', seed));
const teams = s.teams.map((t) => { const roster = finalizeAiRoster(t, draftCapLimit(s)); return { ...t, roster, rotation: aiRotation(roster) }; });
writeFileSync(process.argv[3], JSON.stringify(teams));
