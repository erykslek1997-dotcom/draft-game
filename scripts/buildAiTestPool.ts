/** Builds a reproducible, temporary player allowlist from actual 16-team AI drafts. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { pickForAi } from '../src/engine/aiDrafter';
import { ROSTER_SIZE, TEAM_COUNT } from '../src/engine/positions';

const CALIBRATION_DRAFTS = 10;
const GLUE_FGA_CEILING = 2;

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

const selectionCounts = new Map<string, number>();
const originalRandom = Math.random;

try {
  for (let run = 0; run < CALIBRATION_DRAFTS; run++) {
    Math.random = seededRandom(10_000 + run);
    const rosters = Array.from({ length: TEAM_COUNT }, () => [] as typeof draftPool);
    const selectedNames = new Set<string>();

    for (let round = 0; round < ROSTER_SIZE; round++) {
      for (let pickInRound = 0; pickInRound < TEAM_COUNT; pickInRound++) {
        const teamIndex = round % 2 === 0 ? pickInRound : TEAM_COUNT - 1 - pickInRound;
        const roster = rosters[teamIndex];
        const available = draftPool.filter((span) => !selectedNames.has(normalizePlayerName(span.playerName)));
        const picked = pickForAi(
          roster,
          roster.map((span) => span.fga),
          available,
          TEAM_COUNT,
        );
        const key = normalizePlayerName(picked.playerName);
        selectedNames.add(key);
        roster.push(picked);
        selectionCounts.set(key, (selectionCounts.get(key) ?? 0) + 1);
      }
    }
  }
} finally {
  Math.random = originalRandom;
}

const glueNames = new Set(
  draftPool
    .filter((span) => span.fga < GLUE_FGA_CEILING)
    .map((span) => normalizePlayerName(span.playerName)),
);
const activeNames = new Set([...selectionCounts.keys(), ...glueNames]);
const sortedNames = [...activeNames].sort((a, b) => {
  const countDifference = (selectionCounts.get(b) ?? 0) - (selectionCounts.get(a) ?? 0);
  return countDifference || a.localeCompare(b);
});

const selectedSpans = draftPool.filter((span) => activeNames.has(normalizePlayerName(span.playerName)));
const uniqueByPosition = Object.fromEntries(
  ['PG', 'SG', 'SF', 'PF', 'C'].map((position) => [
    position,
    new Set(
      selectedSpans
        .filter((span) => span.primaryPosition === position)
        .map((span) => normalizePlayerName(span.playerName)),
    ).size,
  ]),
);

writeFileSync('src/data/aiTestPoolNames.json', JSON.stringify(sortedNames));
mkdirSync('reports', { recursive: true });
writeFileSync(
  'reports/ai-test-pool.json',
  JSON.stringify(
    {
      calibrationDrafts: CALIBRATION_DRAFTS,
      picksObserved: CALIBRATION_DRAFTS * TEAM_COUNT * ROSTER_SIZE,
      selectedAtLeastOnce: selectionCounts.size,
      glueFgaBelow: GLUE_FGA_CEILING,
      gluePlayers: glueNames.size,
      activePlayers: activeNames.size,
      activeSpans: selectedSpans.length,
      uniqueByPosition,
      players: sortedNames.map((name) => ({
        name,
        selections: selectionCounts.get(name) ?? 0,
        retainedAsGlue: glueNames.has(name),
      })),
    },
    null,
    2,
  ) + '\n',
);

console.log(
  `Observed ${CALIBRATION_DRAFTS * TEAM_COUNT * ROSTER_SIZE} picks; retained ${activeNames.size} players / ` +
    `${selectedSpans.length} spans (${selectionCounts.size} drafted, ${glueNames.size} FGA<${GLUE_FGA_CEILING}).`,
);
console.log(`Primary-position coverage: ${JSON.stringify(uniqueByPosition)}`);
