/**
 * Regression check for Phase D's `marginalStarterValue` (aiDrafter.ts) — the "draft nie planuje
 * pod rolę w rotacji" fix. Measures, across simulated 16-team drafts, how often a real-talent
 * (TAL>=85) player ends up buried (<12 total rotation minutes) — the Ewing/Jokić/Kirilenko/Nash
 * pattern named in the user's feedback. Same simulation shape as
 * `scripts/checkEliteSlideDiagnostic.ts`.
 */
import { draftPool as players } from '../src/data/draftPool';
import type { PlayerSpan } from '../src/data/schema';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, totalMinutesForPlayer } from '../src/engine/rotation';
import { ROSTER_SIZE } from '../src/engine/positions';

const TEAM_COUNT = 16;
const RUNS = Number(process.argv[2] ?? 6);
const BURIED_MINUTES_THRESHOLD = 20;
const TAL_FLOOR = 75;

function snakeOrderIndex(round: number, pickInRound: number, teamCount: number): number {
  return round % 2 === 0 ? pickInRound : teamCount - 1 - pickInRound;
}

const TRACK_NAMES = ['Patrick Ewing', 'Nikola Jokic', 'Andrei Kirilenko', 'Steve Nash'];
const trackKeys = new Set(TRACK_NAMES.map(normalizePlayerName));
const trackedResults: { name: string; span: string; pick: number; minutes: number; tal: number }[] = [];

let buriedCount = 0;
let eligibleCount = 0;
const eligibleMinutes: number[] = [];
const start = Date.now();

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
    }
  }

  for (const roster of teams) {
    const rotation = autoAssignRotation(roster);
    for (const p of roster) {
      const tal = computeTalent(p);
      const minutes = totalMinutesForPlayer(rotation, p.id);
      if (tal >= TAL_FLOOR) {
        eligibleCount++;
        eligibleMinutes.push(minutes);
        if (minutes < BURIED_MINUTES_THRESHOLD) buriedCount++;
      }
      if (trackKeys.has(normalizePlayerName(p.playerName))) {
        trackedResults.push({ name: p.playerName, span: p.spanLabel, pick: -1, minutes, tal });
      }
    }
  }
  console.log(`run ${run + 1}/${RUNS} done (${((Date.now() - start) / 1000).toFixed(0)}s elapsed)`);
}

console.log(`\n=== Bench-buried-star rate over ${RUNS} simulated 16-team drafts ===`);
console.log(`TAL>=${TAL_FLOOR} spans drafted: ${eligibleCount}. Buried (<${BURIED_MINUTES_THRESHOLD} min): ${buriedCount} (${((buriedCount / eligibleCount) * 100).toFixed(1)}%)`);
const avgMinutes = eligibleMinutes.reduce((s, v) => s + v, 0) / eligibleMinutes.length;
const sortedMin = [...eligibleMinutes].sort((a, b) => a - b);
console.log(`Average minutes: ${avgMinutes.toFixed(1)}. Distribution: 0min=${sortedMin.filter((m) => m === 0).length}, <12=${sortedMin.filter((m) => m < 12).length}, 12-19=${sortedMin.filter((m) => m >= 12 && m < 20).length}, 20-29=${sortedMin.filter((m) => m >= 20 && m < 30).length}, 30+=${sortedMin.filter((m) => m >= 30).length}`);

console.log('\nTracked named cases (Ewing/Jokić/Kirilenko/Nash) — minutes each time drafted:');
for (const n of TRACK_NAMES) {
  const rows = trackedResults.filter((r) => normalizePlayerName(r.name) === normalizePlayerName(n));
  if (rows.length === 0) {
    console.log(`${n}: never drafted in ${RUNS} runs`);
    continue;
  }
  const buried = rows.filter((r) => r.minutes < BURIED_MINUTES_THRESHOLD).length;
  console.log(`${n.padEnd(20)} n=${rows.length}  buried=${buried}  minutes=${rows.map((r) => r.minutes).join(',')}`);
}
