import { lazy, Suspense, useState } from 'react';
import './App.css';
// Plain, data-free module (place/mascot string arrays + a shuffle helper, no engine/dataset
// imports of its own — verified directly, not assumed) — safe to pull into the intro screen's
// eager bundle without regressing the "zero engine dependency until Start Draft" load-time split
// this file's own docstrings already care about (see DISPLAY_CAP_LIMIT's comment above).
import { randomTeamNames } from './engine/teamNames';

// Lazy-loaded so the intro screen renders instantly instead of blocking on the full engine
// import graph (~10MB of player/DARKO/WOWYR data, pulled in transitively by computeTalent's
// real-data corrections) — the user's own report: "the game feels slow with loading data."
// Nothing about showing the intro text or the position/search UI actually needs that data;
// it's only real work once a draft or the pool browser is actually rendered.
const GameShell = lazy(() => import('./components/GameShell'));
const DraftPoolBrowser = lazy(() => import('./components/DraftPoolBrowser'));

type View = 'intro' | 'game' | 'pool';
type Mode = 'developer' | 'player';

/** Set at build time (e.g. `VITE_FORCE_PLAYER_MODE=true npm run build`) to ship a locked-down
 * build for a playtester — Player Mode on, no selector to reach Tester Mode. Leave unset for
 * normal local development, where the mode selector is shown on the intro screen and Tester
 * Mode (the old, internally-named 'developer' mode — same engine, just the pre-redesign UI with
 * every judge metric visible) is the default. */
const FORCE_PLAYER_MODE = import.meta.env.VITE_FORCE_PLAYER_MODE === 'true';

const MODE_OPTIONS: ReadonlyArray<{ id: Mode; name: string; blurb: string }> = [
  { id: 'developer', name: 'Tester Mode', blurb: 'Old UI — every judge rating visible' },
  { id: 'player', name: 'Player Mode', blurb: 'New UI — blind scouting, box stats only' },
];

/** Cap value shown in the intro tagline, kept in sync with `engine/positions.ts`'s CAP_LIMIT by
 * the standing check in `scripts/checkIntroCapLimit.ts` — not imported directly so the intro
 * screen has zero engine dependency (see the lazy-loading note above; even this one constant,
 * pulled through `positions.ts`, would be harmless on its own today, but importing anything from
 * `engine/` here is exactly the seam that regresses back to eager-loading everything if a future
 * edit adds a heavier import to that file without anyone noticing this render path depends on it). */
const DISPLAY_CAP_LIMIT = 100.9;

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="loading-panel">
      <p>{label}</p>
    </div>
  );
}

function App() {
  const [view, setView] = useState<View>('intro');
  const [mode, setMode] = useState<Mode>(FORCE_PLAYER_MODE ? 'player' : 'developer');
  // 2026-08-07, user explicit ask: manually control every one of the 16 teams for a full,
  // causally-reasoned draft (not just the one randomly-assigned human slot), to build a rich
  // pick-by-pick reference dataset — the richest kind of data this project has ever gathered, per
  // the D1 human-vote validation session's own finding that raw outcomes alone (who went where)
  // barely correlate with the actual judge formula. Decided here, before `createDraft()` runs,
  // since the flag has to exist on `DraftState` from the very first pick (see draft.ts's own
  // docstring on why this is a separate flag, not just flipping every team's `isHuman`).
  const [commissionerMode, setCommissionerMode] = useState(false);
  // 2026-08-16, user's own ask ("żeby wiedział jaką drużynę ma" — so they can actually recognize
  // their own team): the human's own team used to always get one of the same random "Place
  // Mascot" names as the 15 CPU teams, indistinguishable from them anywhere it's listed (Overview
  // grid, the new Draft Lottery screen). Pre-filled with a real random suggestion (not a blank
  // field) so a player who doesn't care can just leave it — the 🎲 button next to the input
  // re-rolls a new one without retyping. Threaded through GameShell -> createDraft ->
  // createInitialTeams (draft.ts), which overrides the random draw for whichever slot ends up
  // human with this exact string.
  // 2026-08-16, further follow-up (this session): the visible name-editing UI moved entirely to
  // the Draft Lottery's "Your team" step (DraftLottery.tsx) — this still generates the initial
  // random suggestion `createDraft` needs the moment GameShell mounts, but nothing on THIS screen
  // ever changes it anymore, so there's no setter to expose here.
  const [teamName] = useState(() => randomTeamNames(1)[0]);

  return (
    <div className="app-shell">
      {/* 2026-08-16, user's own report: the intro screen's big "All-Time Draft" title and the
          in-draft shell's own "All-Time Draft" wordmark (DraftBoard.tsx's `.at-wordmark`) both
          rendered at once once a draft started, since this header used to show on every view
          unconditionally — same name, twice, one above the other. Scoping it to the intro view
          leaves exactly one: the big title on the splash screen, the compact wordmark once you're
          actually inside a draft. Also trims persistent chrome above the game controls during
          play, which was part of the same "draft bez dodatkowych napisów" ask. */}
      {view === 'intro' && (
        <header className="app-header">
          <h1>All-Time NBA Draft</h1>
          <p className="tagline">
            Build the best-<em>fitting</em> all-time roster under a {DISPLAY_CAP_LIMIT} FGA cap — not just the best
            players.
          </p>
        </header>
      )}

      {view === 'intro' && (
        <div className="intro-screen">
          {!FORCE_PLAYER_MODE && (
            <div className="mode-select" role="radiogroup" aria-label="Mode">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === opt.id}
                  className={`mode-select-btn ${mode === opt.id ? 'mode-select-btn--active' : ''}`}
                  onClick={() => setMode(opt.id)}
                >
                  <span className="mode-select-name">{opt.name}</span>
                  <span className="mode-select-blurb">{opt.blurb}</span>
                </button>
              ))}
            </div>
          )}
          {!FORCE_PLAYER_MODE && (
            <label className="commissioner-toggle">
              <input type="checkbox" checked={commissionerMode} onChange={(e) => setCommissionerMode(e.target.checked)} />
              Commissioner Mode — control all 16 teams yourself, with a reasoning note per pick
            </label>
          )}
          {/* 2026-08-16, user's own follow-up correction, then a same-day second correction: "Your
              team" (the name input) moved off this screen entirely too, same reasoning as How to
              Play just below — it only makes sense once Player Mode is the choice, and the splash
              screen should stay a splash screen. Both now live together on the Draft Lottery's own
              pre-reveal step (DraftLottery.tsx's `stage === 'intro'`), which runs right after
              "Start Draft" — see that component's own docstring. `teamName` is still generated
              here (silently, no visible UI) so `createDraft` has a real starting name the moment
              GameShell mounts; the Lottery screen edits it in place via `onRenameTeam`. */}
          <button className="primary-btn" onClick={() => setView('game')}>
            Start Draft
          </button>
          <button className="secondary-btn" onClick={() => setView('pool')}>
            Browse Draft Pool
          </button>
        </div>
      )}

      {view === 'game' && (
        <Suspense fallback={<LoadingPanel label="Loading player data…" />}>
          <GameShell mode={mode} commissionerMode={commissionerMode} humanTeamName={teamName} onExit={() => setView('intro')} />
        </Suspense>
      )}

      {view === 'pool' && (
        <Suspense fallback={<LoadingPanel label="Loading player data…" />}>
          <DraftPoolBrowser mode={mode} onBack={() => setView('intro')} />
        </Suspense>
      )}
    </div>
  );
}

export default App;
