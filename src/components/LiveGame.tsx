import { useEffect, useMemo, useRef, useState } from 'react';
import type { LegendFive } from '../engine/dailyMeta';
import type { BoxLineStats, GameMoment, LiveGameResult } from '../engine/liveGame';

/**
 * 2026-09-28, the user ("symulacja super"): the daily five's game against the opponent of the day,
 * played out live — scoreboard, win probability, quarters, the play-by-play and both box scores,
 * about 35 seconds, with ×2 and "Skip to final". The game itself is `simulateLiveGame`; this only
 * plays it back. A daily reopened later shows the final straight away, with "Watch again".
 */

const TICK_MS = 175;

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  return sign * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax));
}

/** Your chance to win from the score, the clock and the model's expected margin. */
function winProbability(moment: GameMoment | undefined, expected: number): number {
  const left = moment ? moment.left / 2880 : 1;
  const lead = moment ? moment.score[0] - moment.score[1] : 0;
  if (moment && left <= 0) return lead > 0 ? 1 : 0;
  const sd = 12 * Math.sqrt(Math.max(left, 0.002));
  return 0.5 * (1 + erf((lead + expected * left) / (sd * Math.SQRT2)));
}

function clock(m: GameMoment | undefined): string {
  if (!m) return 'Q1 12:00';
  const quarterLeft = Math.max(0, m.left - (3 - m.quarter) * 720);
  const mm = Math.floor(quarterLeft / 60);
  const ss = Math.floor(quarterLeft % 60);
  return `Q${m.quarter + 1} ${mm}:${String(ss).padStart(2, '0')}`;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function LiveGame({ game, opponent, autoStart }: { game: LiveGameResult; opponent: LegendFive; autoStart: boolean }) {
  const total = game.moments.length;
  // -1: before tip-off. `total`: final.
  const [shown, setShown] = useState(autoStart && !prefersReducedMotion() ? -1 : total);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    timer.current = window.setTimeout(() => {
      setShown((n) => {
        const next = Math.min(total, n + 1);
        if (next >= total) setRunning(false);
        return next;
      });
    }, TICK_MS / speed);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [running, shown, speed, total]);

  const done = shown >= total;
  const now = shown > 0 ? game.moments[Math.min(shown, total) - 1] : undefined;
  const score = now?.score ?? [0, 0];
  const quarters = useMemo(() => {
    const q: [number[], number[]] = [[0, 0, 0, 0], [0, 0, 0, 0]];
    let prev: [number, number] = [0, 0];
    for (const m of game.moments.slice(0, Math.max(0, shown))) {
      q[0][m.quarter] += m.score[0] - prev[0];
      q[1][m.quarter] += m.score[1] - prev[1];
      prev = m.score;
    }
    return q;
  }, [game.moments, shown]);
  const feed = useMemo(() => {
    const rows: { key: string; cls: string; time?: string; text: string; score?: string }[] = [];
    const upto = Math.max(0, Math.min(shown, total));
    for (let i = 0; i < upto; i++) {
      const m = game.moments[i];
      if (m.play && !m.play.quiet) {
        rows.push({
          key: `p${i}`,
          cls: m.play.joker ? 'is-joker' : m.play.side === 0 ? 'is-you' : 'is-them',
          time: clock(m).slice(3),
          text: m.play.text,
          score: `${m.score[0]}–${m.score[1]}`,
        });
      }
      const next = game.moments[i + 1];
      if (next && next.quarter !== m.quarter) rows.push({ key: `q${i}`, cls: 'is-quarter', text: `End of Q${m.quarter + 1} · You ${m.score[0]}–${m.score[1]}` });
    }
    if (done) rows.push({ key: 'final', cls: 'is-quarter', text: `Final · You ${game.final[0]}–${game.final[1]}` });
    return rows.slice(-12).reverse();
  }, [game.moments, shown, total, done, game.final]);

  const p = Math.round(winProbability(now, game.expectedMargin) * 100);
  const won = game.final[0] > game.final[1];
  const lines = now?.lines ?? [game.labels[0].map(zero), game.labels[1].map(zero)];

  function start() {
    setShown(0);
    setSpeed(1);
    setRunning(true);
  }

  return (
    <section className="bf-live" aria-label={`Game of the day: you against the ${opponent.name}`}>
      <div className="bf-live-head">
        <span className="bf-live-title at-cond">Game of the day</span>
        <span className="bf-live-sub">You vs {opponent.name}</span>
      </div>
      <div className="bf-live-board">
        <div>
          <span className="bf-live-team at-cond">You</span>
          <span className="bf-live-pts">{score[0]}</span>
        </div>
        <div className="bf-live-clock">
          <b>{done ? 'Final' : shown < 0 ? 'Tip-off' : clock(now)}</b>
          <span>{done ? '' : shown < 0 ? 'waiting' : 'live'}</span>
        </div>
        <div className="bf-live-right">
          <span className="bf-live-team at-cond">{opponent.short}</span>
          <span className="bf-live-pts">{score[1]}</span>
        </div>
      </div>
      <div className="bf-live-wp" aria-label={`Win probability: you ${p}%`}>
        <div className="bf-live-wp-bar">
          <i style={{ width: `${p}%` }} />
        </div>
        <div className="bf-live-wp-lbl">
          <span>You {p}%</span>
          <span>win probability</span>
          <span>{100 - p}%</span>
        </div>
      </div>
      <div className="bf-live-qs" role="table" aria-label="Score by quarter">
        <span />
        {['Q1', 'Q2', 'Q3', 'Q4', 'T'].map((h) => (
          <span key={h} className="is-head">{h}</span>
        ))}
        {(['You', opponent.short] as const).map((name, side) => (
          <QuarterRow key={name} name={side === 0 ? 'You' : 'Them'} q={quarters[side]} total={score[side]} upto={now?.quarter ?? (done ? 3 : -1)} />
        ))}
      </div>
      <div className="bf-live-feed" aria-live="off">
        {shown < 0 ? (
          <div className="is-quarter">Starting fives are on the floor.</div>
        ) : (
          feed.map((r) =>
            r.cls === 'is-quarter' ? (
              <div key={r.key} className="is-quarter">{r.text}</div>
            ) : (
              <div key={r.key} className={r.cls}>
                <span className="bf-live-t">{r.time}</span>
                <span>{r.text}</span>
                <span className="bf-live-s">{r.score}</span>
              </div>
            ),
          )
        )}
      </div>
      {done && (
        <p className={`bf-live-final${won ? '' : ' is-loss'}`} role="status">
          {won ? `You beat the ${opponent.short} ` : `The ${opponent.short} beat you `}
          {Math.max(...game.final)}–{Math.min(...game.final)}
          <small>
            ★ {game.star.name}: {game.star.line.pts} pts · {game.star.line.reb} reb · {game.star.line.ast} ast. {game.recap}
          </small>
        </p>
      )}
      <div className="bf-live-ctl">
        {shown < 0 ? (
          <button type="button" className="primary-btn" onClick={start}>
            Tip-off
          </button>
        ) : !done ? (
          <>
            <button type="button" className="secondary-btn" onClick={() => setSpeed((v) => (v === 1 ? 2 : 1))}>
              {speed === 1 ? '×2' : '×1'}
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setRunning(false);
                setShown(total);
              }}
            >
              Skip to final
            </button>
          </>
        ) : (
          <button type="button" className="secondary-btn" onClick={start}>
            Watch again
          </button>
        )}
      </div>
      <details className="bf-live-box" open>
        <summary className="at-cond">Box score</summary>
        <BoxTable title="You" labels={game.labels[0]} lines={lines[0]} joker={game.jokerLabel} star={done ? game.star.name : null} />
        <BoxTable title={opponent.short} labels={game.labels[1]} lines={lines[1]} joker={null} star={null} />
      </details>
    </section>
  );
}

function zero(): BoxLineStats {
  return { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0 };
}

function QuarterRow({ name, q, total, upto }: { name: string; q: number[]; total: number; upto: number }) {
  return (
    <>
      <span className="is-name">{name}</span>
      {q.map((v, i) => (
        <span key={i}>{i <= upto ? v : ''}</span>
      ))}
      <span className="is-total">{total}</span>
    </>
  );
}

function BoxTable({ title, labels, lines, joker, star }: { title: string; labels: string[]; lines: BoxLineStats[]; joker: string | null; star: string | null }) {
  return (
    <table className="bf-live-table">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Player</th>
          <th scope="col">PTS</th>
          <th scope="col">REB</th>
          <th scope="col">AST</th>
          <th scope="col">STL</th>
          <th scope="col">BLK</th>
          <th scope="col">FG</th>
        </tr>
      </thead>
      <tbody>
        {labels.map((name, i) => {
          const l = lines[i];
          return (
            <tr key={name} className={name === joker ? 'is-joker' : undefined}>
              <th scope="row">
                {name === joker && '🃏 '}
                {name}
                {name === star && ' ★'}
              </th>
              <td>{l.pts}</td>
              <td>{l.reb}</td>
              <td>{l.ast}</td>
              <td>{l.stl}</td>
              <td>{l.blk}</td>
              <td>
                {l.fgm}-{l.fga}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
