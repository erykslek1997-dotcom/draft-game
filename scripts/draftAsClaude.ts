/**
 * 2026-08-13: lets Claude draft one real team, pick by pick, using its own basketball judgment
 * instead of `pickForAi` — the other 15 teams stay on the normal AI logic. Deterministic REPLAY
 * design (no state persistence, no Set/complex-object serialization needed): every invocation
 * re-runs the SAME seeded draft from scratch and re-applies the picks Claude has already chosen
 * (passed in via --picks), so the AI teams' behavior is identical every time. Stops at the next
 * point Claude needs to decide (or at draft completion) and prints the legal available pool for
 * Claude to read and choose from, plus what `pickForAi` would have picked at that exact same
 * moment — the real, live "what would the engine do here" comparison the user asked for.
 *
 * Usage: npx tsx scripts/draftAsClaude.ts --seed 12345 --picks "LeBron James|2012-14,Ray Allen|2000-02"
 * (--picks omitted or with fewer entries than picks-so-far just stops earlier)
 */
import { createDraft, isPickLegal, makePick, resolveAiPickIfNeeded, availablePlayers, currentTeamIndex } from '../src/engine/draft';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { CAP_LIMIT } from '../src/engine/positions';
import type { PlayerSpan } from '../src/data/schema';

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

const args = process.argv.slice(2);
function argVal(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const seed = Number(argVal('--seed') ?? '1');
const picksArg = argVal('--picks') ?? '';
const desiredPicks = picksArg.length > 0 ? picksArg.split(',').map((s) => s.trim()) : [];

const rand = seededRandom(seed);
const originalRandom = Math.random;
Math.random = rand;
let state = createDraft(false);

let humanIdx = state.teams.findIndex((t) => t.isHuman);
let pickCursor = 0;

while (!state.complete) {
  const teamIdx = currentTeamIndex(state);
  if (teamIdx !== humanIdx) {
    const next = resolveAiPickIfNeeded(state);
    if (!next) break;
    state = next;
    continue;
  }
  // human's turn
  if (pickCursor < desiredPicks.length) {
    const want = desiredPicks[pickCursor];
    const [name, span] = want.split('|').map((s) => s.trim());
    const available = availablePlayers(state);
    const match = available.find((p) => p.playerName === name && p.spanLabel === span);
    if (!match) {
      console.log(`ERROR: "${want}" not found in available pool (already drafted, or bad name/span).`);
      process.exit(1);
    }
    if (!isPickLegal(state, match.id)) {
      console.log(`ERROR: "${want}" is not a cap/roster-legal pick right now.`);
      process.exit(1);
    }
    state = makePick(state, match.id);
    pickCursor++;
    continue;
  }
  // Out of pre-decided picks -- stop here and show the decision point.
  break;
}
Math.random = originalRandom;

const humanTeam = state.teams[humanIdx];
console.log(`\n=== Claude's team: "${humanTeam.name}" (draft slot #${humanTeam.draftSlot}) ===`);
console.log('Roster so far:');
let spent = 0;
for (const p of humanTeam.roster) {
  spent += p.fga;
  console.log(`  ${p.primaryPosition}\t${p.playerName} ${p.spanLabel}\tFGA ${p.fga.toFixed(1)}\tPPG ${p.box.ppg.toFixed(1)} RPG ${p.box.rpg.toFixed(1)} APG ${p.box.apg.toFixed(1)}`);
}
console.log(`Cap used: ${spent.toFixed(1)} / ${CAP_LIMIT}, remaining: ${(CAP_LIMIT - spent).toFixed(1)}`);

if (state.complete) {
  console.log('\n*** DRAFT COMPLETE ***');
  process.exit(0);
}

const teamIdx = currentTeamIndex(state);
if (teamIdx !== humanIdx) {
  console.log('\n(unexpected: not the human turn and not complete -- state machine stuck)');
  process.exit(1);
}

console.log(`\n=== Pick ${state.round * 16 + state.pickInRound + 1} of 144 -- Round ${state.round + 1} -- YOUR TURN ===`);

// What the engine's own AI would pick right here, for direct comparison.
const currentFgas = humanTeam.roster.map((p) => p.fga);
const available = availablePlayers(state);
const enginePick = pickForAi(humanTeam.roster, currentFgas, available);
console.log(`Engine (pickForAi) would take: ${enginePick.playerName} ${enginePick.spanLabel} (TAL ${computeTalent(enginePick)}, FGA ${enginePick.fga.toFixed(1)})`);

// Legal pool, grouped by position, sorted by FGA (cost) within each -- deliberately NOT sorted
// by TAL, so Claude reads real box-score value/fit, not the engine's own talent ranking.
const legal = available.filter((p) => isPickLegal(state, p.id));
const byPos = new Map<string, PlayerSpan[]>();
for (const p of legal) {
  const arr = byPos.get(p.primaryPosition) ?? [];
  arr.push(p);
  byPos.set(p.primaryPosition, arr);
}
console.log(`\nLegal available pool (${legal.length} spans), grouped by position, top 30 by FGA (usage/volume -- a real box-score number, not the engine's talent ranking) shown per group:`);
for (const [pos, spans] of [...byPos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`\n-- ${pos} (${spans.length} legal) --`);
  const sorted = [...spans].sort((a, b) => b.fga - a.fga).slice(0, 30);
  for (const p of sorted) {
    console.log(`  ${p.playerName} ${p.spanLabel}\tFGA ${p.fga.toFixed(1)}\tPPG ${p.box.ppg.toFixed(1)} RPG ${p.box.rpg.toFixed(1)} APG ${p.box.apg.toFixed(1)} SPG ${p.box.spg.toFixed(1)} BPG ${p.box.bpg.toFixed(1)} FG% ${(p.box.fgPct * 100).toFixed(1)} 3P% ${(p.box.threePct * 100).toFixed(1)}`);
  }
}
