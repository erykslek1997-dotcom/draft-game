/**
 * 2026-11-05, the user ("żeby już po wciśnięciu gry został przypisany numer gracza ... i już wtedy AI
 * robi swoje planowanie"): the CPU teams' draft runs off the page's thread. The page sends the draft
 * as it stands (without its pool — the worker holds the same `activeDraftPool`) whenever CPU turns
 * come up, the lottery included; the worker runs every CPU pick ahead up to the human's turn and
 * posts them one by one, and the page shows them at its usual pace. Planned drafting (`AI_PLAN`,
 * ~0.4 s a pick) is on here only: the page never waits on it.
 *
 * Messages in:  { type: 'runAhead', gen, state } | { type: 'finalize', gen, teams, capLimit } | { type: 'cancel' }
 * Messages out: { type: 'pick', gen, index, playerId } | { type: 'done', gen }
 *               | { type: 'finalized', gen, rosters: string[][] } | { type: 'error', gen, message }
 */
import { activeDraftPool, currentTeamIndex, resolveAiPickIfNeeded, type DraftState } from './draft';
import { AI_PLAN } from './aiDrafter';
import { finalizeAiRoster } from './finalizeAiRoster';
import type { Team } from './types';

AI_PLAN.on = true;

type WireState = Omit<DraftState, 'pool'>;
type Inbound =
  | { type: 'runAhead'; gen: number; state: WireState }
  | { type: 'finalize'; gen: number; teams: Team[]; capLimit: number }
  | { type: 'cancel' };

// Typed by hand: the app's tsconfig carries the DOM lib, which clashes with the WebWorker one.
const scope = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<Inbound>) => void) | null };
let current = 0;

function step(gen: number, state: DraftState): void {
  if (gen !== current) return;
  try {
    if (state.complete || state.teams[currentTeamIndex(state)].isHuman) {
      scope.postMessage({ type: 'done', gen });
      return;
    }
    const next = resolveAiPickIfNeeded(state);
    if (!next || next.history.length === state.history.length) {
      scope.postMessage({ type: 'done', gen });
      return;
    }
    scope.postMessage({ type: 'pick', gen, index: state.history.length, playerId: next.history[next.history.length - 1].playerId });
    // One pick per task, so a newer run (the human picked, a draft restarted) cuts in between picks.
    setTimeout(() => step(gen, next), 0);
  } catch (error) {
    scope.postMessage({ type: 'error', gen, message: error instanceof Error ? error.message : String(error) });
  }
}

scope.onmessage = (event: MessageEvent<Inbound>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    current++;
    return;
  }
  if (message.type === 'runAhead') {
    current = message.gen;
    step(message.gen, { ...message.state, pool: activeDraftPool });
    return;
  }
  if (message.type === 'finalize') {
    try {
      const rosters = message.teams.map((team) => finalizeAiRoster(team, message.capLimit).map((p) => p.id));
      scope.postMessage({ type: 'finalized', gen: message.gen, rosters });
    } catch (error) {
      scope.postMessage({ type: 'error', gen: message.gen, message: error instanceof Error ? error.message : String(error) });
    }
  }
};
