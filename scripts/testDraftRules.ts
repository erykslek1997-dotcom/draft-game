import { createDraft, makePick, availablePlayers } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { canFillRemainingSlots } from '../src/engine/positions';

let state = createDraft();

// --- Test 1: duplicate player prevention ---
state = makePick(state, 'kobe-97-99'); // human drafts Kobe '97-99
const stillAvailable = availablePlayers(state).some((p) => p.playerName === 'Kobe Bryant');
console.log('Test 1 (dedup): Kobe still available after drafting one span?', stillAvailable, stillAvailable ? 'FAIL' : 'PASS');

// --- Test 2: soft-lock prevention ---
// Direct test of the feasibility check that guards makePick: confirm a pick that would
// leave the team unable to afford filling its remaining slots gets blocked.

const cheapPlayers = [...players].sort((a, b) => a.fga - b.fga);
console.log('Cheapest 5 players FGA:', cheapPlayers.slice(0, 5).map((p) => `${p.playerName} ${p.fga}`));

// Simulate: 7 slots filled leaving 2 slots, cap nearly exhausted, cheapest 2 remaining would still fit -> should be allowed.
const okCase = canFillRemainingSlots(cheapPlayers, 2, 20); // plenty of room
console.log('Test 2a (feasible case) canFillRemainingSlots ->', okCase, okCase ? 'PASS' : 'FAIL');

// Simulate: only 0.5 FGA of cap remaining but need to fill 2 more slots -> should be blocked (cheapest 2 players cost far more than 0.5).
const strandedCase = canFillRemainingSlots(cheapPlayers, 2, 0.5);
console.log('Test 2b (stranding case) canFillRemainingSlots ->', strandedCase, strandedCase ? 'FAIL' : 'PASS');

// --- Test 3: makePick itself rejects a stranding pick, end-to-end ---
// Team0 has 3 expensive players (75.0 FGA), leaving 25.9 cap and 5 slots to fill after the next pick.
const threeFillers = ['kobe-05-07', 'iverson-00-02', 'harden-17-19'];
const filledFga = threeFillers.reduce((s, id) => s + players.find((p) => p.id === id)!.fga, 0);
console.log('Three fillers total FGA:', filledFga.toFixed(1));

const team0Roster = threeFillers.map((id) => players.find((p) => p.id === id)!);
let scenario = createDraft();
scenario = { ...scenario, teams: scenario.teams.map((t, i) => (i === 0 ? { ...t, roster: team0Roster } : t)) };
const draftedIds = new Set(threeFillers);
scenario = { ...scenario, draftedIds, round: 0, pickInRound: 0 }; // idx0 = human's turn either way

// Kareem '71-73 (24.6 FGA) would leave only 1.3 cap for the remaining 5 slots -> must be rejected.
const afterStrandingPick = makePick(scenario, 'kareem-71-73');
const pickRejected = afterStrandingPick.teams[0].roster.length === 3;
console.log('Test 3a (stranding pick rejected)?', pickRejected, pickRejected ? 'PASS' : 'FAIL');

// --- Test 4: full simulated drafts never get stuck under the new stranding guard ---
// Every team plays like the AI drafter (with its own randomness); across many runs, the
// draft should always reach all 36 picks — the hard soft-lock guard must never leave a
// team unable to complete its roster.
import { pickForAi } from '../src/engine/aiDrafter';

let allRunsComplete = true;
for (let run = 0; run < 25; run++) {
  let s = createDraft();
  let guard = 0;
  while (!s.complete && guard < 200) {
    const teamIdx = s.round % 2 === 0 ? s.pickInRound : 3 - s.pickInRound;
    const team = s.teams[teamIdx];
    const available = players.filter((p) => !s.draftedIds.has(p.id));
    if (available.length === 0) break;
    const currentFgas = team.roster.map((p) => p.fga);
    const pick = pickForAi(team.roster, currentFgas, available);
    const next = makePick(s, pick.id);
    if (next === s) {
      const spent = currentFgas.reduce((sum, f) => sum + f, 0);
      const slotsLeftAfterPick = 9 - team.roster.length - 1;
      const capRemainingAfterPick = 100.9 - (spent + pick.fga);
      const poolAfterPick = available.filter((p) => p.id !== pick.id && p.playerName !== pick.playerName);
      const uniqueCheapest = new Map<string, number>();
      for (const p of poolAfterPick) {
        const cur = uniqueCheapest.get(p.playerName);
        if (cur === undefined || p.fga < cur) uniqueCheapest.set(p.playerName, p.fga);
      }
      const sortedUnique = [...uniqueCheapest.entries()].sort((a, b) => a[1] - b[1]);
      const neededTop = sortedUnique.slice(0, slotsLeftAfterPick);
      const minCost = neededTop.reduce((sum, [, fga]) => sum + fga, 0);
      console.log(
        `Run ${run} pick#${s.round * 4 + s.pickInRound + 1}: team=${team.name} rosterLen=${team.roster.length} spent=${spent.toFixed(1)} proposed=${pick.playerName}(${pick.fga}) slotsLeftAfter=${slotsLeftAfterPick} capRemainingAfter=${capRemainingAfterPick.toFixed(1)} uniquePlayersAvailable=${uniqueCheapest.size} minCostForSlots=${minCost.toFixed(1)}`,
      );
      console.log('  cheapest unique needed:', neededTop.map(([name, fga]) => `${name} ${fga}`));
      allRunsComplete = false;
      break;
    }
    s = next;
    guard++;
  }
  if (!s.complete && allRunsComplete !== false) allRunsComplete = false;
}
console.log('Test 4 (25 simulated full drafts all complete)?', allRunsComplete, allRunsComplete ? 'PASS' : 'FAIL');

// --- Test 5: deadlock relief for a realistic front-loaded-stars scenario (reproduces
// what happened during live manual testing: human took 3 big-FGA stars in a row, then
// found every remaining option disabled). Team0 takes its first 3 picks as the priciest
// currently-legal options (mirroring that manual test), then plays like a normal drafter.
// The rest of the roster must still be completable via the relief-valve fallback.
import { isPickLegal } from '../src/engine/draft';

let allRealisticRunsComplete = true;
for (let run = 0; run < 15; run++) {
  let s = createDraft();
  let guard = 0;
  while (!s.complete && guard < 200) {
    const teamIdx = s.round % 2 === 0 ? s.pickInRound : 3 - s.pickInRound;
    const team = s.teams[teamIdx];
    const available = players.filter((p) => !s.draftedIds.has(p.id));
    if (available.length === 0) break;

    let pick;
    if (teamIdx === 0 && team.roster.length < 3) {
      const legalSorted = [...available].filter((p) => isPickLegal(s, p.id)).sort((a, b) => b.fga - a.fga);
      pick = legalSorted[0];
      if (!pick) {
        console.log(`Run ${run}: team0 had zero legal picks on pick ${team.roster.length + 1} of its front-loaded stars.`);
        allRealisticRunsComplete = false;
        break;
      }
    } else {
      const currentFgas = team.roster.map((p) => p.fga);
      pick = pickForAi(team.roster, currentFgas, available);
    }

    const next = makePick(s, pick.id);
    if (next === s) {
      const recheck = isPickLegal(s, pick.id);
      const cur = s.teams[teamIdx];
      const currentFgas = cur.roster.map((p) => p.fga);
      console.log(
        `Run ${run}: makePick rejected pick (${pick.playerName}, ${pick.fga} FGA) — isPickLegal recheck=${recheck}, team=${cur.name}, rosterLen=${cur.roster.length}, spent=${currentFgas.reduce((a, b) => a + b, 0).toFixed(1)}, alreadyDrafted=${s.draftedIds.has(pick.id)}`,
      );
      allRealisticRunsComplete = false;
      break;
    }
    s = next;
    guard++;
  }
  if (!s.complete) allRealisticRunsComplete = false;
}
console.log(
  'Test 5 (15 front-loaded-stars drafts all complete via deadlock relief)?',
  allRealisticRunsComplete,
  allRealisticRunsComplete ? 'PASS' : 'FAIL',
);

console.log('\nDone.');
