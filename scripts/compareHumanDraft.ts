/**
 * Compares the user's real 15-team, 9-round human draft (scripts/humanDraftD1.json, 135 picks,
 * transcribed from Desktop/d1.xlsx) against which players the AI drafter NEVER picks across 20
 * simulated 16-team drafts (same methodology as checkNeverDrafted.ts) - do real humans draft
 * players our AI/talent model treats as effectively undraftable?
 */
import { draftPool as players } from '../src/data/draftPool';
import { players as allPlayers } from '../src/data/players';
import type { PlayerSpan } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { ROSTER_SIZE } from '../src/engine/positions';
import humanDraftRaw from './humanDraftD1.json';

const TEAM_COUNT = 16;
const RUNS = 20;

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

const peakTalentByName = new Map<string, number>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const t = computeTalent(p);
  const existing = peakTalentByName.get(key);
  if (existing === undefined || t > existing) peakTalentByName.set(key, t);
}
// Also check the FULL (non-pool-filtered) dataset for peak talent, in case a human pick
// exists in the full dataset but didn't make the 300-player draftPool cut at all.
const peakTalentFullByName = new Map<string, number>();
for (const p of allPlayers) {
  const key = normalizePlayerName(p.playerName);
  const t = computeTalent(p);
  const existing = peakTalentFullByName.get(key);
  if (existing === undefined || t > existing) peakTalentFullByName.set(key, t);
}

const draftCount = new Map<string, number>();
for (const key of peakTalentByName.keys()) draftCount.set(key, 0);

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
console.log(`Human draft: ${humanDraft.length} picks`);

const unmatched: { pick: number; name: string }[] = [];
const notInPool: { pick: number; name: string; fullDatasetTalent: number | undefined }[] = [];
const aiNeverDrafted: { pick: number; name: string; talent: number }[] = [];
const aiAlwaysDrafted: { pick: number; name: string; talent: number; runs: number }[] = [];
const aiSometimesDrafted: { pick: number; name: string; talent: number; runs: number }[] = [];

for (const [pickNum, rawName] of humanDraft) {
  const key = normalizePlayerName(rawName);
  const inPool = peakTalentByName.has(key);
  if (!inPool) {
    const fullTalent = peakTalentFullByName.get(key);
    if (fullTalent === undefined) {
      unmatched.push({ pick: pickNum, name: rawName });
    } else {
      notInPool.push({ pick: pickNum, name: rawName, fullDatasetTalent: fullTalent });
    }
    continue;
  }
  const talent = peakTalentByName.get(key)!;
  const runs = draftCount.get(key) ?? 0;
  if (runs === 0) aiNeverDrafted.push({ pick: pickNum, name: rawName, talent });
  else if (runs >= RUNS) aiAlwaysDrafted.push({ pick: pickNum, name: rawName, talent, runs });
  else aiSometimesDrafted.push({ pick: pickNum, name: rawName, talent, runs });
}

console.log(`\nMatched directly in 300-player draft pool: ${humanDraft.length - unmatched.length - notInPool.length}`);
console.log(`In full dataset but NOT in the 300-player pool (never even a candidate): ${notInPool.length}`);
console.log(`Completely unmatched (name mismatch or missing from dataset entirely): ${unmatched.length}`);

console.log('\n=== Human-drafted players the AI NEVER drafts in 20 sims (the key question) ===');
for (const p of aiNeverDrafted.sort((a, b) => a.pick - b.pick)) {
  console.log(`human pick #${p.pick}: ${p.name.padEnd(25)} aiPeakTalent=${p.talent}`);
}
console.log(`(${aiNeverDrafted.length} such players)`);

console.log('\n=== Human-drafted players NOT in the 300-player pool at all ===');
for (const p of notInPool.sort((a, b) => a.pick - b.pick)) {
  console.log(`human pick #${p.pick}: ${p.name.padEnd(25)} fullDatasetPeakTalent=${p.fullDatasetTalent}`);
}

console.log('\n=== Completely unmatched human picks (check for name/spelling mismatch) ===');
for (const p of unmatched.sort((a, b) => a.pick - b.pick)) {
  console.log(`human pick #${p.pick}: ${p.name}`);
}

console.log(`\nSummary: of ${humanDraft.length} human picks, ${aiAlwaysDrafted.length} are AI-always-drafted, ${aiSometimesDrafted.length} are AI-sometimes-drafted, ${aiNeverDrafted.length} are AI-never-drafted.`);
