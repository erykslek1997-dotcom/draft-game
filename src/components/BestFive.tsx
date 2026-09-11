import { useMemo, useState } from 'react';
import './BestFive.css';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS } from '../engine/positions';
import { naturalPosition } from '../engine/naturalPosition';
import { headshotUrl } from '../data/headshots';
import {
  dailyPool,
  dailyTargets,
  scoreLineup,
  gradeVsPar,
  explainResult,
  isChalkBoard,
  GRADE_LABEL,
  GRADE_BLURB,
  WEIGHTED_AXES,
  AXIS_GLOSSARY,
  dayKey,
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
}

const SLOT_LABEL: Record<Position, string> = { PG: 'Point guard', SG: 'Shooting guard', SF: 'Small forward', PF: 'Power forward', C: 'Center' };

function initials(name: string): string {
  const p = name.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/** Headshot with a monogram fallback (no image, or the image 404s). Faces come from the shared
 * `data/headshots` lookup Codex built for the Card Collection. */
function Face({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const src = headshotUrl(name);
  // Track the src that failed, not a bare boolean — so when this same <Face> instance is reused
  // for a different player (React keeps it mounted across slot re-picks / the your-five vs
  // engine-five columns), a new `src` clears the failed state and the monogram doesn't stick.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === src;
  return (
    <span className={`bf-face bf-face--${size}`} aria-hidden>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** Blind-scouting box stats, never the engine's TAL. `boxLineShort` = the pts/reb/ast triple;
 * `boxLineDetail` = the rest of a normal stat line — steals, blocks, FG%, 3P%. */
function boxLineShort(s: PlayerSpan): string {
  return `${s.box.ppg.toFixed(1)} / ${s.box.rpg.toFixed(1)} / ${s.box.apg.toFixed(1)}`;
}
function boxLineDetail(s: PlayerSpan): string {
  const b = s.box;
  return `${b.spg.toFixed(1)} stl · ${b.bpg.toFixed(1)} blk · ${Math.round(b.fgPct * 100)}% FG · ${Math.round(b.threePct * 100)}% 3P`;
}
function boxLine(s: PlayerSpan): string {
  return `${boxLineShort(s)} · ${boxLineDetail(s)}`;
}

const AXES: { key: keyof Pick<LineupScore, 'talent' | 'offense' | 'defense' | 'spacing' | 'fit'>; label: string; context?: boolean }[] = [
  { key: 'talent', label: 'Talent' },
  { key: 'offense', label: 'Offense' },
  { key: 'defense', label: 'Defense' },
  { key: 'spacing', label: 'Spacing', context: true },
  { key: 'fit', label: 'Fit' },
];

/**
 * "Build the Best 5" — the entry-level daily puzzle. Pick one player per position from a
 * daily-rotated pool of 45, blind-submit, then see a golf-style grade against the engine's own
 * best lineup from that pool. See `engine/bestFive.ts` for the pool generation, the 5-man
 * scoring (a synthetic `Team` scored on the engine's real axes) and the par bands.
 *
 * Deliberately a standalone screen off the intro (same footing as `CapSheet` / `DraftPoolBrowser`)
 * — it has no draft, no lottery, no AI, none of `GameShell`'s phase machine applies.
 */
export default function BestFive({ onBack }: Props) {
  const today = useMemo(() => dayKey(), []);

  // The first board of the day is the daily puzzle; "New board" rolls a fresh random pool so the
  // mode stays playable while there's no backend enforcing one scored attempt per day.
  const [board, setBoard] = useState<{ seed: string; n: number }>({ seed: today, n: 0 });
  const pool: DailyPool = useMemo(() => dailyPool(board.seed), [board.seed]);
  const isDaily = board.seed === today;

  const [lineup, setLineup] = useState<Lineup>({});
  const [activeSlot, setActiveSlot] = useState<Position | null>('PG');
  const [result, setResult] = useState<{ score: LineupScore; targets: DailyTargets; grade: GolfGrade } | null>(null);

  const filledCount = STARTER_SLOTS.filter((s) => lineup[s]).length;
  const complete = filledCount === 5;

  function pick(slot: Position, span: PlayerSpan) {
    setLineup((prev) => ({ ...prev, [slot]: span }));
    // Advance to the next still-empty slot; if there is none (board full, or re-picking the last
    // gap), stay on the current slot so the picker stays open for another change of mind.
    const nextEmpty = STARTER_SLOTS.find((s) => s !== slot && !lineup[s] && s !== activeSlot);
    setActiveSlot(nextEmpty ?? activeSlot);
  }

  function clear(slot: Position) {
    setLineup((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }

  function submit() {
    if (!complete) return;
    const score = scoreLineup(lineup);
    const targets = dailyTargets(pool);
    setResult({ score, targets, grade: gradeVsPar(score.composite, targets.par, targets.optimal) });
  }

  function resetPicks() {
    setLineup({});
    setActiveSlot('PG');
    setResult(null);
  }

  /** Fresh random pool — a practice board, not today's puzzle. */
  function newBoard() {
    setBoard((b) => ({ seed: `practice-${today}-${b.n + 1}-${Math.floor(Math.random() * 1e9)}`, n: b.n + 1 }));
    resetPicks();
  }

  function backToDaily() {
    setBoard({ seed: today, n: 0 });
    resetPicks();
  }

  return (
    <div className="at-shell best-five">
      <div className="at-board-brand at-cond">Build the Best 5</div>
      <div className="bf-subhead">
        <span className="bf-date">{isDaily ? `Daily puzzle · ${today}` : `Practice board #${board.n}`}</span>
        <span className="bf-subhead-actions">
          {!isDaily && (
            <button className="at-legend-toggle at-cond" onClick={backToDaily}>
              Today’s puzzle
            </button>
          )}
          {onBack && (
            <button className="at-legend-toggle at-cond" onClick={onBack}>
              ← Back
            </button>
          )}
        </span>
      </div>

      {!result && (
        <div className="at-card">
          <p className="bf-intro">
            One player per position from today’s pool. The five biggest names usually <em>isn’t</em> the
            answer — spacing and rim protection matter. No score until you submit.
          </p>

          <div className="bf-slot-row">
            {STARTER_SLOTS.map((slot) => {
              const s = lineup[slot];
              return (
                <button
                  key={slot}
                  className={`bf-slot ${activeSlot === slot ? 'bf-slot--active' : ''} ${s ? 'bf-slot--filled' : ''}`}
                  onClick={() => setActiveSlot(slot)}
                >
                  <span className="bf-slot-pos at-cond">{slot}</span>
                  {s ? <Face name={s.playerName} /> : <span className="bf-face bf-face--sm bf-face--empty" aria-hidden />}
                  <span className="bf-slot-name">{s ? s.playerName : 'Tap to pick'}</span>
                  {s && <span className="bf-season bf-season--sm">{s.spanLabel}</span>}
                  {s && <span className="bf-slot-box">{boxLineShort(s)}</span>}
                  {s && (
                    <span
                      className="bf-slot-clear"
                      role="button"
                      tabIndex={0}
                      aria-label={`Clear ${slot}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        clear(slot);
                      }}
                    >
                      ✕
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {activeSlot && (
            <div className="bf-picker">
              <div className="bf-picker-head at-cond">Pick your {SLOT_LABEL[activeSlot].toLowerCase()}</div>
              <div className="bf-pool">
                {pool.bySlot[activeSlot].map((span) => {
                  const chosen = lineup[activeSlot]?.id === span.id;
                  return (
                    <button
                      key={span.id}
                      className={`bf-pool-card ${chosen ? 'bf-pool-card--chosen' : ''}`}
                      onClick={() => pick(activeSlot, span)}
                    >
                      <Face name={span.playerName} size="md" />
                      <span className="bf-pool-name">{span.playerName}</span>
                      <span className="bf-season">{span.spanLabel}</span>
                      <span className="bf-pool-meta">{naturalPosition(span.playerName)}</span>
                      <span className="bf-pool-box">{boxLineShort(span)}</span>
                      <span className="bf-pool-box bf-pool-box--sub">{boxLineDetail(span)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bf-submit-row">
            <button className="at-draft-btn bf-submit" disabled={!complete} onClick={submit}>
              Submit lineup
            </button>
          </div>
        </div>
      )}

      {result && (
        <BestFiveResult
          lineup={lineup}
          pool={pool}
          result={result}
          isDaily={isDaily}
          onNewBoard={newBoard}
          onBackToDaily={backToDaily}
        />
      )}
    </div>
  );
}

function BestFiveResult({
  lineup,
  pool,
  result,
  isDaily,
  onNewBoard,
  onBackToDaily,
}: {
  lineup: Lineup;
  pool: DailyPool;
  result: { score: LineupScore; targets: DailyTargets; grade: GolfGrade };
  isDaily: boolean;
  onNewBoard: () => void;
  onBackToDaily: () => void;
}) {
  const { score, targets, grade } = result;
  const explain = useMemo(() => explainResult(lineup, pool, targets), [lineup, pool, targets]);
  const [showGlossary, setShowGlossary] = useState(false);

  const weightsLine = WEIGHTED_AXES.map((a) => `${a.pct}% ${a.label}`).join(' · ');
  const chalkGap = targets.optimal - targets.par;

  return (
    <div className="at-card bf-result">
      <div className={`bf-grade bf-grade--${grade}`}>
        <span className="bf-grade-label at-cond">{GRADE_LABEL[grade]}</span>
        <span className="bf-grade-blurb">{GRADE_BLURB[grade]}</span>
      </div>

      <div className="bf-scoreline">
        <span>
          <b>{score.composite}</b> your lineup
        </span>
        <span>
          <b>{targets.par}</b> par <span className="bf-muted">(five biggest names)</span>
        </span>
        <span>
          <b>{targets.optimal}</b> engine’s best
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
        <div className="bf-why-head at-cond">Why this score</div>
        {isChalkBoard(targets) && (
          <p className="bf-why-line">
            Chalk board — the five biggest names ({targets.par}){' '}
            {chalkGap <= 0
              ? `already match the engine’s best (${targets.optimal})`
              : `were within ${chalkGap} of the engine’s best (${targets.optimal})`}
            . Not much room to out-think it today.
          </p>
        )}
        {explain.tookLazyPick && !isChalkBoard(targets) && (
          <p className="bf-why-line">
            You picked the five biggest names — that’s exactly par ({targets.par}). The pool almost always
            hides a better-fitting lineup among the lesser names.
          </p>
        )}
        <p className="bf-why-line">
          Your weakest axis is <b>{explain.weakest.label} ({explain.weakest.value})</b>. {explain.weakest.reason}
        </p>
        {score.weakLink && (
          <p className="bf-why-line">
            Defensively, <b>{score.weakLink}</b> is the softest spot — an opponent will attack him every possession.
          </p>
        )}
        {explain.engineEdge.length > 0 && (
          <p className="bf-why-line">
            The engine’s best five ({targets.optimal}) beats yours mostly on{' '}
            <b>{explain.engineEdge[0].label} (+{explain.engineEdge[0].delta})</b>
            {explain.engineEdge[1] && `, then ${explain.engineEdge[1].label} (+${explain.engineEdge[1].delta})`}
            {explain.swaps.length > 0 && (
              <>
                {' '}— it plays{' '}
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
        <div className="bf-optimal-head at-cond">
          <span>Your five</span>
          <span>The engine’s best</span>
        </div>
        {STARTER_SLOTS.map((slot) => {
          const engine = targets.optimalFive[slot];
          const yours = lineup[slot];
          const hit = !!yours && yours.id === engine.id;
          return (
            <div key={slot} className={`bf-cmp-row ${hit ? 'bf-cmp-row--hit' : ''}`}>
              <span className="bf-cmp-pos at-cond">{slot}</span>
              {yours && (
                <div className="bf-cmp-side">
                  <Face name={yours.playerName} />
                  <span className="bf-cmp-body">
                    <span className="bf-cmp-nameline">
                      <span className="bf-cmp-name">{yours.playerName}</span>
                      <span className="bf-season bf-season--sm">{yours.spanLabel}</span>
                    </span>
                    <span className="bf-cmp-box">{boxLine(yours)}</span>
                  </span>
                </div>
              )}
              <span className="bf-cmp-mid at-cond">{hit ? '✓' : '→'}</span>
              {hit ? (
                <span className="bf-cmp-match at-cond">nailed it</span>
              ) : (
                <div className="bf-cmp-side bf-cmp-side--engine">
                  <Face name={engine.playerName} />
                  <span className="bf-cmp-body">
                    <span className="bf-cmp-nameline">
                      <span className="bf-cmp-name">{engine.playerName}</span>
                      <span className="bf-season bf-season--sm">{engine.spanLabel}</span>
                    </span>
                    <span className="bf-cmp-box">{boxLine(engine)}</span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bf-submit-row bf-result-actions">
        <button className="at-draft-btn bf-submit" onClick={onNewBoard}>
          New board
        </button>
        {!isDaily && (
          <button className="at-legend-toggle at-cond" onClick={onBackToDaily}>
            Back to today’s puzzle
          </button>
        )}
      </div>
    </div>
  );
}
