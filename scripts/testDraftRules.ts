import {
  ROUNDS,
  TEAM_COUNT,
  activeDraftPool,
  autoFinishDraft,
  availablePlayers,
  createDraft,
  currentTeamIndex,
  isPickLegal,
  makePick,
  snakeOrderIndex,
  type DraftState,
} from '../src/engine/draft';
import { CAP_LIMIT, ROSTER_SIZE, canFillRemainingSlots, totalFga } from '../src/engine/positions';
import { normalizePlayerName } from '../src/data/schema';

let failures = 0;

function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`PASS: ${label}`);
    return;
  }
  failures++;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
}

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

function withCurrentTeam(state: DraftState, rosterIds: string[], isHuman: boolean): DraftState {
  const roster = rosterIds.map((id) => {
    const player = activeDraftPool.find((p) => p.id === id);
    if (!player) throw new Error(`Missing active-pool test player: ${id}`);
    return player;
  });
  const current = currentTeamIndex(state);
  const rosterNames = new Set(roster.map((player) => normalizePlayerName(player.playerName)));
  return {
    ...state,
    teams: state.teams.map((team, index) => ({
      ...team,
      isHuman: index === current ? isHuman : false,
      roster: index === current ? roster : team.roster,
    })),
    draftedIds: new Set(
      activeDraftPool
        .filter((player) => rosterNames.has(normalizePlayerName(player.playerName)))
        .map((player) => player.id),
    ),
  };
}

function distinctPlayersByName(players: typeof activeDraftPool): typeof activeDraftPool {
  const seen = new Set<string>();
  return players.filter((player) => {
    const name = normalizePlayerName(player.playerName);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

console.log(`Testing the active configuration: ${TEAM_COUNT} teams × ${ROUNDS} rounds, ${activeDraftPool.length} pool entries.`);

// Snake order must visit every team exactly once per round and reverse on odd rounds.
for (let round = 0; round < ROUNDS; round++) {
  const order = Array.from({ length: TEAM_COUNT }, (_, pick) => snakeOrderIndex(round, pick));
  check(new Set(order).size === TEAM_COUNT, `round ${round + 1} visits every team exactly once`);
  check(order[0] === (round % 2 === 0 ? 0 : TEAM_COUNT - 1), `round ${round + 1} starts at the correct end`);
}

// A real production-pool pick must advance and remove the selected real player.
let duplicateState = createDraft();
const firstPick = [...activeDraftPool].sort((a, b) => b.fga - a.fga).find((p) => isPickLegal(duplicateState, p.id));
if (!firstPick) throw new Error('No legal opening pick in the production peak pool.');
duplicateState = makePick(duplicateState, firstPick.id);
check(duplicateState.history.length === 1, 'a legal opening pick advances the draft');
check(
  !availablePlayers(duplicateState).some(
    (p) => normalizePlayerName(p.playerName) === normalizePlayerName(firstPick.playerName),
  ),
  'a drafted player is no longer available',
);

// Human and CPU teams must face exactly the same cap legality. Build a real four-player,
// high-usage roster, then compare one candidate that fits with one that exceeds the cap.
const distinctByDescendingFga = distinctPlayersByName([...activeDraftPool].sort((a, b) => b.fga - a.fga));
const expensiveCore = distinctByDescendingFga.slice(0, 3);
const expensiveCoreNames = new Set(expensiveCore.map((player) => normalizePlayerName(player.playerName)));
const cheapFourth = distinctPlayersByName([...activeDraftPool].sort((a, b) => a.fga - b.fga)).find(
  (player) => !expensiveCoreNames.has(normalizePlayerName(player.playerName)),
);
if (!cheapFourth) throw new Error('Could not find a distinct low-FGA player for the cap-equality test scenario.');
const expensiveRoster = [...expensiveCore, cheapFourth];
const expensiveIds = expensiveRoster.map((p) => p.id);
const spent = totalFga(expensiveRoster.map((p) => p.fga));
const expensiveNames = new Set(expensiveRoster.map((player) => normalizePlayerName(player.playerName)));
const remaining = activeDraftPool.filter((player) => !expensiveNames.has(normalizePlayerName(player.playerName)));
const capLegalCandidate = [...remaining].sort((a, b) => a.fga - b.fga).find((p) => spent + p.fga <= CAP_LIMIT);
const overCapCandidate = [...remaining].sort((a, b) => b.fga - a.fga).find((p) => spent + p.fga > CAP_LIMIT);
if (!capLegalCandidate || !overCapCandidate) throw new Error('Could not construct the cap-equality test scenario.');

const humanScenario = withCurrentTeam(createDraft(), expensiveIds, true);
const cpuScenario = withCurrentTeam(createDraft(), expensiveIds, false);
check(isPickLegal(humanScenario, capLegalCandidate.id), 'human can make a cap-legal pick');
check(isPickLegal(cpuScenario, capLegalCandidate.id), 'CPU can make the same cap-legal pick');
check(!isPickLegal(humanScenario, overCapCandidate.id), 'human cannot bypass the FGA cap');
check(!isPickLegal(cpuScenario, overCapCandidate.id), 'CPU cannot bypass the FGA cap');

const cheapest = [...activeDraftPool].sort((a, b) => a.fga - b.fga);
check(canFillRemainingSlots(cheapest, 2, 20), 'lookahead accepts a feasible two-slot finish');
check(!canFillRemainingSlots(cheapest, 2, 0.5), 'lookahead rejects an impossible two-slot finish');

// Exercise the real synchronous auto-finish path with deterministic random sequences. These are
// regression tests, not a statistical simulation: their job is to prove progress, completion,
// roster size and cap invariants against the same pool/configuration the browser uses.
const originalRandom = Math.random;
try {
  for (const seed of [7, 29]) {
    Math.random = seededRandom(seed);
    const finished = autoFinishDraft(createDraft());
    check(finished.complete, `seed ${seed}: auto-finish completes`);
    check(finished.history.length === TEAM_COUNT * ROSTER_SIZE, `seed ${seed}: records every pick`);
    check(
      finished.teams.every((team) => team.roster.length === ROSTER_SIZE),
      `seed ${seed}: every team has ${ROSTER_SIZE} players`,
    );
    check(
      finished.teams.every((team) => totalFga(team.roster.map((p) => p.fga)) <= CAP_LIMIT),
      `seed ${seed}: every team stays at or below ${CAP_LIMIT} FGA`,
    );
  }
} finally {
  Math.random = originalRandom;
}

if (failures > 0) {
  console.error(`\n${failures} draft regression test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll draft regression tests passed.');
}
