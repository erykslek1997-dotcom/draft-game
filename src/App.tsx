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
/** Same hand-kept-constant pattern as `DISPLAY_CAP_LIMIT` above, for the How to Play copy that
 * moved onto this screen (see the intro-screen `mode === 'player'` block below) — kept in sync
 * with `engine/positions.ts`'s real `ROSTER_SIZE`/`BENCH_SLOT_COUNT` by the same standing check,
 * extended to cover these two. */
const DISPLAY_ROSTER_SIZE = 9;
const DISPLAY_BENCH_SLOT_COUNT = 4;

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
  // grid, the Draft Lottery screen). Pre-filled with a real random suggestion (not a blank field)
  // so a player who doesn't care can just leave it — the 🎲 button next to the input re-rolls a
  // new one without retyping. Threaded through GameShell -> createDraft -> createInitialTeams
  // (draft.ts), which overrides the random draw for whichever slot ends up human with this exact
  // string.
  // 2026-08-16, follow-up (same session): moved the editable UI off this screen entirely, onto
  // the Draft Lottery's own "Your team" step.
  // 2026-08-19, user's explicit ask ("merge how to play with home screen etc"): moved back. Real
  // state again (was a no-setter placeholder while the Lottery screen owned editing) — see the
  // `mode === 'player'` block below for the input itself.
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
              Build the best-<em>fitting</em> all-time roster under a {DISPLAY_CAP_LIMIT} FGA cap — not just the best
              players.
            </p>
          </header>
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
            {/* 2026-08-19, user's explicit ask ("merge how to play with home screen etc"): "Your
                team" and How to Play both used to live on the Draft Lottery's own separate
                pre-reveal step, reached only after clicking "Start Draft" — merged back onto this
                screen instead, one screen instead of two. Still gated to Player Mode (unchanged
                reasoning from when this content first moved off this screen: Tester Mode doesn't
                need a team name or the rules), now reacting live to whichever mode is currently
                selected rather than waiting for a separate step to find out. */}
            {mode === 'player' && (
              <>
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
                    <b>Draft.</b> 16 teams take turns, {DISPLAY_ROSTER_SIZE} rounds — one player each round. You
                    control one team; the rest are CPU.
                  </li>
                  <li>
                    <b>FGA cap.</b> Every pick costs shot volume (FGA). Your whole roster has to fit under{' '}
                    {DISPLAY_CAP_LIMIT} FGA — the best player isn't always the pick that fits.
                  </li>
                  <li>
                    <b>Spans.</b> You're not limited to a player's peak — draft any real multi-season window of
                    their career. A cheaper, less-peak span can be the one that fits your cap.
                  </li>
                  <li>
                    <b>Rotation.</b> Set minutes for your 5 starters and {DISPLAY_BENCH_SLOT_COUNT} bench players —
                    the Team tab opens for it as soon as you have your first pick, no need to wait for the draft to
                    finish.
                  </li>
                  <li>
                    <b>Grading.</b> The judge scores every team — talent, offense, defense, spacing, fit, rotation —
                    and ranks the whole field, yours included.
                  </li>
                </ol>
              </>
            )}
            <button className="primary-btn" onClick={() => setView('game')}>
              Start Draft
            </button>
            <button className="secondary-btn" onClick={() => setView('pool')}>
              Browse Draft Pool
            </button>
          </div>
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
