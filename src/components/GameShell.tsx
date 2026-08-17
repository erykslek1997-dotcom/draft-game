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
import DraftLottery from './DraftLottery';
import ResultsScreen from './ResultsScreen';
import type { FeedbackEntry } from './FeedbackToggle';

// 2026-08-16, user's own ask: span selection ("Choose Each Player's Span") and rotation-building
// stopped being their own dedicated full-screen phases here — that whole "screen" is gone, per
// the user's own words ("ten ekran wyrzucamy"). Both now happen INSIDE DraftBoard's Team tab
// (see that file's own docstring on the merged span+rotation section), reachable from the very
// first pick rather than gated until the draft ends, ending in one "Submit Team" action
// (`handleSubmitTeam` below) instead of two separate confirm screens.
type Phase = 'lottery' | 'draft' | 'results';

interface Props {
  mode: 'developer' | 'player';
  /** 2026-08-07, user explicit ask: manually pick for every one of the 16 teams (not just the
   * one randomly-assigned human slot), with an optional causal reasoning note per pick. Deliberately
   * scoped to the DRAFT phase only — span selection and rotation-building afterward still only
   * involve the one `isHuman`-flagged team, exactly as today; the ask was specifically about
   * describing draft PICKS, not building 16 full rotations by hand. See draft.ts's own
   * `commissionerMode` docstring for why this is a separate flag from `isHuman`. */
  commissionerMode: boolean;
  /** 2026-08-16, user's own ask: whatever the human typed/randomized on the intro screen for
   * their own team's name — passed straight through to `createDraft` so THIS team (whichever
   * random slot it lands on) gets it instead of the normal random "Place Mascot" draw. Empty/
   * unset falls through to that random draw, same as always (see `createInitialTeams`'s own
   * docstring on the trim-and-fallback rule). */
  humanTeamName?: string;
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

export default function GameShell({ mode, commissionerMode, humanTeamName, onExit }: Props) {
  const [draftState, setDraftState] = useState<DraftState>(() => createDraft(commissionerMode, undefined, humanTeamName));
  // 2026-08-16, user's own ask: a visible lottery-reveal moment for the already-randomized slot
  // assignment (see DraftLottery.tsx's own docstring — the randomization itself isn't new, only
  // this reveal step is) runs once, right after Start Draft, before the real board appears.
  const [phase, setPhase] = useState<Phase>('lottery');
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
  // The CPU-speed slider (`aiSpeed`) is only exposed in the UI in Tester Mode (see the
  // `game-controls` render below), but it still drives this effect in Player Mode too — it just
  // stays pinned at its default ('Normal'), same real AI-turn pacing a player would expect.
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

  // Once the draft finishes, AI rosters are re-optimized once via the same knapsack
  // `optimizeSpans` used everywhere else (capped at CAP_LIMIT, matching the cap they drafted
  // under), then have their rotation auto-built. The human's roster is left as-is (still peak
  // spans) — they work through their own spans + rotation in DraftBoard's Team tab instead (see
  // that file's own docstring), not on a separate post-draft screen anymore.
  // `aiTeamsFinalized` is a one-shot guard, not a `phase` check like this effect used to use:
  // `phase` no longer changes away from 'draft' the moment the draft completes (the human keeps
  // working in the Team tab, still phase 'draft', until they hit Submit), so without a separate
  // guard this effect would re-fire on every render once `draftState.complete` goes true —
  // each firing produces a NEW `draftState` object, which would just re-trigger itself forever.
  const [aiTeamsFinalized, setAiTeamsFinalized] = useState(false);
  useEffect(() => {
    if (draftState.complete && !aiTeamsFinalized) {
      setDraftState((s) => ({
        ...s,
        teams: s.teams.map((t) => {
          if (t.isHuman) return t;
          const roster = optimizeSpans(t.roster, CAP_LIMIT);
          return { ...t, roster, rotation: autoAssignRotation(roster) };
        }),
      }));
      setAiTeamsFinalized(true);
    }
  }, [draftState.complete, aiTeamsFinalized]);

  // 2026-08-16, user's own ask: the human's own team name can be edited from the Draft Lottery's
  // "Your team" step (DraftLottery.tsx's `stage === 'intro'`) — GameShell owns `draftState`, so
  // the actual rename happens here rather than in that (deliberately presentational) component.
  function handleRenameHumanTeam(name: string) {
    setDraftState((s) => ({ ...s, teams: s.teams.map((t) => (t.isHuman ? { ...t, name } : t)) }));
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

  // 2026-08-14, user's own ask ("zrób lekkie UI trybu developera żeby wszystko szybko działało"):
  // reaching ResultsScreen for a quick check used to mean finishing 144 picks, then manually
  // clicking through span selection and rotation-building — three separate screens just to see a
  // score. One button, available in every pre-results phase, that does what a normal playthrough
  // does for the human team too (same `optimizeSpans`/`autoAssignRotation` treatment AI teams
  // already get after the draft) instead of leaving it for manual choice. Testing-only, same
  // "no confirmation, skip real steps" convenience as Auto-finish above — never shown outside
  // Tester Mode.
  function handleSkipToResults() {
    const finished = draftState.complete ? draftState : autoFinishDraft(draftState);
    const teams = finished.teams.map((t) => {
      const roster = optimizeSpans(t.roster, CAP_LIMIT);
      return { ...t, roster, rotation: autoAssignRotation(roster) };
    });
    setDraftState(finished);
    setFinalTeams(teams);
    setPhase('results');
  }

  // 2026-08-16, replaces the old two-step `handleSpanSelectionConfirmed`/`handleRotationConfirmed`
  // pair: DraftBoard's Team tab now collects both the human's final spans AND their rotation
  // itself (see that file's own docstring), and hands both back here at once from a single
  // Submit action — this is the only place either ever gets written into `draftState`/`finalTeams`.
  function handleSubmitTeam(roster: PlayerSpan[], rotation: Rotation) {
    const teams = draftState.teams.map((t) => (t.isHuman ? { ...t, roster, rotation } : t));
    setFinalTeams(teams);
    setPhase('results');
  }

  // Deliberately immediate, with no confirmation step: this is a testing convenience for
  // restarting a prototype draft quickly, and a confirm dialog would defeat that purpose.
  function handleReset() {
    onExit();
  }

  // Only meaningful mid-draft: once the pool physically runs dry (fewer real players left than
  // the human still needs), their roster can never reach 9 no matter what happens from here.
  const rosterImpossible = phase === 'draft' && isHumanRosterImpossible(draftState);

  return (
    <>
      <div className="game-controls">
        <button className="secondary-btn reset-btn" onClick={handleReset}>
          {mode === 'developer' ? 'Reset' : 'Exit Draft'}
        </button>
        {/* CPU-speed slider and Auto-finish are testing conveniences, not real player-facing
            features (see their own docstrings) — Tester Mode only. Player Mode always runs AI
            turns at the default 'Normal' pace and has no shortcut past a real draft. */}
        {mode === 'developer' && (
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
        )}
        {mode === 'developer' && phase === 'draft' && !draftState.complete && (
          <button className="secondary-btn auto-finish-btn" onClick={handleAutoFinish}>
            Auto-finish (testing)
          </button>
        )}
        {mode === 'developer' && phase !== 'results' && (
          <button className="secondary-btn skip-to-results-btn" onClick={handleSkipToResults}>
            ⚡ Skip to Results (dev)
          </button>
        )}
      </div>

      {rosterImpossible && (
        <div className="fail-banner">
          <h2>FAIL</h2>
          <p>The pool ran dry — there aren't enough undrafted players left for your team to ever reach 9.</p>
          <button className="primary-btn" onClick={handleReset}>
            {mode === 'developer' ? 'Reset' : 'Exit Draft'}
          </button>
        </div>
      )}
      {phase === 'lottery' && (
        <DraftLottery
          teams={draftState.teams}
          mode={mode}
          onDone={() => setPhase('draft')}
          onRenameTeam={handleRenameHumanTeam}
        />
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
          onSubmitTeam={handleSubmitTeam}
        />
      )}
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
