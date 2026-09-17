import { useEffect, useState } from 'react';
import {
  createDraft,
  currentTeamIndex,
  makePick,
  resolveAiPickIfNeeded,
  isHumanRosterImpossible,
  autoFinishDraft,
  TEAM_COUNT,
  ROUNDS,
  type DraftState,
} from '../engine/draft';
import { autoAssignRotation } from '../engine/rotation';
import { optimizeSpans, spanOptionsFor } from '../engine/spanOptimizer';
import { setAiDraftDebug } from '../engine/aiDrafter';
import { CAP_LIMIT, ROSTER_SIZE, BENCH_SLOT_COUNT } from '../engine/positions';
import { normalizePlayerName } from '../data/schema';
import type { PlayerSpan } from '../data/schema';
import type { Rotation, Team } from '../engine/types';
import DraftBoard from './DraftBoard';
import DraftLottery from './DraftLottery';
import ResultsScreen, { type ChallengeChallenger } from './ResultsScreen';
import type { FeedbackEntry } from './FeedbackToggle';

// 2026-09-17, user's own ask: a real "how to play?" affordance on the lottery screen, now that
// the intro's own always-visible rules list is gone (see App.tsx). This is the same five-item
// copy that used to live there — real engine constants now that we're safely inside the already
// lazy-loaded GameShell, unlike App.tsx's own hand-kept `DISPLAY_*` copies.
const DRAFT_HOW_TO_PLAY = [
  { title: 'Draft', body: `${TEAM_COUNT} teams take turns, ${ROSTER_SIZE} rounds — one player each round. You control one team; the rest are CPU.` },
  { title: 'Shot cap', body: `Every pick costs shots. Your whole roster has to fit under ${CAP_LIMIT} shots — the best player isn't always the pick that fits.` },
  { title: 'Spans', body: "You're not limited to a player's peak — draft any real multi-season window of their career. A cheaper, less-peak span can be the one that fits your cap." },
  { title: 'Rotation', body: `Set minutes for your 5 starters and ${BENCH_SLOT_COUNT} bench players — the Team tab opens for it as soon as you have your first pick, no need to wait for the draft to finish.` },
  { title: 'Grading', body: 'The judge scores every team — talent, offense, defense, spacing, fit, rotation — and ranks the whole field, yours included.' },
];

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

/** Audit AI-4 — chunked auto-finish: picks resolved per `setTimeout(0)` frame, and the whole
 * draft's pick count for the progress readout. */
const AUTO_FINISH_CHUNK = 6;
const TOTAL_PICKS = TEAM_COUNT * ROUNDS;

/** `?draftSeed=123` on the URL replays a specific draft — the seed `createDraft` logs to the
 * console in dev. Any non-finite value is ignored and a fresh random seed is drawn as usual. */
function seedFromUrl(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = new URLSearchParams(window.location.search).get('draftSeed');
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : undefined;
}

/** 2026-09-17, "Duel na seedzie" follow-up — see ResultsScreen.tsx's `ChallengeChallenger`
 * docstring for the full "no backend, the URL IS the message" story. Reads the SAME `cn`/`co`/
 * `cr`/`cf` params `copyChallengeLink` (ResultsScreen.tsx) writes; any missing/non-finite piece
 * and this returns `undefined` rather than a partially-filled comparison, since a still-solo draft
 * (no challenge link, or an old-style link from before this feature shipped) must render exactly
 * like it always has. Read once at mount, same as `seedFromUrl` below — the URL doesn't change
 * mid-draft, and neither should this. */
function challengerFromUrl(): ChallengeChallenger | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const name = params.get('cn');
  const overall = Number(params.get('co'));
  const rank = Number(params.get('cr'));
  const fieldSize = Number(params.get('cf'));
  if (!name || !Number.isFinite(overall) || !Number.isFinite(rank) || !Number.isFinite(fieldSize)) return undefined;
  return { name, overall, rank, fieldSize };
}

export default function GameShell({ mode, commissionerMode, humanTeamName, onExit }: Props) {
  const [draftState, setDraftState] = useState<DraftState>(
    () => createDraft(commissionerMode, undefined, humanTeamName, seedFromUrl()),
  );
  const [challenger] = useState<ChallengeChallenger | undefined>(() => challengerFromUrl());
  // Dev-only console hook: `draftDebug()` turns on the per-pick value-breakdown log in
  // `pickForAi`, `draftDebug(false)` turns it back off. Paired with the seed `createDraft` logs,
  // this is the whole "why did the AI take him?" workflow — no UI surface, dev builds only.
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    (window as unknown as { draftDebug: (on?: boolean) => string }).draftDebug = (on = true) => {
      setAiDraftDebug(on);
      return `AI draft debug ${on ? 'ON' : 'off'}`;
    };
    return () => setAiDraftDebug(false);
  }, []);
  // 2026-08-16, user's own ask: a visible lottery-reveal moment for the already-randomized slot
  // assignment (see DraftLottery.tsx's own docstring — the randomization itself isn't new, only
  // this reveal step is) runs once, right after Start Draft, before the real board appears.
  const [phase, setPhase] = useState<Phase>('lottery');
  const [finalTeams, setFinalTeams] = useState<Team[] | null>(null);
  // 2026-09-11, player-skeleton branch: the CPU-speed slider that used to set this is gone (Tester
  // Mode only — see the docstring at the top of this file), so `aiSpeed` is now a plain constant
  // pinned at its old default ('Normal') instead of `useState` — same real AI-turn pacing a player
  // would expect, just no longer changeable from anywhere.
  const aiSpeed = AI_SPEEDS[DEFAULT_AI_SPEED_INDEX];
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

  // Audit AI-4: `autoFinishDraft` in one synchronous call is ~2500 rotation builds — a multi-
  // second main-thread freeze. `autoFinishing` drives the chunked effect below instead.
  const [autoFinishing, setAutoFinishing] = useState(false);

  // Auto-resolve AI turns during the draft — never in Commissioner Mode, where every team's pick
  // comes from the human via `handlePick` instead (see the effect's own early-return below).
  // `aiSpeed` still paces this effect (pinned at 'Normal' on this branch — see its own docstring
  // above). Suspended while `autoFinishing` — the chunk effect below owns every pick then.
  useEffect(() => {
    if (phase !== 'draft' || draftState.complete || draftState.commissionerMode || autoFinishing) return;
    const teamIdx = currentTeamIndex(draftState);
    if (draftState.teams[teamIdx].isHuman) return;
    const timer = setTimeout(() => {
      const next = resolveAiPickIfNeeded(draftState);
      if (next) setDraftState(next);
    }, aiSpeed.delayMs);
    return () => clearTimeout(timer);
  }, [draftState, phase, aiSpeed.delayMs, autoFinishing]);

  // Resolve the auto-finish in small chunks with a `setTimeout(0)` yield between them, so the
  // browser can paint progress and stay responsive to Reset. `draftState.history.length` is the
  // live progress out of `TOTAL_PICKS`. Stops on completion, or if a chunk makes no progress
  // (the same dead-end guard `autoFinishDraft` already has internally).
  useEffect(() => {
    if (!autoFinishing) return;
    if (draftState.complete) {
      setAutoFinishing(false);
      return;
    }
    const timer = setTimeout(() => {
      const next = autoFinishDraft(draftState, AUTO_FINISH_CHUNK);
      if (next.history.length > draftState.history.length) setDraftState(next);
      else setAutoFinishing(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [autoFinishing, draftState]);

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

  function handlePick(playerId: string) {
    setDraftState((s) => makePick(s, playerId));
  }

  // 2026-09-12, user-reported live ("nadal brak korelacji") — `DraftBoard`'s span dropdown used to
  // be a purely local preview (`humanSpanSelection`), never written back here, so a cheaper span
  // swap couldn't free any cap room `isPickLegal`'s own lookahead would actually honor for the
  // REST of the draft — only `DraftBoard`'s own `setHumanSpan` calls this, and only once it has
  // already verified the swap is safe (never costs more than the span originally drafted, and
  // never busts the real cap given everything else already committed) — this just applies it.
  function handleSwapHumanSpan(playerName: string, newSpanId: string) {
    const key = normalizePlayerName(playerName);
    const newSpan = spanOptionsFor(playerName).find((s) => s.id === newSpanId);
    if (!newSpan) return;
    setDraftState((s) => ({
      ...s,
      teams: s.teams.map((t) =>
        t.isHuman
          ? { ...t, roster: t.roster.map((p) => (normalizePlayerName(p.playerName) === key ? newSpan : p)) }
          : t,
      ),
    }));
  }

  // 2026-08-30, now also a player-facing convenience: lets the user hand every remaining pick
  // to the existing AI draft logic. It still follows the normal draft-complete path below, so
  // rotations/finalization behave exactly as they do after the last manually played pick.
  function handleAutoFinish() {
    setAutoFinishing(true);
  }

  // 2026-09-11, player-skeleton branch: `handleSkipToResults` (Tester-Mode-only "⚡ Skip to
  // Results (dev)") removed along with its button — see GameShell's own top-of-file docstring.

  // 2026-08-16, replaces the old two-step `handleSpanSelectionConfirmed`/`handleRotationConfirmed`
  // pair: DraftBoard's Team tab now collects both the human's final spans AND their rotation
  // itself (see that file's own docstring), and hands both back here at once from a single
  // Submit action — this is the only place either ever gets written into `draftState`/`finalTeams`.
  function handleSubmitTeam(roster: PlayerSpan[], rotation: Rotation) {
    const teams = draftState.teams.map((t) => {
      if (t.isHuman) return { ...t, roster, rotation };
      // Defensive (audit DR-5): the one-shot `aiTeamsFinalized` effect optimizes AI spans and
      // builds their rotations after the draft completes, but the human can Submit on the same
      // render that enabled the button, before that effect fires. Finalize any AI team still
      // missing a rotation here too — `optimizeSpans` + `autoAssignRotation` are deterministic and
      // stable on an already-finalized roster, so this is a no-op once the effect has run.
      if (t.rotation) return t;
      const optimized = optimizeSpans(t.roster, CAP_LIMIT);
      return { ...t, roster: optimized, rotation: autoAssignRotation(optimized) };
    });
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
      {/* 2026-09-14, user-reported live: the results screen's own bottom "Play again" button
          (ResultsScreen.tsx) already calls this exact same `handleReset`/`onExit` — this top row
          used to relabel itself "New draft" and stick around during the results phase purely so
          there was ALWAYS a way out, but that made it a second button doing the identical thing
          the page already ends with. Scoped to `phase !== 'results'` now (still covers both
          `lottery` and `draft` — this row sits above `<DraftLottery>`/`<DraftBoard>` alike, and
          the lottery screen has no Exit control of its own) — "Exit Draft" (the one label this
          row ever needs once results-only "New draft" is gone) is the only case with no
          bottom-of-page equivalent. */}
      {phase !== 'results' && (
        <div className="game-controls">
          <button className="secondary-btn reset-btn" onClick={handleReset}>
            Exit Draft
          </button>
          {/* 2026-09-11, player-skeleton branch: the Tester-Mode-only CPU-speed slider and
              "Skip to Results (dev)" button are gone — `mode` is always 'player' on this branch (see
              App.tsx), so these never rendered here anyway; removed rather than left dead, since
              `aiSpeedIndex`/`handleSkipToResults` are genuinely unused now (see below). Auto-finish
              stays: it was always a real player-facing convenience, not a dev tool. */}
          {phase === 'draft' && !draftState.complete && (
            <button
              className="secondary-btn auto-finish-btn"
              onClick={handleAutoFinish}
              disabled={autoFinishing}
            >
              {autoFinishing ? `Finishing… ${draftState.history.length} / ${TOTAL_PICKS}` : 'Auto-finish'}
            </button>
          )}
        </div>
      )}

      {rosterImpossible && (
        <div className="fail-banner">
          <h2>FAIL</h2>
          <p>The pool ran dry — there aren't enough undrafted players left for your team to ever reach 9.</p>
          <button className="primary-btn" onClick={handleReset}>
            Exit Draft
          </button>
        </div>
      )}
      {phase === 'lottery' && (
        <DraftLottery
          teams={draftState.teams}
          onDone={() => setPhase('draft')}
          howToPlay={DRAFT_HOW_TO_PLAY}
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
          onSwapHumanSpan={handleSwapHumanSpan}
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
          draftSeed={draftState.seed}
          challenger={challenger}
        />
      )}
    </>
  );
}
