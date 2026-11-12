import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { newDraftId, recordDraft } from '../online/career';
import { RunSummary } from './RunSummary';
import type { PlayerSpan, Position } from '../data/schema';
import type { Team } from '../engine/types';
import {
  createQuickDraft,
  currentTeamIndex,
  makeQuickPick,
  resolveQuickAiPickIfNeeded,
  autoFinishQuickDraft,
  isQuickPickLegal,
  isQuickRuleBlocked,
  quickDailyAlternative,
  quickPickBlockReason,
  quickPickBudget,
  finalizeQuickRotation,
  applyQuickServerPick,
  createQuickMultiplayerDraft,
  resolveQuickAutoPick,
  QUICK_ROUNDS,
  type QuickDraftState,
} from '../engine/quickDraft';
import { peakDraftPool } from '../engine/peakDraftPool';
import { totalFga, TEAM_COUNT as MINI_TEAMS, STARTER_SLOTS } from '../engine/positions';
import { bestPrimaryAssignment } from '../engine/rotation';
import { scoreLineup, WEIGHTED_AXES, WEAK_AXIS_REASON, type Lineup, type LineupScore } from '../engine/bestFive';
import { allStarCount } from '../engine/allStarLookup';
import { displayTierForSpan, displayTalentForSpan } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { teamCodes, teamLabel, teamNickname } from '../engine/teamNames';
import { markStepDone } from './pathProgress';
import { nextDraftTip } from './ResultsScreen';
import { DESK_CAST, buildMiniDesk } from '../engine/desk';
import { copyLink } from './shareSave';
import { challengeVerdict, modeChallengeLink, type ModeChallenge } from '../modeChallenge';
import { cpuPickDelay } from './aiSpeed';
import { AUTO_FINISH_FOR_TESTING } from './testingFlags';
import { lowRimPressure } from './DraftChrome';
import { MiniTournamentView, type MiniTournamentSummary } from './MiniTournamentView';
import { MINI_ROUNDS, duelGame, playMiniGame } from '../engine/miniTournament';
import LiveGameNight from '../night/LiveGameNight';
import type { DailyDraftDay } from '../dailyDraftDay';
import { DailyLeaderboard } from './DailyLeaderboard';
import { dailyPoints, medianOf } from '../online/points';
import { clearDailyDraftResult, dailyDraftResult, dailyDraftStreak, ordinal, saveDailyDraftResult } from './dailyDraftProgress';
import { DAILY_REPLAY_FOR_TESTING, STREAK_TIERS, untilTomorrow } from './dailyProgress';
import { maskName } from './bombMask';
import {
  Actions,
  Btn,
  CapBar,
  EmptyNote,
  H3,
  Kv,
  Mast,
  NightGame,
  RosterCard,
  NightVoices,
  Prompt,
  SLOTS,
  SubNote,
  TAP_TO_SHOW,
  Tally,
  buzz,
  dayLabel,
  fmtCaps,
  useStepScroll,
} from '../night/ui';
import { CapsBar, FiveSlots, LeagueMark, NightLottery, Notice, PickLog, PlayerTable, PosTabs, snakePicks, type NightRow, type TickerRow } from '../night/draft';
import { BoardGrid } from '../night/alltime';
import { cardRoles } from './cardRoles';
import { NightConfirm, NightHowTo, NightSettings } from '../night/Dialogs';
import { ShareNight, type PosterData } from '../night/Share';

interface Props {
  humanTeamName?: string;
  onExit: () => void;
  /** The next step of the learning path (the All-Time Draft), offered on the result screen. */
  onNextStep?: () => void;
  /** A friend's "Challenge a friend" link: their board and their score. */
  challenge?: ModeChallenge;
  /** Today's daily draft (2026-10-16): its seed, cap and rule. */
  daily?: DailyDraftDay;
  /** A multiplayer room's draft (2026-11-12): friends' teams, the room's pick log and clock. */
  mp?: MiniMp;
}

/** What the Mini Draft needs from a multiplayer room (MultiMini.tsx keeps it up to date). */
export interface MiniMp {
  roomId: string;
  seed: number;
  /** Your team (its index among the sixteen). */
  mySlot: number;
  /** 16 for a Mini room, 2 for a Duel. */
  teams: number;
  /** Players' names by team index; the rest are CPU GMs. */
  names: Map<number, string>;
  /** Teams whose player is still here; the CPU picks at once for one who left. */
  here: Set<number>;
  /** The room's pick log, player ids in order. */
  picks: string[];
  /** Server time of the latest pick (or the start), ms. */
  lastPickAt: number;
  clockS: number;
  now: () => number;
  /** The tournament, round by round together. */
  tourney?: { gate: number; waiting?: string; onShown: (rounds: number) => void };
  /** Server time the first pick opens, ms: the lottery plays until then. */
  startsAt: number;
  /** This screen sends the CPU's picks first; the others step in a few seconds later. */
  leader: boolean;
  send: (pickNo: number, playerId: string) => void;
}

/** How long the other screens give the leader before they send a CPU pick themselves, ms. */
const BACKUP_DELAY_MS = 4000;

function replayPicks(state: QuickDraftState, picks: string[]): QuickDraftState {
  let s = state;
  for (let i = s.history.length; i < picks.length && !s.complete; i++) s = applyQuickServerPick(s, picks[i]);
  return s;
}

type Phase = 'day' | 'lottery' | 'draft' | 'results';

const howToRules = (cap: number): [string, string][] => [
  ['Draft', `${MINI_TEAMS} teams take turns, ${QUICK_ROUNDS} rounds, one starter each round, no bench. You run one team; the rest are CPU GMs.`],
  ['Caps', `Every pick costs caps, his shots a game in those years. Your five starters have to fit under ${cap} caps.`],
  ['Peak only', 'No choosing years: every player comes at his best stretch, so each pick is quick.'],
  ['Grading', 'The judge scores your five on talent, offense, defense, spacing and fit right after the last pick, and ranks the field.'],
];

/** CPU pick delay while "Skip to my pick" runs, ms. */
const RUSH_PICK_MS = 90;
/** Rows shown at first and per "See more". */
const VISIBLE_STEP = 12;
/** The caps bar's top: the priciest players sit above it and count as "any". */
const CAPS_TOP = 30;

/**
 * The Mini Draft (night edition, mockups `docs/mockups/draw-five-night/mini.html`): a real 16-team,
 * pick-by-pick draft — 5 rounds, starters only, one card per player at his peak — with the same AI
 * as the All-Time Draft. See `quickDraft.ts` for the engine.
 */
export default function QuickFive({ humanTeamName, onExit, onNextStep, challenge, daily, mp }: Props) {
  const freshDraft = (name?: string, seed?: number) => (daily ? createQuickDraft(name, daily.seed, daily) : createQuickDraft(name, seed));
  const [state, setState] = useState<QuickDraftState>(() =>
    mp ? replayPicks(createQuickMultiplayerDraft(mp.seed, mp.mySlot, mp.teams), mp.picks) : freshDraft(humanTeamName, challenge ? Number(challenge.seed) : undefined),
  );
  const TEAM_COUNT = state.teams.length;
  // A room's draft opens on the lottery (the order the host's start drew), then the first pick.
  const [phase, setPhase] = useState<Phase>(mp ? (mp.picks.length === 0 && mp.now() < mp.startsAt ? 'lottery' : 'draft') : daily ? 'day' : 'lottery');
  const mpLotteryOver = mp ? mp.now() >= mp.startsAt || mp.picks.length > 0 : false;
  useEffect(() => {
    if (mpLotteryOver && phase === 'lottery') setPhase('draft');
  }, [mpLotteryOver, phase]);
  const mpPicks = mp?.picks;
  useEffect(() => {
    if (mpPicks && mpPicks.length > state.history.length) setState((s) => replayPicks(s, mpPicks));
  }, [mpPicks, state.history.length]);
  // The pick clock ticks on screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!mp || state.complete) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [mp, state.complete]);
  const [boardOpen, setBoardOpen] = useState(false);
  const [dialog, setDialog] = useState<'settings' | 'howto' | 'leave' | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);
  function restart(seed?: number) {
    const humanName = state.teams.find((t) => t.isHuman)?.name ?? humanTeamName;
    if (daily && !daily.testing) clearDailyDraftResult('mini', daily.day);
    setState(freshDraft(humanName, seed));
    setPhase(daily ? 'day' : 'lottery');
  }
  const [autoFinishing, setAutoFinishing] = useState(false);

  const teamIdx = currentTeamIndex(state);
  const currentTeam = state.teams[teamIdx];
  const humanTeam = state.teams.find((t) => t.isHuman)!;
  const canPick = currentTeam.isHuman;
  // A phone brings your pick to the top when you're on the clock.
  useStepScroll(phase === 'draft' && canPick && !state.complete ? `you-${state.history.length}` : null);
  const codes = useMemo(() => teamCodes(state.teams), [state.teams]);
  const codeOf = (t: Team) => codes.get(t.id) ?? '';

  const [rushToMe, setRushToMe] = useState(false);
  useEffect(() => {
    if (canPick) setRushToMe(false);
  }, [canPick]);
  useEffect(() => {
    if (phase === 'draft' && canPick && !state.complete) buzz([15, 40, 15]);
  }, [phase, canPick, state.complete]);

  // Multiplayer: the room's log is the draft. Your own pick waits for you (the CPU takes it when
  // your clock runs out); a CPU team's, or a friend's who left or ran out of time, is sent by the
  // leading screen, by the others a few seconds later if it didn't.
  const mpSend = mp?.send;
  const mpTiming = mp ? { mine: teamIdxOf(state) === mp.mySlot, owned: mp.names.has(teamIdxOf(state)), here: mp.here.has(teamIdxOf(state)), leader: mp.leader, ends: mp.lastPickAt + mp.clockS * 1000, now: mp.now() } : null;
  // The 10-second bucket retries a pick the server turned down (clocks a second apart): waits are
  // counted from fixed times, so re-arming never delays one.
  const mpKey = mpTiming ? `${state.history.length}|${mpTiming.here}|${mpTiming.leader}|${mpTiming.ends}|${Math.floor(mpTiming.now / 10_000)}` : null;
  useEffect(() => {
    if (!mpTiming || !mpSend || phase !== 'draft' || state.complete) return;
    const pickNo = state.history.length + 1;
    let wait: number;
    const opensIn = mp ? mp.startsAt - mpTiming.now : 0;
    if (mpTiming.mine) wait = mpTiming.ends - mpTiming.now;
    else if (!mpTiming.owned || !mpTiming.here) wait = cpuPickDelay(state.history.length, TEAM_COUNT) + (mpTiming.leader ? 0 : BACKUP_DELAY_MS);
    else wait = mpTiming.ends - mpTiming.now + 1000 + (mpTiming.leader ? 0 : BACKUP_DELAY_MS);
    const timer = window.setTimeout(() => {
      const next = resolveQuickAutoPick(state);
      const pick = next?.history[next.history.length - 1];
      if (pick) mpSend(pickNo, pick.playerId);
    }, Math.max(0, wait, pickNo === 1 ? opensIn : 0));
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpKey, phase, state, mpSend]);

  useEffect(() => {
    if (mp) return;
    if (phase !== 'draft' || state.complete || autoFinishing) return;
    if (state.teams[currentTeamIndex(state)].isHuman) return;
    const timer = setTimeout(() => {
      const next = resolveQuickAiPickIfNeeded(state);
      if (next) setState(next);
    }, rushToMe ? RUSH_PICK_MS : cpuPickDelay(state.history.length, TEAM_COUNT));
    return () => clearTimeout(timer);
  }, [state, phase, autoFinishing, rushToMe, mp, TEAM_COUNT]);

  // The draft ends straight on the results: no rotation step in the Mini.
  useEffect(() => {
    if (state.complete && phase === 'draft') setPhase('results');
  }, [state.complete, phase]);
  useEffect(() => {
    if (autoFinishing && state.complete) setAutoFinishing(false);
  }, [autoFinishing, state.complete]);

  const title = daily ? 'Daily Mini Draft' : mp?.teams === 2 ? 'Duel' : 'Mini Draft';
  const links = {
    onMenu: () => (phase === 'draft' && !state.complete ? setDialog('leave') : onExit()),
    onHowTo: () => setDialog('howto'),
    onSettings: () => setDialog('settings'),
  };
  const dialogs = (
    <>
      {dialog === 'settings' && <NightSettings onClose={closeDialog} />}
      {dialog === 'howto' && <NightHowTo lead={`Mini Draft · ${TEAM_COUNT} teams, ${QUICK_ROUNDS} rounds, starters only.`} rules={howToRules(state.capLimit)} onClose={closeDialog} />}
      {dialog === 'leave' && <NightConfirm title="Leave the draft?" lead={mp ? 'The room drafts on: the CPU picks for your team. You can come back with the room’s link.' : 'Mini Drafts aren’t saved: leaving ends this one.'} yes="Back to menu" no="Keep drafting" onYes={onExit} onNo={closeDialog} />}
    </>
  );

  let screen;
  if (phase === 'day' && daily) {
    screen = <MiniDay day={daily} team={humanTeam} title={title} onStart={() => setPhase('lottery')} links={links} />;
  } else if (phase === 'lottery') {
    screen = (
      <NightLottery
        teams={state.teams}
        rounds={QUICK_ROUNDS}
        title={title}
        sub={`${TEAM_COUNT} teams · ${QUICK_ROUNDS} rounds · starters only`}
        codeOf={codeOf}
        capLimit={state.capLimit}
        howItWorks={[
          ['Each round', '1 starter'],
          ['Order', 'Snake'],
          ['Players', 'Peak years'],
          ['Rivals', mp ? `${mp.names.size - 1} friends · ${TEAM_COUNT - mp.names.size} CPU` : `${TEAM_COUNT - 1} CPU GMs`],
          ['Graded', `After pick ${TEAM_COUNT * QUICK_ROUNDS}`],
        ]}
        onDone={() => setPhase('draft')}
        links={links}
      />
    );
  } else if (phase === 'draft') {
    screen = (
      <QuickDraftBoard
        state={state}
        canPick={canPick}
        currentTeam={currentTeam}
        humanTeam={humanTeam}
        codeOf={codeOf}
        onPick={(id) => {
          buzz();
          if (mp) mp.send(state.history.length + 1, id);
          else setState((s) => makeQuickPick(s, id));
        }}
        clock={mp && !state.complete ? Math.max(0, Math.ceil((mp.lastPickAt + mp.clockS * 1000 - mp.now()) / 1000)) : undefined}
        clockFor={mp ? (mp.names.has(teamIdx) && mp.here.has(teamIdx)) || teamIdx === mp.mySlot : false}
        gmOf={mp ? (i) => mp.names.get(i) : undefined}
        awayOf={mp ? (i) => mp.names.has(i) && !mp.here.has(i) : undefined}
        onAutoFinish={() => {
          setAutoFinishing(true);
          setState((s) => autoFinishQuickDraft(s));
        }}
        autoFinishing={autoFinishing}
        boardOpen={boardOpen}
        onBoard={setBoardOpen}
        rushToMe={rushToMe}
        onRushToMe={() => setRushToMe(true)}
        daily={daily}
        title={title}
        links={links}
      />
    );
  } else {
    screen = (
      <QuickResults
        state={state}
        codeOf={codeOf}
        title={title}
        onNewDraft={() => (mp ? onExit() : restart())}
        onRematch={() => (mp ? onExit() : restart(state.seed))}
        careerId={mp ? `mini:mp:${mp.roomId}` : undefined}
        tourneyGate={mp?.tourney}
        onNextStep={daily ? undefined : onNextStep}
        challenge={challenge && Number(challenge.seed) === state.seed ? challenge : undefined}
        daily={daily}
        links={links}
      />
    );
  }
  return (
    <>
      {screen}
      {dialogs}
    </>
  );
}

/** The daily's rule before the lottery (mockup `mini.html#day`). */
function MiniDay({ day, team, title, onStart, links }: { day: DailyDraftDay; team: Team; title: string; onStart: () => void; links: { onMenu: () => void; onHowTo: () => void; onSettings: () => void } }) {
  const slot = team.draftSlot;
  const streak = dailyDraftStreak('mini', day.day);
  const picks = snakePicks(slot, MINI_TEAMS, QUICK_ROUNDS);
  return (
    <NightGame
      aside={
        <>
          <Mast title={title} daily sub={`${dayLabel(day.day)} · one board for everyone`} />
          <Tally you={fmtCaps(day.cap)} mid={ordinal(slot)} ai={QUICK_ROUNDS} youK="Cap" midK="Your slot" aiK="Rounds" plain />
          <section>
            <H3>Today</H3>
            <Kv k="Streak" v={`${streak} ${streak === 1 ? 'day' : 'days'}`} gold />
            <Kv k="Teams" v={MINI_TEAMS} />
            <Kv k="Tries" v="One" />
            <Kv k="New board in" v={untilTomorrow()} />
          </section>
          <Actions links={links} />
        </>
      }
    >
      <div className="rule">
        <span className="eb">Rule of the day</span>
        <h2>{day.title}</h2>
        <p>{day.rule.kind === 'open' ? 'No rule today: the same board and the same cap for everyone.' : `${day.ruleLine}. The CPU teams can still take them.`}</p>
      </div>
      <div className="facts">
        <div>
          <span>Cap</span>
          <b className="g">{fmtCaps(day.cap)}</b>
          <small>caps for five</small>
        </div>
        <div>
          <span>Your slot</span>
          <b>{ordinal(slot)}</b>
          <small>picks {picks.join(' · ')}</small>
        </div>
        <div>
          <span>Teams</span>
          <b>{MINI_TEAMS}</b>
          <small>{MINI_TEAMS - 1} CPU GMs, same board</small>
        </div>
        <div>
          <span>Streak</span>
          <b>{streak}</b>
          <small>days in a row</small>
        </div>
      </div>
      <FiveSlots lineup={{}} note={`0 of 5 · ${teamLabel(team)}`} />
      <div className="go-row">
        <Btn onClick={onStart}>Start today’s draft</Btn>
        <i>Same players, same order for everyone. Compare tonight.</i>
      </div>
    </NightGame>
  );
}

/** Built once over the immutable peak pool: the tier lookup is expensive, the filters are cheap. */
const allEnrichedOnce = peakDraftPool.map((span) => ({
  span,
  tier: displayTierForSpan(tierContextFor(span)),
  tal: displayTalentForSpan(tierContextFor(span)),
}));

function QuickDraftBoard({
  state,
  canPick,
  currentTeam,
  humanTeam,
  codeOf,
  onPick,
  onAutoFinish,
  autoFinishing,
  boardOpen,
  onBoard,
  rushToMe,
  onRushToMe,
  daily,
  title,
  links,
  clock,
  clockFor,
  gmOf,
  awayOf,
}: {
  /** Multiplayer: the player running a team (by index), none for a CPU team. */
  gmOf?: (teamIndex: number) => string | undefined;
  awayOf?: (teamIndex: number) => boolean;
  clock?: number;
  /** The one on the clock is a person (a friend or you), so the clock shows. */
  clockFor?: boolean;
  state: QuickDraftState;
  canPick: boolean;
  currentTeam: Team;
  humanTeam: Team;
  codeOf: (t: Team) => string;
  onPick: (id: string) => void;
  onAutoFinish: () => void;
  autoFinishing: boolean;
  boardOpen: boolean;
  onBoard: (open: boolean) => void;
  rushToMe: boolean;
  onRushToMe: () => void;
  daily?: DailyDraftDay;
  title: string;
  links: { onMenu: () => void; onHowTo: () => void; onSettings: () => void };
}) {
  const TEAM_COUNT = state.teams.length;
  const budget = useMemo(() => quickPickBudget(state), [state]);
  // Your Big Board, kept per draft like the All-Time's.
  const bbKey = `draftverse.bigboard.mini.${state.seed}`;
  const [bigBoard, setBigBoard] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(bbKey) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const toggleStar = (name: string) => {
    const next = bigBoard.includes(name) ? bigBoard.filter((n) => n !== name) : [...bigBoard, name];
    setBigBoard(next);
    try {
      window.localStorage.setItem(bbKey, JSON.stringify(next));
    } catch {
      // Not kept; the board still works for this visit.
    }
  };
  const [search, setSearch] = useState('');
  const [caps, setCaps] = useState<[number, number]>([0, CAPS_TOP]);
  const humanAssignment = useMemo(() => bestPrimaryAssignment(humanTeam.roster).assignment, [humanTeam.roster]);
  const humanStarters = useMemo(() => Object.values(humanAssignment).filter((p): p is PlayerSpan => Boolean(p)), [humanAssignment]);
  const have = useMemo(() => new Set(SLOTS.filter((s) => humanAssignment[s])), [humanAssignment]);
  // The tab: the first open position once you have a player (the list shows what you need), all
  // of them before your first pick; tapping a tab or an open slot changes it.
  const [tab, setTab] = useState<Position | 'ALL' | null>(null);
  // After a pick the list goes back to everyone; it no longer jumps to the next open slot (playtest 2026-10-23).
  const on: Position | 'ALL' = tab ?? 'ALL';
  useEffect(() => setTab(null), [humanTeam.roster.length]);
  const [visible, setVisible] = useState(VISIBLE_STEP);
  useEffect(() => setVisible(VISIBLE_STEP), [on, search, caps]);

  const available = useMemo(() => allEnrichedOnce.filter((e) => !state.draftedIds.has(e.span.id) && (!state.pool || state.pool.has(e.span.id))), [state.draftedIds, state.pool]);
  const counts = useMemo(() => {
    const c = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<Position, number>;
    for (const e of available) c[e.span.primaryPosition] += 1;
    return c;
  }, [available]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const [lo, hi] = caps;
    return available
      .filter((e) => on === 'ALL' || e.span.primaryPosition === on)
      .filter((e) => !q || e.span.playerName.toLowerCase().includes(q))
      .filter((e) => e.span.fga >= lo && (hi >= CAPS_TOP || e.span.fga <= hi))
      .sort((a, b) => b.tal - a.tal || allStarCount(b.span.playerName) - allStarCount(a.span.playerName));
  }, [available, on, search, caps]);
  const shown = filtered.slice(0, visible);
  const anyLegal = !canPick || shown.some((e) => isQuickPickLegal(state, e.span.id));

  const spanById = useMemo(() => new Map(state.teams.flatMap((t) => t.roster.map((p) => [p.id, p] as const))), [state.teams]);
  const teamById = useMemo(() => new Map(state.teams.map((t) => [t.id, t] as const)), [state.teams]);
  const tickerRows: TickerRow[] = useMemo(
    () =>
      state.history.flatMap((h) => {
        const span = spanById.get(h.playerId);
        const team = teamById.get(h.teamId);
        return span && team ? [{ n: h.pickNumber, team, code: codeOf(team), span }] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.history, spanById, teamById],
  );
  const overall = state.round * TEAM_COUNT + state.pickInRound + 1;
  const myPicks = snakePicks(humanTeam.draftSlot, TEAM_COUNT, QUICK_ROUNDS);
  const nextMine = myPicks.find((n) => n >= overall) ?? null;
  const used = totalFga(humanTeam.roster.map((p) => p.fga));
  const left = state.capLimit - used;
  const slotsLeft = QUICK_ROUNDS - humanTeam.roster.length;
  const round = Math.min(state.round + 1, QUICK_ROUNDS);
  const sub = `Round ${round} of ${QUICK_ROUNDS} · pick ${Math.min(overall, TEAM_COUNT * QUICK_ROUNDS)} of ${TEAM_COUNT * QUICK_ROUNDS}`;
  const picksAway = nextMine === null ? null : nextMine - overall;

  // 2026-10-22, the user: "tak samo powinno wyglądać all time jak mini, po prostu jest krótszy" — the
  // Mini's draft screen is the All-Time's: caps left in the tally, your Big Board and the latest picks
  // in the aside, the player list open while the CPU picks, the board as a grid of faces.
  const asideTop = (
    <>
      <Mast title={title} daily={Boolean(daily)} sub={sub} />
      <Tally you={fmtCaps(left)} mid={fmtCaps(state.capLimit)} ai={`${round}/${QUICK_ROUNDS}`} youK="Caps left" aiK="Round" />
      <CapBar used={used} cap={state.capLimit} />
      <SubNote>
        {slotsLeft > 0 ? (
          <>
            <b>{fmtCaps(left)} caps</b> for {slotsLeft === 1 ? 'one spot' : `${['no', 'one', 'two', 'three', 'four', 'five'][slotsLeft]} spots`}{' '}
            {slotsLeft > 1 && <span style={{ whiteSpace: 'nowrap' }}>· about {fmtCaps(left / slotsLeft)} a pick</span>}
          </>
        ) : (
          <>
            <b>{fmtCaps(used)} caps</b> used of {fmtCaps(state.capLimit)}
          </>
        )}
      </SubNote>
    </>
  );
  const lineup = humanAssignment as Partial<Record<Position, PlayerSpan>>;
  const picksMap = new Map(tickerRows.map((r) => [r.n, r.span] as const));
  const takenAt = (name: string) => tickerRows.find((r) => r.span.playerName === name)?.n;
  const bigBoardSection = (
    <section>
      <H3 note="starred">Your Big Board</H3>
      {bigBoard.length === 0 ? (
        <EmptyNote>Star players in the list to keep them here.</EmptyNote>
      ) : (
        <ol className="bboard">
          {bigBoard.map((name) => {
            const live = available.find((e) => e.span.playerName === name);
            const t = takenAt(name);
            return (
              <li key={name} className={live ? undefined : 'gone'}>
                <span className="bb-n">{maskName(name)}</span>
                <span>{live ? fmtCaps(live.span.fga) : t ? `taken #${t}` : 'gone'}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
  const picksSection = (
    <section>
      <H3>Your picks</H3>
      <Kv k="Next" v={nextMine ? (canPick ? `Now · pick ${overall}` : `Pick ${nextMine}`) : '—'} />
      <Kv k="Then" v={myPicks.filter((n) => nextMine && n > nextMine).join(' · ') || '—'} />
    </section>
  );
  const gmCount = gmOf ? state.teams.filter((_, i) => gmOf(i)).length : 0;
  const roomSection = gmOf && (
    <section>
      <H3 note={state.teams.length > gmCount ? 'the rest are CPU GMs' : undefined}>In the room</H3>
      {state.teams.flatMap((t, i) => {
        const gm = gmOf(i);
        return gm ? [<Kv key={t.id} k={`${gm}${t.isHuman ? ' (you)' : ''}${awayOf?.(i) ? ' · away' : ''}`} v={codeOf(t)} gold={t.isHuman} />] : [];
      })}
    </section>
  );
  const aside = (actions: ReactNode) => (
    <>
      {asideTop}
      {picksSection}
      {roomSection}
      {bigBoardSection}
      <PickLog rows={tickerRows.slice(-6)} title="Latest picks" note="around the league" newestFirst />
      <Actions links={links}>{actions}</Actions>
    </>
  );

  if (boardOpen) {
    return (
      <NightGame aside={aside(<Btn onClick={() => onBoard(false)}>{canPick ? 'Back to your pick' : 'Back to the draft'}</Btn>)}>
        <BoardGrid teams={state.teams} rounds={QUICK_ROUNDS} picks={picksMap} onClock={state.complete ? null : overall} round={state.round} codeOf={codeOf} windows={[[0, QUICK_ROUNDS]]} onHide={() => onBoard(false)} />
        <Btn className="phone-only" onClick={() => onBoard(false)}>
          {canPick ? 'Back to your pick' : 'Back to the draft'}
        </Btn>
      </NightGame>
    );
  }

  const maxPick = budget.maxThisPick;
  const haveList = SLOTS.filter((s) => have.has(s));
  const rows: NightRow[] = shown.map(({ span: peak, tier: peakTier }, i) => {
    // A daily's rule can rule out a player's best years: the row then shows his best years it allows.
    const alt = daily ? quickDailyAlternative(state, peak.id) : null;
    const span = alt ?? peak;
    const tier = alt ? displayTierForSpan(tierContextFor(alt)) : peakTier;
    // While the CPU picks the list stays open to browse and star, the Draft buttons off.
    const legal = canPick && isQuickPickLegal(state, span.id);
    const ruled = daily && !alt && isQuickRuleBlocked(state, peak.id) ? daily.ruleTag : undefined;
    return {
      key: peak.id,
      span,
      tier: span.fga < 2 ? 'Salary glue' : tier,
      legal,
      starred: bigBoard.includes(peak.playerName),
      hot: canPick && i === shown.findIndex((e) => isQuickPickLegal(state, (daily ? quickDailyAlternative(state, e.span.id) : null)?.id ?? e.span.id)),
      title: !canPick
        ? `${teamLabel(currentTeam)} on the clock`
        : ruled
          ? `Today's rule: ${daily!.ruleLine.toLowerCase()}.`
          : legal
            ? `Draft ${maskName(span.playerName)}`
            : quickPickBlockReason(state, span.id) === 'reserve'
              ? `Too expensive right now: keep ${budget.reserved} caps for your other ${budget.slotsLeft - 1} pick${budget.slotsLeft - 1 === 1 ? '' : 's'}. This pick can cost up to ${maxPick}.`
              : `Over the ${state.capLimit}-cap limit.`,
    };
  });
  const actions = (
    <>
      <Btn kind="line" onClick={() => onBoard(true)}>
        Show draft board
      </Btn>
      {clock === undefined && !canPick && picksAway !== null && picksAway > 1 && !rushToMe && (
        <Btn kind="line" onClick={onRushToMe}>
          Skip to my pick
        </Btn>
      )}
      {AUTO_FINISH_FOR_TESTING && clock === undefined && (
        <Btn kind="line" disabled={autoFinishing} onClick={onAutoFinish}>
          {autoFinishing ? 'Finishing…' : 'Auto-finish (testing)'}
        </Btn>
      )}
    </>
  );
  return (
    <NightGame aside={aside(actions)}>
      <FiveSlots
        lineup={lineup}
        note={`${humanTeam.roster.length} of 5 · ${teamLabel(humanTeam)}`}
        sel={on === 'ALL' ? null : on}
        onSlot={(p) => setTab(p)}
        emptyLabel={(p) => (p === on ? `showing ${counts[p]} ▾` : TAP_TO_SHOW)}
      />
      {canPick ? (
        <Prompt eb={`On the clock · Round ${round} · Pick ${overall}${clock !== undefined ? ` · ${fmtClock(clock)}` : ''}`} title="Your pick" now className="ph-keep">
          Up to <b>{fmtCaps(maxPick)} caps</b> on this one and still fill the five.
          {haveList.length > 0 && ` Your ${haveList.length > 1 ? `${haveList.slice(0, -1).join(', ')} and ${haveList[haveList.length - 1]}` : haveList[0]} ${haveList.length === 1 ? 'is' : 'are'} set.`}
        </Prompt>
      ) : (
        <Prompt eb={`On the clock · Pick ${overall}${clock !== undefined && clockFor ? ` · ${fmtClock(clock)}` : ''}`} title={teamLabel(currentTeam)} now>
          {gmOf && (gmOf(currentTeamIndex(state)) ? <b>{gmOf(currentTeamIndex(state))}{awayOf?.(currentTeamIndex(state)) ? ' (away, the CPU picks)' : ''} is picking. </b> : 'A CPU GM is picking. ')}
          {picksAway === 1 ? 'Your pick is next.' : picksAway ? `Your pick in ${picksAway} picks.` : 'Your five is in.'} The list stays open while they think.
        </Prompt>
      )}
      <section>
        {canPick && lowRimPressure(humanStarters) && (
          <Notice>
            <b>Low rim pressure.</b> Nobody in your five attacks the basket yet. Look for a slasher or a big who finishes inside.
          </Notice>
        )}
        <PosTabs counts={counts} have={have} on={on} onPick={setTab} search={search} onSearch={setSearch} />
        <CapsBar lo={caps[0]} hi={caps[1]} top={CAPS_TOP} maxPick={maxPick} onChange={(lo, hi) => setCaps([lo, hi])} />
        {canPick && !anyLegal && (
          <Notice
            action="Show players that fit"
            onAction={() => {
              setSearch('');
              setTab('ALL');
              setCaps([0, Math.max(1, Math.floor(maxPick))]);
            }}
          >
            <b>None of these fit this pick.</b> It can cost up to {fmtCaps(maxPick)} caps.
          </Notice>
        )}
        <PlayerTable rows={rows} variant="mini" onDraft={(span) => onPick(span.id)} onStar={toggleStar} />
        <div className="more">
          Showing {shown.length} of {filtered.length}
          {on !== 'ALL' && ` ${on}`}
          {visible < filtered.length && (
            <>
              {' · '}
              <button type="button" className="lk-inline" onClick={() => setVisible((v) => v + VISIBLE_STEP * 2)}>
                See more
              </button>
            </>
          )}
        </div>
      </section>
      <Btn kind="line" className="phone-only" onClick={() => onBoard(true)}>
        Draft board
      </Btn>
    </NightGame>
  );
}

/** Same finish tiers as the All-Time Draft's results. */
function resultTier(rank: number, fieldSize: number): { label: string; line: string } {
  const pct = rank / fieldSize;
  if (rank === 1) return { label: 'Dynasty', line: 'The best team in the field.' };
  if (pct <= 0.2) return { label: 'Contender', line: 'One of the teams to beat.' };
  if (pct <= 0.4) return { label: 'Playoff lock', line: 'A real team, not the best one.' };
  if (pct <= 0.6) return { label: 'Play-in fight', line: 'Middle of the field.' };
  if (pct <= 0.85) return { label: 'Lottery team', line: 'Most of the field built better.' };
  if (rank < fieldSize) return { label: 'Full rebuild', line: 'Near the bottom of the field.' };
  return { label: 'Wooden spoon', line: 'Last in the field.' };
}

const AXIS_KEYS: (keyof LineupScore)[] = ['talent', 'offense', 'defense', 'spacing', 'fit'];
const AXIS_LABEL: Record<string, string> = { talent: 'Talent', offense: 'Offense', defense: 'Defense', spacing: 'Spacing', fit: 'Fit' };

function QuickResults({
  state,
  codeOf,
  title,
  onNewDraft,
  onRematch,
  onNextStep,
  challenge,
  daily,
  links,
  careerId: fixedCareerId,
  tourneyGate,
}: {
  tourneyGate?: { gate: number; waiting?: string; onShown: (rounds: number) => void };
  careerId?: string;
  state: QuickDraftState;
  codeOf: (t: Team) => string;
  title: string;
  onNewDraft: () => void;
  onRematch: () => void;
  onNextStep?: () => void;
  challenge?: ModeChallenge;
  daily?: DailyDraftDay;
  links: { onMenu: () => void; onHowTo: () => void; onSettings: () => void };
}) {
  const TEAM_COUNT = state.teams.length;
  useEffect(() => markStepDone('quickfive'), []);
  const [shareOpen, setShareOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  // 2026-10-28: the tournament after the draft (mockup docs/mockups/mini-ncaa.html).
  const [tourney, setTourney] = useState(false);
  const [tourneyResult, setTourneyResult] = useState<MiniTournamentSummary | null>(null);
  const ranked = useMemo(
    () =>
      state.teams
        .map((team) => {
          const finalized = finalizeQuickRotation(team);
          const lineup: Lineup = {};
          for (const [slot, assignments] of Object.entries(finalized.rotation!.slots) as [Position, { playerId: string }[]][]) {
            const playerId = assignments[0]?.playerId;
            if (playerId) lineup[slot] = finalized.roster.find((p) => p.id === playerId);
          }
          return { team: finalized, score: scoreLineup(lineup), lineup };
        })
        .sort((a, b) => b.score.composite - a.score.composite),
    [state.teams],
  );
  const humanRank = ranked.findIndex((r) => r.team.isHuman) + 1;
  const human = ranked[humanRank - 1];
  const best = ranked[0];
  const tier = resultTier(humanRank, TEAM_COUNT);
  const [careerId] = useState(() => fixedCareerId ?? newDraftId('mini'));
  useEffect(() => {
    // The Duel is a test mode: no career entry yet.
    if (!daily?.testing && TEAM_COUNT !== 2) recordDraft({ id: careerId, mode: 'mini', daily: !!daily, place: humanRank, field: TEAM_COUNT, overall: human.score.composite, title: tourneyResult ? tourneyResult.out === null : undefined });
  }, [careerId, daily, humanRank, human.score.composite, tourneyResult, TEAM_COUNT]);
  useEffect(() => {
    if (daily && !daily.testing) saveDailyDraftResult('mini', daily.day, { place: humanRank, field: TEAM_COUNT, overall: human.score.composite, median: medianOf(ranked.map((r) => r.score.composite)) });
  }, [daily, humanRank, human.score.composite]);
  const [dailyCopied, setDailyCopied] = useState(false);
  async function copyDailyResult() {
    if (!daily) return;
    const lines = [`Draftverse Daily · Mini · ${daily.day}`, `${daily.cap} caps · ${daily.title}`];
    if (tourneyResult) {
      const r = tourneyResult;
      lines.push(`Draft ${ordinal(humanRank)} / ${TEAM_COUNT} · ${human.score.composite}`, r.out === null ? `🏆 Champions · #${r.seed} seed` : `🏀 ${MINI_ROUNDS[r.out]} · #${r.seed} seed`, r.games.map((g) => (g.won ? '✅' : '❌')).join(''));
    } else lines.push(`${ordinal(humanRank)} / ${TEAM_COUNT} · ${human.score.composite}`);
    const text = lines.join('\n');
    if (await copyLink(text)) {
      setDailyCopied(true);
      setTimeout(() => setDailyCopied(false), 2000);
    }
  }
  const weakest = useMemo(() => {
    const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0;
    return [...WEIGHTED_AXES].sort((a, b) => human.score[a.key] - median(ranked.map((r) => r.score[a.key])) - (human.score[b.key] - median(ranked.map((r) => r.score[b.key]))))[0];
  }, [ranked, human]);
  const nextTip = useMemo(() => (humanRank === 1 ? undefined : nextDraftTip(weakest.label, human.team)), [weakest, human, humanRank]);
  const voices = buildMiniDesk({
    team: human.team,
    rank: humanRank,
    fieldSize: ranked.length,
    weakest: { label: weakest.label, value: human.score[weakest.key] as number },
    weakReason: WEAK_AXIS_REASON[weakest.key](human.score),
    weakLink: human.score.weakLink,
    tip: humanRank > 3 ? nextTip : undefined,
    seed: state.seed,
  });
  const five = STARTER_SLOTS.flatMap((slot) => (human.lineup[slot] ? [human.lineup[slot]!] : []));
  const capsUsed = totalFga(five.map((p) => p.fga));
  const behind = best.score.composite - human.score.composite;
  const myLog = state.history
    .filter((h) => h.teamId === human.team.id)
    .map((h) => ({ ...h, span: human.team.roster.find((p) => p.id === h.playerId) }));
  const streak = daily ? dailyDraftStreak('mini', daily.day) : 0;
  const strongest = [...AXIS_KEYS].filter((k) => k !== 'spacing').sort((a, b) => (human.score[b] as number) - (human.score[a] as number))[0];

  async function challengeFriend() {
    if (await copyLink(modeChallengeLink('mini', state.seed, human.score.composite, teamLabel(human.team)))) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }
  const poster: PosterData = {
    daily: Boolean(daily),
    mode: daily ? 'Mini Draft · daily' : 'Mini Draft',
    date: daily ? new Date(`${daily.day}T12:00:00`) : new Date(),
    kick: `Final standings · ${ordinal(humanRank)} of ${TEAM_COUNT}`,
    head: tier.label,
    line: `${teamLabel(human.team)}. ${tier.line}${humanRank > 1 ? ` ${weakest.label} kept them ${behind} behind the best.` : ''}`,
    five: five.map((span) => ({ span, num: Math.round(span.fga * 10) / 10 })),
    unit: 'caps',
    prof: AXIS_KEYS.map((k) => ({ label: AXIS_LABEL[k], value: Math.round(human.score[k] as number), tone: k === weakest.key ? 'lo' : k === strongest ? 'hi' : undefined })),
    strip: [
      ['Place', ordinal(humanRank)],
      ['Score', human.score.composite],
      ['Best', best.score.composite],
      ['Caps', fmtCaps(capsUsed)],
    ],
    foot: daily ? 'One board for everyone today' : `Same ${TEAM_COUNT} teams, your turn · challenge link`,
  };
  // 2026-10-28 (mockup mini-tournament-share.html C/D): once the tournament is played the poster
  // leads with it — the round you went out in, your road, then the draft's grade and profile.
  if (tourneyResult) {
    const r = tourneyResult;
    poster.kick = `Tournament · #${r.seed} seed`;
    poster.head = r.out === null ? 'Cut down the nets' : `Out in the ${MINI_ROUNDS[r.out]}`;
    poster.line =
      r.out === null
        ? `${teamLabel(human.team)}. Four wins from the #${r.seed} seed.`
        : `${teamLabel(human.team)}. ${r.wins === 0 ? 'One and done' : r.wins === 1 ? 'One win' : `${r.wins} wins`} as the #${r.seed} seed${r.games.length ? `, then the ${r.games[r.games.length - 1].opp}` : ''}.`;
    poster.champ = r.out === null;
    poster.ig = true;
    poster.road = MINI_ROUNDS.map((_round, i) => {
      const g = r.games.find((x) => x.round === i);
      const short = ['R16', 'Elite 8', 'Final 4', 'Final'][i];
      return g ? { label: short, result: g.won ? 'W' : 'L', line: `#${g.oppSeed} · ${g.score[0]}–${g.score[1]}` } : { label: short, result: '—', line: i === MINI_ROUNDS.length - 1 ? `${r.championName} won` : '' };
    });
    poster.draft = [`The draft · ${ordinal(humanRank)} of ${TEAM_COUNT}`, `Score ${human.score.composite} · best ${best.score.composite}`];
    poster.strip = [
      ['Seed', `#${r.seed}`],
      ['Record', `${r.wins}–${r.losses}`],
      ['Caps', fmtCaps(capsUsed)],
      ['Champion', r.championCode],
    ];
  }

  const whoOf = (team: Team) =>
    [...team.roster]
      .sort((a, b) => displayTalentForSpan(tierContextFor(b)) - displayTalentForSpan(tierContextFor(a)))
      .slice(0, 3)
      .map((p) => maskName(p.playerName).split(' ').slice(-1)[0])
      .join(' · ');

  const profile = (r: (typeof ranked)[number], vsBest: boolean) => (
    <table className="profile">
      <tbody>
        {AXIS_KEYS.map((k) => {
          const v = Math.round(r.score[k] as number);
          const b = Math.round(best.score[k] as number);
          const weak = vsBest && k === weakest.key;
          const good = vsBest && !weak && v >= b && r !== best;
          return (
            <tr key={k} className={weak ? 'weak' : good ? 'good' : undefined}>
              <td className="l">{AXIS_LABEL[k]}</td>
              <td className="v">
                {v}
                {weak && <span className="visually-hidden"> weak</span>}
              </td>
              <td className="b">best {b}</td>
              <td>
                <div className="bar">
                  <i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
                  <u style={{ left: `${Math.max(0, Math.min(100, b))}%` }} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const dayResult = daily && !daily.testing ? dailyDraftResult('mini', daily.day) : null;
  const dayPts = dayResult ? dailyPoints({ mode: 'mini', ...dayResult, streak: dailyDraftStreak('mini', daily!.day) }).total : null;
  if (tourney && TEAM_COUNT === 2) {
    const seeded = ranked.map((r) => r.team);
    const g = duelGame(seeded, String(state.seed));
    const game = playMiniGame(seeded, g);
    const a = seeded[0];
    const b = seeded[1];
    if (game) {
      const nick = (t: Team) => teamNickname(t.name);
      return (
        <LiveGameNight
          game={game}
          variant="full"
          sides={{ names: [a.name, b.name], short: [nick(a), nick(b)], codes: [codeOf(a), codeOf(b)], you: b.isHuman ? 1 : 0 }}
          mast={{ title: 'Duel', sub: `Final · ${game.final[0] > game.final[1] ? nick(a) : nick(b)} win`, liveSub: 'Live · one game decides it', preSub: 'Tip-off' }}
          autoStart
          pregame={{ eb: 'Duel · tonight', now: true, title: `${nick(a)} vs ${nick(b)}`, line: 'Your five against theirs. One game.' }}
          links={{ onMenu: links.onMenu }}
          done={
            <Btn kind="line" onClick={() => setTourney(false)}>
              Back to the results
            </Btn>
          }
        />
      );
    }
  }
  if (tourney) {
    return (
      <MiniTournamentView
        seeded={ranked.map((r) => r.team)}
        scores={new Map(ranked.map((r) => [r.team.id, r.score.composite]))}
        seed={String(state.seed)}
        codeOf={codeOf}
        title={title}
        links={links}
        onBack={() => setTourney(false)}
        onNewDraft={daily ? undefined : onNewDraft}
        onFinished={setTourneyResult}
        gate={tourneyGate?.gate}
        waiting={tourneyGate?.waiting}
        onShown={tourneyGate?.onShown}
        summary={
          tourneyResult && (
            <RunSummary
              careerId={careerId}
              dayPoints={dayPts}
              rows={[
                ['Power ranking', `${ordinal(humanRank)} of ${TEAM_COUNT}`],
                ['Tournament', tourneyResult.out === null ? '🏆 Champions' : `Out in the ${MINI_ROUNDS[tourneyResult.out]}`],
                ['Record', `${tourneyResult.wins}–${tourneyResult.losses} · #${tourneyResult.seed} seed`],
              ]}
            />
          )
        }
        onShare={() => setShareOpen(true)}
        overlay={shareOpen ? <ShareNight d={poster} link={daily ? undefined : modeChallengeLink('mini', state.seed, human.score.composite, teamLabel(human.team))} fileName={teamLabel(human.team)} onClose={() => setShareOpen(false)} /> : undefined}
      />
    );
  }

  const aside = (
    <>
      <Mast title={title} daily={Boolean(daily)} sub={daily ? `${dayLabel(daily.day)} · final` : `Final · ${TEAM_COUNT} teams`} />
      <Tally you={ordinal(humanRank)} mid={human.score.composite} ai={best.score.composite} youK="Place" midK="Score" aiK="Best" plain />
      {daily ? (
        <>
          <section>
            <H3 note={`${streak} ${streak === 1 ? 'day' : 'days'}`}>Streak</H3>
            <div className="streak">
              {STREAK_TIERS.map((t) => (
                <div key={t.days} className={streak >= t.days ? 'got' : STREAK_TIERS.find((x) => streak < x.days) === t ? 'next' : undefined}>
                  <b>{t.days}</b>
                  <span>{t.reward.split(' ').slice(0, 2).join(' ')}</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <H3>Next board</H3>
            <Kv k="New draft in" v={untilTomorrow()} />
          </section>
        </>
      ) : (
        <>
          <section>
            <H3 note={`${fmtCaps(capsUsed)} / ${fmtCaps(state.capLimit)} caps`}>Your draft</H3>
            {/* The same pick log as the All-Time results (playtest 2026-10-22: Mini = All-Time, shorter). */}
            <table className="log">
              <tbody>
                {myLog.map((h) => (
                  <tr key={h.pickNumber} className="y">
                    <td className="n">{h.pickNumber}</td>
                    <td className="w">{h.span?.primaryPosition ?? ''}</td>
                    <td className="p">{h.span ? maskName(h.span.playerName) : h.playerId}</td>
                    <td className="c">{h.span ? fmtCaps(h.span.fga) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {challenge?.vs != null && <Kv k={`${challenge.vsName ?? 'Friend'} · ${challengeVerdict(human.score.composite, challenge.vs) === 'won' ? 'you win' : challengeVerdict(human.score.composite, challenge.vs) === 'lost' ? 'they win' : 'tied'}`} v={challenge.vs} />}
          </section>
        </>
      )}
      <Actions links={{ ...links, menuPhoneOnly: true }}>
        <Btn onClick={() => setTourney(true)}>{TEAM_COUNT === 2 ? '▶ Play the game' : '▶ The tournament'}</Btn>
        {daily ? (
          <>
            <div className="btn2">
              <Btn kind="line" onClick={copyDailyResult}>
                {dailyCopied ? '✓ Copied' : 'Copy result'}
              </Btn>
              <Btn kind="line" onClick={() => setShareOpen(true)}>
                Share
              </Btn>
            </div>
            {DAILY_REPLAY_FOR_TESTING && (
              <Btn kind="line" onClick={onRematch}>
                Replay (testing)
              </Btn>
            )}
          </>
        ) : (
          <>
            <Btn kind="line" onClick={onNewDraft}>New draft</Btn>
            <div className="btn2">
              <Btn kind="line" onClick={() => setShareOpen(true)}>
                Share
              </Btn>
              <Btn kind="line" onClick={challengeFriend}>
                {linkCopied ? '✓ Copied' : 'Challenge'}
              </Btn>
            </div>
            <Btn kind="line" onClick={onRematch}>
              Rematch this board
            </Btn>
          </>
        )}
        {onNextStep && (
          <Btn kind="line" onClick={onNextStep}>
            Next: All-Time Draft →
          </Btn>
        )}
        <Btn kind="line" onClick={links.onMenu}>
          Main menu
        </Btn>
      </Actions>
    </>
  );

  return (
    <NightGame aside={aside} overlay={shareOpen ? <ShareNight d={poster} link={daily ? undefined : modeChallengeLink('mini', state.seed, human.score.composite, teamLabel(human.team))} fileName={teamLabel(human.team)} onClose={() => setShareOpen(false)} /> : undefined}>
      <div className="headline">
        <span className="eb">{daily ? `Daily · ${daily.title}` : 'Final standings'}</span>
        <b>{teamLabel(human.team)}</b>
        <i>
          {QUICK_ROUNDS} rounds · {TEAM_COUNT * QUICK_ROUNDS} picks
        </i>
      </div>
      <div className="verdict vmini">
        <div className="place">
          <b>
            {humanRank}
            <sup>{ordinal(humanRank).slice(String(humanRank).length)}</sup>
          </b>
          <span>of {TEAM_COUNT}</span>
        </div>
        <div className="tier">
          <span className="eb">The verdict</span>
          <h2>{tier.label}</h2>
          <p>
            {tier.line}
            {humanRank > 3 && ` ${weakest.label} kept you out of the top three.`}
          </p>
        </div>
        <div className="nums">
          <div className="you">
            <span>Your team</span>
            <b>{human.score.composite}</b>
          </div>
          <div>
            <span>Best</span>
            <b>{best.score.composite}</b>
          </div>
          <div>
            <span>Behind</span>
            <b>{behind > 0 ? behind : '—'}</b>
          </div>
        </div>
      </div>
      <section>
        <H3 note={`${fmtCaps(capsUsed)} / ${fmtCaps(state.capLimit)} caps`}>Your five</H3>
        <div className="five-row">
          {STARTER_SLOTS.map((slot) => {
            const p = human.lineup[slot];
            return p ? <RosterCard key={slot} span={p} slot={slot} foot={cardRoles(p).join(' · ') || ' '} /> : <div key={slot} className="slot empty">{slot}</div>;
          })}
        </div>
      </section>
      <div className="split">
        <section>
          <H3 note="yours · the best team">{humanRank === 1 ? 'Why you won' : 'Why you finished here'}</H3>
          {profile(human, true)}
        </section>
        <section className="voices">
          <H3>The room</H3>
          <NightVoices voices={voices} cast={DESK_CAST} fold={5} />
        </section>
      </div>
      <section>
        <H3 note="tap a team to see its five">Final standings</H3>
        <table className="stand">
          <tbody>
            {ranked.map((r, i) => {
              const open = openTeam === r.team.id;
              return (
                <StandRow
                  key={r.team.id}
                  rank={i + 1}
                  r={r}
                  code={codeOf(r.team)}
                  who={whoOf(r.team)}
                  open={open}
                  onToggle={r.team.isHuman ? undefined : () => setOpenTeam(open ? null : r.team.id)}
                  detail={
                    open ? (
                      <>
                        <div className="five-row">
                          {STARTER_SLOTS.map((slot) => {
                            const p = r.lineup[slot];
                            return p ? <RosterCard key={slot} span={p} slot={slot} foot={cardRoles(p).join(' · ') || ' '} /> : <div key={slot} className="slot empty">{slot}</div>;
                          })}
                        </div>
                        {profile(r, false)}
                      </>
                    ) : null
                  }
                />
              );
            })}
          </tbody>
        </table>
      </section>
      {daily ? (
        <Btn kind="line" className="phone-only" onClick={copyDailyResult}>
          {dailyCopied ? '✓ Copied' : 'Copy result'}
        </Btn>
      ) : (
        <Btn className="phone-only" onClick={onNewDraft}>
          New draft
        </Btn>
      )}
      {daily && <EmptyNote>Same players, same order for everyone today.</EmptyNote>}
      {daily && <DailyLeaderboard mode="mini" day={daily.day} testing={daily.testing} />}
    </NightGame>
  );
}

function StandRow({
  rank,
  r,
  code,
  who,
  open,
  onToggle,
  detail,
}: {
  rank: number;
  r: { team: Team; score: LineupScore };
  code: string;
  who: string;
  open: boolean;
  onToggle?: () => void;
  detail: ReactNode;
}) {
  return (
    <>
      <tr className={r.team.isHuman ? 'you' : onToggle ? 'tap' : undefined} onClick={onToggle} aria-expanded={onToggle ? open : undefined} style={onToggle ? ({ cursor: 'pointer' } as CSSProperties) : undefined}>
        <td className="rk">{rank}</td>
        <td className="tmc">
          <LeagueMark name={r.team.name} code={code} />
        </td>
        <td className="nm">
          <b>{teamLabel(r.team)}</b>
        </td>
        <td className="who">{who}</td>
        <td className="sc">{r.score.composite}</td>
        <td className="car">{r.team.isHuman ? '' : open ? '▾' : '▸'}</td>
      </tr>
      {open && detail && (
        <tr className="open">
          <td colSpan={6}>{detail}</td>
        </tr>
      )}
    </>
  );
}

function teamIdxOf(state: QuickDraftState): number {
  return currentTeamIndex(state);
}

function fmtClock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
