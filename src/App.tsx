import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import './night/index.css';
import { BRAND } from './brand';
import { NightMenu } from './night/Menu';
import { NightConfirm } from './night/Dialogs';
import { stepDone } from './components/pathProgress';
// Small modules with no player data: the franchise pool (names, codes, logo parts; its one engine
// import is type-only) and the logo kit — safe to pull into the intro screen's eager bundle
// without regressing the "zero engine dependency until Start Draft" load-time split this file's
// own docstrings already care about (see DISPLAY_ROSTER_SIZE's comment below).
import { randomFranchiseName, teamCodes } from './engine/teamNames';
import { initialTeamsForSeed } from './engine/draftSetup';
import { ROSTER_SIZE } from './engine/rosterConstants';
import { randomSeed } from './engine/rng';
import type { Team } from './engine/types';
import { NightLottery } from './night/league';
import { CapsInfoHost } from './components/CapIcon';
import { clearDraftSave, readDraftSaveSummary, type DraftSaveSummary } from './draftSaveSummary';
import { takeModeChallengeFromUrl, type ModeChallenge } from './modeChallenge';
import { LIVE_TEST_BENCH_FOR_TESTING } from './components/testingFlags';
import { DAILY_REPLAY_FOR_TESTING, localDayKey } from './components/dailyProgress';
import type { DailyDraftDay, DailyDraftMode } from './dailyDraftDay';
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
// 2026-09-25: one shared promise, so the intro's early lottery can start preparing the draft module
// (and its player data) before React asks for it.
let gameShellPromise: ReturnType<typeof loadGameShellUncached> | null = null;
function loadGameShellUncached() {
  return loadGameModule(() => import('./components/GameShell'));
}
function loadGameShell() {
  gameShellPromise ??= loadGameShellUncached();
  return gameShellPromise;
}
const GameShell = lazy(loadGameShell);
const BestFive = lazy(() => loadGameModule(() => import('./components/BestFive')));
const QuickFive = lazy(() => loadGameModule(() => import('./components/QuickFive')));
const LiveTestBench = lazy(() => loadGameModule(() => import('./components/LiveTestBench')));

function useLoadStatus(): LoadStatus {
  const [loadStatus, setLoadStatus] = useState(getLoadStatus);
  useEffect(() => subscribeLoadStatus(setLoadStatus), []);
  return loadStatus;
}

type View = 'intro' | 'game' | 'bestfive' | 'quickfive' | 'daily' | 'livetest';

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
const MODE_HOW_TO_PLAY: Record<'draft' | 'bestfive' | 'quickfive', { title: string; body: string }[]> = {
  draft: [
    { title: 'Draft', body: `16 teams take turns, ${DISPLAY_ROSTER_SIZE} rounds — one player each round. You control one team; the rest are CPU.` },
    { title: 'Caps', body: `Every pick costs caps — a player's price is how many shots a game he took in those years. Your whole roster has to fit under ${DISPLAY_CAP_LIMIT} caps, so the best player isn't always the pick that fits.` },
    { title: 'Years', body: "Every player comes with several stretches of his career (e.g. 1996-98 vs 2003-05). The draft takes his best one; in the Team tab you can switch to other years — a cheaper, less-peak stretch can be what fits your cap." },
    { title: 'Rotation', body: `Set minutes for your 5 starters and ${DISPLAY_BENCH_SLOT_COUNT} bench players — the Team tab opens for it as soon as you have your first pick, no need to wait for the draft to finish.` },
    { title: 'Grading', body: 'The judge scores every team — talent, offense, defense, spacing, fit, rotation — and ranks the whole field, yours included.' },
  ],
  bestfive: [
    { title: 'The deck', body: 'Shuffled as the game loads. Draw four cards for each position, pick one, and the next position comes up.' },
    { title: 'Caps', body: 'Every player costs caps — his shots per game in those years. Your five have to fit under the board’s cap, shown by the meter above it.' },
    { title: 'Submit once', body: 'No re-picking after you see your score.' },
    { title: 'Grading', body: 'You’re scored on talent, offense, defense, spacing, and fit, then compared against the fan-vote five.' },
    { title: 'Against the AI', body: 'The AI drafts its own five from the same deck under the same cap — then the two fives play a live game.' },
  ],
  quickfive: [
    { title: 'Draft', body: `16 teams take turns, 5 rounds — one starter each round, no bench. You control one team; the rest are CPU.` },
    { title: 'Caps', body: `Every pick costs caps — his shots per game in those years. Your five starters have to fit under ${DISPLAY_QUICK_CAP_LIMIT} caps.` },
    { title: 'Peak only', body: "No choosing years — every player is shown at his single best season, so each pick is quick." },
    { title: 'Grading', body: 'The judge scores your five the same way the full draft does — talent, offense, defense, spacing, fit — right after your last pick.' },
  ],
};

function LoadingPanel({ mode = 'Getting the players ready' }: { mode?: string }) {
  const { stage, progress } = useLoadStatus();
  const downloading = stage === 'idle' || stage === 'download';
  const pct = downloading && progress !== null ? Math.round(progress * 100) : null;
  // Night edition (mockup `alltime.html#loading`): the masthead, one line, one bar.
  return (
    <div className="nt">
      <div className="game solo">
        <main>
          <div className="load" role="status" aria-live="polite">
            <div className="mast">
              <b>{BRAND}</b>
              <small>{mode}</small>
            </div>
            <div className="load-l">
              <span>{downloading ? 'Downloading player data' : 'Preparing players'}</span>
              <em>{pct !== null ? `${pct}%` : '…'}</em>
            </div>
            <div className="load-bar" aria-hidden>
              <i className={pct === null ? 'indet' : undefined} style={pct !== null ? { width: `${pct}%` } : undefined} />
            </div>
            <p>{downloading ? '80 years of real NBA seasons. This only downloads once.' : 'Rating every season in the pool. A few more seconds.'}</p>
          </div>
        </main>
      </div>
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
    <p className="m2-note" role="status">
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
  // 2026-09-27: a Mini Draft / Roulette "Challenge a friend" link opens straight on that board.
  const [modeChallenge] = useState<ModeChallenge | null>(() => takeModeChallengeFromUrl());
  const [dailyOffset, setDailyOffset] = useState(0);
  const [view, setView] = useState<View>(() =>
    modeChallenge?.mode === 'mini' ? 'quickfive' : modeChallenge?.mode === 'roulette' ? 'bestfive' : 'intro',
  );
  // Today's Mini daily when it was opened from its strip; null for a regular Mini Draft.
  const [miniDaily, setMiniDaily] = useState<DailyDraftDay | null>(null);
  // Today's All-Time daily when it was opened from its strip; null for a regular draft.
  const [allTimeDaily, setAllTimeDaily] = useState<DailyDraftDay | null>(null);
  // Testing only: how many days from today each mode's daily strip is rerolled to.
  const [dailyReroll, setDailyReroll] = useState<Record<DailyDraftMode, number>>({ mini: 0, alltime: 0, bomb: 0 });
  // Re-read whenever the intro is shown: GameShell strips a shared link's params from the URL once
  // it has used them (2026-09-24), so the "Duel loaded" banner must not outlive that.
  const sharedDraftSeed = useMemo(() => (view === 'intro' ? sharedDraftSeedFromUrl() : null), [view]);
  // 2026-09-24: the autosaved All-Time Draft (components/draftSave.ts), if any — re-read on every
  // return to the intro, since leaving a draft or finishing one changes it.
  const savedDraft = useMemo<DraftSaveSummary | null>(() => (view === 'intro' ? readDraftSaveSummary() : null), [view]);
  const [resumeDraft, setResumeDraft] = useState(false);
  const [confirmNewDraft, setConfirmNewDraft] = useState(false);
  // 2026-09-25, user's ask ("zamiast długiego paska ładowania skracamy go czasowo, ładowanie
  // nadal w tle"): a new draft opens straight on its lottery — seed and teams need no player
  // data (engine/draftSetup.ts) — while the data keeps loading behind it. The draft module is
  // prepared once the reel stops, and the board opens with exactly this seed and these teams.
  const [earlyDraft, setEarlyDraft] = useState<{ seed: number; teams: Team[] } | null>(null);
  const [earlyLotteryDone, setEarlyLotteryDone] = useState(false);
  const prepareDraft = useCallback(() => {
    void loadGameShell();
  }, []);
  function startNewDraft() {
    if (savedDraft && !confirmNewDraft) {
      setConfirmNewDraft(true);
      return;
    }
    clearDraftSave();
    setConfirmNewDraft(false);
    setResumeDraft(false);
    setAllTimeDaily(null);
    const seed = sharedDraftSeedFromUrl() ?? randomSeed();
    setEarlyDraft({ seed, teams: initialTeamsForSeed(seed, teamName) });
    setEarlyLotteryDone(false);
    void prefetchGameData();
    setView('game');
  }
  function continueDraft() {
    setAllTimeDaily(null);
    setResumeDraft(true);
    setEarlyDraft(null);
    setView('game');
  }
  // 2026-08-16, user's own ask ("żeby wiedział jaką drużynę ma" — so they can actually recognize
  // their own team): the human gets a team of their own, shown on the menu before the draft.
  // 2026-10-14: picked from the franchise pool (data/franchises.ts) with a re-roll instead of typed
  // (user: "wybór z puli z ponownym losowaniem"), so it has a logo like every rival. Threaded through
  // GameShell -> createDraft -> createInitialTeams (draftSetup.ts), which seats it in the human's slot
  // and deals the 15 rivals from the rest of the pool.
  const [teamName, setTeamName] = useState(() => randomFranchiseName());
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
    if (!confirmNewDraft) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setConfirmNewDraft(false);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmNewDraft]);

  return (
    <div className="app-shell">
      <CapsInfoHost />
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
        <NightMenu
          teamName={teamName}
          onTeamReroll={() => setTeamName(randomFranchiseName(teamName))}
          savedDraft={savedDraft}
          sharedSeed={sharedDraftSeed}
          onContinue={continueDraft}
          onMode={(m) => {
            if (m === 'draft') startNewDraft();
            else if (m === 'quickfive') {
              setMiniDaily(null);
              setView('quickfive');
            } else setView('bestfive');
          }}
          onDailyDrawFive={() => setView('daily')}
          onDailyDraft={(day) => {
            if (day.mode === 'mini') {
              setMiniDaily(day);
              setView('quickfive');
              return;
            }
            setAllTimeDaily(day);
            setResumeDraft(false);
            setEarlyDraft(null);
            setConfirmNewDraft(false);
            void prefetchGameData();
            setView('game');
          }}
          dailyOffset={dailyReroll}
          onReroll={(m, n) => setDailyReroll((r) => ({ ...r, [m]: n }))}
          howTo={MODE_HOW_TO_PLAY}
          dataStatus={<IntroDataStatus />}
          stepDone={(m) => stepDone(m)}
          onLiveTest={LIVE_TEST_BENCH_FOR_TESTING ? () => setView('livetest') : undefined}
          confirm={
            confirmNewDraft && savedDraft ? (
              <NightConfirm
                title="Start a new draft?"
                lead={`Your draft in progress (${savedDraft.teamName}, ${savedDraft.humanPicks} of ${savedDraft.rosterSize} picks) will be discarded.`}
                yes="Start new draft"
                no="Continue that draft"
                onYes={startNewDraft}
                onNo={continueDraft}
              />
            ) : undefined
          }
        />
      )}

      {view === 'game' && earlyDraft && !resumeDraft && !earlyLotteryDone && (
        <NightLottery
          teams={earlyDraft.teams}
          rounds={ROSTER_SIZE}
          title="All-Time Draft"
          sub={`16 teams · ${DISPLAY_ROSTER_SIZE} rounds · a season after`}
          codeOf={(t) => teamCodes(earlyDraft.teams).get(t.id) ?? ''}
          capLimit={DISPLAY_CAP_LIMIT}
          howItWorks={[
            ['Each round', '1 player'],
            ['Order', 'Snake'],
            ['Roster', `5 + ${DISPLAY_BENCH_SLOT_COUNT} bench`],
            ['Rivals', '15 CPU GMs'],
            ['Then', 'Season + playoffs'],
          ]}
          onDone={() => setEarlyLotteryDone(true)}
          onRevealed={prepareDraft}
          links={{ onMenu: () => setView('intro') }}
        />
      )}
      {view === 'game' && (resumeDraft || !earlyDraft || earlyLotteryDone) && (
        <Suspense fallback={<LoadingPanel />}>
          <GameShell
            key={allTimeDaily ? `daily-${allTimeDaily.mode}-${allTimeDaily.day}${allTimeDaily.testing ? '-test' : ''}` : 'draft'}
            mode="player"
            commissionerMode={false}
            humanTeamName={teamName}
            resume={resumeDraft}
            preset={resumeDraft || allTimeDaily ? undefined : earlyDraft ?? undefined}
            daily={allTimeDaily ?? undefined}
            onExit={() => setView('intro')}
          />
        </Suspense>
      )}

      {view === 'bestfive' && (
        <Suspense fallback={<LoadingPanel />}>
          <BestFive
            mode="player"
            onBack={() => setView('intro')}
            onNextStep={() => {
              setMiniDaily(null);
              setView('quickfive');
            }}
            challenge={modeChallenge?.mode === 'roulette' ? modeChallenge : undefined}
          />
        </Suspense>
      )}

      {view === 'daily' && (
        <Suspense fallback={<LoadingPanel />}>
          {/* 2026-09-28, the user ("nadal mam zablokowane, zrób nowy daily"): while testing, any day's
              board can be played — "Another day" steps to the next date's board. */}
          <BestFive
            key={dailyOffset}
            mode="player"
            daily={localDayKey(new Date(Date.now() + dailyOffset * 864e5))}
            testDay={dailyOffset !== 0}
            onAnotherDay={DAILY_REPLAY_FOR_TESTING ? () => setDailyOffset((n) => n + 1) : undefined}
            onBack={() => {
              setDailyOffset(0);
              setView('intro');
            }}
          />
        </Suspense>
      )}

      {view === 'livetest' && (
        <Suspense fallback={<LoadingPanel />}>
          <LiveTestBench onBack={() => setView('intro')} />
        </Suspense>
      )}

      {view === 'quickfive' && (
        <Suspense fallback={<LoadingPanel />}>
          <QuickFive
            key={miniDaily ? `daily-${miniDaily.day}` : 'mini'}
            daily={miniDaily ?? undefined}
            humanTeamName={teamName}
            onExit={() => setView('intro')}
            onNextStep={() => (readDraftSaveSummary() ? setView('intro') : startNewDraft())}
            challenge={modeChallenge?.mode === 'mini' ? modeChallenge : undefined}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
