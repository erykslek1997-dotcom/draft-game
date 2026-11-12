import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { dailyDraftDay, type DailyDraftMode } from '../dailyDraftDay';
import { createDraft, currentTeamIndex, draftCapLimit, isBombTurn, makeBombPick, makePick, resolveAiPickIfNeeded, type DraftState } from '../engine/draft';
import { aiRotation, finalizeAiRoster } from '../engine/finalizeAiRoster';
import { totalFga } from '../engine/positions';
import { rankTeams } from '../engine/scoring';
import { spanOptionsFor } from '../engine/spanOptimizer';
import type { Rotation } from '../engine/types';

/**
 * 2026-11-11, the leaderboard's check (variant B, the user: "jak mi powiesz co i jak to robimy").
 * A daily score arrives with its proof — every pick of the draft in order, the human's final windows
 * and rotation — and an hourly job (scripts/verifyDaily.ts) re-runs it through the engine:
 *
 *   hard  — every pick is legal at its moment (the human's under the day's rule and cap), the final
 *           roster is the drafted players in windows no dearer than drafted and within the cap, and
 *           the engine's own Overall and place match what was posted. Fails → the row is deleted.
 *   soft  — the CPU picks are the ones the engine makes from the same seed. The browser drafts the
 *           CPU in a worker; if that ever differs, the row stays but without the ✓.
 *
 * The season's points can't be re-run cheaply (a whole season per row) and are taken as posted,
 * capped by the database.
 */
export interface DailyProof {
  /** The human team's name (it seeds nothing, but the draft is created with it). */
  teamName: string;
  /** Every pick in order: [teamId, spanId]. */
  picks: [string, string][];
  /** The human's final windows, one per drafted player. */
  roster: string[];
  rotation: Rotation;
}

export interface DailyClaim {
  overall: number;
  place: number;
  field: number;
}

export type Verdict = { status: 'ok' } | { status: 'ai-diverged'; at: number } | { status: 'rejected'; reason: string };

export function verifyDaily(mode: DailyDraftMode, day: string, proof: DailyProof, claim: DailyClaim): Verdict {
  if (mode === 'mini') return { status: 'rejected', reason: 'mini has no replayable proof yet' };
  const daily = dailyDraftDay(mode, day);
  let state: DraftState = createDraft(false, undefined, proof.teamName, daily.seed, undefined, { day, cap: daily.cap, rule: daily.rule, bomb: daily.bomb });
  let diverged = -1;
  for (let i = 0; i < proof.picks.length; i++) {
    if (state.complete) return { status: 'rejected', reason: `pick ${i + 1} after the draft ended` };
    const [teamId, spanId] = proof.picks[i];
    const team = state.teams[currentTeamIndex(state)];
    if (team.id !== teamId) return { status: 'rejected', reason: `pick ${i + 1} by the wrong team` };
    let next: DraftState;
    if (team.isHuman && isBombTurn(state)) next = makeBombPick(state);
    else {
      if (!team.isHuman && diverged < 0) {
        const engine = resolveAiPickIfNeeded(state);
        const enginePick = engine?.history[engine.history.length - 1]?.playerId;
        if (enginePick !== spanId) diverged = i + 1;
      }
      next = makePick(state, spanId);
    }
    if (next === state) return { status: 'rejected', reason: `pick ${i + 1} (${spanId}) is not legal` };
    if (next.history[next.history.length - 1]?.playerId !== spanId) return { status: 'rejected', reason: `pick ${i + 1} doesn't match` };
    state = next;
  }
  if (!state.complete) return { status: 'rejected', reason: 'the draft is not finished' };

  const human = state.teams.find((t) => t.isHuman)!;
  if (proof.roster.length !== human.roster.length) return { status: 'rejected', reason: 'roster size' };
  const finalRoster: PlayerSpan[] = [];
  for (const drafted of human.roster) {
    const key = normalizePlayerName(drafted.playerName);
    const chosenId = proof.roster.find((id) => spanOptionsFor(drafted.playerName).some((s) => s.id === id));
    const chosen = spanOptionsFor(drafted.playerName).find((s) => s.id === chosenId) ?? (proof.roster.includes(drafted.id) ? drafted : undefined);
    if (!chosen || normalizePlayerName(chosen.playerName) !== key) return { status: 'rejected', reason: `no window for ${drafted.playerName}` };
    if (chosen.fga > drafted.fga + 1e-9) return { status: 'rejected', reason: `${drafted.playerName}'s window is dearer than drafted` };
    finalRoster.push(chosen);
  }
  if (totalFga(finalRoster.map((p) => p.fga)) > draftCapLimit(state) + 1e-9) return { status: 'rejected', reason: 'over the cap' };
  const ids = new Set(finalRoster.map((p) => p.id));
  const inRotation = Object.values(proof.rotation?.slots ?? {}).flat().map((a) => a.playerId);
  if (!inRotation.length || inRotation.some((id) => !ids.has(id))) return { status: 'rejected', reason: 'the rotation names someone not on the roster' };

  const cap = draftCapLimit(state);
  const teams = state.teams.map((t) => {
    if (t.isHuman) return { ...t, roster: finalRoster, rotation: proof.rotation };
    const roster = finalizeAiRoster(t, cap);
    return { ...t, roster, rotation: aiRotation(roster) };
  });
  const ranked = rankTeams(teams);
  const me = ranked.find((r) => r.team.isHuman)!;
  if (Math.abs(me.breakdown.overall - claim.overall) > 0.051 || me.rank !== claim.place || ranked.length !== claim.field) {
    return { status: 'rejected', reason: `engine says ${me.breakdown.overall} (${me.rank}/${ranked.length}), posted ${claim.overall} (${claim.place}/${claim.field})` };
  }
  return diverged > 0 ? { status: 'ai-diverged', at: diverged } : { status: 'ok' };
}
