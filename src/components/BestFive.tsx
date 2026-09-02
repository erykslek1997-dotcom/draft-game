import { useMemo, useState } from 'react';
import './BestFive.css';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS } from '../engine/positions';
import { effectiveTalent } from '../engine/grades';
import { naturalPosition } from '../engine/naturalPosition';
import {
  dailyPool,
  dailyTargets,
  scoreLineup,
  gradeVsPar,
  GRADE_LABEL,
  GRADE_BLURB,
  dayKey,
  type Lineup,
  type LineupScore,
  type DailyTargets,
  type GolfGrade,
} from '../engine/bestFive';

interface Props {
  mode: 'developer' | 'player';
  onBack: () => void;
}

const SLOT_LABEL: Record<Position, string> = { PG: 'Point guard', SG: 'Shooting guard', SF: 'Small forward', PF: 'Power forward', C: 'Center' };

const AXES: { key: keyof Pick<LineupScore, 'talent' | 'offense' | 'defense' | 'spacing' | 'fit'>; label: string }[] = [
  { key: 'talent', label: 'Talent' },
  { key: 'offense', label: 'Offense' },
  { key: 'defense', label: 'Defense' },
  { key: 'spacing', label: 'Spacing' },
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
export default function BestFive({ mode, onBack }: Props) {
  const dev = mode === 'developer';
  const key = useMemo(() => dayKey(), []);
  const pool = useMemo(() => dailyPool(key), [key]);

  const [lineup, setLineup] = useState<Lineup>({});
  const [activeSlot, setActiveSlot] = useState<Position | null>('PG');
  const [result, setResult] = useState<{ score: LineupScore; targets: DailyTargets; grade: GolfGrade } | null>(null);

  const filledCount = STARTER_SLOTS.filter((s) => lineup[s]).length;
  const complete = filledCount === 5;
  const liveScore = dev && filledCount > 0 ? scoreLineup(lineup) : null;

  function pick(slot: Position, span: PlayerSpan) {
    setLineup((prev) => ({ ...prev, [slot]: span }));
    const nextEmpty = STARTER_SLOTS.find((s) => s !== slot && !lineup[s] && s !== activeSlot);
    setActiveSlot(nextEmpty ?? null);
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

  function playAgain() {
    setLineup({});
    setActiveSlot('PG');
    setResult(null);
  }

  return (
    <div className="at-shell best-five">
      <div className="at-board-brand at-cond">Build the Best 5</div>
      <div className="bf-subhead">
        <span className="bf-date">Daily puzzle · {key}</span>
        <button className="at-legend-toggle at-cond" onClick={onBack}>
          ← Back
        </button>
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
                  <span className="bf-slot-name">{s ? s.playerName : 'Tap to pick'}</span>
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
                      <span className="bf-pool-name">{span.playerName}</span>
                      <span className="bf-pool-meta">
                        {naturalPosition(span.playerName)}
                        {dev && ` · TAL ${effectiveTalent(span)} · ${span.spanLabel}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bf-submit-row">
            {dev && liveScore && (
              <span className="bf-live at-cond">
                live composite {liveScore.composite}
                {!complete && ` (${filledCount}/5)`}
              </span>
            )}
            <button className="at-draft-btn bf-submit" disabled={!complete} onClick={submit}>
              Submit lineup
            </button>
          </div>
        </div>
      )}

      {result && (
        <BestFiveResult
          lineup={lineup}
          result={result}
          onPlayAgain={playAgain}
        />
      )}
    </div>
  );
}

function BestFiveResult({
  lineup,
  result,
  onPlayAgain,
}: {
  lineup: Lineup;
  result: { score: LineupScore; targets: DailyTargets; grade: GolfGrade };
  onPlayAgain: () => void;
}) {
  const { score, targets, grade } = result;
  const chosenIds = new Set(STARTER_SLOTS.map((s) => lineup[s]?.id));

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
        {AXES.map(({ key, label }) => (
          <div key={key} className="bf-bar-row">
            <span className="bf-bar-label at-cond">{label}</span>
            <span className="bf-bar-track">
              <span className="bf-bar-fill" style={{ width: `${Math.max(0, Math.min(100, score[key]))}%` }} />
            </span>
            <span className="bf-bar-val">{Math.round(score[key])}</span>
          </div>
        ))}
      </div>

      {score.weakLink && (
        <p className="bf-weaklink">
          Defensively, <b>{score.weakLink}</b> is the softest spot in this five — a lineup that can be hunted there.
        </p>
      )}

      <div className="bf-optimal">
        <div className="bf-optimal-head at-cond">The engine’s best five from today’s pool</div>
        {STARTER_SLOTS.map((slot) => {
          const s = targets.optimalFive[slot];
          const hit = chosenIds.has(s.id);
          return (
            <div key={slot} className={`bf-optimal-row ${hit ? 'bf-optimal-row--hit' : ''}`}>
              <span className="bf-optimal-pos at-cond">{slot}</span>
              <span className="bf-optimal-name">{s.playerName}</span>
              <span className="bf-optimal-mark">{hit ? '✓ you had this' : `you picked ${lineup[slot]?.playerName ?? '—'}`}</span>
            </div>
          );
        })}
      </div>

      <div className="bf-submit-row">
        <button className="at-legend-toggle at-cond" onClick={onPlayAgain}>
          Play again
        </button>
      </div>
    </div>
  );
}
