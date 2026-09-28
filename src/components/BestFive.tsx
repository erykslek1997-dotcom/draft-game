import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import './BestFive.css';
import { ChallengeNote, ScoreBoard } from './ScoreBoard';
import { ScoreChip } from './ResultsScreen';
import ShareResultModal from './ShareResultModal';
import { copyLink } from './shareSave';
import { modeChallengeLink, type ModeChallenge } from '../modeChallenge';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS } from '../engine/positions';
import { CapIcon, Face, ShotChip, ShotsMeter, shortenName } from './ShotChip';
import { hadStealsBlocksRecorded, hadThreePointLine } from './eraNotes';
import { EraYears } from './EraYears';
import { TeamChip } from './TeamBadge';
import { teamsForSpan } from '../engine/spanTeams';
import { markStepDone } from './pathProgress';
import { SpinLever } from './SpinLever';
import {
  dailyBoard,
  dailyTargets,
  lineupShots,
  scoreLineup,
  gradeVsPar,
  explainResult,
  isChalkBoard,
  GRADE_LABEL,
  GRADE_BLURB,
  WEIGHTED_AXES,
  AXIS_GLOSSARY,
  slotReels,
  rumorFor,
  type Lineup,
  type LineupScore,
  type DailyPool,
  type DailyTargets,
  type GolfGrade,
  type ResultExplanation,
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
}

const SLOT_LABEL: Record<Position, string> = { PG: 'Point guard', SG: 'Shooting guard', SF: 'Small forward', PF: 'Power forward', C: 'Center' };

/** Blind-scouting box stats, never the engine's TAL. `boxLineShort` = the pts/reb/ast triple;
 * `boxLineDetail` = the rest of a normal stat line — steals, blocks, FG%, 3P%. */
function boxLineShort(s: PlayerSpan): string {
  return `${s.box.ppg.toFixed(1)} / ${s.box.rpg.toFixed(1)} / ${s.box.apg.toFixed(1)}`;
}
function boxLineDetail(s: PlayerSpan): string {
  const b = s.box;
  // Stats that didn't exist yet in his era are left out rather than shown as a misleading 0.
  const parts = [
    ...(hadStealsBlocksRecorded(s) ? [`${b.spg.toFixed(1)} stl`, `${b.bpg.toFixed(1)} blk`] : []),
    `${Math.round(b.fgPct * 100)}% FG`,
    hadThreePointLine(s) ? `${Math.round(b.threePct * 100)}% 3P` : 'no 3-pt line',
  ];
  return parts.join(' · ');
}

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
export default function BestFive({ onBack, onNextStep, challenge }: Props) {
  // 2026-09-27, the user: "Usuńmy daily challenge. Dodamy go osobnym przyciskiem jak będziemy
  // robić porządnie daily challenge". Every board is a fresh random deal; the old daily puzzle and
  // streak (bestFiveProgress.ts) are in git history for when the daily challenge gets built.
  const [board, setBoard] = useState<{ seed: string; n: number }>(() => ({ seed: challenge?.seed ?? randomSeed(1), n: 1 }));
  // 2026-09-11, user's own ask: "dodajemy koszt gracza w shots i oprócz codziennej puli graczy
  // będzie losowa liczba między 60 a 90" — a seeded shots budget for the five starters.
  // 2026-09-27: pool and cap come together from `dailyBoard`, which skips boards where the five
  // biggest names are already about the best answer (see its docstring).
  const dealt = useMemo(() => dailyBoard(board.seed), [board.seed]);
  const pool: DailyPool = dealt.pool;
  const shotsCap = dealt.cap;

  function resultFor(l: Lineup, p: DailyPool, cap: number) {
    const score = scoreLineup(l);
    const targets = dailyTargets(p, cap);
    return { score, targets, grade: gradeVsPar(score.composite, targets.par, targets.optimal) };
  }
  const [lineup, setLineup] = useState<Lineup>({});
  const [activeSlot, setActiveSlot] = useState<Position | null>('PG');
  // 2026-09-26, the user: "ograniczmy wybór do 5 graczy. Niech po każdym wyborze gracz widzi jacy
  // gracze się losują." Positions are dealt one at a time: a slot's five stay face down until the
  // pick before it, then spin in on the slot machine (`freshSlot`, once per slot).
  const [revealed, setRevealed] = useState<Set<Position>>(() => new Set(['PG']));
  const [freshSlot, setFreshSlot] = useState<Position | null>('PG');
  const [result, setResult] = useState<{ score: LineupScore; targets: DailyTargets; grade: GolfGrade } | null>(null);
  // 2026-09-17, user's own ask: a real "how to play?" affordance on every mode, now that the
  // intro screen's own always-visible rules list is gone.
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  const filledCount = STARTER_SLOTS.filter((s) => lineup[s]).length;
  const complete = filledCount === 5;
  const shotsUsed = lineupShots(lineup);
  const overCap = shotsUsed > shotsCap;

  // 2026-09-27, the user ("kolejna rzecz, która doda sporo emocji. Nie można cofnąć picku"): a
  // pick is final — no clearing, no re-opening a filled position. So a player who would leave the
  // positions still open unfillable under the cap (even at their cheapest dealt option) can't be
  // taken; his card says by how much he's over.
  const cheapestLeft = (except: Position) =>
    STARTER_SLOTS.filter((s) => s !== except && !lineup[s]).reduce((sum, s) => sum + Math.min(...pool.bySlot[s].map((p) => p.fga)), 0);
  const overBy = (slot: Position, span: PlayerSpan) => shotsUsed + span.fga + cheapestLeft(slot) - shotsCap;

  function pick(slot: Position, span: PlayerSpan) {
    if (lineup[slot] || overBy(slot, span) > 1e-9) return;
    setLineup((prev) => ({ ...prev, [slot]: span }));
    // Advance to the next still-empty slot, in PG→C order; the picker closes after the last one.
    // A slot seen for the first time gets dealt.
    const nextEmpty = STARTER_SLOTS.find((s) => s !== slot && !lineup[s]);
    if (nextEmpty && !revealed.has(nextEmpty)) {
      setRevealed((prev) => new Set(prev).add(nextEmpty));
      setFreshSlot(nextEmpty);
    } else {
      setFreshSlot(null);
    }
    setActiveSlot(nextEmpty ?? null);
  }

  function submit() {
    if (!complete || overCap) return;
    const next = resultFor(lineup, pool, shotsCap);
    setResult(next);
  }

  function resetPicks() {
    setLineup({});
    setActiveSlot('PG');
    setRevealed(new Set(['PG']));
    setFreshSlot('PG');
    setResult(null);
  }

  /** A fresh random deal. */
  function newBoard() {
    setBoard((b) => ({ seed: randomSeed(b.n + 1), n: b.n + 1 }));
    resetPicks();
  }

  return (
    <div className="at-shell best-five">
      {/* 2026-09-27 UI audit: the same "← Menu" in the top corner as the drafts (was "← Back" on
          the right next to "How to play?", with a "Board #n" nobody needed). */}
      {onBack && (
        <button type="button" className="at-menu-btn at-cond" onClick={onBack}>
          ← Menu
        </button>
      )}
      <div className="at-board-brand at-cond">Slot Machine</div>
      <div className="bf-subhead">
        <span className="bf-subhead-actions">
          <button className="at-legend-toggle at-cond" onClick={() => setShowHowToPlay((v) => !v)}>
            {showHowToPlay ? 'Hide how to play' : 'How to play?'}
          </button>
        </span>
      </div>

      {showHowToPlay && (
        <ol className="how-to-play-panel">
          <li><b>Pick five.</b> One player per position — PG/SG/SF/PF/C. Each position deals four players, and the next position turns over after you pick. Picks are final: no going back. While you choose, the scouts drop a word about the next deal. It is always true of one of its four players — but not always the one worth saving caps for.</li>
          <li><b>Caps.</b> Every player costs caps — his shots per game in those years. Your five have to fit under the board’s cap, shown by the meter above it.</li>
          <li><b>Submit once.</b> No re-picking after you see your score.</li>
          <li><b>Grading.</b> You’re scored on talent, offense, defense, spacing, and fit, then compared against the fan-vote five (the five biggest names) and the best five on the board.</li>
          <li><b>Spin again.</b> Every new board is a fresh random deal.</li>
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
                  <span className="bf-slot-pos at-cond">{slot}</span>
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
                  {STARTER_SLOTS.indexOf(activeSlot) < STARTER_SLOTS.length - 1
                    ? 'Four dealt for this spot — picks are final, the next position turns over after you pick.'
                    : 'Last spot — four dealt. Picks are final.'}
                </span>
              </div>
              {/* 2026-09-28, the user ("jeden widok byłby lepszy"): the deal no longer switches to a
                  separate card grid once the reels stop — each reel opens up into its card, in the
                  same cabinet, and a position you come back to shows its cards there too. */}
              <SlotMachine
                key={`${pool.key}-${activeSlot}`}
                pool={pool}
                slot={activeSlot}
                fresh={freshSlot === activeSlot}
                onDone={() => setFreshSlot(null)}
                renderCard={(span) => {
                  const chosen = lineup[activeSlot]?.id === span.id;
                  const over = overBy(activeSlot, span);
                  const blocked = over > 1e-9;
                  return (
                    <button
                      className={`bf-pool-card ${chosen ? 'bf-pool-card--chosen' : ''}${blocked ? ' bf-pool-card--blocked' : ''}`}
                      title={blocked ? `${span.playerName} would leave no room under the cap` : span.playerName}
                      disabled={blocked}
                      onClick={() => pick(activeSlot, span)}
                    >
                      {blocked && <span className="bf-pool-over at-cond">Over the cap by {over.toFixed(1)}</span>}
                      <Face name={span.playerName} size="md" />
                      <span className="bf-pool-name">{shortenName(span.playerName)}</span>
                      {/* 2026-09-11, user-reported live ("mało przestrzeni tutaj... sezon zwykły
                          font i najbardziej widoczny, później statystyki") — the badge treatment
                          (`.bf-season`, bold+boxed) read as chrome, not the headline info a Best
                          Five pick actually turns on: which career window you're drafting. Plain,
                          larger text (`.bf-pool-season`, pool-card only) makes it the card's real
                          lead without spending padding on a box in an already-tight ~140px card. */}
                      <EraYears span={span} className="bf-pool-season" />
                      <span className="bf-pool-teams">
                        {teamsForSpan(span).map((t) => (
                          <TeamChip key={t.code} code={t.code} seasonStart={t.seasonStart} seasonEnd={t.seasonEnd} />
                        ))}
                      </span>
                      {/* 2026-09-11, user-reported live ("dopisek pozycji na karcie nie ma sensu"):
                          this picker is already scoped to one slot (`SLOT_LABEL[activeSlot]` in
                          the header above — "Pick your point guard"), so repeating the position on
                          every card under it was pure noise, not new information. */}
                      <span className="bf-pool-meta">
                        <ShotChip fga={span.fga} cap={shotsCap} />
                      </span>
                      <span className="bf-pool-box">{boxLineShort(span)}</span>
                      <span className="bf-pool-box bf-pool-box--sub">{boxLineDetail(span)}</span>
                    </button>
                  );
                }}
              />
              {(() => {
                // 2026-09-27: a line of scouting talk about the next position — true of one of its
                // four cards, but sometimes about the card that sounds better than it plays.
                const next = STARTER_SLOTS.find((sl) => sl !== activeSlot && !lineup[sl] && !revealed.has(sl));
                const rumor = next ? rumorFor(pool, next) : undefined;
                if (!next || !rumor) return null;
                return (
                  <div className="bf-teaser" aria-label={`Word on the ${SLOT_LABEL[next].toLowerCase()} deal`}>
                    <span className="bf-teaser-label at-cond">Word on the next deal · {SLOT_LABEL[next].toLowerCase()}</span>
                    <q className="bf-teaser-rumor">{rumor.text}</q>
                    <span className="bf-teaser-note">Scouts talk. Not everything they say is worth the caps.</span>
                  </div>
                );
              })()}
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
          onNextStep={onNextStep}
          seed={board.seed}
          challenge={challenge && challenge.seed === board.seed ? challenge : undefined}
        />
      )}
    </div>
  );
}

/** Milliseconds reel `i` spins before it stops — each reel stops a beat after the one before.
 * 2026-09-27, the user ("po dźwigni za krótko"): about 2.6 s for the first reel, 4.6 s for the last. */
const reelDuration = (i: number) => 2600 + i * 650;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * 2026-09-26, the user: "losując karty w daily deal, może być naprawdę jak w kasynie na maszynie,
 * widzimy jak śmigają nam gracze i co mogliśmy ominąć". A position's five come in on five reels:
 * faces from the top of that position blur past, each reel stops on its dealt player a beat
 * after the one to its left, and the stars that flew past are named once all five stop. Tap to
 * skip; reduced motion skips it outright.
 */
function SlotMachine({
  pool,
  slot,
  fresh,
  onDone,
  renderCard,
}: {
  pool: DailyPool;
  slot: Position;
  /** First visit to this position: the reels wait for the lever and spin. Otherwise they stand
   * open on the dealt cards. */
  fresh: boolean;
  onDone: () => void;
  renderCard: (span: PlayerSpan) => ReactNode;
}) {
  const { reels, nearMisses } = useMemo(() => slotReels(pool, slot), [pool, slot]);
  const dealt = pool.bySlot[slot];
  const [stoppedCount, setStopped] = useState(0);
  // Waits for the lever (2026-09-26: "element wizualny który daje nam możliwość wystartowania").
  const [spinning, setSpinning] = useState(false);
  const stopped = fresh ? stoppedCount : dealt.length;
  const allStopped = stopped >= dealt.length;
  useEffect(() => {
    if (fresh && prefersReducedMotion()) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!fresh || !allStopped) return;
    const t = window.setTimeout(onDone, nearMisses.length > 0 ? 1700 : 800);
    return () => window.clearTimeout(t);
  }, [fresh, allStopped, nearMisses.length, onDone]);
  const skippable = fresh && spinning && !allStopped;
  return (
    <div
      className={`bf-machine${fresh && !spinning ? ' is-idle' : ''}${allStopped ? ' is-open' : ''}`}
      role={skippable ? 'button' : undefined}
      tabIndex={skippable ? 0 : undefined}
      aria-label={skippable ? 'Dealing — tap to skip' : undefined}
      onClick={skippable ? onDone : undefined}
      onKeyDown={(e) => skippable && (e.key === 'Enter' || e.key === ' ') && onDone()}
    >
      <div className="bf-cabinet">
      <div className="bf-reels">
        {dealt.map((final, i) => (
          <div key={final.id} className={`bf-reel${i < stopped ? ' is-stopped is-card' : ''}`} style={{ '--i': i } as CSSProperties}>
            {i < stopped ? (
              // A pick must not also count as the machine's tap-to-skip.
              <div className="bf-reel-card" onClick={(e) => e.stopPropagation()}>{renderCard(final)}</div>
            ) : (
              <div
                className="bf-reel-strip"
                style={{ '--n': reels[i].length, '--dur': `${reelDuration(i)}ms` } as CSSProperties}
                onAnimationEnd={(e) => e.target === e.currentTarget && setStopped((n) => n + 1)}
              >
                {[...reels[i], final].map((span, k) => (
                  <div className="bf-reel-item" key={k}>
                    <Face name={span.playerName} size="md" />
                    <span className="bf-reel-name">{shortenName(span.playerName, 0)}</span>
                    <span className="bf-reel-season">{span.spanLabel}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* 2026-09-27, the user: "4 sloty, obok dźwignia" — the lever stands beside the reels, as on
          a one-armed bandit, and stays there (pulled down) while they spin. */}
      <div className="bf-machine-lever" onClick={(e) => e.stopPropagation()}>
        <SpinLever onPull={() => setSpinning(true)} label={!fresh ? 'Dealt' : spinning ? 'Dealing' : 'Pull'} disabled={!fresh || (spinning && allStopped)} />
      </div>
      </div>
      <p className={`bf-machine-foot${allStopped ? ' is-done' : ''}`} aria-live="polite">
        {fresh && !spinning ? (
          <>Four {SLOT_LABEL[slot].toLowerCase()}s are loaded — pull the lever.</>
        ) : !allStopped ? (
          <>Dealing… <span className="bf-muted">tap to skip</span></>
        ) : fresh && nearMisses.length > 0 ? (
          <>So close — <b>{nearMisses.join(' · ')}</b> flew past.</>
        ) : (
          <>Pick one — picks are final.</>
        )}
      </p>
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
  onNextStep,
  seed,
  challenge,
}: {
  lineup: Lineup;
  pool: DailyPool;
  result: { score: LineupScore; targets: DailyTargets; grade: GolfGrade };
  shotsCap: number;
  onNewBoard: () => void;
  onNextStep?: () => void;
  seed: string;
  challenge?: ModeChallenge;
}) {
  useEffect(() => markStepDone('bestfive'), []);
  const [shareOpen, setShareOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  async function challengeFriend() {
    if (await copyLink(modeChallengeLink('roulette', seed, result.score.composite))) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }
  const { score, targets, grade } = result;
  const explain = useMemo(() => explainResult(lineup, pool, targets, shotsCap), [lineup, pool, targets, shotsCap]);
  const [showGlossary, setShowGlossary] = useState(false);
  const yourShots = useMemo(() => lineupShots(lineup), [lineup]);

  const weightsLine = WEIGHTED_AXES.map((a) => `${a.pct}% ${a.label}`).join(' · ');
  // Strongest axes against the field of this deal: the best five's own value is the yardstick.
  const [strongest, secondStrongest] = [...WEIGHTED_AXES].sort((a, b) => score[b.key] - score[a.key]);
  const chalkGap = targets.optimal - targets.par;

  return (
    <div className="at-card bf-result">
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
          <button
            type="button"
            className="results-hero-copy results-hero-challenge"
            onClick={challengeFriend}
            title="Copies a link that deals a friend the exact same Slot Machine board, with your score to beat."
          >
            {linkCopied ? '✓ Link copied' : '🔗 Challenge a friend'}
          </button>
        </div>
      </div>
      {shareOpen && (
        <ShareResultModal
          onClose={() => setShareOpen(false)}
          mode="Slot Machine"
          title="My Slot Machine five"
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
      <div className="bf-submit-row bf-result-actions">
        <button className="primary-btn" onClick={onNewBoard}>
          New board
        </button>
      </div>
    </div>
  );
}
