/**
 * 2026-09-25, user's ask ("zamiast długiego paska ładowania… ładowanie nadal w tle"): the pieces
 * of draft setup that don't need any player data — the team list and the human's lottery slot,
 * both fixed by the draft seed. Kept free of the player database so the intro can run the draft
 * lottery right away while the data finishes loading behind it; `createDraft` (draft.ts) then
 * builds the draft from the same seed and teams.
 */
import { TEAM_COUNT } from './positions';
import { randomTeamNames } from './teamNames';
import { mixSeed, mulberry32 } from './rng';
import type { Team } from './types';

export function createInitialTeams(humanTeamName?: string, rng: () => number = Math.random): Team[] {
  const humanIndex = Math.floor(rng() * TEAM_COUNT);
  const names = randomTeamNames(TEAM_COUNT);
  const trimmedHumanName = humanTeamName?.trim();
  if (trimmedHumanName) names[humanIndex] = trimmedHumanName;
  const teams: Team[] = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    // `draftSlot` is 1-based and equals the team's position in round 1 — the same index the snake
    // order runs off — so "Kentucky Chickens #4" tells a drafter exactly when that team picks.
    teams.push({
      id: `t${i}`,
      name: names[i],
      draftSlot: i + 1,
      isHuman: i === humanIndex,
      roster: [],
      rotation: null,
    });
  }
  return teams;
}

/** The teams `createDraft` builds for this seed (same slot draw, same RNG stream). */
export function initialTeamsForSeed(seed: number, humanTeamName?: string): Team[] {
  return createInitialTeams(humanTeamName, mulberry32(mixSeed(seed, 0)));
}
