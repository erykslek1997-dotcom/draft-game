import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import './BestFive.css';
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
} from '../engine/bestFive';

interface Props {
  mode: 'developer' | 'player';
  /** Return to the host app's intro. Omitted in the standalone web export, where the "← Back"
   * control is simply not rendered. */
  onBack?: () => void;
  /** The next step of the learning path (Quick 5), offered on the result screen. */
  onNextStep?: () => void;
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
export default function BestFive({ onBack, onNextStep }: Props) {
  // 2026-09-27, the user: "Usuńmy daily challenge. Dodamy go osobnym przyciskiem jak będziemy
  // robić porządnie daily challenge". Every board is a fresh random deal; the old daily puzzle and
  // streak (bestFiveProgress.ts) are in git history for when the daily challenge gets built.
  const [board, setBoard] = useState<{ seed: string; n: number }>(() => ({ seed: randomSeed(1), n: 1 }));
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
  // pick before it, then spin in on a slot machine (`spinSlot`, once per slot; `landedSlot` pops
  // the cards in after it stops).
  const [revealed, setRevealed] = useState<Set<Position>>(() => new Set(['PG']));
  const [freshSlot, setFreshSlot] = useState<Position | null>('PG');
  const [landedSlot, setLandedSlot] = useState<Position | null>(null);
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
      <div className="at-board-brand at-cond">Roulette</div>
      <div className="bf-subhead">
        <span className="bf-date">Board #{board.n}</span>
        <span className="bf-subhead-actions">
          <button className="at-legend-toggle at-cond" onClick={() => setShowHowToPlay((v) => !v)}>
            {showHowToPlay ? 'Hide how to play' : 'How to play?'}
          </button>
          {onBack && (
            <button className="at-legend-toggle at-cond" onClick={onBack}>
              ← Back
            </button>
          )}
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
          <p className="bf-intro">
            One player per position from this deal. The five biggest names usually <em>isn’t</em> the
            answer — spacing and rim protection matter. No score until you submit.
          </p>

          <ShotsMeter used={shotsUsed} cap={shotsCap} />
          <p className="bf-caps-note">
            <CapIcon /> Caps = a player’s shots per game in those years. A high-usage star eats the budget, so the five
            have to fit under this board’s {shotsCap}.
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
              {freshSlot === activeSlot ? (
                <SlotMachine
                  key={`${pool.key}-${activeSlot}`}
                  pool={pool}
                  slot={activeSlot}
                  onDone={() => {
                    setLandedSlot(activeSlot);
                    setFreshSlot(null);
                  }}
                />
              ) : (
              <div className={`bf-pool${landedSlot === activeSlot ? ' bf-pool--landed' : ''}`} key={activeSlot}>
                {pool.bySlot[activeSlot].map((span, i) => {
                  const chosen = lineup[activeSlot]?.id === span.id;
                  const over = overBy(activeSlot, span);
                  const blocked = over > 1e-9;
                  return (
                    <div className="bf-deal" key={span.id} style={{ '--i': i } as CSSProperties}>
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
                    </div>
                  );
                })}
              </div>
              )}
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
function SlotMachine({ pool, slot, onDone }: { pool: DailyPool; slot: Position; onDone: () => void }) {
  const { reels, nearMisses } = useMemo(() => slotReels(pool, slot), [pool, slot]);
  const dealt = pool.bySlot[slot];
  const [stopped, setStopped] = useState(0);
  // Waits for the lever (2026-09-26: "element wizualny który daje nam możliwość wystartowania").
  const [spinning, setSpinning] = useState(false);
  const allStopped = stopped >= dealt.length;
  useEffect(() => {
    if (prefersReducedMotion()) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!allStopped) return;
    const t = window.setTimeout(onDone, nearMisses.length > 0 ? 1700 : 800);
    return () => window.clearTimeout(t);
  }, [allStopped, nearMisses.length, onDone]);
  return (
    <div
      className={`bf-machine${spinning ? '' : ' is-idle'}`}
      role={spinning ? 'button' : undefined}
      tabIndex={spinning ? 0 : undefined}
      aria-label={spinning ? 'Dealing — tap to skip' : undefined}
      onClick={spinning ? onDone : undefined}
      onKeyDown={(e) => spinning && (e.key === 'Enter' || e.key === ' ') && onDone()}
    >
      <div className="bf-cabinet">
      <div className="bf-reels">
        {dealt.map((final, i) => (
          <div key={final.id} className={`bf-reel${i < stopped ? ' is-stopped' : ''}`}>
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
          </div>
        ))}
      </div>
      {/* 2026-09-27, the user: "4 sloty, obok dźwignia" — the lever stands beside the reels, as on
          a one-armed bandit, and stays there (pulled down) while they spin. */}
      <div className="bf-machine-lever" onClick={(e) => e.stopPropagation()}>
        <SpinLever onPull={() => setSpinning(true)} label={spinning ? 'Dealing' : 'Pull'} disabled={spinning && allStopped} />
      </div>
      </div>
      <p className={`bf-machine-foot${allStopped ? ' is-done' : ''}`} aria-live="polite">
        {!spinning ? (
          <>Four {SLOT_LABEL[slot].toLowerCase()}s are loaded — pull the lever.</>
        ) : !allStopped ? (
          <>Dealing… <span className="bf-muted">tap to skip</span></>
        ) : nearMisses.length > 0 ? (
          <>So close — <b>{nearMisses.join(' · ')}</b> flew past.</>
        ) : (
          <>Your five are in.</>
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

function BestFiveResult({
  lineup,
  pool,
  result,
  shotsCap,
  onNewBoard,
  onNextStep,
}: {
  lineup: Lineup;
  pool: DailyPool;
  result: { score: LineupScore; targets: DailyTargets; grade: GolfGrade };
  shotsCap: number;
  onNewBoard: () => void;
  onNextStep?: () => void;
}) {
  useEffect(() => markStepDone('bestfive'), []);
  const { score, targets, grade } = result;
  const explain = useMemo(() => explainResult(lineup, pool, targets, shotsCap), [lineup, pool, targets, shotsCap]);
  const [showGlossary, setShowGlossary] = useState(false);
  const yourShots = useMemo(() => lineupShots(lineup), [lineup]);

  const weightsLine = WEIGHTED_AXES.map((a) => `${a.pct}% ${a.label}`).join(' · ');
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
        <div className="bf-board">
          <div className="bf-board-cell bf-board-cell--you">
            <b>{score.composite}</b>
            <span className="at-cond">Your five</span>
          </div>
          <div className="bf-board-cell">
            <b>{targets.par}</b>
            <span className="at-cond">Fan-vote five</span>
          </div>
          <div className="bf-board-cell">
            <b>{targets.optimal}</b>
            <span className="at-cond">Best on the board</span>
          </div>
        </div>
        <span className="bf-board-caps">
          <CapIcon /> {Math.round(yourShots)} / {shotsCap} caps · fan-vote five = the five biggest names
        </span>
      </div>

      <div className="bf-bars">
        {AXES.map(({ key, label, context }) => (
          <div key={key} className={`bf-bar-row ${context ? 'bf-bar-row--context' : ''}`}>
            <span className="bf-bar-label at-cond">{label}</span>
            <span className="bf-bar-track">
              <span className="bf-bar-fill" style={{ width: `${Math.max(0, Math.min(100, score[key]))}%` }} />
            </span>
            <span className="bf-bar-val">{Math.round(score[key])}</span>
          </div>
        ))}
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

      <div className="bf-why">
        <div className="bf-why-head at-cond">Film room</div>
        <p className="bf-why-line bf-why-lead">{RESULT_LEAD[grade]}</p>
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
            You started the five biggest names — that’s the fan-vote five ({targets.par}). The deal almost always
            hides a better-fitting lineup among the role players.
          </p>
        )}
        <p className="bf-why-line">
          Your weak spot is <b>{explain.weakest.label} ({explain.weakest.value})</b>. {explain.weakest.reason}
        </p>
        {score.weakLink && explain.weakest.axis !== 'defense' && (
          <p className="bf-why-line">
            On defense, <b>{score.weakLink}</b> is the one they’ll hunt — every switch, every possession.
          </p>
        )}
        {explain.engineEdge.length > 0 && (
          <p className="bf-why-line">
            The best five on the board ({targets.optimal}) wins the matchup mostly on{' '}
            <b>{explain.engineEdge[0].label} (+{explain.engineEdge[0].delta})</b>
            {explain.engineEdge[1] && `, then ${explain.engineEdge[1].label} (+${explain.engineEdge[1].delta})`}
            {explain.swaps.length > 0 && (
              <>
                {' '}— it starts{' '}
                {explain.swaps.map((s, i) => (
                  <span key={s.slot}>
                    {i > 0 && (i === explain.swaps.length - 1 ? ' and ' : ', ')}
                    <b>{s.engine}</b> at {s.slot}
                  </span>
                ))}
                .
              </>
            )}
          </p>
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
        <button className="at-draft-btn bf-submit" onClick={onNewBoard}>
          New board
        </button>
      </div>
    </div>
  );
}
