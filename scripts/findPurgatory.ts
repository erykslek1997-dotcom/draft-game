/**
 * "Purgatory": players in the 300-player draft pool that BOTH the AI (across 20 simulated
 * 16-team drafts) and the real human draft (scripts/humanDraftD1.json) never touch. Task 1 of
 * the user's 3-part follow-up to compareHumanDraft.ts - a review file, not an automatic cut.
 */
import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { computePortability } from '../src/engine/portability';
import { ROSTER_SIZE } from '../src/engine/positions';
import humanDraftRaw from './humanDraftD1.json';
import { writeFileSync } from 'fs';

const TEAM_COUNT = 16;
const RUNS = 20;

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

const bestSpanByName = new Map<string, PlayerSpan>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const existing = bestSpanByName.get(key);
  if (!existing || computeTalent(p) > computeTalent(existing)) bestSpanByName.set(key, p);
}

const draftCount = new Map<string, number>();
for (const key of bestSpanByName.keys()) draftCount.set(key, 0);

for (let run = 0; run < RUNS; run++) {
  const teams: PlayerSpan[][] = Array.from({ length: TEAM_COUNT }, () => []);
  const draftedIds = new Set<string>();
  for (let round = 0; round < ROSTER_SIZE; round++) {
    for (let pickInRound = 0; pickInRound < TEAM_COUNT; pickInRound++) {
      const teamIdx = snakeOrderIndex(round, pickInRound, TEAM_COUNT);
      const roster = teams[teamIdx];
      const available = players.filter((p) => !draftedIds.has(p.id));
      if (available.length === 0) continue;
      const currentFgas = roster.map((p) => p.fga);
      const pick = pickForAi(roster, currentFgas, available, TEAM_COUNT);
      const key = normalizePlayerName(pick.playerName);
      for (const p of players) {
        if (normalizePlayerName(p.playerName) === key) draftedIds.add(p.id);
      }
      roster.push(pick);
      draftCount.set(key, (draftCount.get(key) ?? 0) + 1);
    }
  }
}

const humanDraft = humanDraftRaw as [number, string][];
const humanDraftedKeys = new Set(humanDraft.map(([, name]) => normalizePlayerName(name)));

const purgatory: { name: string; position: string; talent: number; por: number }[] = [];
for (const [key, span] of bestSpanByName.entries()) {
  const aiCount = draftCount.get(key) ?? 0;
  if (aiCount > 0) continue;
  if (humanDraftedKeys.has(key)) continue;
  purgatory.push({ name: span.playerName, position: span.primaryPosition, talent: computeTalent(span), por: computePortability(span) });
}
purgatory.sort((a, b) => b.talent - a.talent);

console.log(`Pool size: ${players.length === 0 ? 0 : bestSpanByName.size} distinct players`);
console.log(`AI-never-drafted (20 runs): ${[...draftCount.values()].filter((c) => c === 0).length}`);
console.log(`Human-drafted (matched to pool): ${[...bestSpanByName.keys()].filter((k) => humanDraftedKeys.has(k)).length}`);
console.log(`Purgatory (never AI, never human): ${purgatory.length}`);

const lines = ['name,position,peak_talent,portability', ...purgatory.map((p) => `${p.name},${p.position},${p.talent},${p.por}`)];
const outPath = 'scripts/output_purgatoryCandidates.csv';
writeFileSync(outPath, lines.join('\n'));
console.log(`Wrote ${outPath}`);
