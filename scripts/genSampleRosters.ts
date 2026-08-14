/**
 * 2026-08-13: generates N full AI-vs-AI seeded drafts (16 teams each) for Claude to read and
 * qualitatively judge directly, the same way the 15 real D1 rosters were judged
 * (`analyzeD1HumanVote.ts`) — building a much bigger sample than the real n=15 human-vote set to
 * find more statistically robust patterns in what a holistic read weighs, per the user's own
 * "multi-judge ensemble" direction (see [[multi_judge_ensemble_vision]] memory). Output is a
 * plain-text roster dump, not scored — scoring/reading happens in a separate pass by Claude
 * itself, not this script, to keep the sample genuinely blind (no engine numbers shown alongside
 * the roster while judging, same as the D1 read).
 */
import { autoFinishDraft, createDraft } from '../src/engine/draft';
import { writeFileSync } from 'node:fs';

const DRAFTS = Number(process.env.DRAFTS ?? 3);
const SEED_BASE = Number(process.env.SEED_BASE ?? 555_000);

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let out = '';
let globalTeamId = 1;
for (let d = 0; d < DRAFTS; d++) {
  const rand = seededRandom(SEED_BASE + d * 7919);
  const originalRandom = Math.random;
  Math.random = rand;
  let state = createDraft(false);
  state = autoFinishDraft(state);
  Math.random = originalRandom;

  for (const team of state.teams) {
    if (team.roster.length < 8) continue; // incomplete, skip
    out += `\n=== TEAM ${globalTeamId} (draft ${d + 1}) ===\n`;
    for (const p of team.roster) {
      out += `${p.primaryPosition}\t${p.playerName} ${p.spanLabel}\tPPG ${p.box.ppg.toFixed(1)} RPG ${p.box.rpg.toFixed(1)} APG ${p.box.apg.toFixed(1)}\n`;
    }
    globalTeamId++;
  }
}
writeFileSync('reports/sample-rosters-for-claude-read.txt', out);
console.log('Wrote', globalTeamId - 1, 'team rosters to reports/sample-rosters-for-claude-read.txt');
