import { activeDraftPool, autoFinishDraft, createDraft } from '../src/engine/draft';
import { autoAssignRotation, totalMinutesForPlayer } from '../src/engine/rotation';
import { rotationScore } from '../src/engine/scoring';
import { effectiveTalent, overallTierForSpan, tierContextFor } from '../src/engine/grades';

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

const seed = Number(process.env.SEED ?? 630_003);
const originalRandom = Math.random;
Math.random = seededRandom(seed);
try {
  const state = autoFinishDraft(createDraft(false, activeDraftPool));
  const rows = state.teams
    .map((team) => {
      const withRotation = { ...team, rotation: autoAssignRotation(team.roster) };
      return { team: withRotation, result: rotationScore(withRotation) };
    })
    .sort((a, b) => a.result.score - b.result.score);

  console.log(`Seed ${seed}: ${rows.length} teams`);
  for (const { team, result } of rows.filter((row) => row.result.score < 60)) {
    console.log(`\n${team.name} — Rotation ${result.score}`);
    console.log('Components:', result.components);
    console.log('Notes:', result.notes);
    console.table(
      team.roster
        .map((player) => ({
          player: player.playerName,
          span: player.spanLabel,
          positions: [player.primaryPosition, ...player.secondaryPositions].join('/'),
          fga: player.fga,
          tal: effectiveTalent(player),
          tier: overallTierForSpan(tierContextFor(player)),
          minutes: totalMinutesForPlayer(team.rotation, player.id),
        }))
        .sort((a, b) => b.minutes - a.minutes),
    );
    console.table(
      state.history
        .filter((pick) => pick.teamId === team.id)
        .map((pick) => {
          const player = activeDraftPool.find((candidate) => candidate.id === pick.playerId);
          return { pick: pick.pickNumber, player: player?.playerName, span: player?.spanLabel };
        }),
    );
  }
} finally {
  Math.random = originalRandom;
}
