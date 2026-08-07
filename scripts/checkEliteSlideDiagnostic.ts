/**
 * Diagnostic for the user's hypothesis ("maybe AI doesn't weigh FGA enough in rounds 1-2, so
 * elite players slide") behind repeated playtest feedback ("Jokic/Paul George/Giannis/Bird
 * slide too far"). Two parts:
 *  1. Analytic check of fgaPenalty's actual value across a team's own pick indices 0-8.
 *  2. Simulated 16-team drafts (real draftPool) tracking exact overall pick number for every
 *     TAL>=90 span, to see whether "sliding" is explained by pool depth/lottery variance
 *     rather than cost-penalty.
 */
import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { ROSTER_SIZE } from '../src/engine/positions';

const TEAM_COUNT = 16;
const RUNS = 25;

// ---- Part 1: analytic fgaPenalty by own-pick-index ----
const CAP_LIMIT = 100.9; // mirrors positions.ts
const COMFORTABLE_BUDGET_PER_SLOT = CAP_LIMIT / ROSTER_SIZE;
const COMFORT_SLOTS_LEFT = 4;
const BASE_FGA_PENALTY = 0.4;
const MAX_FGA_PENALTY = 1.3;

console.log('=== Part 1: fgaPenalty by a team\'s own pick index (assumes on-budget spending) ===');
console.log('ownPickIdx\tslotsLeft\tslotsLeftPressure\tfgaPenalty(on-budget)');
for (let i = 0; i < ROSTER_SIZE; i++) {
  const slotsLeft = ROSTER_SIZE - i;
  const slotsLeftPressure = Math.max(0, Math.min(1, (COMFORT_SLOTS_LEFT - slotsLeft) / COMFORT_SLOTS_LEFT));
  const pressure = slotsLeftPressure; // budgetPressure ~0 if spending stays proportional
  const fgaPenalty = BASE_FGA_PENALTY + pressure * (MAX_FGA_PENALTY - BASE_FGA_PENALTY);
  console.log(`${i}\t\t${slotsLeft}\t\t${slotsLeftPressure.toFixed(2)}\t\t\t${fgaPenalty.toFixed(2)}`);
}

// ---- Pool depth context ----
const bestSpanByName = new Map<string, PlayerSpan>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const existing = bestSpanByName.get(key);
  if (!existing || computeTalent(p) > computeTalent(existing)) bestSpanByName.set(key, p);
}
const talents = [...bestSpanByName.values()].map((p) => computeTalent(p)).sort((a, b) => b - a);
console.log(`\nPool: ${bestSpanByName.size} distinct players. TAL>=95: ${talents.filter((t) => t >= 95).length}, TAL>=90: ${talents.filter((t) => t >= 90).length}, TAL>=85: ${talents.filter((t) => t >= 85).length}`);
console.log('Top 20 by peak TAL:', talents.slice(0, 20).join(', '));

// ---- Part 2: simulated drafts, track pick numbers ----
function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

const TRACK_NAMES = ['Nikola Jokic', 'Paul George', 'Giannis Antetokounmpo', 'Larry Bird', 'Anthony Davis', 'Chris Paul', "Shaquille O'Neal", 'Patrick Ewing', 'Michael Jordan'];
const trackKeys = new Set(TRACK_NAMES.map(normalizePlayerName));
const pickNumbersByName = new Map<string, number[]>();
for (const n of TRACK_NAMES) pickNumbersByName.set(n, []);

const allPickNumbersByTalBucket: Record<string, number[]> = { '95+': [], '90-94': [], '85-89': [] };

for (let run = 0; run < RUNS; run++) {
  const teams: PlayerSpan[][] = Array.from({ length: TEAM_COUNT }, () => []);
  const draftedIds = new Set<string>();
  let overallPick = 0;
  for (let round = 0; round < ROSTER_SIZE; round++) {
    for (let pickInRound = 0; pickInRound < TEAM_COUNT; pickInRound++) {
      overallPick++;
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

      if (trackKeys.has(key)) {
        const canonical = TRACK_NAMES.find((n) => normalizePlayerName(n) === key)!;
        pickNumbersByName.get(canonical)!.push(overallPick);
      }
      const tal = computeTalent(pick);
      if (tal >= 95) allPickNumbersByTalBucket['95+'].push(overallPick);
      else if (tal >= 90) allPickNumbersByTalBucket['90-94'].push(overallPick);
      else if (tal >= 85) allPickNumbersByTalBucket['85-89'].push(overallPick);
    }
  }
}

console.log(`\n=== Part 2: over ${RUNS} simulated 16-team drafts ===`);
console.log('\nTracked elite players — pick number distribution:');
for (const n of TRACK_NAMES) {
  const picks = pickNumbersByName.get(n)!;
  if (picks.length === 0) { console.log(`${n}: never drafted in ${RUNS} runs (!)`); continue; }
  const avg = picks.reduce((s, v) => s + v, 0) / picks.length;
  const min = Math.min(...picks);
  const max = Math.max(...picks);
  console.log(`${n.padEnd(24)} n=${picks.length}/${RUNS}  avg pick=${avg.toFixed(1)}  range=[${min}-${max}]  all=${picks.join(',')}`);
}

console.log('\nPick-number distribution by TAL bucket (all players, all runs):');
for (const [bucket, picks] of Object.entries(allPickNumbersByTalBucket)) {
  if (picks.length === 0) continue;
  const avg = picks.reduce((s, v) => s + v, 0) / picks.length;
  const sorted = [...picks].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`TAL ${bucket}: n=${picks.length}, avg pick=${avg.toFixed(1)}, median=${median}, min=${sorted[0]}, max=${sorted[sorted.length - 1]}`);
}
