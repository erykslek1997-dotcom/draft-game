import { useEffect, useState } from 'react';
import {
  createDraft,
  currentTeamIndex,
  makePick,
  resolveAiPickIfNeeded,
  isHumanRosterImpossible,
  autoFinishDraft,
  type DraftState,
} from '../engine/draft';
import { autoAssignRotation } from '../engine/rotation';
import { optimizeSpans } from '../engine/spanOptimizer';
import { CAP_LIMIT } from '../engine/positions';
import type { PlayerSpan } from '../data/schema';
import type { Rotation, Team } from '../engine/types';
import DraftBoard from './DraftBoard';
import SpanSelectionScreen from './SpanSelectionScreen';
import RotationBuilder from './RotationBuilder';
import ResultsScreen from './ResultsScreen';
import type { FeedbackEntry } from './FeedbackToggle';

type Phase = 'draft' | 'spanSelection' | 'rotation' | 'results';

interface Props {
  mode: 'developer' | 'player';
  /** 2026-08-07, user explicit ask: manually pick for every one of the 16 teams (not just the
   * one randomly-assigned human slot), with an optional causal reasoning note per pick. Deliberately
   * scoped to the DRAFT phase only — span selection and rotation-building afterward still only
   * involve the one `isHuman`-flagged team, exactly as today; the ask was specifically about
   * describing draft PICKS, not building 16 full rotations by hand. See draft.ts's own
   * `commissionerMode` docstring for why this is a separate flag from `isHuman`. */
  commissionerMode: boolean;
  /** Returns the app to the intro screen — same "no confirmation" testing-convenience shape as
   * the old in-component Reset button had, just lifted up so the intro screen (which doesn't
   * load this module at all) can unmount it entirely. */
  onExit: () => void;
}

/**
 * Everything that touches the draft engine — split out of `App.tsx` (2026-07-30) so the intro
 * screen can render instantly instead of blocking on ~10MB of player/DARKO/WOWYR data. `App.tsx`
 * only loads this component (via `React.lazy`) once the user clicks "Start Draft," at which point
 * the load is expected and can show a real loading state instead of stalling the whole app before
 * it's shown anything at all. See the user's own report: "the game feels slow with loading data."
 */
const AI_SPEEDS = [
  { label: 'Slow', delayMs: 1100 },
  { label: 'Normal', delayMs: 450 },
  { label: 'Fast', delayMs: 180 },
  { label: 'Instant', delayMs: 0 },
] as const;
const DEFAULT_AI_SPEED_INDEX = 1;

export default function GameShell({ mode, commissionerMode, onExit }: Props) {
  const [draftState, setDraftState] = useState<DraftState>(() => createDraft(commissionerMode));
  const [phase, setPhase] = useState<Phase>('draft');
  const [finalTeams, setFinalTeams] = useState<Team[] | null>(null);
  const [aiSpeedIndex, setAiSpeedIndex] = useState(DEFAULT_AI_SPEED_INDEX);
  const aiSpeed = AI_SPEEDS[aiSpeedIndex];
  // Owned here (not inside DraftBoard) so live in-draft reactions survive the phase transition
  // into ResultsScreen's export — see FeedbackToggle's own docstring for why this replaced the
  // old too_high/too_low dropdown flow.
  const [pickReactions, setPickReactions] = useState<Record<number, FeedbackEntry>>({});
  // 2026-08-07, Commissioner Mode's own per-pick "why" note — deliberately a separate free-text
  // field from `pickReactions` above, not a repurposing of it: `FeedbackEntry` is about flagging
  // a PROBLEM with a pick ("Co jest nie tak?" — what's wrong with this?), which doesn't fit a
  // neutral causal explanation for every single pick, most of which aren't complaints at all.
  const [pickReasoning, setPickReasoning] = useState<Record<number, string>>({});

  function handlePickReactionChange(pickNumber: number, entry: FeedbackEntry | undefined) {
    setPickReactions((prev) => {
      const next = { ...prev };
      if (entry) next[pickNumber] = entry;
      else delete next[pickNumber];
      return next;
    });
  }

  function handlePickReasoningChange(pickNumber: number, reasoning: string) {
    setPickReasoning((prev) => {
      const next = { ...prev };
      if (reasoning.trim()) next[pickNumber] = reasoning;
      else delete next[pickNumber];
      return next;
    });
  }

  // Auto-resolve AI turns during the draft — never in Commissioner Mode, where every team's pick
  // comes from the human via `handlePick` instead (see the effect's own early-return below).
  useEffect(() => {
    if (phase !== 'draft' || draftState.complete || draftState.commissionerMode) return;
    const teamIdx = currentTeamIndex(draftState);
    if (draftState.teams[teamIdx].isHuman) return;
    const timer = setTimeout(() => {
      const next = resolveAiPickIfNeeded(draftState);
      if (next) setDraftState(next);
    }, aiSpeed.delayMs);
    return () => clearTimeout(timer);
  }, [draftState, phase, aiSpeed.delayMs]);

  // Once the draft finishes, resolve Phase 2 (span selection) for every team: AI rosters are
  // re-optimized immediately via the same knapsack `optimizeSpans` used everywhere else (capped
  // at CAP_LIMIT, matching the cap they drafted under), then have their rotation auto-built; the
  // human's roster is left as-is (still peak spans) for them to work through on the next screen.
  useEffect(() => {
    if (phase === 'draft' && draftState.complete) {
      setDraftState((s) => ({
        ...s,
        teams: s.teams.map((t) => {
          if (t.isHuman) return t;
          const roster = optimizeSpans(t.roster, CAP_LIMIT);
          return { ...t, roster, rotation: autoAssignRotation(roster) };
        }),
      }));
      setPhase('spanSelection');
    }
  }, [draftState, phase]);

  function handleSpanSelectionConfirmed(roster: PlayerSpan[]) {
    setDraftState((s) => ({ ...s, teams: s.teams.map((t) => (t.isHuman ? { ...t, roster } : t)) }));
    setPhase('rotation');
  }

  function handlePick(playerId: string) {
    setDraftState((s) => makePick(s, playerId));
  }

  // Testing convenience, not a real game action — see `autoFinishDraft`'s own docstring. Skips
  // straight to a fully-drafted state; the existing draft-complete effect above then picks up
  // exactly as it would after a normal draft (auto-builds AI rotations, advances to 'rotation').
  function handleAutoFinish() {
    setDraftState((s) => autoFinishDraft(s));
  }

  function handleRotationConfirmed(rotation: Rotation) {
    const teams = draftState.teams.map((t) => (t.isHuman ? { ...t, rotation } : t));
    setFinalTeams(teams);
    setPhase('results');
  }

  // Deliberately immediate, with no confirmation step: this is a testing convenience for
  // restarting a prototype draft quickly, and a confirm dialog would defeat that purpose.
  function handleReset() {
    onExit();
  }

  const humanTeam = draftState.teams.find((t) => t.isHuman)!;
  // Only meaningful mid-draft: once the pool physically runs dry (fewer real players left than
  // the human still needs), their roster can never reach 9 no matter what happens from here.
  const rosterImpossible = phase === 'draft' && isHumanRosterImpossible(draftState);

  return (
    <>
      <div className="game-controls">
        <button className="secondary-btn reset-btn" onClick={handleReset}>
          Reset
        </button>
        <label className="ai-speed">
          <span>CPU speed</span>
          <input
            type="range"
            min={0}
            max={AI_SPEEDS.length - 1}
            step={1}
            value={aiSpeedIndex}
            onChange={(e) => setAiSpeedIndex(Number(e.target.value))}
          />
          <span className="ai-speed-value">{aiSpeed.label}</span>
        </label>
        {phase === 'draft' && !draftState.complete && (
          <button className="secondary-btn auto-finish-btn" onClick={handleAutoFinish}>
            Auto-finish (testing)
          </button>
        )}
      </div>

      {rosterImpossible && (
        <div className="fail-banner">
          <h2>FAIL</h2>
          <p>The pool ran dry — there aren't enough undrafted players left for your team to ever reach 9.</p>
          <button className="primary-btn" onClick={handleReset}>
            Reset
          </button>
        </div>
      )}
      {phase === 'draft' && (
        <DraftBoard
          state={draftState}
          onPick={handlePick}
          mode={mode}
          pickReactions={pickReactions}
          onPickReactionChange={handlePickReactionChange}
          pickReasoning={pickReasoning}
          onPickReasoningChange={handlePickReasoningChange}
        />
      )}
      {phase === 'spanSelection' && (
        <SpanSelectionScreen roster={humanTeam.roster} onConfirm={handleSpanSelectionConfirmed} />
      )}
      {phase === 'rotation' && <RotationBuilder roster={humanTeam.roster} onConfirm={handleRotationConfirmed} />}
      {phase === 'results' && finalTeams && (
        <ResultsScreen
          teams={finalTeams}
          history={draftState.history}
          mode={mode}
          onRestart={handleReset}
          pickReactions={pickReactions}
          pickReasoning={pickReasoning}
        />
      )}
    </>
  );
}
