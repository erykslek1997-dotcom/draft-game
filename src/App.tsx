import { lazy, Suspense, useState } from 'react';
import './App.css';

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

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>All-Time Draft</h1>
        <p className="tagline">
          Build the best-<em>fitting</em> all-time roster under a {DISPLAY_CAP_LIMIT} FGA cap — not just the best
          players.
        </p>
      </header>

      {view === 'intro' && (
        <div className="intro-screen">
          <p>
            Draft a 9-player all-time roster against 15 CPU teams, one pick at a time, under an FGA cap that forces
            real trade-offs. Once the draft ends, you'll set your rotation's minutes, and the judge will grade every
            roster — including yours.
          </p>
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
          <GameShell mode={mode} commissionerMode={commissionerMode} onExit={() => setView('intro')} />
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
