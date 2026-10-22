import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { deckSfx } from './deckSounds';
import { clearDailyResult, DAILY_REPLAY_FOR_TESTING, currentStreak, dailySeed, recordDailyResult, savedDailyLineup, untilTomorrow, STREAK_TIERS, type Streak } from './dailyProgress';
import { dailyMeta, DAILY_HAND_SIZE, JOKERS_MAX, JOKERS_MIN, type LegendFive } from '../engine/dailyMeta';
import { expectedMargin, headToHeadMargin, legendLineup, simulateLiveGame, type LiveGameResult } from '../engine/liveGame';
import { copyLink } from './shareSave';
import { challengeVerdict, modeChallengeLink, type ModeChallenge } from '../modeChallenge';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS } from '../engine/positions';
import { markStepDone } from './pathProgress';
import { maskName } from './bombMask';
import { reducedMotion } from '../settings';
import {
  dailyBoard,
  lineupShots,
  scoreLineup,
  gradeVsPar,
  explainResult,
  isChalkBoard,
  GRADE_LABEL,
  GRADE_BLURB,
  dealFor,
  boardTargets,
  dealHint,
  dailyGame,
  DEAL_SIZE,
  slotFloor,
  spanById,
  fanVoteFive,
  type DailyJoker,
  type Lineup,
  type LineupScore,
  type DailyPool,
  type DailyTargets,
  type GolfGrade,
  type ResultExplanation,
  type DealNeed,
} from '../engine/bestFive';
import {
  Actions,
  Btn,
  CapBar,
  CapI,
  CardBack,
  EmptyNote,
  H3,
  Kv,
  Mast,
  NCard,
  NFace,
  NightGame,
  Prompt,
  SLOT_NAME,
  Slot,
  SubNote,
  Tally,
  buzz,
  dayLabel,
  fmtCaps,
  shortName,
  spanBand,
} from '../night/ui';
import LiveGameNight from '../night/LiveGameNight';
import { NightHowTo, NightSettings } from '../night/Dialogs';
import { ShareNight, type PosterData } from '../night/Share';

interface Props {
  mode: 'developer' | 'player';
  /** Return to the host app's intro. Omitted in the standalone web export. */
  onBack?: () => void;
  /** The next step of the learning path (Mini Draft), offered on the result screen. */
  onNextStep?: () => void;
  /** A friend's "Challenge a friend" link: their deal and their score. */
  challenge?: ModeChallenge;
  /** The daily Draw Five: today's local date. One board for everyone, one attempt, a streak. */
  daily?: string;
  /** Testing: a day other than today — played, never recorded. */
  testDay?: boolean;
  /** Testing: step to the next date's daily board. */
  onAnotherDay?: () => void;
}

/** The deal hint, by what the five so far is missing (`dealHint`). Never names the card. */
const DEAL_HINT: Record<DealNeed, (have: number) => string> = {
  shooting: (have) => (have === 0 ? 'No shooters yet; one of these cards can space the floor.' : 'One shooter so far; this deal has another.'),
  defense: (have) => (have === 0 ? 'Nobody who can guard yet; one of these cards can.' : 'One stopper so far; this deal has a second.'),
  creation: () => 'Nobody creates his own shot yet; one of these cards can.',
};

const AXES: { key: keyof Pick<LineupScore, 'talent' | 'offense' | 'defense' | 'spacing' | 'fit'>; label: string }[] = [
  { key: 'talent', label: 'Talent' },
  { key: 'offense', label: 'Offense' },
  { key: 'defense', label: 'Defense' },
  { key: 'spacing', label: 'Spacing' },
  { key: 'fit', label: 'Fit' },
];

const WORD = ['no', 'one', 'two', 'three', 'four', 'five'];
const NTH = ['next', '3rd', '4th', '5th'];
/**
 * One tempo for the table (2026-10-22, playtest: "AI bardzo szybko dostaje karty i pickuje, tempo
 * jest rozjechane"). Your hand and the AI's are dealt the same way, card by card; the AI then
 * thinks for a beat and lifts its card, the way yours lifts when you take it.
 */
const TEMPO = {
  /** Between two cards leaving the deck. */
  step: 480,
  /** One card's flight and turn. */
  flight: 950,
  /** The AI looking at its hand. */
  think: 1300,
  /** A taken card held up before the table moves on (yours and the AI's). */
  take: 1500,
  /** Your card lifting before the next deal. */
  pick: 650,
};

/**
 * Draw Five (night edition, mockups `docs/mockups/draw-five-night/index.html`): one player per
 * position from a deal of four, under a cap, against the AI drafting from the same deck — or, in
 * the daily, a five of the day with a face-down Joker against a legendary team. See
 * `engine/bestFive.ts` for the pool, the deals, the 5-man scoring and the par bands.
 */
export default function BestFive({ onBack, onNextStep, challenge, daily, testDay, onAnotherDay }: Props) {
  const [board, setBoard] = useState<{ seed: string; n: number }>(() => ({ seed: daily ? dailySeed(daily) : challenge?.seed ?? randomSeed(1), n: 1 }));
  const meta = useMemo(() => (daily ? dailyMeta(board.seed) : null), [daily, board.seed]);
  const dealt = useMemo(
    () => (meta ? dailyGame(board.seed, meta) : { ...dailyBoard(board.seed), order: STARTER_SLOTS, jokers: [] as DailyJoker[] }),
    [meta, board.seed],
  );
  const pool: DailyPool = dealt.pool;
  const shotsCap = dealt.cap;
  const order = dealt.order;
  const jokers = dealt.jokers;
  const jokerAt = (slot: Position) => jokers.find((j) => j.slot === slot);
  const legends = useMemo(() => (meta ? legendLineup(meta.opponent) : null), [meta]);
  /** The live game: the daily plays the opponent of the day, a regular board the AI's five. The
   * same fives on the same seed play the same game. */
  const matchFor = (l: Lineup, ai: Lineup): LiveGameResult | null => {
    const seedOf = `${board.seed}:${STARTER_SLOTS.map((s) => l[s]?.id).join(',')}`;
    if (meta) {
      if (!legends) return null;
      const tookJoker = jokers.find((j) => l[j.slot]?.id === j.card.id);
      return simulateLiveGame(l, legends, expectedMargin(l, fanVoteFive(pool, shotsCap), legends), seedOf, tookJoker?.span.id);
    }
    if (!STARTER_SLOTS.every((s) => ai[s])) return null;
    return simulateLiveGame(l, ai, headToHeadMargin(l, ai), seedOf);
  };

  function resultFor(l: Lineup, p: DailyPool, cap: number) {
    const score = scoreLineup(l);
    const target = boardTargets(p, cap);
    // 2026-09-30, the user: a five can beat the engine's search (a Joker, a topped-up card); then
    // that five is the best on the board.
    const targets = score.composite > target.optimal ? { ...target, optimal: score.composite, optimalFive: l as Record<Position, PlayerSpan> } : target;
    return { score, targets, grade: gradeVsPar(score.composite, targets.par, targets.optimal) };
  }
  // The daily board already played today opens straight on its result (not while testing).
  const savedDaily = useMemo(() => (daily && !DAILY_REPLAY_FOR_TESTING ? savedDailyLineup(daily, pool, spanById) : null), [daily, pool]);
  const [lineup, setLineup] = useState<Lineup>(() => savedDaily ?? {});
  const [activeSlot, setActiveSlot] = useState<Position | null>(savedDaily ? null : order[0]);
  const [streak, setStreak] = useState<Streak | null>(() => (daily ? currentStreak(daily) : null));
  const [match, setMatch] = useState<LiveGameResult | null>(() => (savedDaily ? matchFor(savedDaily, {}) : null));
  // The AI drafts its own five from the same deck: each round the four cards that didn't come to you.
  const [aiLineup, setAiLineup] = useState<Lineup>({});
  // The AI's turn on the table: the hand it drew and the card it took.
  const [aiTurn, setAiTurn] = useState<{ slot: Position; hand: PlayerSpan[]; took: string; phase: 'deal' | 'think' | 'take' } | null>(null);
  // Your card held up for a beat once picked, before the AI's turn or your next deal.
  const [taking, setTaking] = useState<{ slot: Position; id: string } | null>(null);
  // The daily Joker of the round just played, turned over once a card was picked.
  const [jokerReveal, setJokerReveal] = useState<{ joker: DailyJoker; took: boolean } | null>(null);
  // Every pick, in order (yours and the AI's), for the aside's log.
  const [log, setLog] = useState<{ n: number; who: 'You' | 'AI'; span: PlayerSpan }[]>([]);
  // Your newest card lands with a gold ring.
  const [landed, setLanded] = useState<string | null>(null);
  // After Submit: the game (pre-game, live, final), then the result.
  const [stage, setStage] = useState<'draft' | 'game' | 'result'>(savedDaily ? 'result' : 'draft');
  // A slot's cards stay face down until "Draw" (once per slot).
  const [freshSlot, setFreshSlot] = useState<Position | null>(savedDaily ? null : order[0]);
  const [result, setResult] = useState<{ score: LineupScore; targets: DailyTargets; grade: GolfGrade } | null>(() =>
    savedDaily ? resultFor(savedDaily, pool, shotsCap) : null,
  );
  const [dialog, setDialog] = useState<'howto' | 'settings' | null>(null);

  const aiPhase = aiTurn?.phase ?? null;
  useEffect(() => {
    if (aiPhase === 'think') {
      const t = window.setTimeout(() => setAiTurn((a) => a && { ...a, phase: 'take' }), TEMPO.think);
      return () => window.clearTimeout(t);
    }
    if (aiPhase === 'take') {
      const t = window.setTimeout(() => setAiTurn(null), reducedMotion() ? 1200 : TEMPO.take);
      return () => window.clearTimeout(t);
    }
  }, [aiPhase]);
  /** A tap on the AI's table moves it on a step. */
  const nextAiPhase = () => setAiTurn((a) => (!a ? null : a.phase === 'take' ? null : { ...a, phase: 'take' }));

  /** The picks made before `slot` in the day's order. */
  const picksBefore = (slot: Position): Lineup => {
    const before: Lineup = {};
    for (const s of order.slice(0, order.indexOf(slot))) if (lineup[s]) before[s] = lineup[s];
    return before;
  };
  /** A position's deal: fixed by the picks before it. The daily deals five, one of them a
   * face-down Joker in his rounds. */
  const dealOf = (slot: Position): PlayerSpan[] => {
    if (!daily) return dealFor(pool, slot, picksBefore(slot), shotsCap);
    const j = jokerAt(slot);
    const hand = dealFor(pool, slot, picksBefore(slot), shotsCap, j ? DAILY_HAND_SIZE - 1 : DAILY_HAND_SIZE);
    if (!j) return hand;
    const withJoker = [...hand];
    withJoker.splice(Math.min(j.place, withJoker.length), 0, j.card);
    return withJoker;
  };

  const filledCount = STARTER_SLOTS.filter((s) => lineup[s]).length;
  const complete = filledCount === 5;
  const shotsUsed = lineupShots(lineup);
  const overCap = shotsUsed > shotsCap;

  // A pick is final; a player who would leave the open positions unfillable under the cap (at their
  // cheapest player in the whole game — later deals top up to fit) can't be taken.
  const cheapestLeft = (except: Position) => STARTER_SLOTS.filter((s) => s !== except && !lineup[s]).reduce((sum, s) => sum + slotFloor(s), 0);
  const overBy = (slot: Position, span: PlayerSpan) => shotsUsed + span.fga + cheapestLeft(slot) - shotsCap;

  function pick(slot: Position, span: PlayerSpan) {
    if (taking || lineup[slot] || overBy(slot, span) > 1e-9) return;
    deckSfx.pick();
    buzz();
    if (reducedMotion()) {
      commitPick(slot, span);
      return;
    }
    setTaking({ slot, id: span.id });
    window.setTimeout(() => {
      setTaking(null);
      commitPick(slot, span);
    }, TEMPO.pick);
  }

  function commitPick(slot: Position, span: PlayerSpan) {
    setLineup((prev) => ({ ...prev, [slot]: span }));
    setLanded(span.id);
    const n = order.indexOf(slot) + 1;
    setLog((prev) => [...prev, { n, who: 'You', span }]);
    if (!daily) aiTakes(slot, n);
    const j = jokerAt(slot);
    setJokerReveal(j ? { joker: j, took: span.id === j.card.id } : null);
    const nextEmpty = order.find((s) => s !== slot && !lineup[s]);
    setFreshSlot(nextEmpty ?? null);
    setActiveSlot(nextEmpty ?? null);
  }

  /** The AI's pick at `slot`: from the position's cards that didn't come to you, the one that makes
   * its five best while leaving room for the rest. It counts on the fifth cheapest of the eight for
   * each later position and never goes over the cap. */
  function aiTakes(slot: Position, n: number) {
    const yours = new Set(dealOf(slot).map((c) => c.id));
    const hand = pool.bySlot[slot].filter((c) => !yours.has(c.id));
    const ai = aiLineup;
    if (ai[slot] || hand.length === 0) return;
    const used = lineupShots(ai);
    const open = STARTER_SLOTS.filter((s) => s !== slot && !ai[s]);
    const reserve = open.reduce((sum, s) => {
      const costs = pool.bySlot[s].map((c) => c.fga).sort((a, b) => a - b);
      return sum + (costs[Math.min(DEAL_SIZE, costs.length - 1)] ?? 0);
    }, 0);
    const fits = hand.filter((c) => used + c.fga + reserve <= shotsCap);
    const choice = fits.length
      ? fits.reduce((best, c) => (scoreLineup({ ...ai, [slot]: c }).composite > scoreLineup({ ...ai, [slot]: best }).composite ? c : best))
      : [...hand].sort((a, b) => a.fga - b.fga)[0];
    setAiLineup({ ...ai, [slot]: choice });
    setAiTurn({ slot, hand: hand.slice(0, DEAL_SIZE).some((c) => c.id === choice.id) ? hand.slice(0, DEAL_SIZE) : [choice, ...hand.filter((c) => c.id !== choice.id).slice(0, DEAL_SIZE - 1)], took: choice.id, phase: reducedMotion() ? 'take' : 'deal' });
    setLog((prev) => [...prev, { n, who: 'AI', span: choice }]);
  }

  function submit() {
    if (!complete || overCap) return;
    const next = resultFor(lineup, pool, shotsCap);
    setResult(next);
    const m = matchFor(lineup, aiLineup);
    setMatch(m);
    setStage(m ? 'game' : 'result');
    if (daily && !testDay) {
      setStreak(
        recordDailyResult(daily, lineup, next.grade, next.score.composite, {
          game: m && meta ? { you: m.final[0], them: m.final[1], opponent: meta.opponent.short } : undefined,
          jokers: jokers.map((j) => ({ name: j.span.playerName, legend: j.legend, slot: j.slot })),
        }),
      );
    }
  }

  function resetPicks() {
    setLineup({});
    setAiLineup({});
    setAiTurn(null);
    setJokerReveal(null);
    setLog([]);
    setLanded(null);
    setMatch(null);
    setStage('draft');
    setActiveSlot(order[0]);
    setFreshSlot(order[0]);
    setResult(null);
  }

  /** Testing only (`DAILY_REPLAY_FOR_TESTING`): play today's daily board again from the start. */
  function replayDaily() {
    if (!daily) return;
    setStreak(clearDailyResult(daily));
    resetPicks();
  }

  function newBoard() {
    setBoard((b) => ({ seed: randomSeed(b.n + 1), n: b.n + 1 }));
    resetPicks();
  }

  const links = { onMenu: onBack, onHowTo: () => setDialog('howto'), onSettings: () => setDialog('settings') };
  const dialogs = (
    <>
      {dialog === 'howto' && <NightHowTo lead={daily ? 'Daily Draw Five · one board for everyone, one try.' : 'Draw Five · five cards a position, one cap, against the AI.'} rules={howToRules(Boolean(daily))} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <NightSettings onClose={() => setDialog(null)} />}
    </>
  );

  const title = daily ? 'Daily Draw Five' : 'Draw Five';
  const oppShort = meta?.opponent.short ?? 'AI';

  /* ------------------------------ the game ------------------------------ */
  if (stage === 'game' && match && result) {
    const opp = meta?.opponent;
    return (
      <>
        <LiveGameNight
          game={match}
          variant="d5"
          sides={{ names: ['You', opp ? opp.short : 'AI · Pro'], short: ['You', opp ? opp.short.replace(/^’\d\d |^'\d\d /, '') : 'AI'], codes: ['YOU', opp ? (opp.short.split(' ').slice(-1)[0] ?? 'OPP').slice(0, 3).toUpperCase() : 'AI'], you: 0 }}
          mast={{
            title,
            daily: Boolean(daily),
            sub: daily ? `${dayLabel(daily)} · final` : 'Final · against the AI (Pro)',
            liveSub: daily ? `${dayLabel(daily)} · game of the day` : 'Live · you vs the AI (Pro)',
            preSub: daily ? `${dayLabel(daily)} · game of the day` : 'Tip-off · you vs the AI (Pro)',
          }}
          autoStart
          links={links}
          pregame={{
            eb: daily ? 'Game of the day · tonight' : 'Before tip-off',
            now: Boolean(daily),
            title: daily && opp ? `The ${opp.short}` : 'Starting fives',
            line: pregameLine(match, opp),
            tally: [result.score.composite, daily ? '—' : scoreLineup(aiLineup).composite],
            aside: (
              <section>
                <H3>{daily ? 'Today' : 'Your number'}</H3>
                {daily && streak && <Kv k="Streak" v={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`} gold />}
                <Kv k="Your five" v={result.score.composite} />
                {!daily && <Kv k="AI five" v={scoreLineup(aiLineup).composite} />}
                {daily ? <Kv k="Jokers taken" v={`${jokers.filter((j) => lineup[j.slot]?.id === j.card.id).length} of ${jokers.length}`} /> : <Kv k="Caps used" v={`${fmtCaps(shotsUsed)} / ${shotsCap}`} />}
              </section>
            ),
          }}
          done={
            <Btn onClick={() => setStage('result')}>
              See the result
            </Btn>
          }
        />
        {dialogs}
      </>
    );
  }

  /* ------------------------------ the result ------------------------------ */
  if (stage === 'result' && result) {
    return (
      <>
        <BestFiveResult
          title={title}
          lineup={lineup}
          pool={pool}
          result={result}
          shotsCap={shotsCap}
          onNewBoard={newBoard}
          onReplayDaily={daily && DAILY_REPLAY_FOR_TESTING ? replayDaily : undefined}
          onWatch={match ? () => setStage('game') : undefined}
          daily={daily}
          streak={streak}
          onNextStep={onNextStep}
          seed={board.seed}
          challenge={challenge && challenge.seed === board.seed ? challenge : undefined}
          jokers={jokers}
          opponent={meta?.opponent}
          match={match}
          links={links}
        />
        {dialogs}
      </>
    );
  }

  /* ------------------------------ the draft ------------------------------ */
  const pickNo = Math.min(5, filledCount + 1);
  const left = shotsCap - shotsUsed;
  const spotsLeft = 5 - filledCount;
  const openSlots = order.filter((s) => !lineup[s]);
  const hand = activeSlot ? dealOf(activeSlot) : [];
  const handBlocked = activeSlot ? hand.filter((c) => !(jokerAt(activeSlot)?.card.id === c.id) && overBy(activeSlot, c) > 1e-9) : [];
  const hint = activeSlot && !aiTurn ? dealHint(pool, activeSlot, picksBefore(activeSlot), shotsCap) : null;
  const jokerHere = activeSlot ? jokerAt(activeSlot) : undefined;
  const nextLabels = new Map<Position, string>();
  openSlots.filter((s) => s !== activeSlot).forEach((s, i) => nextLabels.set(s, NTH[i] ?? ''));
  const submitLabel = complete ? 'Submit lineup' : `Submit lineup — ${spotsLeft} to go`;
  const submitBtn = (cls?: string) => (
    <Btn className={cls} disabled={!complete || overCap || Boolean(aiTurn)} onClick={submit}>
      {submitLabel}
    </Btn>
  );
  // The AI's card stays its secret until it turns its pick over (no spoiler in the row or the log).
  const aiHidden = aiTurn && aiTurn.phase !== 'take' ? aiTurn.took : null;
  const aiShown: Lineup = { ...aiLineup };
  if (aiHidden && aiTurn) delete aiShown[aiTurn.slot];
  const logShown = aiHidden ? log.filter((l) => !(l.who === 'AI' && l.span.id === aiHidden)) : log;
  const aiUsed = lineupShots(aiShown);

  const aside = (
    <>
      <Mast title={title} daily={Boolean(daily)} sub={daily ? `${dayLabel(daily)} · ${filledCount === 0 ? 'one board for everyone' : complete ? 'five set' : `pick ${pickNo} of 5`}` : `${complete ? 'Five set' : `Pick ${pickNo} of 5`} · against the AI (Pro)`} />
      {daily ? (
        <Tally you={fmtCaps(shotsUsed)} mid={shotsCap} ai={<OppName short={oppShort} />} aiK="Tonight" name />
      ) : (
        <Tally you={shotsUsed.toFixed(1)} mid={shotsCap} ai={aiUsed.toFixed(1)} />
      )}
      <CapBar used={shotsUsed} cap={shotsCap} />
      <SubNote>
        {filledCount === 0 ? (
          <>
            <b className="g">{shotsCap} caps</b> for five spots
          </>
        ) : complete ? (
          <>
            <b>{fmtCaps(left)} caps</b> under the cap
          </>
        ) : (
          <>
            <b>{fmtCaps(left)} caps</b> left for {spotsLeft === 1 ? openSlots[0] : spotsLeft <= 2 ? openSlots.join(' and ') : `${WORD[spotsLeft]} spots`}
          </>
        )}
      </SubNote>
      {daily && meta ? (
        <section>
          <H3>Today</H3>
          {streak && <Kv k="Streak" v={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`} gold />}
          <Kv k="Order">
            <span className="order">
              {order.map((s, i) => (
                <span key={s}>
                  {i > 0 && ' → '}
                  {s === activeSlot ? <u>{s}</u> : s}
                </span>
              ))}
            </span>
          </Kv>
          {filledCount === 0 ? (
            <>
              <Kv k="Cards a spot" v={DAILY_HAND_SIZE} />
              <Kv k="Jokers" v={`${JOKERS_MIN}–${JOKERS_MAX} face down`} />
              <Kv k="Tries" v="One" />
            </>
          ) : (
            <Kv k="Jokers left" v={`${jokers.filter((j) => !lineup[j.slot]).length} of ${jokers.length}`} />
          )}
          {onAnotherDay && (
            <Kv k={testDay ? 'Testing · not recorded' : 'Testing'}>
              <button type="button" className="lk-inline" onClick={onAnotherDay}>
                Another day →
              </button>
            </Kv>
          )}
        </section>
      ) : logShown.length === 0 ? (
        <>
          <section>
            <H3>The draft so far</H3>
            <EmptyNote>No picks yet. You draw first, then the AI drafts from its own deal: same deck, same cap.</EmptyNote>
          </section>
          <section>
            <H3>How it works</H3>
            <Kv k="Positions" v="PG → C" />
            <Kv k="Cards a spot" v={DEAL_SIZE} />
            <Kv k="Picks" v="Final" />
            <Kv k="Then" v="Live game" />
          </section>
        </>
      ) : null}
      {logShown.length > 0 && <DraftLog rows={logShown.slice(-6)} />}
      <Actions links={links}>{submitBtn()}</Actions>
    </>
  );

  // The stage under the prompt: the AI's turn, the face-down deal, or your hand.
  let promptEl: ReactNode;
  let table: ReactNode = null;
  if (aiTurn) {
    const took = aiTurn.hand.find((c) => c.id === aiTurn.took);
    const drew = WORD[aiTurn.hand.length] ?? aiTurn.hand.length;
    promptEl = (
      <Prompt eb={`AI on the clock · Pick ${order.indexOf(aiTurn.slot) + 1}`} title={SLOT_NAME[aiTurn.slot]} now>
        {aiTurn.phase === 'deal' ? (
          <>The AI draws {drew}.</>
        ) : aiTurn.phase === 'think' ? (
          <>
            The AI drew {drew}. <span className="ai-think">Thinking</span>
          </>
        ) : (
          <>
            The AI drew {drew}. It takes <b className="w">{took ? maskName(took.playerName) : ''}</b>.
          </>
        )}
      </Prompt>
    );
    table =
      aiTurn.phase === 'deal' ? (
        <DeckHand
          key={`ai-${pool.key}-${aiTurn.slot}`}
          slot={aiTurn.slot}
          cards={aiTurn.hand}
          fresh
          auto
          joker={false}
          daily={false}
          note="The AI draws from the same deck, under the same cap."
          onDone={() => setAiTurn((a) => a && { ...a, phase: 'think' })}
          renderCard={(c) => <NCard span={c} />}
        />
      ) : (
        <button type="button" className={`hand ai-hand ${aiTurn.phase}${aiTurn.hand.length >= 5 ? ' n5' : ''}`} style={{ '--n': aiTurn.hand.length } as CSSProperties} onClick={nextAiPhase} aria-label="Next">
          {aiTurn.hand.map((c, i) => (
            <span key={c.id} style={{ '--i': i } as CSSProperties} className="ai-c">
              <NCard span={c} cls={aiTurn.phase === 'take' ? (c.id === aiTurn.took ? 'sel ai-took' : 'dim') : undefined} took={aiTurn.phase === 'take' && c.id === aiTurn.took ? 'AI takes' : undefined} />
            </span>
          ))}
        </button>
      );
  } else if (activeSlot) {
    const n = order.indexOf(activeSlot) + 1;
    const firstLine =
      filledCount === 0 ? (
        daily ? (
          <>
            Today starts at {activeSlot}. <b>{shotsCap} caps</b>, one try.
          </>
        ) : (
          <>
            {WORD[hand.length][0].toUpperCase() + WORD[hand.length].slice(1)} cards off the deck. <b>{shotsCap} caps</b> for five spots.
          </>
        )
      ) : jokerHere ? (
        <>
          {WORD[hand.length][0].toUpperCase() + WORD[hand.length].slice(1)} cards. One of them is a <b>Joker</b>.
        </>
      ) : (
        <>
          <b>{fmtCaps(left)} caps</b> for {WORD[spotsLeft]} {spotsLeft === 1 ? 'spot' : 'spots'}.
          {handBlocked.length > 0 && freshSlot !== activeSlot && <> {handBlocked.map((c) => maskName(c.playerName).split(' ').slice(-1)[0]).join(' and ')} won’t fit.</>}
        </>
      );
    promptEl = (
      <Prompt eb={`On the clock · Pick ${n}`} title={SLOT_NAME[activeSlot]} now>
        {firstLine}
        {hint && freshSlot !== activeSlot && <> {DEAL_HINT[hint.need](hint.have)}</>}
      </Prompt>
    );
    table = (
      <DeckHand
        key={`${pool.key}-${activeSlot}`}
        slot={activeSlot}
        cards={hand}
        fresh={freshSlot === activeSlot}
        joker={Boolean(jokerHere)}
        daily={Boolean(daily)}
        onDone={() => setFreshSlot(null)}
        renderCard={(span) => {
          const over = overBy(activeSlot, span);
          const blocked = over > 1e-9;
          const j = jokerAt(activeSlot);
          if (j?.card.id === span.id) return <JokerCard price={j.price} pos={activeSlot} blocked={blocked} onPick={() => pick(activeSlot, span)} />;
          return (
            <NCard
              span={span}
              cls={taking ? (taking.id === span.id ? 'you-took' : 'dim') : blocked ? 'dim over' : undefined}
              over={blocked ? `Over the cap by ${over.toFixed(1)}` : undefined}
              onClick={blocked ? undefined : () => pick(activeSlot, span)}
              title={blocked ? `${maskName(span.playerName)} would leave no room under the cap` : `Draft ${maskName(span.playerName)}`}
            />
          );
        }}
      />
    );
  } else {
    promptEl = (
      <Prompt eb="Five set" title="Lock it in">
        Picks are final. Your five plays {meta ? `the ${meta.opponent.short}` : 'the AI'} live.
      </Prompt>
    );
    const them = meta ? legends : aiLineup;
    table = them ? <TaleOfTheTape yours={lineup} theirs={them} theirLabel={meta ? meta.opponent.short : 'AI'} /> : null;
  }

  const newAi = aiTurn?.took ?? [...log].reverse().find((l) => l.who === 'AI')?.span.id;
  const jokerModal = jokerReveal?.took ? (
    <JokerModal
      joker={jokerReveal.joker}
      next={activeSlot}
      onNext={() => setJokerReveal(null)}
    />
  ) : null;

  return (
    <>
      <NightGame className="d5" aside={aside} overlay={jokerModal}>
        {daily && meta ? (
          <OppRow title={`Game of the day · ${meta.opponent.name}`} note={filledCount === 0 ? 'they play your five after the last pick' : 'after the last pick'} lineup={legends ?? {}} legends />
        ) : (
          <OppRow title="AI · Pro" lineup={aiShown} nextPos={aiTurn ? null : activeSlot} newId={aiHidden ? undefined : newAi} />
        )}
        <section>
          <H3 note={`${filledCount} of 5`}>Your five</H3>
          <div className="slots">
            {STARTER_SLOTS.map((s) => (
              <Slot
                key={s}
                pos={s}
                span={lineup[s]}
                land={!!lineup[s] && lineup[s]!.id === landed}
                state={s === activeSlot && !aiTurn ? 'active' : 'empty'}
                small={s === activeSlot && !aiTurn ? 'your pick' : nextLabels.get(s)}
              />
            ))}
          </div>
        </section>
        {jokerReveal && !jokerReveal.took && !aiTurn && (
          <p className="reveal">
            The {jokerReveal.joker.slot} Joker was <b>{maskName(jokerReveal.joker.span.playerName)}</b> {jokerReveal.joker.span.spanLabel}, {jokerReveal.joker.legend ? 'a legend. He got away.' : 'a scrub. Good dodge.'}
          </p>
        )}
        {promptEl}
        {table}
        {submitBtn('phone-only')}
      </NightGame>
      {dialogs}
    </>
  );
}

/** "'92 Bulls" set on two lines in the tally. */
function OppName({ short }: { short: string }) {
  const [a, ...b] = short.split(' ');
  return b.length ? (
    <>
      {a}
      <br />
      {b.join(' ')}
    </>
  ) : (
    <>{short}</>
  );
}

function pregameLine(match: LiveGameResult, opp: LegendFive | undefined): string {
  if (opp) return `${opp.name}. Beat the five biggest names on the board and you usually beat them too.`;
  const m = match.expectedMargin;
  const lead = Math.round(Math.abs(m));
  if (lead < 1) return 'The engine has it even. Every matchup counts.';
  return m > 0 ? `The engine has you by ${lead === 1 ? 'a point' : `${lead}`}.` : `The engine has the AI by ${lead === 1 ? 'a point' : `${lead}`}.`;
}

function howToRules(daily: boolean): [string, ReactNode][] {
  const base: [string, ReactNode][] = [
    ['Draw five', 'One player per position, PG to C. Each position you draw cards off the deck, pick one, and the next position comes up. Picks are final.'],
    [
      'Caps',
      <>
        Every player costs caps <CapI />, his shots a game in those years. Your five have to fit under the board’s cap.
      </>,
    ],
    ['Grading', 'Your five is scored on talent, offense, defense, spacing and fit, then compared with the fan-vote five (the five biggest names) and the best five on the board.'],
  ];
  return daily
    ? [
        ...base,
        ['Today’s order', 'The daily deals the positions in its own order, a different one every day.'],
        ['Jokers', `Five cards a position. In ${JOKERS_MIN} to ${JOKERS_MAX} rounds one card is a face-down Joker at the position’s middle price: even odds a legend or a scrub. You find out when you pick him.`],
        ['Game of the day', 'Your five then plays a legendary team, live.'],
      ]
    : [...base, ['Against the AI', 'The AI drafts its own five from the same deck under the same cap: each position it gets the cards that didn’t come to you. Then the two fives play a live game.']];
}

/** The aside's log of the draft so far. */
function DraftLog({ rows }: { rows: { n: number; who: 'You' | 'AI'; span: PlayerSpan }[] }) {
  return (
    <section>
      <H3>The draft so far</H3>
      <table className="log">
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.n}-${r.who}`} className={`${r.who === 'AI' ? 'a' : 'y'}${i === rows.length - 1 ? ' latest' : ''}`}>
              <td className="n">{r.n}</td>
              <td className="w">{r.who}</td>
              <td className="p">
                {maskName(r.span.playerName)}, {r.span.primaryPosition}
              </td>
              <td className="c">{fmtCaps(r.span.fga)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The rival's five across the top: the AI's picks so far, or the legends of the day. */
function OppRow({ title, note, lineup, nextPos, newId, legends }: { title: string; note?: string; lineup: Lineup; nextPos?: Position | null; newId?: string; legends?: boolean }) {
  const filled = STARTER_SLOTS.filter((s) => lineup[s]).length;
  return (
    <section>
      <H3 note={note ?? `${filled} of 5`}>{title}</H3>
      <ul className="opp">
        {STARTER_SLOTS.map((s) => {
          const p = lineup[s];
          if (!p)
            return (
              <li key={s} className="e">
                <span className="pos">{s}</span>
                <span className="who">{s === nextPos ? 'picks next' : '—'}</span>
              </li>
            );
          return (
            <li key={s} className={p.id === newId ? 'new' : undefined}>
              <NFace name={p.playerName} span={p} />
              <span className="pos">{s}</span>
              <span className="who">{maskName(p.playerName)}</span>
              <span className="c">
                {p.spanLabel}
                {!legends && <> · {fmtCaps(p.fga)}</>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Tale of the tape: position by position before Submit. */
function TaleOfTheTape({ yours, theirs, theirLabel }: { yours: Lineup; theirs: Lineup; theirLabel: string }) {
  const side = (p: PlayerSpan | undefined) =>
    p ? (
      <div className="pl">
        <NFace name={p.playerName} span={p} />
        <div>
          <b>{maskName(p.playerName)}</b>
          <small>
            {p.spanLabel} · {fmtCaps(p.fga)} caps
          </small>
        </div>
      </div>
    ) : null;
  return (
    <section>
      <H3 note={`you · ${theirLabel}`}>Tale of the tape</H3>
      <table className="tape">
        <tbody>
          {STARTER_SLOTS.map((s) => (
            <tr key={s}>
              <td>{side(yours[s])}</td>
              <td className="pos">{s}</td>
              <td className="r">{side(theirs[s])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The face-down Joker: gold card, "?" — legend or scrub. */
function JokerCard({ price, pos, blocked, onPick }: { price: number; pos: Position; blocked: boolean; onPick: () => void }) {
  return (
    <button type="button" className={`card joker${blocked ? ' dim' : ''}`} disabled={blocked} onClick={onPick} title="A Joker: even odds a legend or a scrub">
      <div className="top">
        <span>JOKER</span>
        <span className="cost">{fmtCaps(price)}</span>
      </div>
      <div className="q">?</div>
      <div className="nm">Legend or scrub?</div>
      <div className="sb">{pos} · face down</div>
      <div className="roles" style={{ color: 'var(--cgold3)' }}>
        You find out when you pick him.
      </div>
      <div className="st">
        <div>
          <b>50%</b>
          <span>LEGEND</span>
        </div>
        <div>
          <b>50%</b>
          <span>SCRUB</span>
        </div>
      </div>
    </button>
  );
}

/** The Joker you took, turned over in the middle of the table (mockups `#jokerTook` / `#jokerScrub`). */
function JokerModal({ joker, next, onNext }: { joker: DailyJoker; next: Position | null; onNext: () => void }) {
  useEffect(() => {
    if (joker.legend) deckSfx.jackpot();
    else deckSfx.scrub();
    buzz(joker.legend ? [20, 40, 20, 40, 60] : 60);
  }, [joker]);
  const name = maskName(joker.span.playerName);
  return (
    <>
      <div className="jr-dim" aria-hidden />
      <div className={`jr${joker.legend ? '' : ' scrub'}`} role="dialog" aria-modal="true" aria-label={joker.legend ? 'Jackpot' : 'Ouch'}>
        <NCard span={{ ...joker.span, fga: joker.price }} jokerBand costLabel={fmtCaps(joker.price)} />
        <h2>{joker.legend ? 'Jackpot' : 'Ouch'}</h2>
        <p>
          The {joker.slot} Joker was <b>{name}</b> {joker.span.spanLabel}, {joker.legend ? 'a legend' : 'a scrub'}, for <b>{fmtCaps(joker.price)} caps</b>.{' '}
          {joker.legend ? `He would cost ${fmtCaps(joker.span.fga)} face up.` : 'The other four will have to carry him.'}
        </p>
        <Btn onClick={onNext}>{next ? `Next pick · ${next}` : 'See your five'}</Btn>
      </div>
    </>
  );
}

const DEAL_STEP_MS = TEMPO.step;
const DEAL_FLIGHT_MS = TEMPO.flight;

/** One dealt card (deal animation A, 2026-09-30): it leaves the deck face down, flies to its place
 * and turns over as it lands. */
function DealtCard({ pile, fly, children }: { pile: RefObject<HTMLDivElement | null>; fly: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const from = pile.current;
    if (!fly || !el || !from || typeof el.animate !== 'function') return;
    const a = from.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const scale = Math.min(1, a.width / Math.max(1, b.width));
    // It flies in face down with a slight turn, settles, then turns over on its own axis: half a
    // turn to edge-on, the face swaps in, the other half (2026-10-22: the flat squash read cheap).
    el.animate(
      [
        { transform: `perspective(900px) translate(${dx}px, ${dy}px) scale(${scale}) rotate(-8deg)`, easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)' },
        { transform: 'perspective(900px) translate(0, -6px) scale(1.02) rotate(0deg)', offset: 0.5, easing: 'ease-out' },
        { transform: 'perspective(900px) translate(0, 0) scale(1) rotate(0deg)', offset: 0.58, easing: 'ease-in' },
        { transform: 'perspective(900px) rotateY(90deg)', offset: 0.74, easing: 'ease-out' },
        { transform: 'perspective(900px) rotateY(0deg)' },
      ],
      { duration: DEAL_FLIGHT_MS },
    );
    el.querySelector<HTMLElement>('.fly-back')?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.739 }, { opacity: 0, offset: 0.74 }, { opacity: 0 }], { duration: DEAL_FLIGHT_MS, fill: 'none' });
    deckSfx.deal();
    const flip = window.setTimeout(() => deckSfx.flip(), DEAL_FLIGHT_MS * 0.66);
    return () => window.clearTimeout(flip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className="dealt">
      {children}
      {fly && <span className="fly-back" aria-hidden />}
    </div>
  );
}

/**
 * A position's cards (mockups `#start` / `#pick`): face down until "Draw", then each card flies from
 * the deck and turns over, and the hand opens. A position seen before shows its cards face up.
 * Reduced motion deals them face up at once.
 */
function DeckHand({
  slot,
  cards,
  fresh,
  auto,
  joker,
  daily,
  note,
  onDone,
  renderCard,
}: {
  slot: Position;
  cards: PlayerSpan[];
  fresh: boolean;
  /** The AI's hand: dealt at once, no Draw button. */
  auto?: boolean;
  joker: boolean;
  daily: boolean;
  /** The line under the deck in place of the caps note. */
  note?: ReactNode;
  onDone: () => void;
  renderCard: (span: PlayerSpan) => ReactNode;
}) {
  const pile = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(fresh ? 0 : cards.length);
  const [drawing, setDrawing] = useState(false);
  useEffect(() => {
    if (!auto || !fresh || reducedMotion()) return;
    deckSfx.shuffle();
    setDrawing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [settled, setSettled] = useState(!fresh);
  useEffect(() => {
    if (fresh && reducedMotion()) {
      setSettled(true);
      setShown(cards.length);
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!drawing) return;
    if (shown >= cards.length) {
      const t = window.setTimeout(() => {
        setSettled(true);
        onDone();
        if (!auto) buzz();
      }, DEAL_FLIGHT_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 250 : shown === cards.length - 1 ? DEAL_STEP_MS + 350 : DEAL_STEP_MS);
    return () => window.clearTimeout(t);
  }, [drawing, shown, cards.length, onDone, auto]);
  const n = cards.length;
  if (settled) {
    return (
      <div className={`hand${n >= 5 ? ' n5' : ''}`} style={{ '--n': n } as CSSProperties}>
        {cards.map((c) => (
          <div key={c.id} className="hand-c">
            {renderCard(c)}
          </div>
        ))}
      </div>
    );
  }
  const plural = SLOT_NAME[slot].toLowerCase() + 's';
  return (
    <div className={`stage${n >= 5 ? ' n5' : ''}`} style={{ '--n': n } as CSSProperties}>
      {cards.map((c, i) =>
        i < shown ? (
          <DealtCard key={c.id} pile={pile} fly={drawing}>
            {renderCard(c)}
          </DealtCard>
        ) : (
          <div key={c.id} className="ph" aria-hidden>
            ?
          </div>
        ),
      )}
      <div className="deal" aria-live="polite">
        <div ref={pile}>
          <CardBack />
        </div>
        {!drawing ? (
          <Btn
            onClick={() => {
              deckSfx.shuffle();
              setDrawing(true);
            }}
          >
            Draw {n} {plural}
          </Btn>
        ) : (
          <p>Dealing…</p>
        )}
        <p>
          {note ? (
            note
          ) : daily && joker ? (
            <>
              A gold Joker hides in this hand: <b>50% legend, 50% scrub</b>.
            </>
          ) : daily ? (
            <>
              A gold Joker may hide in today’s hands: <b>50% legend, 50% scrub</b>.
            </>
          ) : (
            'Every player costs his shots a game in caps.'
          )}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ the result ------------------------------ */

const RESULT_LEAD: Record<GolfGrade, string> = {
  eagle: 'You out-scouted everyone on a board that had a real trap to avoid.',
  birdie: 'You saw past the obvious five.',
  par: 'A safe, sensible five.',
  bogey: 'Something in this five is fighting itself.',
  'double-bogey': 'This five doesn’t play as a team yet.',
};
const LEAD_BEST = [
  'Nobody builds a better five from this deal. This is the best team on the board.',
  'You found the best five the deal had. There’s nothing on the tape to fix.',
  'Best team on the board. Every card you passed on would have made it worse.',
  'That’s the five the film room would have drawn up. Hang the banner.',
];
const LEAD_CLOSE = [
  (gap: number) => `${gap} points off the best five on the board: one decision away from it.`,
  (gap: number) => `Nearly the best team on the board: ${gap} points short, and it comes down to one spot.`,
  (gap: number) => `A good five, ${gap} points behind the best one the deal had.`,
];
function filmRoomLead(explain: ResultExplanation, grade: GolfGrade, seed: string): string {
  const pick = <T,>(list: T[]) => list[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % list.length];
  if (explain.standing === 'best') return pick(LEAD_BEST);
  if (explain.standing === 'close') return pick(LEAD_CLOSE)(explain.gapToBest);
  return `${RESULT_LEAD[grade]} The best five on the board was ${explain.gapToBest} points better.`;
}

function randomSeed(n: number): string {
  return `roulette-${n}-${Math.floor(Math.random() * 1e9)}`;
}

/** Top scorer of each side: "Durant 31 · Kemp 24". */
function topScorers(match: LiveGameResult): string {
  const last = match.moments[match.moments.length - 1];
  if (!last) return '';
  return ([0, 1] as const)
    .map((side) => {
      let best = 0;
      last.lines[side].forEach((l, k) => {
        if (l.pts > last.lines[side][best].pts) best = k;
      });
      return `${maskName(match.labels[side][best])} ${last.lines[side][best].pts}`;
    })
    .join(' · ');
}

function BestFiveResult({
  title,
  lineup,
  pool,
  result,
  shotsCap,
  onNewBoard,
  onReplayDaily,
  onWatch,
  daily,
  streak,
  onNextStep,
  seed,
  challenge,
  jokers,
  opponent,
  match,
  links,
}: {
  title: string;
  lineup: Lineup;
  pool: DailyPool;
  result: { score: LineupScore; targets: DailyTargets; grade: GolfGrade };
  shotsCap: number;
  onNewBoard: () => void;
  onReplayDaily?: () => void;
  onWatch?: () => void;
  daily?: string;
  streak?: Streak | null;
  onNextStep?: () => void;
  seed: string;
  challenge?: ModeChallenge;
  jokers: DailyJoker[];
  opponent?: LegendFive;
  match: LiveGameResult | null;
  links: { onMenu?: () => void; onHowTo: () => void; onSettings: () => void };
}) {
  useEffect(() => markStepDone('bestfive'), []);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { score, targets, grade } = result;
  const explain = useMemo(() => explainResult(lineup, pool, targets, shotsCap), [lineup, pool, targets, shotsCap]);
  const yourShots = useMemo(() => lineupShots(lineup), [lineup]);
  const opp = opponent?.short ?? 'AI';
  const won = match ? match.final[0] > match.final[1] : null;
  const margin = match ? Math.abs(match.final[0] - match.final[1]) : 0;
  const hits = STARTER_SLOTS.filter((s) => lineup[s]?.id === targets.optimalFive[s].id);
  const scoreLine = match ? `${match.final[0]}–${match.final[1]}` : '';
  const headline = match ? (won ? `You beat the ${opp} ${scoreLine}` : `The ${opp} beat you ${match.final[1]}–${match.final[0]}`) : 'Your five is in';

  /** The minimal daily line: date, grade, streak and the game, nothing about the five or the Joker. */
  async function copyDailyResult() {
    if (!daily) return;
    const lines = [
      `${title} · ${dayLabel(daily)}`,
      `🏀 ${GRADE_LABEL[grade]}${streak && streak.current > 0 ? ` · 🔥 ${streak.current}` : ''}`,
      ...(match && opponent ? [won ? `🏆 Beat the ${opponent.short} ${match.final[0]}–${match.final[1]}` : `❌ Lost to the ${opponent.short} ${match.final[0]}–${match.final[1]}`] : []),
      `${window.location.origin}${window.location.pathname}`,
    ];
    if (await copyLink(lines.join('\n'))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  async function challengeFriend() {
    if (await copyLink(modeChallengeLink('roulette', seed, score.composite))) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  const strongest = [...AXES].filter((a) => a.key !== 'spacing').sort((a, b) => score[b.key] - score[a.key])[0];
  const poster: PosterData = {
    daily: Boolean(daily),
    mode: daily ? 'Draw Five · daily' : 'Draw Five',
    date: daily ? new Date(`${daily}T12:00:00`) : new Date(),
    kick: match ? (daily ? `Game of the day · ${won ? 'beat' : 'lost to'} the ${opp} ${match.final[0]}–${match.final[1]}` : `Final · ${won ? 'beat' : 'lost to'} the AI ${match.final[0]}–${match.final[1]}`) : 'Final',
    head: GRADE_LABEL[grade],
    line: `${GRADE_BLURB[grade]}${match ? ` ${topScorers(match)}.` : ''}`,
    five: STARTER_SLOTS.flatMap((s) => (lineup[s] ? [{ span: lineup[s]!, num: Math.round(lineup[s]!.fga * 10) / 10 }] : [])),
    unit: 'caps',
    hidden: Boolean(daily),
    prof: AXES.map(({ key, label }) => ({ label, value: Math.round(score[key]), tone: key === explain.weakest.axis ? 'lo' : key === strongest.key ? 'hi' : undefined })),
    strip: [
      ['Your five', score.composite],
      ['Fan vote', targets.par],
      ['Best', targets.optimal],
      daily ? ['Streak', `🔥 ${streak?.current ?? 1}`] : ['Caps', `${fmtCaps(yourShots)}`],
    ],
    foot: daily ? 'One board for everyone today · your five stays hidden till tomorrow' : `Beat my ${score.composite} on the same deck · challenge link`,
  };

  const filmLines: { glyph: '+' | '−' | '!'; body: ReactNode }[] = [];
  filmLines.push({ glyph: explain.standing === 'off' ? '−' : '+', body: filmRoomLead(explain, grade, seed) });
  if (explain.standing === 'best') {
    filmLines.push({
      glyph: '+',
      body: (
        <>
          It wins on <b>{strongest.label.toLowerCase()} ({Math.round(score[strongest.key])})</b>, and every one of the five is the right card at his spot.
        </>
      ),
    });
    filmLines.push({ glyph: '!', body: <>{explain.weakest.label} ({explain.weakest.value}) is the lowest number, but that’s the deal: no five on this board gets it higher without losing more elsewhere.</> });
  } else {
    if (isChalkBoard(targets))
      filmLines.push({ glyph: '!', body: <>Chalk board: the fan-vote five ({targets.par}) {targets.optimal - targets.par <= 0 ? `already is the best five on the board (${targets.optimal})` : `was within ${targets.optimal - targets.par} of the best five (${targets.optimal})`}. Not much room to out-coach it.</> });
    else if (explain.tookLazyPick) filmLines.push({ glyph: '!', body: <>You started the five biggest names: that’s the fan-vote five ({targets.par}). The deal hid a better-fitting lineup among the role players.</> });
    const c = explain.pickCosts[0];
    if (c)
      filmLines.push({
        glyph: '−',
        body: (
          <>
            {explain.standing === 'close' ? 'The difference: ' : 'Costliest pick: '}
            <b>{maskName(c.yours)}</b> at {c.slot}. <b>{maskName(c.best)}</b> there is worth about <b>{c.cost} points</b>
            {c.axisDelta < 0 && <>, most of it on {c.axis}</>}.
          </>
        ),
      });
    filmLines.push({
      glyph: '!',
      body: explain.weakestIsBoardLimit ? (
        <>
          Your lowest number, <b>{explain.weakest.label.toLowerCase()} ({explain.weakest.value})</b>, is as high as this deal goes: the best five has {explain.bestAxes[explain.weakest.axis]} there too.
        </>
      ) : (
        <>
          Your weak spot is <b>{explain.weakest.label.toLowerCase()} ({explain.weakest.value})</b>. {explain.weakest.reason} The best five has {explain.bestAxes[explain.weakest.axis]} there.
        </>
      ),
    });
    if (explain.standing === 'off' && score.weakLink && explain.weakest.axis !== 'defense')
      filmLines.push({ glyph: '!', body: <>On defense, <b>{maskName(score.weakLink)}</b> is the one they’ll hunt, every switch, every possession.</> });
  }

  const youWin = won === null ? null : won;
  const aside = (
    <>
      <Mast title={title} daily={Boolean(daily)} sub={daily ? `${dayLabel(daily)} · final` : 'Final · against the AI (Pro)'} />
      {match ? (
        <Tally you={match.final[0]} mid="Final" ai={match.final[1]} midK="Q4 0:00" aiK={daily ? opp : 'AI'} plain />
      ) : (
        <Tally you={score.composite} mid={targets.par} ai={targets.optimal} youK="Your five" midK="Fan vote" aiK="Best" plain />
      )}
      {youWin !== null && (
        <SubNote>
          <b>{youWin ? 'You win' : 'You lose'}</b> by {margin}
        </SubNote>
      )}
      {daily && streak && (
        <section>
          <H3 note={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`}>Streak</H3>
          <StreakTrack best={streak.best} current={streak.current} />
        </section>
      )}
      {daily ? (
        <section>
          <H3>Next board</H3>
          <Kv k="New deck in" v={untilTomorrow()} />
        </section>
      ) : (
        <section>
          <H3>Your number</H3>
          <Kv k="Your five" v={score.composite} />
          <Kv k="Caps used" v={`${fmtCaps(yourShots)} / ${shotsCap}`} />
          <Kv k="Matches the best" v={`${hits.length} of 5`} />
          {challenge?.vs != null && <Kv k={`Friend’s five · ${challengeVerdict(score.composite, challenge.vs) === 'won' ? 'you win' : challengeVerdict(score.composite, challenge.vs) === 'lost' ? 'they win' : 'tied'}`} v={challenge.vs} />}
        </section>
      )}
      <Actions links={{ ...links, onMenu: undefined }}>
        {daily ? (
          <div className="btn2">
            <Btn kind="line" onClick={copyDailyResult}>
              {copied ? '✓ Copied' : 'Copy result'}
            </Btn>
            <Btn kind="line" onClick={() => setShareOpen(true)}>
              Share
            </Btn>
          </div>
        ) : (
          <>
            <Btn onClick={onNewBoard}>New board</Btn>
            <div className="btn2">
              <Btn kind="line" onClick={() => setShareOpen(true)}>
                Share
              </Btn>
              <Btn kind="line" onClick={challengeFriend}>
                {linkCopied ? '✓ Copied' : 'Challenge'}
              </Btn>
            </div>
          </>
        )}
        {onWatch && (
          <Btn kind="line" onClick={onWatch}>
            Watch the game again
          </Btn>
        )}
        {onNextStep && (
          <Btn kind="line" onClick={onNextStep}>
            Next: Mini Draft →
          </Btn>
        )}
        {onReplayDaily && (
          <Btn kind="line" onClick={onReplayDaily}>
            Play today again (testing)
          </Btn>
        )}
        {links.onMenu && (
          <Btn kind="line" onClick={links.onMenu}>
            Main menu
          </Btn>
        )}
      </Actions>
    </>
  );

  return (
    <NightGame className="d5" aside={aside} overlay={shareOpen ? <ShareNight d={poster} link={daily ? undefined : modeChallengeLink('roulette', seed, score.composite)} fileName={title} onClose={() => setShareOpen(false)} /> : undefined}>
      {daily && jokers.length > 0 && <JokerRecap jokers={jokers} lineup={lineup} />}
      <div className="headline">
        <span className="eb">{daily ? 'Game of the day' : 'Final'}</span>
        <b>{headline}</b>
        {match && <i>{topScorers(match)}</i>}
      </div>
      <div className="verdict">
        <div>
          <span className="eb">The verdict</span>
          <h2>{GRADE_LABEL[grade]}</h2>
          <p>{GRADE_BLURB[grade]}</p>
        </div>
        <div className="nums">
          <div className="you">
            <span>Your five</span>
            <b>{score.composite}</b>
          </div>
          <div>
            <span>Fan-vote</span>
            <b>{targets.par}</b>
          </div>
          <div>
            <span>Best</span>
            <b>{targets.optimal}</b>
          </div>
        </div>
      </div>
      <section>
        <H3 note="yours · the best five">Team profile</H3>
        <table className="profile">
          <tbody>
            {AXES.map(({ key, label }) => {
              const v = Math.round(score[key]);
              const b = explain.bestAxes[key as keyof typeof explain.bestAxes];
              const weak = key === explain.weakest.axis;
              const good = !weak && v >= b;
              return (
                <tr key={key} className={weak ? 'weak' : good ? 'good' : undefined}>
                  <td className="l">{label}</td>
                  <td className="v">
                    {v}
                    {weak ? <span className="visually-hidden"> weak</span> : good ? <span className="visually-hidden"> strength</span> : null}
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
      </section>
      <section className="film">
        <H3>Film room</H3>
        {filmLines.map((l, i) => (
          <p key={i}>
            <i className={l.glyph === '+' ? 'up' : l.glyph === '−' ? 'dn' : 'nt-q'}>{l.glyph}</i>
            <span>{l.body}</span>
          </p>
        ))}
      </section>
      <section>
        <H3 note={`${hits.length} of 5 match the best`}>Starting five</H3>
        <div className="cmp">
          <span className="rl">You</span>
          {STARTER_SLOTS.map((s) => (
            <MiniCard key={s} pos={s} span={lineup[s]} hit={hits.includes(s)} />
          ))}
          <span className="rl">Best</span>
          {STARTER_SLOTS.map((s) => (
            <MiniCard key={s} pos={s} span={targets.optimalFive[s]} hit={hits.includes(s)} />
          ))}
        </div>
      </section>
      <div className="phone-only stackb">
        {daily ? (
          <Btn kind="line" onClick={copyDailyResult}>
            {copied ? '✓ Copied' : 'Copy result'}
          </Btn>
        ) : (
          <Btn onClick={onNewBoard}>New board</Btn>
        )}
        <Btn kind="line" onClick={() => setShareOpen(true)}>
          Share
        </Btn>
      </div>
    </NightGame>
  );
}

function MiniCard({ pos, span, hit }: { pos: Position; span?: PlayerSpan; hit: boolean }) {
  if (!span) return <div />;
  const band = spanBand(span);
  return (
    <div className={`mini${hit ? ' hit' : ''}`} style={{ '--team': band.color, '--team-ink': band.ink } as CSSProperties}>
      <div className="top">
        <span>{band.code}</span>
        <span>{pos}</span>
      </div>
      <div className="bd">
        <NFace name={span.playerName} span={span} />
        <div style={{ minWidth: 0 }}>
          <b>{shortName(span.playerName)}</b>
          <span className="s">
            {span.spanLabel} · <CapI />
            {fmtCaps(span.fga)}
          </span>
        </div>
        {hit && <span className="ck">✓</span>}
      </div>
    </div>
  );
}

/** The day's Jokers turned over: only on your own result, never in the shared line. */
function JokerRecap({ jokers, lineup }: { jokers: DailyJoker[]; lineup: Lineup }) {
  return (
    <section className="recap">
      <H3 tone="gold">Today’s Jokers</H3>
      {jokers.map((j) => {
        const took = lineup[j.slot]?.id === j.card.id;
        const res = took ? (j.legend ? 'Jackpot' : 'Ouch') : j.legend ? 'Missed' : 'Dodged';
        return (
          <p key={j.slot}>
            <span className="jk">?</span>
            <span>
              {j.slot} Joker: <b>{maskName(j.span.playerName)}</b> {j.span.spanLabel}, {j.legend ? 'a legend' : 'a scrub'}.{' '}
              {took ? (j.legend ? 'You hit the jackpot.' : 'You drew the short straw.') : j.legend ? 'You left him on the table.' : 'You left him in the deck.'}
            </span>
            <span className={`res${res === 'Jackpot' || res === 'Dodged' ? ' g' : ''}`}>{res}</span>
          </p>
        );
      })}
    </section>
  );
}

/** Streak rewards, by the best streak (cosmetic, kept once earned). */
function StreakTrack({ best, current }: { best: number; current: number }) {
  const next = STREAK_TIERS.find((t) => best < t.days);
  const short: Record<number, string> = { 3: 'Flame', 7: 'Gold draw', 14: 'Gold frames', 30: 'Retro backs', 100: 'Hall of Fame' };
  return (
    <>
      <div className="streak">
        {STREAK_TIERS.map((t) => (
          <div key={t.days} className={best >= t.days ? 'got' : next === t ? 'next' : undefined} title={t.reward}>
            <b>{t.days}</b>
            <span>{short[t.days] ?? t.reward}</span>
          </div>
        ))}
      </div>
      {next && (
        <EmptyNote style={{ marginTop: 8 }}>
          {next.days - current === 1 ? 'One more day' : `${next.days - current} more days`}: the {next.reward.toLowerCase()}.
        </EmptyNote>
      )}
    </>
  );
}
