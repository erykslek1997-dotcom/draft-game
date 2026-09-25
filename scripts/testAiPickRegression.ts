/**
 * AI draft-pick regression fixture (audit AI-3). `pickForAi`'s value formula is a stack of ~12
 * hand-tuned bonus/malus terms, each individually justified by a playtest complaint but never
 * pinned as a whole. This freezes the AI's actual output.
 *
 * The BASELINE (`aiPickRegression.baseline.json`) captures ~30 real mid-draft snapshots — the
 * on-the-clock team's roster + the set of already-drafted players + the seeded pick number —
 * taken from a few seeded 16-team drafts, each with the exact player `pickForAi` chose there.
 * The TEST replays only those ~30 `pickForAi` calls (no full drafts), so it stays fast enough
 * for `npm test`. Any change to the value formula, the lottery, the phase filters, the candidate
 * pool, or a rostered player's data that moves one of these picks fails here.
 *
 * Snapshots sit in the draft's first four rounds — where the value formula, the first-pick
 * lottery, the need ramp, the redundancy discounts and the starter-lock phase all do their work.
 * Regenerate with `--update` after a *deliberate* AI change (steps a few full drafts — a couple
 * of minutes).
 *
 * Determinism comes from the seeded RNG (draft.ts's `seed` → `mulberry32(mixSeed(seed, pickNumber))`,
 * the same stream `resolveAutomatedPick` builds); see AI-2 in the same audit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createDraft,
  currentTeamIndex,
  resolveAiPickIfNeeded,
  activeDraftPool,
  type DraftState,
} from '../src/engine/draft';
import { pickForAi } from '../src/engine/aiDrafter';
import { TEAM_COUNT } from '../src/engine/positions';
import { mulberry32, mixSeed } from '../src/engine/rng';
import { normalizePlayerName } from '../src/data/schema';
import { draftPool } from '../src/data/draftPool';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, 'aiPickRegression.baseline.json');

const SEEDS = [7, 42, 123456];
const TARGET_PICKS = [1, 3, 6, 10, 16, 24, 33, 44, 55, 64];
const LAST_TARGET = Math.max(...TARGET_PICKS);

interface Snapshot {
  seed: number;
  pickNumber: number;
  teamIdx: number;
  rosterIds: string[];
  /** Normalized names of every already-drafted player — `makePick` retires all of a player's
   * spans at once, so a name is enough to reconstruct the available pool, and far smaller than
   * the ~1500 span ids a late snapshot would otherwise carry. */
  draftedNames: string[];
  expectedPickId: string;
  expectedPickLabel: string;
}

// `draftedIds` also retires the drafted player's spans from the FULL pool (any career year is
// draftable), so names have to resolve against that, not just the lean active pool.
const spanById = new Map([...draftPool, ...activeDraftPool].map((p) => [p.id, p]));
const nameById = new Map([...spanById].map(([id, p]) => [id, p.playerName]));

function pickAt(seed: number, pickNumber: number, rosterIds: string[], draftedNames: string[]): { id: string; label: string } {
  const roster = rosterIds.map((id) => spanById.get(id)!);
  const drafted = new Set(draftedNames);
  const available = activeDraftPool.filter((p) => !drafted.has(normalizePlayerName(p.playerName)));
  const rng = mulberry32(mixSeed(seed, pickNumber));
  const chosen = pickForAi(roster, roster.map((p) => p.fga), available, TEAM_COUNT, pickNumber, rng);
  return { id: chosen.id, label: `${chosen.playerName} | ${chosen.spanLabel}` };
}

function captureSnapshots(seed: number): Snapshot[] {
  let s: DraftState = createDraft(false, undefined, undefined, seed);
  s = { ...s, teams: s.teams.map((t) => ({ ...t, isHuman: false })) };
  const out: Snapshot[] = [];
  const targets = new Set(TARGET_PICKS);
  for (let pn = 1; !s.complete && pn <= LAST_TARGET; pn++) {
    if (targets.has(pn)) {
      const teamIdx = currentTeamIndex(s);
      const rosterIds = s.teams[teamIdx].roster.map((p) => p.id);
      const draftedNames = [
        ...new Set([...s.draftedIds].map((id) => normalizePlayerName(nameById.get(id)!))),
      ];
      const { id, label } = pickAt(seed, pn, rosterIds, draftedNames);
      out.push({ seed, pickNumber: pn, teamIdx, rosterIds, draftedNames, expectedPickId: id, expectedPickLabel: label });
    }
    const next = resolveAiPickIfNeeded(s);
    if (!next || next === s) break;
    s = next;
  }
  return out;
}

if (process.argv.includes('--update')) {
  const all = SEEDS.flatMap(captureSnapshots);
  writeFileSync(BASELINE_PATH, JSON.stringify(all, null, 2) + '\n');
  console.log(`Baseline written: ${all.length} pinned picks across ${SEEDS.length} seeds → ${BASELINE_PATH}`);
  process.exit(0);
}

let baseline: Snapshot[];
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error('FAIL: no baseline — run `npx tsx scripts/testAiPickRegression.ts --update` first');
  process.exit(1);
}

let failures = 0;
for (const snap of baseline) {
  const { id, label } = pickAt(snap.seed, snap.pickNumber, snap.rosterIds, snap.draftedNames);
  if (id === snap.expectedPickId) {
    console.log(`PASS: seed ${snap.seed} pick #${snap.pickNumber} (roster ${snap.rosterIds.length}) → ${label}`);
  } else {
    console.error(`FAIL: seed ${snap.seed} pick #${snap.pickNumber} — baseline "${snap.expectedPickLabel}"  →  now "${label}"`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${baseline.length} pinned picks changed. If deliberate, re-bless with --update.`);
  process.exit(1);
}
console.log(`\nAI pick regression: all ${baseline.length} pinned picks match baseline.`);
