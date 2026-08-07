/**
 * Empirically calibrates `fitScore`'s `ACHIEVABLE_MIN`/`ACHIEVABLE_MAX` rescale anchors
 * (`scoring.ts`), replacing the old hand-summed analytical bound with a real worst/best-
 * constructible-roster search — same discipline as `calibrateExtremeTeamScores.ts`, adapted for
 * a metric that isn't per-player-decomposable (fitScore depends on the whole starting five's
 * composition together, not a sum of independent per-player scores), so this uses local-search
 * hill-climbing (random legal roster -> repeatedly swap one player for a pool candidate if it
 * improves the target direction) instead of a simple greedy per-slot fill.
 */
import { draftPool as poolAll } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import type { PlayerSpan, Position } from '../src/data/schema';
import { STARTER_SLOTS, ROSTER_SIZE, CAP_LIMIT, isPositionEligible, totalFga } from '../src/engine/positions';
import { autoAssignRotation } from '../src/engine/rotation';
import type { Team } from '../src/engine/types';
import { fitScore } from '../src/engine/scoring';
import { computeOffensivePortability } from '../src/engine/portability';
import { players } from '../src/data/players';

const RESTARTS = 4;
const SWAPS_PER_RESTART = 60;

const pick = (name: string, spanLabel: string): PlayerSpan => {
  const span = players.find((p) => p.playerName === name && p.spanLabel === spanLabel);
  if (!span) throw new Error('missing ' + name + ' ' + spanLabel);
  return span;
};

/** Fills 4 bench slots onto a fixed 5-man starting five, cap-legal, biased toward the given
 * direction (low-O-POR cheap fillers for worst, high-O-POR fillers for best) — a cheap heuristic
 * seed for the local search below to refine further, not a claim of optimality on its own. */
function fillBench(starters: PlayerSpan[], direction: 1 | -1): PlayerSpan[] {
  const used = new Set(starters.map((p) => normalizePlayerName(p.playerName)));
  const roster = [...starters];
  const sorted = [...poolAll]
    .filter((p) => !used.has(normalizePlayerName(p.playerName)))
    .sort((a, b) => direction * (computeOffensivePortability(b) - computeOffensivePortability(a)));
  for (const cand of sorted) {
    if (roster.length >= ROSTER_SIZE) break;
    const key = normalizePlayerName(cand.playerName);
    if (used.has(key)) continue;
    if (totalFga([...roster.map((r) => r.fga), cand.fga]) > CAP_LIMIT) continue;
    roster.push(cand);
    used.add(key);
  }
  return roster;
}

const badSeedStarters = [
  pick('Ben Simmons', '2017-19'),
  pick('David Thompson', '1976-78'),
  pick('Alex English', '1981-83'),
  pick('Elton Brand', '2005-07'),
  pick("Amar'e Stoudemire", '2007-09'),
];
const goodSeedStarters = [
  pick('Kyle Lowry', '2015-17'),
  pick('Jrue Holiday', '2021-23'),
  pick('LeBron James', '2008-10'),
  pick('Paul Millsap', '2013-15'),
  pick('Brook Lopez', '2022-24'),
];
// The user's own 5-man BAD example is high-usage enough (Simmons+Thompson+English+Brand+
// Stoudemire) that there isn't enough cap room left under CAP_LIMIT for a full 4-man bench —
// `fillBench` can legitimately fall short of ROSTER_SIZE here, which isn't a bug, it means this
// specific five isn't extendable to a cap-legal 9-man roster at all. Only used as a seed when it
// actually reaches ROSTER_SIZE; the direct, unpadded 5-man version of this exact test lives in
// `scripts/checkFitZeroHundred.ts` (no cap/bench complication) and is the real acceptance check.
const worstSeedRaw = fillBench(badSeedStarters, -1);
const bestSeedRaw = fillBench(goodSeedStarters, 1);
const worstSeed = worstSeedRaw.length === ROSTER_SIZE ? worstSeedRaw : undefined;
const bestSeed = bestSeedRaw.length === ROSTER_SIZE ? bestSeedRaw : undefined;
console.log('worst seed reached', worstSeedRaw.length, '/', ROSTER_SIZE, 'raw:', worstSeed ? fitScore(team(worstSeed)).raw : 'N/A (unused)');
console.log('best seed reached', bestSeedRaw.length, '/', ROSTER_SIZE, 'raw:', bestSeed ? fitScore(team(bestSeed)).raw : 'N/A (unused)');

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function team(roster: PlayerSpan[]): Team {
  const t: Team = { id: 't', name: 'x', draftSlot: 1, isHuman: true, roster, rotation: null };
  t.rotation = autoAssignRotation(roster);
  return t;
}

function isLegalRoster(roster: PlayerSpan[]): boolean {
  if (roster.length !== ROSTER_SIZE) return false;
  const names = new Set(roster.map((p) => normalizePlayerName(p.playerName)));
  if (names.size !== roster.length) return false;
  return totalFga(roster.map((p) => p.fga)) <= CAP_LIMIT;
}

function randomLegalRoster(): PlayerSpan[] | null {
  for (let attempt = 0; attempt < 20; attempt++) {
    const roster: PlayerSpan[] = [];
    const used = new Set<string>();
    let ok = true;
    for (const slot of STARTER_SLOTS) {
      const candidates = shuffle(poolAll.filter((p) => isPositionEligible(p, slot) && !used.has(normalizePlayerName(p.playerName))));
      const pick = candidates.find((p) => totalFga([...roster.map((r) => r.fga), p.fga]) <= CAP_LIMIT * 0.85);
      if (!pick) {
        ok = false;
        break;
      }
      roster.push(pick);
      used.add(normalizePlayerName(pick.playerName));
    }
    if (!ok) continue;
    while (roster.length < ROSTER_SIZE) {
      const candidates = shuffle(poolAll.filter((p) => !used.has(normalizePlayerName(p.playerName))));
      const pick = candidates.find((p) => totalFga([...roster.map((r) => r.fga), p.fga]) <= CAP_LIMIT);
      if (!pick) {
        ok = false;
        break;
      }
      roster.push(pick);
      used.add(normalizePlayerName(pick.playerName));
    }
    if (ok && isLegalRoster(roster)) return roster;
  }
  return null;
}

function hillClimb(direction: 1 | -1, seed?: PlayerSpan[]): { roster: PlayerSpan[]; raw: number } | null {
  let roster = seed ?? randomLegalRoster();
  if (!roster) return null;
  let bestRaw = fitScore(team(roster)).raw;
  for (let i = 0; i < SWAPS_PER_RESTART; i++) {
    const idx = Math.floor(Math.random() * roster.length);
    const used = new Set(roster.filter((_, j) => j !== idx).map((p) => normalizePlayerName(p.playerName)));
    const otherFgas = roster.filter((_, j) => j !== idx).map((p) => p.fga);
    const candidates = poolAll.filter(
      (p) => !used.has(normalizePlayerName(p.playerName)) && totalFga([...otherFgas, p.fga]) <= CAP_LIMIT,
    );
    if (candidates.length === 0) continue;
    const sample = shuffle(candidates).slice(0, 10); // bounded per-swap search for speed
    let improved = false;
    for (const cand of sample) {
      const trial = [...roster];
      trial[idx] = cand;
      if (trial.length !== ROSTER_SIZE) throw new Error(`trial length ${trial.length} != ${ROSTER_SIZE} at idx=${idx}`);
      const raw = fitScore(team(trial)).raw;
      if (direction === 1 ? raw > bestRaw : raw < bestRaw) {
        bestRaw = raw;
        roster = trial;
        improved = true;
      }
    }
    if (roster.length !== ROSTER_SIZE) throw new Error(`roster length ${roster.length} != ${ROSTER_SIZE} after swap loop, i=${i}`);
    if (!improved && i > 100 && i % 50 === 0) {
      // occasional random restart-from-current to escape local optima
      const idx2 = Math.floor(Math.random() * roster.length);
      const cand = shuffle(candidates)[0];
      if (cand) {
        const trial = [...roster];
        trial[idx2] = cand;
        roster = trial;
      }
    }
  }
  return { roster, raw: bestRaw };
}

let worst = Infinity;
let worstRoster: PlayerSpan[] = [];
let best = -Infinity;
let bestRoster: PlayerSpan[] = [];

for (let r = 0; r < RESTARTS; r++) {
  const w = hillClimb(-1, r === 0 ? worstSeed : undefined);
  if (w && w.raw < worst) {
    worst = w.raw;
    worstRoster = w.roster;
  }
  const b = hillClimb(1, r === 0 ? bestSeed : undefined);
  if (b && b.raw > best) {
    best = b.raw;
    bestRoster = b.roster;
  }
  console.log(`restart ${r}: worst-so-far=${worst.toFixed(1)} best-so-far=${best.toFixed(1)}`);
}

console.log('\n=== WORST raw =', worst.toFixed(1), '===');
for (const p of worstRoster) console.log(' ', p.playerName, p.spanLabel, p.primaryPosition);
console.log('\n=== BEST raw =', best.toFixed(1), '===');
for (const p of bestRoster) console.log(' ', p.playerName, p.spanLabel, p.primaryPosition);

console.log(`\nPaste into scoring.ts: const ACHIEVABLE_MIN = ${Math.floor(worst)}; const ACHIEVABLE_MAX = ${Math.ceil(best)};`);
