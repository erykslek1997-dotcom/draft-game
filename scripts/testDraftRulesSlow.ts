import { TEAM_COUNT, autoFinishDraft, createDraft } from '../src/engine/draft';
import { CAP_LIMIT, ROSTER_SIZE, totalFga } from '../src/engine/positions';

/**
 * 2026-09-05: split out of testDraftRules.ts — this is the one part of that file slow enough to
 * matter (a full 16-team/9-round synchronous auto-finish over the real ~1223-player pool, twice).
 * Kept in `npm test` for full correctness, but excluded from `npm run test:fast` so iterating on
 * an unrelated change doesn't have to wait on it every time. See testInsightsSlow.ts's own
 * docstring for the same split applied to the other slow script.
 */

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
  console.log('\nAll draft regression (slow) tests passed.');
}
