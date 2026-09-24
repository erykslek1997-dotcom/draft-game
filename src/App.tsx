import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import './App.css';
// Plain, data-free module (place/mascot string arrays + a shuffle helper, no engine/dataset
// imports of its own — verified directly, not assumed) — safe to pull into the intro screen's
// eager bundle without regressing the "zero engine dependency until Start Draft" load-time split
// this file's own docstrings already care about (see DISPLAY_ROSTER_SIZE's comment below).
import { randomTeamNames } from './engine/teamNames';
import { clearDraftSave, readDraftSaveSummary, type DraftSaveSummary } from './draftSaveSummary';
import { getLoadStatus, loadGameModule, prefetchGameData, subscribeLoadStatus, type LoadStatus } from './gameLoader';

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
// 2026-09-24: routed through `loadGameModule` (gameLoader.ts) so the wait shows a real download
// percentage, then a "Preparing players" stage, instead of one static line of text.
const GameShell = lazy(() => loadGameModule(() => import('./components/GameShell')));
const BestFive = lazy(() => loadGameModule(() => import('./components/BestFive')));
const QuickFive = lazy(() => loadGameModule(() => import('./components/QuickFive')));

function useLoadStatus(): LoadStatus {
  const [loadStatus, setLoadStatus] = useState(getLoadStatus);
  useEffect(() => subscribeLoadStatus(setLoadStatus), []);
  return loadStatus;
}

type View = 'intro' | 'game' | 'bestfive' | 'quickfive';

/** Roster-size figure shown in the Draft mode card's own one-line description, kept in sync with
 * `engine/positions.ts`'s real `ROSTER_SIZE` by the standing check in
 * `scripts/checkIntroCapLimit.ts` — not imported directly so the intro screen has zero engine
 * dependency (see the lazy-loading note above; even this one constant, pulled through
 * `positions.ts`, would be harmless on its own today, but importing anything from `engine/` here
 * is exactly the seam that regresses back to eager-loading everything if a future edit adds a
 * heavier import to that file without anyone noticing this render path depends on it). */
const DISPLAY_ROSTER_SIZE = 9;
/** Same hand-kept-constant pattern again, for the Quick 5 mode card's own one-line description —
 * kept in sync with `engine/quickDraft.ts`'s real `QUICK_CAP_LIMIT` by the same standing check
 * (`scripts/checkIntroCapLimit.ts`), extended to cover this one too. */
const DISPLAY_QUICK_CAP_LIMIT = 70;
/** Same hand-kept-constant pattern, revived for the mode cards' own "?" popovers below (2026-09-17,
 * user's own ask — a quick-glance rules check without leaving the menu). Kept in sync with
 * `engine/positions.ts`'s real `CAP_LIMIT`/`BENCH_SLOT_COUNT` by the same standing check. */
const DISPLAY_CAP_LIMIT = 100.9;
const DISPLAY_BENCH_SLOT_COUNT = 4;

/** Same copy as each mode's own in-flow "How to play?" (GameShell.tsx's `DRAFT_HOW_TO_PLAY`,
 * QuickFive.tsx's `QUICK_HOW_TO_PLAY`, BestFive.tsx's inline list) — duplicated by hand rather than
 * imported, same reasoning as the `DISPLAY_*` constants above: App.tsx must stay free of any
 * engine import until a mode is actually chosen. Keep these three in sync with their real-mode
 * counterparts if the rules ever change. */
const MODE_HOW_TO_PLAY_TITLE: Record<'draft' | 'bestfive' | 'quickfive', string> = {
  draft: 'All-Time Draft',
  bestfive: 'Best 5',
  quickfive: 'Quick 5',
};

const MODE_HOW_TO_PLAY: Record<'draft' | 'bestfive' | 'quickfive', { title: string; body: string }[]> = {
  draft: [
    { title: 'Draft', body: `16 teams take turns, ${DISPLAY_ROSTER_SIZE} rounds — one player each round. You control one team; the rest are CPU.` },
    { title: 'Shot cap', body: `Every pick costs shots. Your whole roster has to fit under ${DISPLAY_CAP_LIMIT} shots — the best player isn't always the pick that fits.` },
    { title: 'Spans', body: "You're not limited to a player's peak — draft any real multi-season window of their career. A cheaper, less-peak span can be the one that fits your cap." },
    { title: 'Rotation', body: `Set minutes for your 5 starters and ${DISPLAY_BENCH_SLOT_COUNT} bench players — the Team tab opens for it as soon as you have your first pick, no need to wait for the draft to finish.` },
    { title: 'Grading', body: 'The judge scores every team — talent, offense, defense, spacing, fit, rotation — and ranks the whole field, yours included.' },
  ],
  bestfive: [
    { title: 'Pick five', body: 'One player per position — PG/SG/SF/PF/C — from today’s pool.' },
    { title: 'Shot cap', body: 'Your five have to fit under today’s cap, shown by the meter above the board.' },
    { title: 'Submit once', body: 'No re-picking after you see your score for today’s puzzle.' },
    { title: 'Grading', body: 'You’re scored on talent, offense, defense, spacing, and fit, then compared against par.' },
    { title: 'Practice anytime', body: 'Today’s puzzle is once a day — a practice board gives you a fresh random pool whenever you want another rep.' },
  ],
  quickfive: [
    { title: 'Draft', body: `16 teams take turns, 5 rounds — one starter each round, no bench. You control one team; the rest are CPU.` },
    { title: 'Shot cap', body: `Every pick costs shots. Your five starters have to fit under ${DISPLAY_QUICK_CAP_LIMIT} shots.` },
    { title: 'Peak only', body: "No span picking — every player is shown at their single best season, so each pick is quick." },
    { title: 'Grading', body: 'The judge scores your five the same way the full draft does — talent, offense, defense, spacing, fit — right after your last pick.' },
  ],
};

function LoadingPanel() {
  const { stage, progress } = useLoadStatus();
  const downloading = stage === 'idle' || stage === 'download';
  const pct = downloading && progress !== null ? Math.round(progress * 100) : null;
  return (
    <div className="loading-panel" role="status" aria-live="polite">
      <p className="loading-panel-label">
        {downloading ? 'Downloading player data' : 'Preparing players'}
        {pct !== null ? ` — ${pct}%` : '…'}
      </p>
      <div className="loading-bar" aria-hidden>
        {pct !== null ? (
          <span className="loading-bar-fill" style={{ width: `${pct}%` }} />
        ) : (
          <span className="loading-bar-indeterminate" />
        )}
      </div>
      <p className="loading-panel-hint">
        {downloading
          ? '80 years of real NBA seasons — this only downloads once.'
          : 'Rating every season in the pool — a few more seconds.'}
      </p>
    </div>
  );
}

/** Small status line under the mode cards while the data downloads in the background. */
function IntroDataStatus() {
  const { stage, progress } = useLoadStatus();
  // Nothing to report when there was no real download to track (dev server, or a failed prefetch
  // that the mode's own import will simply retry).
  if (stage === 'idle' || progress === null) return null;
  const ready = stage !== 'download';
  return (
    <p className={`intro-data-status ${ready ? 'is-ready' : ''}`} role="status">
      {ready ? '✓ Player data ready' : `Loading player data… ${progress !== null ? Math.round(progress * 100) : 0}%`}
    </p>
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
  // Re-read whenever the intro is shown: GameShell strips a shared link's params from the URL once
  // it has used them (2026-09-24), so the "Duel loaded" banner must not outlive that.
  const sharedDraftSeed = useMemo(() => (view === 'intro' ? sharedDraftSeedFromUrl() : null), [view]);
  // 2026-09-24: the autosaved All-Time Draft (components/draftSave.ts), if any — re-read on every
  // return to the intro, since leaving a draft or finishing one changes it.
  const savedDraft = useMemo<DraftSaveSummary | null>(() => (view === 'intro' ? readDraftSaveSummary() : null), [view]);
  const [resumeDraft, setResumeDraft] = useState(false);
  const [confirmNewDraft, setConfirmNewDraft] = useState(false);
  function startNewDraft() {
    if (savedDraft && !confirmNewDraft) {
      setConfirmNewDraft(true);
      return;
    }
    clearDraftSave();
    setConfirmNewDraft(false);
    setResumeDraft(false);
    setView('game');
  }
  function continueDraft() {
    setResumeDraft(true);
    setView('game');
  }
  // 2026-08-16, user's own ask ("żeby wiedział jaką drużynę ma" — so they can actually recognize
  // their own team): the human's own team used to always get one of the same random "Place
  // Mascot" names as the 15 CPU teams, indistinguishable from them anywhere it's listed (Overview
  // grid, the Draft Lottery screen). Pre-filled with a real random suggestion (not a blank field)
  // so a player who doesn't care can just leave it — the 🎲 button next to the input re-rolls a
  // new one without retyping. Threaded through GameShell -> createDraft -> createInitialTeams
  // (draft.ts), which overrides the random draw for whichever slot ends up human with this exact
  // string.
  const [teamName, setTeamName] = useState(() => randomTeamNames(1)[0]);
  // 2026-09-17, user's own ask: a "?" on each mode card itself, so the rules are a glance away
  // right on the menu instead of only reachable after already committing to a mode.
  const [expandedHelp, setExpandedHelp] = useState<'draft' | 'bestfive' | 'quickfive' | null>(null);
  function toggleHelp(mode: 'draft' | 'bestfive' | 'quickfive') {
    setExpandedHelp((current) => (current === mode ? null : mode));
  }
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);
  // 2026-09-24: start downloading the player data as soon as the menu is up — by the time the
  // player has read the modes and picked a team name, most or all of it is already here.
  useEffect(() => {
    const t = setTimeout(() => void prefetchGameData(), 300);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!expandedHelp && !confirmNewDraft) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setExpandedHelp(null);
        setConfirmNewDraft(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedHelp, confirmNewDraft]);

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
        <div className="at-shell at-intro at-intro-terminal">
          {/* 2026-09-17, user's own ask on a genuinely wide monitor: the whole screen used to be
              one narrow centred column pinned near the top, leaving most of a large display
              empty — `.intro-columns` splits it into a hero (wordmark + team name, vertically
              centred) on the left and the mode list as its own column on the right, once there's
              real width to spend (see the `min-width` breakpoint below); narrower viewports keep
              the original single stacked column, just flowing top to bottom. */}
          <div className="intro-columns">
            <div className="intro-hero">
              <header className="app-header">
                {/* 2026-09-17, user's own ask ("czy jest możliwość połączenie modern designu z
                    starszym?"): a genuinely old-basketball touch on an otherwise modern/terminal
                    screen, kept to one small stamp rather than reskinning anything — full concept
                    (era-aware player cards) prototyped separately and parked, see
                    [[heritage_board_era_cards_concept]]. 1946 is the real first season this game's
                    own data covers, not a decorative number. */}
                <span className="heritage-badge" aria-hidden>
                  Est. 1946
                </span>
                <h1>Draftverse</h1>
              </header>
              {sharedDraftSeed !== null && (
                <p className="shared-seed-banner">
                  🔗 Duel loaded — Start Draft gives you the exact same 16-team board a friend already played.
                </p>
              )}
              {savedDraft && (
                <div className="saved-draft-banner">
                  <span>
                    Draft in progress — <b>{savedDraft.teamName}</b>, {savedDraft.humanPicks}/{savedDraft.rosterSize} picks made.
                  </span>
                  <button type="button" className="saved-draft-continue at-cond" onClick={continueDraft}>
                    Continue draft
                  </button>
                </div>
              )}
              <div className="team-name-row">
                <label htmlFor="intro-team-name" className="team-name-label">
                  Your team
                </label>
                <div className="team-name-input-row">
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
              </div>
            </div>
            {/* 2026-09-11, mode-card grid — the intro used to stack every mode as same-weight
                buttons in a column; three real modes now (Draft/Best 5/Quick 5) makes that
                column read as a growing pile instead of a set of real choices. User's own steer
                (shown a competitor's icon-grid mode picker): "tak, dobry kierunek... nie kopiuję
                1:1 wyglądu... naszej już ustalonej ciemnej tablicy NBA-touch, żeby siatka
                wyglądała jak część tej samej gry" — structure only (icon + name + one line +
                a NEW badge for a genuinely new mode), our own dark board tokens throughout, not
                the reference's own colors/branding. Draft keeps the visual weight it earns from
                every other piece of this screen (hero, tagline, How to Play) already being about
                it — the other two are real, equal-footing choices, not afterthoughts. */}
            <div className="mode-grid">
              <div className="mode-card-wrap">
                <button className="mode-card mode-card--featured" onClick={startNewDraft}>
                  <span className="mode-card-icon" aria-hidden>
                    🏀
                  </span>
                  <span className="mode-card-name at-cond">All-Time Draft</span>
                  <span className="mode-card-desc">16 teams, {DISPLAY_ROSTER_SIZE} rounds — real AI reacting to every pick you make.</span>
                </button>
                <button
                  type="button"
                  className="mode-card-help"
                  aria-label="How to play: All-Time Draft"
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHelp('draft');
                  }}
                >
                  ?
                </button>
              </div>
              <div className="mode-card-wrap">
                <button className="mode-card" onClick={() => setView('bestfive')}>
                  <span className="mode-card-icon" aria-hidden>
                    🧩
                  </span>
                  <span className="mode-card-name at-cond">Best 5</span>
                  <span className="mode-card-desc">Daily puzzle — pick five under a shot cap, beat the field.</span>
                </button>
                <button
                  type="button"
                  className="mode-card-help"
                  aria-label="How to play: Best 5"
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHelp('bestfive');
                  }}
                >
                  ?
                </button>
              </div>
              <div className="mode-card-wrap">
                <button className="mode-card" onClick={() => setView('quickfive')}>
                  <span className="mode-card-icon" aria-hidden>
                    ⚡
                  </span>
                  <span className="mode-card-name at-cond">Quick 5</span>
                  <span className="mode-card-desc">5 rounds, a {DISPLAY_QUICK_CAP_LIMIT}-shot cap — a real draft in a few minutes.</span>
                </button>
                <button
                  type="button"
                  className="mode-card-help"
                  aria-label="How to play: Quick 5"
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHelp('quickfive');
                  }}
                >
                  ?
                </button>
              </div>
              <IntroDataStatus />
            </div>
          </div>
          {confirmNewDraft && savedDraft && (
            <div className="mode-help-backdrop" onClick={() => setConfirmNewDraft(false)}>
              <div
                className="mode-help-modal"
                role="alertdialog"
                aria-modal="true"
                aria-label="Start a new draft?"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mode-help-modal-head">
                  <span className="mode-help-modal-title at-cond">Start a new draft?</span>
                </div>
                <p className="saved-draft-confirm-text">
                  Your draft in progress ({savedDraft.teamName}, {savedDraft.humanPicks}/{savedDraft.rosterSize} picks) will be
                  discarded.
                </p>
                <div className="saved-draft-confirm-actions">
                  <button type="button" className="secondary-btn" onClick={continueDraft} autoFocus>
                    Continue that draft
                  </button>
                  <button type="button" className="primary-btn" onClick={startNewDraft}>
                    Start new draft
                  </button>
                </div>
              </div>
            </div>
          )}
          {expandedHelp && (
            <div className="mode-help-backdrop" onClick={() => setExpandedHelp(null)}>
              <div
                className="mode-help-modal"
                role="dialog"
                aria-modal="true"
                aria-label={`How to play: ${MODE_HOW_TO_PLAY_TITLE[expandedHelp]}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mode-help-modal-head">
                  <span className="mode-help-modal-title at-cond">{MODE_HOW_TO_PLAY_TITLE[expandedHelp]}</span>
                  <button type="button" className="mode-help-modal-close" aria-label="Close" onClick={() => setExpandedHelp(null)}>
                    ✕
                  </button>
                </div>
                <ol className="how-to-play-panel mode-help-modal-panel">
                  {MODE_HOW_TO_PLAY[expandedHelp].map((item) => (
                    <li key={item.title}>
                      <b>{item.title}.</b> {item.body}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'game' && (
        <Suspense fallback={<LoadingPanel />}>
          <GameShell
            mode="player"
            commissionerMode={false}
            humanTeamName={teamName}
            resume={resumeDraft}
            onExit={() => setView('intro')}
          />
        </Suspense>
      )}

      {view === 'bestfive' && (
        <Suspense fallback={<LoadingPanel />}>
          <BestFive mode="player" onBack={() => setView('intro')} />
        </Suspense>
      )}

      {view === 'quickfive' && (
        <Suspense fallback={<LoadingPanel />}>
          <QuickFive humanTeamName={teamName} onExit={() => setView('intro')} />
        </Suspense>
      )}
    </div>
  );
}

export default App;
