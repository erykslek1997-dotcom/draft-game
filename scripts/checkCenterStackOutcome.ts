/**
 * Diagnostic: when an AI team drafts almost nothing but centers, what does its rotation
 * actually look like, and does the judge punish it? Prints each team's positional makeup,
 * the fit multiplier of each assigned starter, and the resulting scores.
 */
import { createDraft, resolveAiPickIfNeeded, currentTeamIndex, makePick, isPickLegal } from '../src/engine/draft';
import { draftPool as players } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { positionFitMultiplier } from '../src/engine/positions';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

let s = createDraft();
let guard = 0;
while (!s.complete && guard < 100) {
  const teamIdx = currentTeamIndex(s);
  if (s.teams[teamIdx].isHuman) {
    const legal = players
      .filter((p) => !s.draftedIds.has(p.id) && isPickLegal(s, p.id))
      .sort((a, b) => computeTalent(b) - computeTalent(a));
    if (legal.length === 0) break;
    s = makePick(s, legal[0].id);
  } else {
    const next = resolveAiPickIfNeeded(s);
    if (!next) break;
    s = next;
  }
  guard++;
}

const teams: Team[] = s.teams.map((t) => ({ ...t, rotation: autoAssignRotation(t.roster) }));

for (const team of teams) {
  const counts = new Map<string, number>();
  for (const p of team.roster) counts.set(p.primaryPosition, (counts.get(p.primaryPosition) ?? 0) + 1);
  const makeup = [...counts.entries()].map(([pos, n]) => `${pos}x${n}`).join(' ');
  const breakdown = scoreTeam(team);

  console.log(`\n=== ${team.name} — roster makeup: ${makeup} ===`);
  console.log(`   scores: talent=${breakdown.talentScore} fit=${breakdown.fitScore} rotation=${breakdown.rotationScore} OVERALL=${breakdown.overall}`);
  for (const { slot, player } of primaryStarters(team)) {
    const mult = positionFitMultiplier(player, slot);
    const raw = computeTalent(player);
    const flag = mult === 0 ? '  <-- contributes ZERO talent here' : '';
    console.log(
      `   ${slot}: ${player.playerName} (${player.primaryPosition}) talent ${raw} x fit ${mult} = ${(raw * mult).toFixed(1)}${flag}`,
    );
  }
}

const ranked = [...teams]
  .map((t) => ({ name: t.name, overall: scoreTeam(t).overall }))
  .sort((a, b) => b.overall - a.overall);
console.log('\n=== final ranking ===');
ranked.forEach((r, i) => console.log(`${i + 1}. ${r.name} — ${r.overall}`));
