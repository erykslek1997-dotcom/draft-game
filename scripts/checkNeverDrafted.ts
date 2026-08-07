/**
 * User's hypothesis: at 16 teams, there's so much star power on the board that some real
 * players simply never get drafted across a whole run, regardless of who they are - "too much
 * star power to pass on." This tracks, across many 16-team drafts, which distinct real players
 * (normalized name) are NEVER picked in any run, vs. picked rarely, vs. picked often - to see
 * whether it's specific weak players falling out (expected/fine) or a broad swath of decent
 * players getting crowded out (a real problem).
 */
import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { ROSTER_SIZE } from '../src/engine/positions';

const TEAM_COUNT = 16;
const RUNS = 20;

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

// Peak talent per distinct real player, for reporting "how good is this player we're never drafting"
const peakTalentByName = new Map<string, number>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const t = computeTalent(p);
  const existing = peakTalentByName.get(key);
  if (existing === undefined || t > existing) peakTalentByName.set(key, t);
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

const totalDistinctPlayers = peakTalentByName.size;
const neverDrafted = [...draftCount.entries()].filter(([, c]) => c === 0);
const rarelyDrafted = [...draftCount.entries()].filter(([, c]) => c > 0 && c < RUNS * 0.25);

console.log(`Total distinct real players in pool: ${totalDistinctPlayers}`);
console.log(`Picks per run: ${TEAM_COUNT * ROSTER_SIZE} (of ${totalDistinctPlayers} available) => at most ${((TEAM_COUNT * ROSTER_SIZE / totalDistinctPlayers) * 100).toFixed(0)}% of the pool per run`);
console.log(`Never drafted in any of ${RUNS} runs: ${neverDrafted.length} / ${totalDistinctPlayers}`);
console.log(`Rarely drafted (<25% of runs): ${rarelyDrafted.length} / ${totalDistinctPlayers}`);

console.log('\n=== Never-drafted players with talent >= 60 (should be draftable - worth investigating) ===');
const neverDraftedGood = neverDrafted
  .map(([name]) => ({ name, talent: peakTalentByName.get(name)! }))
  .filter((p) => p.talent >= 60)
  .sort((a, b) => b.talent - a.talent);
for (const p of neverDraftedGood) {
  console.log(`${p.name.padEnd(25)} peakTalent=${p.talent}`);
}
console.log(`(${neverDraftedGood.length} such players)`);

console.log('\n=== Talent distribution of never-drafted players (all) ===');
const buckets = { '80+': 0, '70-79': 0, '60-69': 0, '50-59': 0, '<50': 0 };
for (const [, ] of neverDrafted) { /* placeholder */ }
for (const [name] of neverDrafted) {
  const t = peakTalentByName.get(name)!;
  if (t >= 80) buckets['80+']++;
  else if (t >= 70) buckets['70-79']++;
  else if (t >= 60) buckets['60-69']++;
  else if (t >= 50) buckets['50-59']++;
  else buckets['<50']++;
}
console.log(buckets);

console.log('\n=== Most-drafted players (picked in every run) sample ===');
const alwaysDrafted = [...draftCount.entries()].filter(([, c]) => c >= RUNS).map(([name, c]) => ({ name, c, talent: peakTalentByName.get(name)! })).sort((a,b) => b.talent - a.talent);
for (const p of alwaysDrafted.slice(0, 15)) {
  console.log(`${p.name.padEnd(25)} talent=${p.talent} drafted in ${p.c}/${RUNS} runs`);
}
