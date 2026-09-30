import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type ReactNode } from 'react';
import { deckSfx, deckSoundsMuted, setDeckSoundsMuted } from './deckSounds';
import './BestFive.css';
import { ChallengeNote, ScoreBoard } from './ScoreBoard';
import { ScoreChip } from './ResultsScreen';
import ShareResultModal from './ShareResultModal';
import { clearDailyResult, DAILY_REPLAY_FOR_TESTING, currentStreak, dailySeed, recordDailyResult, savedDailyLineup, streakRewardClasses, untilTomorrow, localDayKey, STREAK_TIERS, type Streak } from './dailyProgress';
import { dailyMeta, DAILY_HAND_SIZE, JOKERS_MAX, JOKERS_MIN, type LegendFive } from '../engine/dailyMeta';
import { expectedMargin, headToHeadMargin, legendLineup, simulateLiveGame, type LiveGameResult } from '../engine/liveGame';
import LiveGame from './LiveGame';
import { copyLink } from './shareSave';
import { modeChallengeLink, type ModeChallenge } from '../modeChallenge';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS } from '../engine/positions';
import { CapIcon, Face, ShotChip, ShotsMeter, shortenName } from './ShotChip';
import { DraftPlayerCard } from './DraftPlayerCard';
import { markStepDone } from './pathProgress';
import {
  dailyBoard,
  lineupShots,
  scoreLineup,
  gradeVsPar,
  explainResult,
  isChalkBoard,
  GRADE_LABEL,
  GRADE_BLURB,
  WEIGHTED_AXES,
  AXIS_GLOSSARY,
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

interface Props {
  mode: 'developer' | 'player';
  /** Return to the host app's intro. Omitted in the standalone web export, where the "← Back"
   * control is simply not rendered. */
  onBack?: () => void;
  /** The next step of the learning path (Quick 5), offered on the result screen. */
  onNextStep?: () => void;
  /** A friend's "Challenge a friend" link: their deal and their score. */
  challenge?: ModeChallenge;
  /** The Daily Slot Machine: today's local date. One board for everyone, one attempt, a streak. */
  daily?: string;
  /** Testing: a day other than today — played, never recorded. */
  testDay?: boolean;
  /** Testing: step to the next date's daily board. */
  onAnotherDay?: () => void;
}

/** The deal hint, by what the five so far is missing (`dealHint`). Never names the card. */
const DEAL_HINT: Record<DealNeed, (have: number) => string> = {
  shooting: (have) => (have === 0 ? 'No shooters yet — one of these four can space the floor.' : 'One shooter so far — this deal has another.'),
  defense: (have) => (have === 0 ? 'Nobody who can guard yet — one of these four can.' : 'One stopper so far — this deal has a second.'),
  creation: () => 'Nobody creates his own shot yet — one of these four can.',
};

/** "2026-09-28" → "Sep 28". */
function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const SLOT_LABEL: Record<Position, string> = { PG: 'Point guard', SG: 'Shooting guard', SF: 'Small forward', PF: 'Power forward', C: 'Center' };

const AXES: { key: keyof Pick<LineupScore, 'talent' | 'offense' | 'defense' | 'spacing' | 'fit'>; label: string; context?: boolean }[] = [
  { key: 'talent', label: 'Talent' },
  { key: 'offense', label: 'Offense' },
  { key: 'defense', label: 'Defense' },
  { key: 'spacing', label: 'Spacing', context: true },
  { key: 'fit', label: 'Fit' },
];

/**
 * Roulette (was "Build the Best 5" / Daily Deal) — pick one player per position from a
 * random deal, blind-submit, then see a golf-style grade against the engine's own
 * best lineup from that pool. See `engine/bestFive.ts` for the pool generation, the 5-man
 * scoring (a synthetic `Team` scored on the engine's real axes) and the par bands.
 *
 * Deliberately a standalone screen off the intro (same footing as `CapSheet` / `DraftPoolBrowser`)
 * — it has no draft, no lottery, no AI, none of `GameShell`'s phase machine applies.
 */
export default function BestFive({ onBack, onNextStep, challenge, daily, testDay, onAnotherDay }: Props) {
  // 2026-09-27, the user: "Usuńmy daily challenge. Dodamy go osobnym przyciskiem jak będziemy
  // robić porządnie daily challenge". Every board is a fresh random deal; the old daily puzzle and
  // streak (bestFiveProgress.ts) are in git history for when the daily challenge gets built.
  const [board, setBoard] = useState<{ seed: string; n: number }>(() => ({ seed: daily ? dailySeed(daily) : challenge?.seed ?? randomSeed(1), n: 1 }));
  // 2026-09-11, user's own ask: "dodajemy koszt gracza w shots i oprócz codziennej puli graczy
  // będzie losowa liczba między 60 a 90" — a seeded shots budget for the five starters.
  // 2026-09-27: pool and cap come together from `dailyBoard`, which skips boards where the five
  // biggest names are already about the best answer (see its docstring).
  // 2026-09-28, Daily Slot Machine 2.0: the daily board has its own position order, a Joker and an
  // opponent (`dailyMeta` / `dailyGame`); a random board keeps PG→C and no Joker.
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
  const isJokerCard = (span: PlayerSpan) => jokers.some((j) => j.card.id === span.id && j.slot === span.primaryPosition);
  // Streak rewards (cosmetic): the gold lever, gold reel frames and retro card backs, by best streak.
  const rewardClasses = useMemo(() => streakRewardClasses(currentStreak(daily ?? localDayKey()).best), [daily]);
  /** The live game: the daily plays the opponent of the day, a regular board the AI's five. The
   * same fives on the same seed play the same game. */
  const matchFor = (l: Lineup, ai: Lineup): LiveGameResult | null => {
    const seedOf = `${board.seed}:${STARTER_SLOTS.map((s) => l[s]?.id).join(',')}`;
    if (meta) {
      const legends = legendLineup(meta.opponent);
      if (!legends) return null;
      const tookJoker = jokers.find((j) => l[j.slot]?.id === j.card.id);
      return simulateLiveGame(l, legends, expectedMargin(l, fanVoteFive(pool, shotsCap), legends), seedOf, tookJoker?.span.id);
    }
    if (!STARTER_SLOTS.every((s) => ai[s])) return null;
    return simulateLiveGame(l, ai, headToHeadMargin(l, ai), seedOf);
  };

  // 2026-09-28: each position shows DEAL_SIZE of its pool, dealt for the five so far. The grade is
  // against `boardTargets` — the same fan-vote five and best five for every path through the seed.
  function resultFor(l: Lineup, p: DailyPool, cap: number) {
    const score = scoreLineup(l);
    const board = boardTargets(p, cap);
    // 2026-09-30, the user ("your five lepsze od the best on the board?"): a five can beat the
    // engine's search — with a Joker, a card the deal topped up from outside the board, or one the
    // search missed. Then that five is the best on the board.
    const targets = score.composite > board.optimal ? { ...board, optimal: score.composite, optimalFive: l as Record<Position, PlayerSpan> } : board;
    return { score, targets, grade: gradeVsPar(score.composite, targets.par, targets.optimal) };
  }
  // The daily board already played today opens straight on its result.
  // While testing, a daily always opens on a fresh board.
  const savedDaily = useMemo(() => (daily && !DAILY_REPLAY_FOR_TESTING ? savedDailyLineup(daily, pool, spanById) : null), [daily, pool]);
  const [lineup, setLineup] = useState<Lineup>(() => savedDaily ?? {});
  const [activeSlot, setActiveSlot] = useState<Position | null>(savedDaily ? null : order[0]);
  const [streak, setStreak] = useState<Streak | null>(() => (daily ? currentStreak(daily) : null));
  const [match, setMatch] = useState<LiveGameResult | null>(() => (savedDaily ? matchFor(savedDaily, {}) : null));
  // 2026-09-30, Draw Five vs the AI: the AI drafts its own five from the same deck — each round it
  // gets the four cards of the position that didn't come to you.
  const [aiLineup, setAiLineup] = useState<Lineup>({});
  // The AI's last round: the hand it drew and the card it took (animated like yours).
  const [aiLog, setAiLog] = useState<{ slot: Position; hand: PlayerSpan[]; took: string } | null>(null);
  // The daily Joker of the round just played, turned over once a card was picked.
  const [jokerReveal, setJokerReveal] = useState<{ joker: DailyJoker; took: boolean } | null>(null);
  // Submitted in this visit: the game plays live. A daily reopened later opens on its final.
  const [justSubmitted, setJustSubmitted] = useState(false);
  // 2026-09-26, the user: "ograniczmy wybór do 5 graczy. Niech po każdym wyborze gracz widzi jacy
  // gracze się losują." Positions are dealt one at a time: a slot's five stay face down until the
  // pick before it, then spin in on the slot machine (`freshSlot`, once per slot).
  const [revealed, setRevealed] = useState<Set<Position>>(() => new Set(savedDaily ? STARTER_SLOTS : [order[0]]));
  const [freshSlot, setFreshSlot] = useState<Position | null>(savedDaily ? null : order[0]);
  const [result, setResult] = useState<{ score: LineupScore; targets: DailyTargets; grade: GolfGrade } | null>(() =>
    savedDaily ? resultFor(savedDaily, pool, shotsCap) : null,
  );
  // 2026-09-17, user's own ask: a real "how to play?" affordance on every mode, now that the
  // intro screen's own always-visible rules list is gone.
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  /** The picks made before `slot` in the day's order. */
  const picksBefore = (slot: Position): Lineup => {
    const before: Lineup = {};
    for (const s of order.slice(0, order.indexOf(slot))) if (lineup[s]) before[s] = lineup[s];
    return before;
  };
  /** A position's deal: fixed by the picks before it (positions go in order, picks are final). The
   * daily deals five, one of them a face-down Joker in his rounds. */
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

  // 2026-09-27, the user ("kolejna rzecz, która doda sporo emocji. Nie można cofnąć picku"): a
  // pick is final — no clearing, no re-opening a filled position. So a player who would leave the
  // positions still open unfillable under the cap (even at their cheapest dealt option) can't be
  // taken; his card says by how much he's over.
  // 2026-09-30, the user ("nie powinno mnie blokować"): what the open positions must still cost is
  // their cheapest player in the whole game — the later deals top up to fit (`dealFor`).
  const cheapestLeft = (except: Position) => STARTER_SLOTS.filter((s) => s !== except && !lineup[s]).reduce((sum, s) => sum + slotFloor(s), 0);
  const overBy = (slot: Position, span: PlayerSpan) => shotsUsed + span.fga + cheapestLeft(slot) - shotsCap;

  function pick(slot: Position, span: PlayerSpan) {
    if (lineup[slot] || overBy(slot, span) > 1e-9) return;
    setLineup((prev) => ({ ...prev, [slot]: span }));
    deckSfx.pick();
    if (!daily) aiTakes(slot);
    const j = jokerAt(slot);
    setJokerReveal(j ? { joker: j, took: span.id === j.card.id } : null);
    // Advance to the next still-empty slot, in the board's order; the picker closes after the last
    // one. A slot seen for the first time gets dealt.
    const nextEmpty = order.find((s) => s !== slot && !lineup[s]);
    if (nextEmpty && !revealed.has(nextEmpty)) {
      setRevealed((prev) => new Set(prev).add(nextEmpty));
      setFreshSlot(nextEmpty);
    } else {
      setFreshSlot(null);
    }
    setActiveSlot(nextEmpty ?? null);
  }

  /** The AI's pick at `slot`: from the position's cards that didn't come to you, the one that makes
   * its five best while leaving room for the rest. It can't know which four of a later position will
   * come to you, so it counts on the fifth cheapest of the eight — the dearest its cheapest card
   * could be — and never goes over the cap. */
  function aiTakes(slot: Position) {
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
    setAiLog({ slot, hand, took: choice.id });
  }

  function submit() {
    if (!complete || overCap) return;
    const next = resultFor(lineup, pool, shotsCap);
    setResult(next);
    const match = matchFor(lineup, aiLineup);
    setMatch(match);
    setJustSubmitted(true);
    if (daily) {
      if (testDay) return;
      setStreak(
        recordDailyResult(daily, lineup, next.grade, next.score.composite, {
          game: match && meta ? { you: match.final[0], them: match.final[1], opponent: meta.opponent.short } : undefined,
          jokers: jokers.map((j) => ({ name: j.span.playerName, legend: j.legend, slot: j.slot })),
        }),
      );
    }
  }

  function resetPicks() {
    setLineup({});
    setAiLineup({});
    setAiLog(null);
    setJokerReveal(null);
    setMatch(null);
    setJustSubmitted(false);
    setActiveSlot(order[0]);
    setRevealed(new Set([order[0]]));
    setFreshSlot(order[0]);
    setResult(null);
  }

  /** Testing only (`DAILY_REPLAY_FOR_TESTING`): play today's daily board again from the start. */
  function replayDaily() {
    if (!daily) return;
    setStreak(clearDailyResult(daily));
    setMatch(null);
    resetPicks();
  }

  /** A fresh random deal. */
  function newBoard() {
    setBoard((b) => ({ seed: randomSeed(b.n + 1), n: b.n + 1 }));
    resetPicks();
  }

  return (
    <div className={`at-shell best-five ${rewardClasses}`}>
      {/* 2026-09-27 UI audit: the same "← Menu" in the top corner as the drafts (was "← Back" on
          the right next to "How to play?", with a "Board #n" nobody needed). */}
      {onBack && (
        <button type="button" className="at-menu-btn at-cond" onClick={onBack}>
          ← Menu
        </button>
      )}
      <div className="at-board-brand at-cond">{daily ? 'Daily Draw Five' : 'Draw Five'}</div>
      {daily && (
        <p className="bf-daily-sub">
          {formatDay(daily)} · one board for everyone, one try
          {streak && streak.current > 0 && <> · 🔥 {streak.current}-day streak</>}
          {streak && streak.best >= 100 && <span className="bf-hof-plaque at-cond">Hall of Fame</span>}
        </p>
      )}
      {onAnotherDay && (
        <p className="bf-daily-test">
          Testing{testDay ? ` · board for ${formatDay(daily ?? '')}, not recorded` : ''} ·{' '}
          <button type="button" className="at-legend-toggle at-cond" onClick={onAnotherDay}>
            Another day’s board →
          </button>
        </p>
      )}
      {daily && meta && !result && <DailyIntro opponent={meta.opponent} order={order} />}
      <div className="bf-subhead">
        <span className="bf-subhead-actions">
          <button className="at-legend-toggle at-cond" onClick={() => setShowHowToPlay((v) => !v)}>
            {showHowToPlay ? 'Hide how to play' : 'How to play?'}
          </button>
        </span>
      </div>

      {showHowToPlay && (
        <ol className="how-to-play-panel">
          <li><b>Draw five.</b> One player per position — PG/SG/SF/PF/C. The deck is shuffled as the game loads; each position you draw four cards off it, pick one, and the next position comes up. Picks are final: no going back. When the five you have is missing something, a hint says this hand can cover it.</li>
          <li><b>Caps.</b> Every player costs caps — his shots per game in those years. Your five have to fit under the board’s cap, shown by the meter above it.</li>
          <li><b>Submit once.</b> No re-picking after you see your score.</li>
          <li><b>Grading.</b> You’re scored on talent, offense, defense, spacing, and fit, then compared against the fan-vote five (the five biggest names) and the best five on the board.</li>
          {daily ? (
            <>
              <li><b>Today’s order.</b> The daily board deals the positions in its own order, a different one every day.</li>
              <li><b>Jokers.</b> The daily deals five cards a position. In {JOKERS_MIN} to {JOKERS_MAX} of the rounds one of them is a face-down Joker at the position’s middle price: even odds a legend or a scrub. You only find out who he is when you pick him.</li>
              <li><b>Game of the day.</b> Your five then plays a legendary team, live. The engine decides who’s better — beat the five biggest names on the board and you’ll usually beat them too.</li>
            </>
          ) : (
            <>
              <li><b>Against the AI.</b> The AI drafts its own five from the same deck under the same cap: each position it gets the four cards that didn’t come to you. Then the two fives play a live game.</li>
              <li><b>New deck.</b> Every new board is a fresh shuffle.</li>
            </>
          )}
        </ol>
      )}

      {!result && (
        <div className="at-card">
          <ShotsMeter used={shotsUsed} cap={shotsCap} />
          {/* 2026-09-27 UI audit: one line instead of an intro paragraph plus a caps note that both
              explained the board — the slot machine now sits higher on a phone. */}
          <p className="bf-caps-note">
            <CapIcon /> One player per position; each costs his shots per game in caps. The biggest names usually
            aren’t the answer — spacing and rim protection matter.
          </p>


          {/* 2026-09-28, the user ("pozycje niech będą ustawione w zwykłej kolejności ale losowanie
              nadal losowe"): the row stays PG→C; the daily board still deals them in its own order. */}
          {!daily && <AiFive lineup={aiLineup} cap={shotsCap} log={aiLog} />}
          <div className="bf-slot-row">
            {STARTER_SLOTS.map((slot) => {
              const s = lineup[slot];
              const dealt = revealed.has(slot);
              return (
                <button
                  key={slot}
                  className={`bf-slot ${activeSlot === slot ? 'bf-slot--active' : ''} ${s ? 'bf-slot--filled' : ''} ${dealt ? '' : 'bf-slot--hidden'}`}
                  disabled={!dealt || Boolean(s)}
                  title={s ? `${s.playerName} — picks are final` : dealt ? undefined : 'Dealt after your previous pick'}
                  onClick={() => {
                    setFreshSlot(null);
                    setActiveSlot(slot);
                  }}
                >
                  <span className="bf-slot-pos at-cond">
                    {slot}
                    {s && isJokerCard(s) && <span className="bf-slot-joker" title="A Joker">🃏</span>}
                  </span>
                  {s ? <Face name={s.playerName} /> : <span className={`bf-face bf-face--sm bf-face--empty${dealt ? '' : ' bf-face--card'}`} aria-hidden />}
                  <span className="bf-slot-name">{s ? shortenName(s.playerName, 0) : dealt ? 'Tap to pick' : 'Face down'}</span>
                  {s && <span className="bf-season bf-season--sm">{s.spanLabel}</span>}
                  {s && (
                    <span className="bf-slot-box">
                      <ShotChip fga={s.fga} cap={shotsCap} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {activeSlot && (
            <div className="bf-picker">
              <div className="bf-picker-head at-cond">
                Your draw · {SLOT_LABEL[activeSlot].toLowerCase()}
                <span className="bf-picker-sub">
                  {order.indexOf(activeSlot) < order.length - 1
                    ? 'Four off the deck for this spot — picks are final, the next position comes up after you pick.'
                    : 'Last spot — four off the deck. Picks are final.'}
                </span>
              </div>
              {(() => {
                // 2026-09-28: the one hint left — what the five is missing, when this deal can cover it.
                const hint = dealHint(pool, activeSlot, picksBefore(activeSlot), shotsCap);
                if (!hint) return null;
                return <p className="bf-deal-hint">{DEAL_HINT[hint.need](hint.have)}</p>;
              })()}
              {jokerReveal && <JokerReveal {...jokerReveal} />}
              <DeckHand
                key={`${pool.key}-${activeSlot}`}
                slot={activeSlot}
                cards={dealOf(activeSlot)}
                fresh={freshSlot === activeSlot}
                onDone={() => setFreshSlot(null)}
                renderCard={(span) => {
                  const chosen = lineup[activeSlot]?.id === span.id;
                  const over = overBy(activeSlot, span);
                  const blocked = over > 1e-9;
                  // 2026-09-30: a Joker lies face down — who he is shows only once he's picked.
                  if (jokerAt(activeSlot)?.card.id === span.id) {
                    return (
                      <button
                        className={`bf-pool-card bf-joker-card${blocked ? ' is-locked' : ''}`}
                        title="A Joker: even odds a legend or a scrub"
                        disabled={blocked}
                        onClick={() => pick(activeSlot, span)}
                      >
                        <span className="bf-joker-tag at-cond">🃏 Joker</span>
                        <span className="bf-joker-q" aria-hidden>?</span>
                        <span className="bf-pool-name">Legend or scrub?</span>
                        <span className="bf-pool-meta">
                          <ShotChip fga={span.fga} cap={shotsCap} />
                        </span>
                        <span className="bf-pool-box">50 / 50</span>
                      </button>
                    );
                  }
                  // 2026-09-30, the user ("karty żeby wyglądały tak samo jak w każdym trybie"): the
                  // draft card of every mode, dealt blind — the team band on top, no tier frame, no
                  // TAL, no position (the picker names it); the whole card is the pick.
                  return (
                    <DraftPlayerCard
                      blind
                      span={span}
                      cap={shotsCap}
                      tier="Starter"
                      legal={!blocked}
                      onDraft={() => pick(activeSlot, span)}
                      className={`bf-deal-card${chosen ? ' bf-pool-card--chosen' : ''}${blocked ? ' bf-pool-card--blocked' : ''}`}
                      title={blocked ? `${span.playerName} would leave no room under the cap` : span.playerName}
                    >
                      <span className="bf-card-sheen" aria-hidden />
                      <span className="bf-card-glare" aria-hidden />
                      {blocked && <span className="bf-pool-over at-cond">Over the cap by {over.toFixed(1)}</span>}
                    </DraftPlayerCard>
                  );
                }}
              />
            </div>
          )}

          <div className="bf-submit-row">
            <button
              className="at-draft-btn bf-submit"
              disabled={!complete || overCap}
              title={overCap ? `Over the ${shotsCap}-cap limit.` : undefined}
              onClick={submit}
            >
              Submit lineup
            </button>
            <span className={`bf-submit-hint${complete && !overCap ? ' is-ready' : ''}`} role="status">
              {overCap
                ? `Over the cap by ${(shotsUsed - shotsCap).toFixed(1)}.`
                : complete
                  ? 'Ready to submit.'
                  : `Pick ${5 - filledCount} more to submit.`}
            </span>
          </div>
        </div>
      )}

      {result && (
        <BestFiveResult
          lineup={lineup}
          pool={pool}
          result={result}
          shotsCap={shotsCap}
          onNewBoard={newBoard}
          onReplayDaily={daily && DAILY_REPLAY_FOR_TESTING ? replayDaily : undefined}
          daily={daily}
          streak={streak}
          onNextStep={onNextStep}
          seed={board.seed}
          challenge={challenge && challenge.seed === board.seed ? challenge : undefined}
          jokers={jokers}
          opponent={meta?.opponent ?? aiOpponent(aiLineup)}
          match={match}
          fresh={justSubmitted}
        />
      )}
    </div>
  );
}

/** Milliseconds between two cards leaving the deck, and one card's flight (land + turn over). */
// 2026-09-30, the user ("ZA SZYBKO"): slowed from 170 / 640 ms.
const DEAL_STEP_MS = 480;
const DEAL_FLIGHT_MS = 950;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * One dealt card. 2026-09-30, the user chose deal animation A from the card-motion mockup: the card
 * leaves the deck face down, flies to its place and turns over as it lands.
 */
function DealtCard({ pile, fly, children }: { pile: RefObject<HTMLDivElement | null>; fly: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const from = pile.current;
    if (!fly || !el || !from || typeof el.animate !== 'function') return;
    const a = from.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const scale = Math.min(1, a.width / Math.max(1, b.width));
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(-6deg)` },
        { transform: 'translate(0, 0) scale(1) rotate(0deg)', offset: 0.55 },
        { transform: 'scaleX(0.02)', offset: 0.7 },
        { transform: 'none' },
      ],
      { duration: DEAL_FLIGHT_MS, easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)' },
    );
    backRef.current?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.69 }, { opacity: 0, offset: 0.7 }, { opacity: 0 }], { duration: DEAL_FLIGHT_MS, fill: 'none' });
    deckSfx.deal();
    const flip = window.setTimeout(() => deckSfx.flip(), DEAL_FLIGHT_MS * 0.62);
    return () => window.clearTimeout(flip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className={`bf-hand-face${fly ? ' is-dealt' : ''}`}>
      {children}
      <span ref={backRef} className="bf-fly-back" aria-hidden />
    </div>
  );
}

/** 2026-09-30, the user chose the fanned hand: each card turned a little and set on an arc. */
function fanStyle(i: number, n: number): CSSProperties {
  const mid = (n - 1) / 2;
  return { '--r': `${(i - mid) * 3}deg`, '--y': `${Math.round((i - mid) * (i - mid) * 4)}px` } as CSSProperties;
}

/** The table's sound switch (remembered in this browser). */
function SoundToggle() {
  const [muted, setMuted] = useState(deckSoundsMuted);
  return (
    <button
      type="button"
      className="bf-sound-btn"
      aria-pressed={muted}
      title={muted ? 'Sound off' : 'Sound on'}
      onClick={() => {
        setDeckSoundsMuted(!muted);
        setMuted(!muted);
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

/**
 * 2026-09-30, the user (Draw Five: "zmieniamy slot machine na deck kart"): a position's cards come
 * off the deck — the hand waits face down until "Draw", then each card flies from the deck and turns
 * over (deal animation A). The mechanics are the slot machine's (a reactive deal per position, picks
 * final); only the table changed. A position you come back to shows its cards face up. Reduced
 * motion deals them face up at once.
 */
function DeckHand({
  slot,
  cards,
  fresh,
  onDone,
  renderCard,
}: {
  slot: Position;
  /** The position's deal (`dealFor`; five cards in the daily). */
  cards: PlayerSpan[];
  /** First visit to this position: the hand waits face down for "Draw". */
  fresh: boolean;
  onDone: () => void;
  renderCard: (span: PlayerSpan) => ReactNode;
}) {
  const pile = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(fresh ? 0 : cards.length);
  const [drawing, setDrawing] = useState(false);
  // Every card has landed and turned over (the last one flies a moment after it leaves the deck).
  const [settled, setSettled] = useState(!fresh);
  useEffect(() => {
    if (fresh && prefersReducedMotion()) {
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
      }, DEAL_FLIGHT_MS);
      return () => window.clearTimeout(t);
    }
    // The last card waits a beat longer — a little suspense.
    const t = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 250 : shown === cards.length - 1 ? DEAL_STEP_MS + 350 : DEAL_STEP_MS);
    return () => window.clearTimeout(t);
  }, [drawing, shown, cards.length, onDone]);
  const allUp = shown >= cards.length && settled;
  return (
    <div className={`bf-deck${allUp ? ' is-open' : ''}`}>
      <div className="bf-deck-table">
        <div className={`bf-hand${cards.length > 4 ? ' is-5' : ''}`}>
          {cards.map((card, i) => (
            <div
              key={card.id}
              className="bf-hand-card"
              style={fanStyle(i, cards.length)}
              onMouseMove={(e) => {
                // Premium cards catch the light where the pointer is.
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
                e.currentTarget.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
              }}
            >
              {i < shown ? (
                <DealtCard pile={pile} fly={drawing}>
                  {renderCard(card)}
                </DealtCard>
              ) : (
                <div className="bf-hand-back" aria-hidden />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="bf-deck-foot" aria-live="polite">
        <div className="bf-pile" ref={pile} aria-hidden>
          <span />
          <span />
          <span />
        </div>
        {fresh && !drawing && !allUp ? (
          <button
            type="button"
            className="primary-btn bf-draw-btn"
            onClick={() => {
              deckSfx.shuffle();
              setDrawing(true);
            }}
          >
            Draw {cards.length} {SLOT_LABEL[slot].toLowerCase()}s
          </button>
        ) : !allUp ? (
          <span>Dealing…</span>
        ) : (
          <span>Pick one — picks are final.</span>
        )}
        <SoundToggle />
      </div>
    </div>
  );
}

/** 2026-09-11, user-reported live: "why powinno być ciekawsze, nie że silnik ocenia tak i tak" —
 * the detail lines below were already real, plain-spoken sentences, not engine-speak; what was
 * missing was a single narrative lead tying the grade to the actual STORY of the board before the
 * bullet-by-bullet breakdown starts — the same job the grade banner's own blurb does for the
 * headline number. One line, keyed off the grade itself, not a repeat of any line below it. */
const RESULT_LEAD: Record<GolfGrade, string> = {
  eagle: 'You out-scouted everyone on a board that had a real trap to avoid.',
  birdie: 'You saw past the obvious five — here’s where you won the matchup.',
  par: 'A safe, sensible five. Here’s the upside you left on the bench.',
  bogey: 'Something in this five is fighting itself — here’s what the tape shows.',
  'double-bogey': 'This five doesn’t play as a team yet — here’s where it breaks down.',
};

/**
 * The film room's first line. 2026-09-28, the user ("opisy nic nie mówią bo są zbyt podobne"): it
 * used to be one fixed sentence per grade. It now follows how close the five is to the best five on
 * the board, names the gap, and rotates between a few wordings by the board's seed.
 */
const LEAD_BEST = [
  'Nobody builds a better five from this deal — this is the best team on the board.',
  'You found the best five the deal had. There’s nothing on the tape to fix.',
  'Best team on the board. Every card you passed on would have made it worse.',
  'That’s the five the film room would have drawn up. Hang the banner.',
];
const LEAD_CLOSE = [
  (gap: number) => `${gap} points off the best five on the board — one decision away from it.`,
  (gap: number) => `Nearly the best team on the board: ${gap} points short, and it comes down to one spot.`,
  (gap: number) => `A good five, ${gap} points behind the best one the deal had.`,
];
function filmRoomLead(explain: ResultExplanation, grade: GolfGrade, seed: string): string {
  const pick = <T,>(list: T[]) => list[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % list.length];
  if (explain.standing === 'best') return pick(LEAD_BEST);
  if (explain.standing === 'close') return pick(LEAD_CLOSE)(explain.gapToBest);
  return `${RESULT_LEAD[grade]} The best five on the board was ${explain.gapToBest} points better.`;
}

function CmpCell({ span, tone }: { span: PlayerSpan | null | undefined; tone: 'hit' | 'miss' | 'best' }) {
  if (!span) return <span />;
  return (
    <span className={`bf-cmp-cell bf-cmp-cell--${tone}`}>
      <span className="bf-cmp-name">{span.playerName}</span>
      <span className="bf-cmp-season">{span.spanLabel}</span>
    </span>
  );
}

function randomSeed(n: number): string {
  return `roulette-${n}-${Math.floor(Math.random() * 1e9)}`;
}

/** The draft finish tiers' colour tone for each Slot Machine grade (same words, same colours). */
const GRADE_TONE: Record<GolfGrade, 1 | 2 | 3 | 4 | 5 | 6> = { eagle: 6, birdie: 5, par: 4, bogey: 3, 'double-bogey': 2 };

function BestFiveResult({
  lineup,
  pool,
  result,
  shotsCap,
  onNewBoard,
  onReplayDaily,
  daily,
  streak,
  onNextStep,
  seed,
  challenge,
  jokers,
  opponent,
  match,
  fresh,
}: {
  lineup: Lineup;
  pool: DailyPool;
  result: { score: LineupScore; targets: DailyTargets; grade: GolfGrade };
  shotsCap: number;
  onNewBoard: () => void;
  onReplayDaily?: () => void;
  daily?: string;
  streak?: Streak | null;
  onNextStep?: () => void;
  seed: string;
  challenge?: ModeChallenge;
  jokers?: DailyJoker[];
  opponent?: LegendFive;
  match?: LiveGameResult | null;
  /** Just submitted (the game plays live); a daily reopened later shows its final straight away. */
  fresh?: boolean;
}) {
  useEffect(() => markStepDone('bestfive'), []);
  const [copied, setCopied] = useState(false);
  const [gameOver, setGameOver] = useState(!(fresh && match));
  /** 2026-09-28, the user chose the minimal share: date, grade, streak and the game — nothing about
   * the five or the Joker, so it spoils nothing for anyone who hasn't played today. */
  async function copyDailyResult() {
    if (!daily) return;
    const lines = [
      `Daily Draw Five · ${formatDay(daily)}`,
      `🏀 ${GRADE_LABEL[result.grade]}${streak && streak.current > 0 ? ` · 🔥 ${streak.current}` : ''}`,
      ...(match && opponent ? [match.final[0] > match.final[1] ? `🏆 Beat the ${opponent.short} ${match.final[0]}–${match.final[1]}` : `❌ Lost to the ${opponent.short} ${match.final[0]}–${match.final[1]}`] : []),
      `${window.location.origin}${window.location.pathname}`,
    ];
    if (await copyLink(lines.join('\n'))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  const [shareOpen, setShareOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  async function challengeFriend() {
    if (await copyLink(modeChallengeLink('roulette', seed, result.score.composite))) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }
  const { score, targets, grade } = result;
  const explain = useMemo(
    () => explainResult(lineup, pool, targets, shotsCap),
    [lineup, pool, targets, shotsCap],
  );
  const [showGlossary, setShowGlossary] = useState(false);
  const yourShots = useMemo(() => lineupShots(lineup), [lineup]);

  const weightsLine = WEIGHTED_AXES.map((a) => `${a.pct}% ${a.label}`).join(' · ');
  // Strongest axes against the field of this deal: the best five's own value is the yardstick.
  const [strongest, secondStrongest] = [...WEIGHTED_AXES].sort((a, b) => score[b.key] - score[a.key]);
  const chalkGap = targets.optimal - targets.par;

  return (
    <div className="at-card bf-result">
      {match && opponent && <LiveGame game={match} opponent={opponent} autoStart={Boolean(fresh)} onFinish={() => setGameOver(true)} />}
      {/* 2026-09-30, the user ("wynik widoczny po meczu"): the grade, the numbers and the film room
          wait until the game has been played (or skipped). */}
      {gameOver && (
        <>
      {daily && jokers && <JokerRecap jokers={jokers} lineup={lineup} />}
      {/* 2026-09-27, the user: "wynik nie pokazuje od razu" — grade and the three numbers land
          together in one scoreboard, no staged wait. */}
      <div className={`bf-grade bf-grade--${grade}`}>
        <div className="bf-grade-top">
          <span className="bf-grade-label at-cond">{GRADE_LABEL[grade]}</span>
          <span className="bf-grade-blurb">{GRADE_BLURB[grade]}</span>
        </div>
        <ScoreBoard
          cells={[
            { label: 'Your five', value: score.composite, you: score.composite },
            { label: 'Fan-vote five', value: targets.par, title: 'The five biggest names in the deal' },
            { label: 'Best on the board', value: targets.optimal },
          ]}
          note={
            <>
              <CapIcon /> {Math.round(yourShots)} / {shotsCap} caps · fan-vote five = the five biggest names
              {challenge?.vs != null && (
                <>
                  <br />
                  <ChallengeNote yours={score.composite} theirs={challenge.vs} />
                </>
              )}
            </>
          }
        />
        <div className="results-hero-actions">
          <button type="button" className="results-hero-copy" onClick={() => setShareOpen(true)}>
            📤 Share the result
          </button>
          {daily && (
            <button type="button" className="results-hero-copy" onClick={copyDailyResult} title="Copies a spoiler-free line: date, grade, streak and the game">
              {copied ? '✓ Copied' : '📋 Copy result'}
            </button>
          )}
          <button
            type="button"
            className="results-hero-copy results-hero-challenge"
            onClick={challengeFriend}
            title="Copies a link that deals a friend the exact same Draw Five deck, with your score to beat."
          >
            {linkCopied ? '✓ Link copied' : '🔗 Challenge a friend'}
          </button>
        </div>
      </div>
      {shareOpen && (
        <ShareResultModal
          onClose={() => setShareOpen(false)}
          mode="Draw Five"
          title={daily ? `Daily Draw Five · ${formatDay(daily)}` : 'My Draw Five'}
          tier={{ label: GRADE_LABEL[grade], tone: GRADE_TONE[grade] }}
          cells={[
            { label: 'Your five', value: score.composite, you: score.composite },
            { label: 'Fan-vote five', value: targets.par },
            { label: 'Best on the board', value: targets.optimal },
          ]}
          chips={AXES.map(({ key, label }) => ({ label, value: Math.round(score[key]) }))}
          five={STARTER_SLOTS.flatMap((slot) => {
            const p = lineup[slot];
            return p ? [{ slot, name: p.playerName, years: p.spanLabel }] : [];
          })}
        />
      )}

      {/* 2026-09-28 playtest: the same "Team profile" tiles as the Mini and All-Time results
          (they were bars here, tiles there, for the same five numbers). */}
      <div className="bf-bars results-hero-scores">
        <span className="share-modal-face-group-label">Team profile</span>
        <div className="results-hero-scores-row results-hero-scores-row--5">
          {AXES.map(({ key, label }) => (
            <ScoreChip key={key} label={label} value={Math.round(score[key])} />
          ))}
        </div>
        {/* 2026-09-28, the user: the numbers read against what this deal allowed — the best five's
            own value under each of yours. */}
        <div className="results-hero-scores-row results-hero-scores-row--5 bf-axis-best" aria-label="Best five on the board">
          {AXES.map(({ key }) => (
            <span key={key} title="The best five on the board">vs {explain.bestAxes[key as keyof typeof explain.bestAxes]}</span>
          ))}
        </div>
        <p className="bf-weights at-cond">
          Score = {weightsLine}. Spacing is diagnostic — it feeds Offense and Fit.
          <button className="bf-glossary-toggle at-cond" onClick={() => setShowGlossary((v) => !v)}>
            {showGlossary ? 'hide' : 'what do these mean?'}
          </button>
        </p>
        {showGlossary && (
          <dl className="bf-glossary">
            {AXIS_GLOSSARY.map((g) => (
              <div key={g.label}>
                <dt>{g.label}</dt>
                <dd>{g.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* 2026-09-28, the user: "im lepiej tym bardziej w stronę pochwał". The film room's tone
          follows how close the five is to the best five on the board: matching it gets praise and
          the deal's own ceiling instead of a weakness; close gets praise plus the one pick that
          made the difference; further off keeps the breakdown, now naming what each pick cost. */}
      <div className="bf-why">
        <div className="bf-why-head at-cond">Film room</div>
        <p className="bf-why-line bf-why-lead">{filmRoomLead(explain, grade, seed)}</p>
        {explain.standing === 'best' ? (
          <>
            <p className="bf-why-line">
              It wins on <b>{strongest.label} ({Math.round(score[strongest.key])})</b>
              {secondStrongest && (
                <>
                  {' '}and <b>{secondStrongest.label} ({Math.round(score[secondStrongest.key])})</b>
                </>
              )}
              , and every one of the five is the right card at his spot.
            </p>
            <p className="bf-why-line bf-muted">
              {explain.weakest.label} ({explain.weakest.value}) is the lowest number, but that’s the deal, not you — no
              five on this board gets it higher without losing more elsewhere.
            </p>
          </>
        ) : (
          <>
            {isChalkBoard(targets) && (
              <p className="bf-why-line">
                Chalk board — the fan-vote five ({targets.par}){' '}
                {chalkGap <= 0
                  ? `already is the best five on the board (${targets.optimal})`
                  : `was within ${chalkGap} of the best five on the board (${targets.optimal})`}
                . Not much room to out-coach it on this deal.
              </p>
            )}
            {explain.tookLazyPick && !isChalkBoard(targets) && (
              <p className="bf-why-line">
                You started the five biggest names — that’s the fan-vote five ({targets.par}). The deal hid a better-fitting
                lineup among the role players.
              </p>
            )}
            {explain.pickCosts[0] && (
              <p className="bf-why-line">
                {explain.standing === 'close' ? 'The difference is ' : 'Costliest pick: '}
                <b>{explain.pickCosts[0].yours}</b> at {explain.pickCosts[0].slot} — <b>{explain.pickCosts[0].best}</b> there
                is worth about <b>{explain.pickCosts[0].cost} points</b>
                {explain.pickCosts[0].axisDelta < 0 && <>, most of it on {explain.pickCosts[0].axis} (−{Math.abs(explain.pickCosts[0].axisDelta)})</>}.
                {explain.standing === 'off' && explain.pickCosts[1] && explain.pickCosts[1].cost > 0 && (
                  <>
                    {' '}Next: <b>{explain.pickCosts[1].yours}</b> at {explain.pickCosts[1].slot} instead of <b>{explain.pickCosts[1].best}</b> (
                    {explain.pickCosts[1].cost}).
                  </>
                )}
              </p>
            )}
            {explain.weakestIsBoardLimit ? (
              <p className="bf-why-line">
                Your lowest number, <b>{explain.weakest.label} ({explain.weakest.value})</b>, is as high as this deal goes — the
                best five has {explain.bestAxes[explain.weakest.axis]} there too.
              </p>
            ) : (
              <p className="bf-why-line">
                Your weak spot is <b>{explain.weakest.label} ({explain.weakest.value})</b> — the best five has{' '}
                {explain.bestAxes[explain.weakest.axis]}. {explain.weakest.reason}
              </p>
            )}
            {explain.standing === 'off' && score.weakLink && explain.weakest.axis !== 'defense' && (
              <p className="bf-why-line">
                On defense, <b>{score.weakLink}</b> is the one they’ll hunt — every switch, every possession.
              </p>
            )}
          </>
        )}
      </div>

      <div className="bf-optimal">
        <div className="bf-optimal-title at-cond">
          Starting five <span>{STARTER_SLOTS.filter((slot) => lineup[slot]?.id === targets.optimalFive[slot].id).length}/5 match the best</span>
        </div>
        <div className="bf-cmp">
          <span />
          <span className="bf-cmp-head at-cond">You</span>
          <span className="bf-cmp-head at-cond">Best</span>
          {STARTER_SLOTS.map((slot) => {
            const engine = targets.optimalFive[slot];
            const yours = lineup[slot];
            const hit = !!yours && yours.id === engine.id;
            return (
              <Fragment key={slot}>
                <span className={`bf-cmp-pos at-cond ${hit ? 'bf-cmp-pos--hit' : ''}`}>{slot}</span>
                <CmpCell span={yours} tone={hit ? 'hit' : 'miss'} />
                {hit ? <span className="bf-cmp-same at-cond">✓ same</span> : <CmpCell span={engine} tone="best" />}
              </Fragment>
            );
          })}
        </div>
      </div>

      {onNextStep && (
        <div className="path-next">
          <span>
            <b>Next step: Mini Draft.</b> The same five and the same judge — but drafted live against 15 CPU teams that take
            your targets first.
          </span>
          <button className="at-draft-btn" onClick={onNextStep}>
            Play Mini Draft
          </button>
        </div>
      )}
      {daily ? (
        <div className="bf-daily-done">
          <b>That’s today’s board.</b>{' '}
          {streak && streak.current > 0 && <>🔥 {streak.current}-day streak{streak.best > streak.current ? ` (best ${streak.best})` : ''}. </>}
          A new one in {untilTomorrow()}.
          {streak && <StreakTrack best={streak.best} current={streak.current} />}
          {onReplayDaily && (
            <button type="button" className="secondary-btn bf-daily-replay" onClick={onReplayDaily}>
              Play today again (testing)
            </button>
          )}
        </div>
      ) : (
        <div className="bf-submit-row bf-result-actions">
          <button className="primary-btn" onClick={onNewBoard}>
            New board
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
}

/** 2026-09-28, Daily Slot Machine 2.0: what the day is known by before the first pull — the Joker
 * (announced in full, so saving caps for him is a plan, not luck) and the opponent. */
function DailyIntro({ opponent, order }: { opponent: LegendFive; order: Position[] }) {
  return (
    <div className="bf-daily-intro">
      <div className="bf-daily-banner bf-daily-banner--joker">
        <span className="bf-daily-banner-k at-cond">🃏 Jokers in the deck</span>
        <span className="bf-daily-banner-v">
          {JOKERS_MIN}–{JOKERS_MAX} face-down cards today
        </span>
        <span className="bf-daily-banner-d">
          Five cards a position. Somewhere in today’s hands, a gold card at the position’s middle price: <b>50% a legend</b>,{' '}
          <b>50% a scrub</b>. You find out when you pick him.
        </span>
      </div>
      <div className="bf-daily-banner bf-daily-banner--opp">
        <span className="bf-daily-banner-k at-cond">Game of the day</span>
        <span className="bf-daily-banner-v">{opponent.name}</span>
        <span className="bf-daily-banner-d">
          {opponent.players.join(' · ')} — your five plays them live after the last pick. Order today: {order.join(' → ')}.
        </span>
      </div>
    </div>
  );
}

/** The day's Jokers turned over — only on your own result, never in the shared line. */
function JokerRecap({ jokers, lineup }: { jokers: DailyJoker[]; lineup: Lineup }) {
  if (jokers.length === 0) return null;
  return (
    <div className="bf-joker-line">
      {jokers.map((j) => {
        const took = lineup[j.slot]?.id === j.card.id;
        return (
          <p key={j.slot} className={took ? 'is-took' : undefined}>
            🃏 {j.slot} Joker: <b>{j.span.playerName}</b> {j.span.spanLabel} — {j.legend ? 'a legend' : 'a scrub'}.{' '}
            {took ? (j.legend ? 'You hit the jackpot.' : 'You drew the short straw.') : j.legend ? 'You left him on the table.' : 'You dodged him.'}
          </p>
        );
      })}
    </div>
  );
}

/** Streak rewards, by the best streak (cosmetic, kept once earned). */
function StreakTrack({ best, current }: { best: number; current: number }) {
  const next = STREAK_TIERS.find((t) => best < t.days);
  return (
    <div className="bf-streak-track" aria-label="Streak rewards">
      <div className="bf-streak-tiers">
        {STREAK_TIERS.map((t) => (
          <span key={t.days} className={`bf-streak-tier${best >= t.days ? ' is-got' : ''}${next === t ? ' is-next' : ''}`} title={t.reward}>
            <span className="bf-streak-dot" aria-hidden />
            <b>{t.days}</b>
            <span>{t.reward}</span>
          </span>
        ))}
      </div>
      {next && (
        <span className="bf-streak-next">
          {next.days - current} more {next.days - current === 1 ? 'day' : 'days'} in a row: {next.reward.toLowerCase()}.
        </span>
      )}
    </div>
  );
}

/** 2026-09-30, Draw Five vs the AI: its five so far, its caps and what it drew last. */
function AiFive({ lineup, cap, log }: { lineup: Lineup; cap: number; log: { slot: Position; hand: PlayerSpan[]; took: string } | null }) {
  // 2026-09-30, the user ("animacja losowania i wyboru kart również obecna dla AI"): the AI's hand
  // comes off the deck and turns over like yours, then the card it takes lifts out and lands in its
  // five. Its newest pick shows once that has played.
  const used = lineupShots(lineup);
  return (
    <div className="bf-ai">
      <div className="bf-ai-head">
        <span className="at-cond">AI · Pro</span>
        <span>
          <CapIcon /> {used.toFixed(1)} / {cap} caps
        </span>
      </div>
      <div className="bf-ai-five">
        {STARTER_SLOTS.map((slot) => {
          const p = lineup[slot];
          return (
            <span key={slot} className={`bf-ai-slot${p ? ' is-filled' : ''}${p && log?.slot === slot ? ' is-new' : ''}`}>
              <b>{slot}</b>
              {p ? shortenName(p.playerName, 0) : '—'}
            </span>
          );
        })}
      </div>
      {log && (
        <div className="bf-ai-hand" key={`${log.slot}-${log.took}`} aria-label={`The AI drew ${log.hand.map((c) => c.playerName).join(', ')} and took ${log.hand.find((c) => c.id === log.took)?.playerName}`}>
          {log.hand.map((c, i) => (
            <span key={c.id} className={`bf-ai-card${c.id === log.took ? ' is-took' : ''}`} style={{ '--i': i } as CSSProperties}>
              <span className="bf-ai-card-in">
                <span className="bf-ai-card-back" aria-hidden />
                <span className="bf-ai-card-face">
                  {shortenName(c.playerName, 0)}
                  <small>{c.fga.toFixed(1)}</small>
                </span>
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The AI's five as the live game's opponent (it only plays once it's complete). */
function aiOpponent(ai: Lineup): LegendFive | undefined {
  if (!STARTER_SLOTS.every((s) => ai[s])) return undefined;
  return {
    id: 'ai',
    name: 'the AI (Pro)',
    short: 'AI',
    endYear: 0,
    players: STARTER_SLOTS.map((s) => ai[s]!.playerName) as LegendFive['players'],
  };
}

/** 2026-09-30: the Joker of the round just played, turned over once a card was picked. */
function JokerReveal({ joker, took }: { joker: DailyJoker; took: boolean }) {
  useEffect(() => {
    if (!took) return;
    if (joker.legend) deckSfx.jackpot();
    else deckSfx.scrub();
  }, [joker, took]);
  return (
    <p className={`bf-joker-reveal${joker.legend ? ' is-legend' : ' is-scrub'}${took ? ' is-took' : ''}`} role="status">
      🃏 The {joker.slot} Joker was <b>{joker.span.playerName}</b> {joker.span.spanLabel} — {joker.legend ? 'a legend' : 'a scrub'}.{' '}
      {took ? (joker.legend ? 'Jackpot.' : 'Ouch.') : joker.legend ? 'He got away.' : 'Good dodge.'}
    </p>
  );
}
