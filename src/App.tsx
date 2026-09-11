import { lazy, Suspense, useMemo, useState } from 'react';
import './App.css';
// Plain, data-free module (place/mascot string arrays + a shuffle helper, no engine/dataset
// imports of its own — verified directly, not assumed) — safe to pull into the intro screen's
// eager bundle without regressing the "zero engine dependency until Start Draft" load-time split
// this file's own docstrings already care about (see DISPLAY_CAP_LIMIT's comment above).
import { randomTeamNames } from './engine/teamNames';

/**
 * 2026-09-11, `player-skeleton` branch: the real Tester Mode / Player Mode split (mode picker,
 * `SHOW_DEV_CONTROLS`, Commissioner Mode, DraftPoolBrowser/CapSheet/CardGallery nav) lives on
 * `catch-up-2026-08-14` — see that branch's `App.tsx` for the full history. This branch is
 * deliberately Player Mode ONLY, hardcoded, with no toggle anywhere: "musimy oddzielić tester game
 * od player game, żebym już mógł poprawiać na gotowym do eksportu szkielecie" (separate the
 * tester game from the player game, so there's a real export-ready skeleton to polish). Scope
 * further narrowed same session: "w player game zostawiamy tylko draft i build the best 5" — Card
 * Collection / Browse Draft Pool / Cap Sheet are NOT wired into this branch's nav at all (their
 * component files still exist, untouched, just unreached — reintroducing one later is a small,
 * additive change, not a revert). GameShell.tsx/BestFive.tsx had their own dev-only branches
 * stripped to match; DraftBoard.tsx's ~16 `mode === 'developer'`/`showJudgeMetrics` branches were
 * deliberately left in place (see that file — too much load-bearing history to strip safely in one
 * pass) but are permanently dead code here since `mode` is always `'player'`, never selectable.
 */

// Lazy-loaded so the intro screen renders instantly instead of blocking on the full engine
// import graph (~10MB of player/DARKO/WOWYR data, pulled in transitively by computeTalent's
// real-data corrections) — the user's own report: "the game feels slow with loading data."
// Nothing about showing the intro text or the position/search UI actually needs that data;
// it's only real work once a draft is actually rendered.
const GameShell = lazy(() => import('./components/GameShell'));
const BestFive = lazy(() => import('./components/BestFive'));
const QuickFive = lazy(() => import('./components/QuickFive'));

type View = 'intro' | 'game' | 'bestfive' | 'quickfive';

/** Cap value shown in the intro tagline, kept in sync with `engine/positions.ts`'s CAP_LIMIT by
 * the standing check in `scripts/checkIntroCapLimit.ts` — not imported directly so the intro
 * screen has zero engine dependency (see the lazy-loading note above; even this one constant,
 * pulled through `positions.ts`, would be harmless on its own today, but importing anything from
 * `engine/` here is exactly the seam that regresses back to eager-loading everything if a future
 * edit adds a heavier import to that file without anyone noticing this render path depends on it). */
const DISPLAY_CAP_LIMIT = 100.9;
/** Same hand-kept-constant pattern as `DISPLAY_CAP_LIMIT` above, for the always-visible How to
 * Play copy on the intro screen below — kept in sync with `engine/positions.ts`'s real
 * `ROSTER_SIZE`/`BENCH_SLOT_COUNT` by the same standing check, extended to cover these two. */
const DISPLAY_ROSTER_SIZE = 9;
const DISPLAY_BENCH_SLOT_COUNT = 4;

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="loading-panel">
      <p>{label}</p>
    </div>
  );
}

/** 2026-09-11, "Duel na seedzie" — read-only mirror of `GameShell.tsx`'s own `seedFromUrl()`, just
 * for the intro screen's own "you're on a shared board" hint below; the actual replay still only
 * ever happens inside `GameShell`'s `createDraft` call, this never touches draft state itself. */
function sharedDraftSeedFromUrl(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('draftSeed');
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : null;
}

function App() {
  const [view, setView] = useState<View>('intro');
  const sharedDraftSeed = useMemo(sharedDraftSeedFromUrl, []);
  // 2026-08-16, user's own ask ("żeby wiedział jaką drużynę ma" — so they can actually recognize
  // their own team): the human's own team used to always get one of the same random "Place
  // Mascot" names as the 15 CPU teams, indistinguishable from them anywhere it's listed (Overview
  // grid, the Draft Lottery screen). Pre-filled with a real random suggestion (not a blank field)
  // so a player who doesn't care can just leave it — the 🎲 button next to the input re-rolls a
  // new one without retyping. Threaded through GameShell -> createDraft -> createInitialTeams
  // (draft.ts), which overrides the random draw for whichever slot ends up human with this exact
  // string.
  const [teamName, setTeamName] = useState(() => randomTeamNames(1)[0]);

  return (
    <div className="app-shell">
      {/* 2026-08-16, user's own report: the intro screen's big "All-Time Draft" title and the
          in-draft shell's own "All-Time Draft" wordmark (DraftBoard.tsx's `.at-wordmark`) both
          rendered at once once a draft started, since this header used to show on every view
          unconditionally — same name, twice, one above the other. Scoping it to the intro view
          leaves exactly one: the big title on the splash screen, the compact wordmark once you're
          actually inside a draft. Also trims persistent chrome above the game controls during
          play, which was part of the same "draft bez dodatkowych napisów" ask. */}
      {/* 2026-08-19, "NBA-touch" full redesign: the splash screen picks up the same `.at-shell`
          dark-board tokens/card treatment DraftBoard/DraftLottery/ResultsScreen already use,
          instead of sitting on the plain app-wide light/dark tokens as a visibly different-looking
          "old UI" leftover — the first screen every session sees now matches the rest of the app. */}
      {view === 'intro' && (
        <div className="at-shell at-intro">
          <header className="app-header">
            <h1>All-Time NBA Draft</h1>
            <p className="tagline">
              Build the best-<em>fitting</em> all-time roster under a {DISPLAY_CAP_LIMIT}-shot cap — not just the best
              players.
            </p>
          </header>
          {sharedDraftSeed !== null && (
            <p className="shared-seed-banner">
              🔗 Duel loaded — Start Draft gives you the exact same 16-team board a friend already played.
            </p>
          )}
          <div className="intro-screen">
            <div className="team-name-row">
              <label htmlFor="intro-team-name" className="team-name-label">
                Your team
              </label>
              <input
                id="intro-team-name"
                type="text"
                className="team-name-input"
                value={teamName}
                maxLength={40}
                onChange={(e) => setTeamName(e.target.value)}
              />
              <button
                type="button"
                className="secondary-btn team-name-randomize"
                title="Randomize a new suggestion"
                onClick={() => setTeamName(randomTeamNames(1)[0])}
              >
                🎲
              </button>
            </div>
            <ol className="how-to-play-panel">
              <li>
                <b>Draft.</b> 16 teams take turns, {DISPLAY_ROSTER_SIZE} rounds — one player each round. You control
                one team; the rest are CPU.
              </li>
              <li>
                <b>Shot cap.</b> Every pick costs shots. Your whole roster has to fit under{' '}
                {DISPLAY_CAP_LIMIT} shots — the best player isn't always the pick that fits.
              </li>
              <li>
                <b>Spans.</b> You're not limited to a player's peak — draft any real multi-season window of their
                career. A cheaper, less-peak span can be the one that fits your cap.
              </li>
              <li>
                <b>Rotation.</b> Set minutes for your 5 starters and {DISPLAY_BENCH_SLOT_COUNT} bench players — the
                Team tab opens for it as soon as you have your first pick, no need to wait for the draft to finish.
              </li>
              <li>
                <b>Grading.</b> The judge scores every team — talent, offense, defense, spacing, fit, rotation — and
                ranks the whole field, yours included.
              </li>
            </ol>
            <div className="intro-actions">
              <button className="primary-btn" onClick={() => setView('game')}>
                Start Draft
              </button>
              <button className="secondary-btn intro-bestfive-btn" onClick={() => setView('bestfive')}>
                Build the Best 5 — daily
              </button>
              <button className="secondary-btn" onClick={() => setView('quickfive')}>
                Szybka 5 — 5 rounds, 70-shot cap
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'game' && (
        <Suspense fallback={<LoadingPanel label="Loading player data…" />}>
          <GameShell mode="player" commissionerMode={false} humanTeamName={teamName} onExit={() => setView('intro')} />
        </Suspense>
      )}

      {view === 'bestfive' && (
        <Suspense fallback={<LoadingPanel label="Loading player data…" />}>
          <BestFive mode="player" onBack={() => setView('intro')} />
        </Suspense>
      )}

      {view === 'quickfive' && (
        <Suspense fallback={<LoadingPanel label="Loading player data…" />}>
          <QuickFive humanTeamName={teamName} onExit={() => setView('intro')} />
        </Suspense>
      )}
    </div>
  );
}

export default App;
