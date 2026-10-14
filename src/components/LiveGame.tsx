import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LegendFive } from '../engine/dailyMeta';
import { pregameOdds, type BoxLineStats, type GameMoment, type LiveGameResult } from '../engine/liveGame';
import { gameWinProbability } from '../engine/matchup';
import { Face } from './ShotChip';
import './LiveGame.css';

/**
 * A game played out live — the daily five's game of the day and the season's playoff games. The
 * game itself is `simulateLiveGame` / `playPairingGame`; this only plays it back.
 *
 * 2026-10-14, the "Simcast" redesign (approved mockups; the user: "coś w tym stylu, tylko żeby był
 * widok relacji"): a broadcast scoreboard — both teams' marks, the scores, the quarter and clock,
 * the win probability — over the play-by-play as the main thing, with Box score / Team comparison /
 * Match-ups tabs; beside it a court with the last shot, the score by quarter, who is being hunted
 * on defense and the leaders so far.
 */

/** 2026-10-14, the user ("ważne żeby wyważyć czas trwania"): about 12 s a quarter for the first
 * three, the fourth slower, a close finish (last two minutes, within 8) about a second a play so
 * every line can be read, and a blowout's fourth quarter fast. ~55-60 s for a one-sided game, ~80-90
 * s for a close one at ×1. A quarter break holds 2.5 s with one line on the quarter. Measured on 24
 * AI-drafted games: one-sided 53-58 s, close 64-73 s (the fourth 22-31 s of it). */
const PACE = { early: 250, fourth: 420, blowout: 170, clutchPlay: 1500, clutchQuiet: 500, quarterBreak: 2500 };
/** The last two minutes with the margin at most this many points. */
const CLUTCH = { seconds: 120, margin: 8 };
/** A fourth-quarter lead this big plays fast. */
const BLOWOUT_MARGIN = 20;
/** "Key moments" starts here: the second half of the fourth quarter. */
const KEY_MOMENTS_LEFT = 360;
const SPEEDS = [1, 2, 4] as const;

function isClutch(m: GameMoment | undefined): boolean {
  return !!m && m.quarter >= 3 && m.left <= CLUTCH.seconds && Math.abs(m.score[0] - m.score[1]) <= CLUTCH.margin;
}

/** How long to hold before showing moment `i`. */
function delayBefore(moments: GameMoment[], i: number): number {
  const m = moments[i];
  const prev = moments[i - 1];
  if (!m) return PACE.early;
  if (prev && prev.quarter !== m.quarter) return PACE.quarterBreak;
  if (isClutch(prev ?? m)) return m.play && !m.play.quiet ? PACE.clutchPlay : PACE.clutchQuiet;
  if (m.quarter >= 3) return Math.abs(m.score[0] - m.score[1]) >= BLOWOUT_MARGIN ? PACE.blowout : PACE.fourth;
  return PACE.early;
}

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

function quarterClock(m: GameMoment | undefined): string {
  if (!m) return '12:00';
  const quarterLeft = Math.max(0, m.left - (3 - m.quarter) * 720);
  const mm = Math.floor(quarterLeft / 60);
  const ss = Math.floor(quarterLeft % 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

const QUARTER_NAME = ['1st', '2nd', '3rd', '4th'];

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The same name-to-hue hash the results screen's team marks use. */
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** A game between two teams (the season's playoffs): both sides by name, one of them yours. */
export interface LiveMatchup {
  title: string;
  subtitle: string;
  /** Full names and short labels, side 0 first. */
  names: [string, string];
  short: [string, string];
  /** Three-letter codes, for the marks and the narrow quarter table. */
  codes: [string, string];
  yourSide: 0 | 1;
}

type Tab = 'feed' | 'box' | 'teams' | 'matchups';

interface FeedRow {
  key: string;
  kind: 'play' | 'note' | 'break';
  side?: 0 | 1;
  time?: string;
  text: string;
  score?: string;
  /** The player who made the play (full name, for his face). */
  actor?: string;
  scored?: boolean;
}

/** Where on the floor a play happened, from its words: at the rim, mid-range or from three. */
function shotZone(text: string): 'rim' | 'mid' | 'three' | null {
  if (/\bthree\b/i.test(text)) return 'three';
  if (/layup|dunk|putback|tip-in|alley|hook|at the rim/i.test(text)) return 'rim';
  if (/jumper|fadeaway|floater|mid-range/i.test(text)) return 'mid';
  return null;
}

export default function LiveGame({
  game,
  opponent,
  matchup,
  autoStart,
  autoPlay = false,
  doneAction,
  onFinish,
}: {
  game: LiveGameResult;
  /** The daily's opponent (side 1; you are side 0). Unused when `matchup` is given. */
  opponent?: LegendFive;
  matchup?: LiveMatchup;
  autoStart: boolean;
  /** Start playing at once, without the tip-off button (the playoffs' "Play game N"). */
  autoPlay?: boolean;
  /** Called once the final is on the board (played out or skipped). */
  onFinish?: () => void;
  /** Replaces "Watch again" in the top bar once the final is in (the playoffs' next game). */
  doneAction?: ReactNode;
}) {
  const short: [string, string] = matchup ? matchup.short : ['You', opponent?.short ?? 'Them'];
  const names: [string, string] = matchup ? matchup.names : ['Your five', opponent?.name ?? 'Them'];
  const codes: [string, string] = matchup ? matchup.codes : ['YOU', (opponent?.short ?? 'OPP').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'OPP'];
  const yourSide = matchup ? matchup.yourSide : 0;
  const hues: [number, number] = [hueOf(names[0]), hueOf(names[1])];
  const total = game.moments.length;
  // -1: before tip-off. `total`: final.
  const [shown, setShown] = useState(autoStart && !prefersReducedMotion() ? (autoPlay ? 0 : -1) : total);
  const [running, setRunning] = useState(autoStart && autoPlay && !prefersReducedMotion());
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [tab, setTab] = useState<Tab>('feed');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    timer.current = window.setTimeout(() => {
      setShown((n) => {
        const next = Math.min(total, n + 1);
        if (next >= total) setRunning(false);
        return next;
      });
    }, delayBefore(game.moments, Math.max(0, shown)) / speed);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [running, shown, speed, total, game.moments]);

  const done = shown >= total;
  useEffect(() => {
    if (done) onFinish?.();
  }, [done, onFinish]);
  const upto = Math.max(0, Math.min(shown, total));
  const now = upto > 0 ? game.moments[upto - 1] : undefined;
  const score = now?.score ?? [0, 0];
  const fullName = (side: 0 | 1, label: string) => game.players[side][game.labels[side].indexOf(label)]?.playerName ?? label;

  const quarters = useMemo(() => {
    const q: [number[], number[]] = [[0, 0, 0, 0], [0, 0, 0, 0]];
    let prev: [number, number] = [0, 0];
    for (const m of game.moments.slice(0, upto)) {
      q[0][m.quarter] += m.score[0] - prev[0];
      q[1][m.quarter] += m.score[1] - prev[1];
      prev = m.score;
    }
    return q;
  }, [game.moments, upto]);

  const feed = useMemo(() => {
    const rows: FeedRow[] = [];
    // A run: one side's points since the other last scored more than two; called at 8, then every 4.
    let runSide = -1;
    let runPts = 0;
    let runOpp = 0;
    let called = 0;
    let leader = 0;
    let quarterStartLines: [BoxLineStats[], BoxLineStats[]] | null = null;
    for (let i = 0; i < upto; i++) {
      const m = game.moments[i];
      const before = i > 0 ? game.moments[i - 1].score : [0, 0];
      for (const side of [0, 1] as const) {
        const pts = m.score[side] - before[side];
        if (pts <= 0) continue;
        if (side === runSide) runPts += pts;
        else {
          runOpp += pts;
          if (runOpp > 2) {
            runSide = side;
            runPts = runOpp;
            runOpp = 0;
            called = 0;
          }
        }
      }
      if (runSide >= 0 && runPts >= 8 && runPts >= called + 4) {
        called = runPts;
        rows.push({ key: `r${i}`, kind: 'note', text: `${short[runSide]} on a ${runPts}–${runOpp} run` });
      }
      // 2026-10-14 (playtest: "dlaczego Nash zagrał tylko 29 minut, kiedy ma ustawione 39" — he had
      // fouled out, and nothing said so): a fifth foul and a sixth get their own line.
      const prevLines = i > 0 ? game.moments[i - 1].lines : null;
      for (const side of [0, 1] as const) {
        m.lines[side].forEach((l, k) => {
          const before = prevLines ? prevLines[side][k].pf : 0;
          if (l.pf >= 6 && before < 6) rows.push({ key: `f${i}-${side}-${k}`, kind: 'note', text: `${game.labels[side][k]} fouls out — his minutes go to the bench` });
          else if (l.pf === 5 && before < 5) rows.push({ key: `f${i}-${side}-${k}`, kind: 'note', text: `${game.labels[side][k]} picks up his 5th foul` });
        });
      }
      const lead = Math.sign(m.score[0] - m.score[1]);
      if (lead !== 0 && leader !== 0 && lead !== leader && m.quarter >= 3) rows.push({ key: `l${i}`, kind: 'note', text: `Lead change · ${short[lead > 0 ? 0 : 1]} in front` });
      if (lead !== 0) leader = lead;
      if (m.play && !m.play.quiet) {
        const side = m.play.side;
        const actorLabel = game.labels[side].find((l) => m.play!.text.startsWith(l));
        rows.push({
          key: `p${i}`,
          kind: 'play',
          side,
          time: quarterClock(m),
          text: m.play.text,
          score: `${m.score[0]}–${m.score[1]}`,
          actor: actorLabel ? fullName(side, actorLabel) : undefined,
          scored: m.score[side] > before[side],
        });
      }
      const next = game.moments[i + 1];
      if (!next || next.quarter !== m.quarter) {
        // One line on the quarter: who won it and its top scorer.
        const qa = m.score[0] - (quarterStartLines ? quarterStartLines[0].reduce((s, l) => s + l.pts, 0) : 0);
        const qb = m.score[1] - (quarterStartLines ? quarterStartLines[1].reduce((s, l) => s + l.pts, 0) : 0);
        let best = { side: 0 as 0 | 1, label: '', pts: 0 };
        for (const side of [0, 1] as const) {
          m.lines[side].forEach((l, k) => {
            const pts = l.pts - (quarterStartLines ? quarterStartLines[side][k].pts : 0);
            if (pts > best.pts) best = { side, label: game.labels[side][k], pts };
          });
        }
        const winner = qa === qb ? `${QUARTER_NAME[m.quarter]} quarter even at ${qa}` : `${short[qa > qb ? 0 : 1]} take the ${QUARTER_NAME[m.quarter]} ${Math.max(qa, qb)}–${Math.min(qa, qb)}`;
        if (next) rows.push({ key: `q${i}`, kind: 'break', text: `End of the ${QUARTER_NAME[m.quarter]} · ${short[0]} ${m.score[0]}–${m.score[1]} ${short[1]} — ${winner}${best.pts > 0 ? ` · ${best.label} ${best.pts} pts` : ''}` });
        quarterStartLines = m.lines;
      }
    }
    if (done) rows.push({ key: 'final', kind: 'break', text: `Final · ${short[0]} ${game.final[0]}–${game.final[1]} ${short[1]}` });
    return rows.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, upto, done, short[0], short[1]]);

  // Who gets hunted on defense: "X attacks Nash — …" plays so far, by defender.
  const hunted = useMemo(() => {
    const counts = new Map<string, { side: 0 | 1; label: string; n: number; by: Set<string> }>();
    for (let i = 0; i < upto; i++) {
      const play = game.moments[i].play;
      if (!play) continue;
      const hit = /^(\S+(?: \S+)?) attacks (\S+(?:-\S+)?)/.exec(play.text);
      if (!hit) continue;
      const defenderSide = (1 - play.side) as 0 | 1;
      const key = `${defenderSide}:${hit[2]}`;
      const entry = counts.get(key) ?? { side: defenderSide, label: hit[2], n: 0, by: new Set<string>() };
      entry.n += 1;
      entry.by.add(hit[1]);
      counts.set(key, entry);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n);
  }, [game.moments, upto]);

  const lines = now?.lines ?? [game.labels[0].map(zero), game.labels[1].map(zero)];
  const leaders = ([0, 1] as const).map((side) => {
    let best = -1;
    lines[side].forEach((l, k) => {
      if (best < 0 || l.pts > lines[side][best].pts) best = k;
    });
    return best >= 0 && lines[side][best].pts > 0 ? { side, label: game.labels[side][best], line: lines[side][best] } : null;
  });

  const lastShot = useMemo(() => {
    for (let i = upto - 1; i >= 0; i--) {
      const m = game.moments[i];
      if (!m.play || m.play.quiet) continue;
      const before = i > 0 ? game.moments[i - 1].score : [0, 0];
      const pts = m.score[m.play.side] - before[m.play.side];
      if (pts <= 0) continue;
      const zone = shotZone(m.play.text);
      if (!zone) continue;
      return { side: m.play.side, zone, text: m.play.text.split(' (')[0], pts };
    }
    return null;
  }, [game.moments, upto]);

  const p = Math.round(winProbability(now, game.expectedMargin) * 100);
  const yourP = yourSide === 0 ? p : 100 - p;
  const clutch = !done && upto > 0 && isClutch(now);
  const atBreak = !done && upto > 0 && !!now && !!game.moments[upto] && game.moments[upto].quarter !== now.quarter;
  const won = game.final[0] > game.final[1];
  // 2026-09-30, the user chose A + B: a clear favourite always wins; a close game shows its odds up
  // front and calls an upset an upset. Team games have no clear favourite: anyone can lose.
  const odds = matchup ? { you: gameWinProbability(game.expectedMargin), clear: false } : pregameOdds(game.expectedMargin);
  const favourite = game.expectedMargin >= 0;
  const upset = !odds.clear && won !== favourite;
  const youPct = Math.round(odds.you * 100);
  const keyMomentIdx = game.moments.findIndex((m) => m.quarter >= 3 && m.left <= KEY_MOMENTS_LEFT);

  function start(from = 0) {
    setShown(from);
    setSpeed(1);
    setRunning(true);
  }
  const vars = { '--sc-a': `hsl(${hues[0]} 62% 52%)`, '--sc-b': `hsl(${hues[1]} 62% 52%)`, '--sc-a-deep': `hsl(${hues[0]} 55% 30%)`, '--sc-b-deep': `hsl(${hues[1]} 55% 30%)` } as CSSProperties;
  const sideColor = (side: 0 | 1) => (side === 0 ? 'var(--sc-a)' : 'var(--sc-b)');

  const mark = (side: 0 | 1, big = true) => (
    <span className={`sc-mark${big ? '' : ' sc-mark--sm'}`} style={{ background: `linear-gradient(160deg, hsl(${hues[side]} 55% 32%) 0 60%, hsl(${(hues[side] + 40) % 360} 72% 55%) 60%)` }} aria-hidden>
      {codes[side]}
    </span>
  );

  return (
    <section className="sc" style={vars} aria-label={matchup ? `${matchup.names[0]} against ${matchup.names[1]}` : `Game of the day: you against the ${opponent?.name}`}>
      <div className="sc-top">
        <span className="sc-title">{matchup ? matchup.title : 'Game of the day'}</span>
        <span className="sc-sub">{matchup ? matchup.subtitle : `You vs ${opponent?.name}`}</span>
        <span className="sc-gap" />
        <span className="sc-ctl">
          {shown < 0 ? (
            <>
              {keyMomentIdx > 0 && (
                <button type="button" className="sc-btn" onClick={() => start(keyMomentIdx)}>
                  Key moments
                </button>
              )}
              <button type="button" className="sc-btn sc-btn--go" onClick={() => start(0)}>
                Tip-off
              </button>
            </>
          ) : !done ? (
            <>
              <button type="button" className="sc-btn" onClick={() => setRunning((r) => !r)} aria-pressed={!running} aria-label={running ? 'Pause' : 'Play'}>
                {running ? '❚❚' : '▶'}
                <span className="sc-long">{running ? ' Pause' : ' Play'}</span>
              </button>
              <span className="sc-speeds" role="group" aria-label="Speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" className={speed === s ? 'is-on' : ''} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                    ×{s}
                  </button>
                ))}
              </span>
              {keyMomentIdx > upto && (
                <button type="button" className="sc-btn" onClick={() => setShown(keyMomentIdx)}>
                  Key moments
                </button>
              )}
              <button
                type="button"
                className="sc-btn sc-btn--go"
                onClick={() => {
                  setRunning(false);
                  setShown(total);
                }}
              >
                Skip<span className="sc-long"> to final</span>
              </button>
            </>
          ) : (
            (doneAction ?? (
              <button type="button" className="sc-btn" onClick={() => start(0)}>
                Watch again
              </button>
            ))
          )}
        </span>
      </div>

      <div className="sc-board" role="status" aria-live="off">
        <div className={`sc-team${done && !won ? ' is-lost' : ''}`}>
          {mark(0)}
          <span className="sc-team-id">
            <span className="sc-team-name">{names[0]}</span>
            {yourSide === 0 && <span className="sc-you">You</span>}
          </span>
          <span className="sc-pts">{score[0]}</span>
        </div>
        <div className="sc-center">
          <span className="sc-clock-row">
            <span className={`sc-q${clutch ? ' is-clutch' : ''}`}>{done ? 'FINAL' : shown < 0 ? 'TIP-OFF' : atBreak ? `END ${QUARTER_NAME[now!.quarter].toUpperCase()}` : QUARTER_NAME[now?.quarter ?? 0].toUpperCase()}</span>
            {!done && shown >= 0 && !atBreak && <span className="sc-clock">{quarterClock(now)}</span>}
          </span>
          {shown < 0 ? (
            <span className="sc-odds">
              {odds.clear ? (favourite ? 'You are the clear favourite' : `The ${short[1]} are the clear favourite`) : `Pre-game: ${short[0]} ${youPct}% · ${short[1]} ${100 - youPct}%`}
            </span>
          ) : done ? (
            <span className="sc-odds">{won ? short[0] : short[1]} by {Math.abs(game.final[0] - game.final[1])}</span>
          ) : (
            <span className="sc-wp" aria-label={`Win probability: ${short[yourSide]} ${yourP}%`}>
              <span className="sc-wp-lbl">
                <span>Win probability</span>
                <b>
                  {yourP}% {yourSide === 0 ? short[0] : short[1]}
                </b>
              </span>
              <span className="sc-wp-bar">
                <i style={{ width: `${p}%` }} />
              </span>
            </span>
          )}
        </div>
        <div className={`sc-team sc-team--b${done && won ? ' is-lost' : ''}`}>
          {mark(1)}
          <span className="sc-team-id">
            <span className="sc-team-name">{names[1]}</span>
            {yourSide === 1 && <span className="sc-you">You</span>}
          </span>
          <span className="sc-pts">{score[1]}</span>
        </div>
      </div>

      <div className="sc-body">
        <div className="sc-main">
          <nav className="sc-tabs" role="tablist">
            {(
              [
                ['feed', 'Play-by-play'],
                ['box', 'Box score'],
                ['teams', 'Team stats'],
                ['matchups', 'Match-ups'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {hunted[0] && hunted[0].n >= 3 && tab === 'feed' && (
            <p className="sc-hunt sc-hunt--inline">
              <b>{hunted[0].side === yourSide ? `They're hunting ${hunted[0].label}` : `${short[yourSide]} are hunting ${hunted[0].label}`}</b> —{' '}
              {[...hunted[0].by].join(' and ')} {hunted[0].by.size > 1 ? 'have' : 'has'} gone at him {hunted[0].n} times.
            </p>
          )}
          {tab === 'feed' && (
            <div className="sc-feed" aria-live="off">
              {shown < 0 ? (
                <div className="sc-break">Starting fives are on the floor.</div>
              ) : (
                feed.map((r, idx) =>
                  r.kind === 'play' ? (
                    <div key={r.key} className={`sc-play${idx === 0 && !done ? ' is-latest' : ''}${r.scored ? ' is-score' : ''}`}>
                      <span className="sc-play-t">{r.time}</span>
                      <span className="sc-play-stripe" style={{ background: sideColor(r.side!) }} />
                      {r.actor ? (
                        <span className="sc-play-face" style={{ boxShadow: `0 0 0 2px ${sideColor(r.side!)}` }}>
                          <Face name={r.actor} size="sm" />
                        </span>
                      ) : (
                        <span className="sc-play-face sc-play-face--none" />
                      )}
                      <span className="sc-play-text">{r.text}</span>
                      <span className="sc-play-s">{r.score}</span>
                    </div>
                  ) : r.kind === 'note' ? (
                    <div key={r.key} className="sc-note">{r.text}</div>
                  ) : (
                    <div key={r.key} className="sc-break">{r.text}</div>
                  ),
                )
              )}
            </div>
          )}
          {tab === 'box' && (
            <div className="sc-boxes">
              {([0, 1] as const).map((side) => (
                <BoxTable key={side} title={names[side]} color={sideColor(side)} labels={game.labels[side]} lines={lines[side]} joker={side === 0 ? game.jokerLabel : null} star={done && !matchup && side === 0 ? game.star.name : null} />
              ))}
            </div>
          )}
          {tab === 'teams' && <TeamComparison lines={lines} short={short} />}
          {tab === 'matchups' && (
            <div className="sc-panel">
              {hunted.length === 0 ? (
                <p className="sc-empty">No one has been singled out on defense yet.</p>
              ) : (
                hunted.map((h) => (
                  <div key={`${h.side}${h.label}`} className="sc-mu">
                    <span className="sc-mu-n" style={{ color: sideColor(h.side === 0 ? 1 : 0) }}>
                      ×{h.n}
                    </span>
                    <span>
                      <b>{h.label}</b> ({short[h.side]}) attacked by {[...h.by].join(', ')}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
          {done && (
            <p className={`sc-final${won === (yourSide === 0) ? '' : ' is-loss'}`}>
              {upset && <span className="sc-upset">Upset! </span>}
              {game.recap}
              <small>
                ★ {game.star.name}: {game.star.line.pts} pts · {game.star.line.reb} reb · {game.star.line.ast} ast.
                {upset && !matchup && (won ? ` You had a ${youPct}% chance.` : ` You were ${youPct}% favourites — it happens in close games.`)}
                {upset && matchup && ` The ${won ? short[0] : short[1]} had a ${won ? youPct : 100 - youPct}% chance.`}
              </small>
            </p>
          )}
        </div>

        <aside className="sc-side">
          <div className="sc-court" aria-hidden>
            <svg viewBox="0 0 440 168" preserveAspectRatio="xMidYMid meet">
              <rect x="0" y="0" width="220" height="168" fill="var(--sc-a-deep)" />
              <rect x="220" y="0" width="220" height="168" fill="var(--sc-b-deep)" />
              <g fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5">
                <rect x="8" y="8" width="424" height="152" rx="2" />
                <line x1="220" y1="8" x2="220" y2="160" />
                <circle cx="220" cy="84" r="22" />
                <rect x="8" y="56" width="62" height="56" />
                <rect x="370" y="56" width="62" height="56" />
                <path d="M8 22 H40 A72 72 0 0 1 40 146 H8" />
                <path d="M432 22 H400 A72 72 0 0 0 400 146 H432" />
                <circle cx="22" cy="84" r="4" />
                <circle cx="418" cy="84" r="4" />
              </g>
              {lastShot && <ShotMarker key={upto} side={lastShot.side} zone={lastShot.zone} />}
            </svg>
            {lastShot && (
              <span className="sc-court-lbl">
                {lastShot.text} · +{lastShot.pts}
              </span>
            )}
          </div>
          <div className="sc-qs" role="table" aria-label="Score by quarter">
            <span className="is-head">Team</span>
            {['1st', '2nd', '3rd', '4th'].map((h) => (
              <span key={h} className="is-head">{h}</span>
            ))}
            <span className="is-head is-total">Total</span>
            {([0, 1] as const).map((side) => (
              <QuarterRow key={side} name={codes[side]} color={sideColor(side)} q={quarters[side]} total={score[side]} upto={done ? 3 : (now?.quarter ?? -1)} />
            ))}
          </div>
          {hunted[0] && hunted[0].n >= 3 && (
            <div className="sc-hunt">
              <b>{hunted[0].side === yourSide ? `They're hunting ${hunted[0].label}` : `${short[yourSide]} are hunting ${hunted[0].label}`}</b>
              <span>
                {[...hunted[0].by].join(' and ')} {hunted[0].by.size > 1 ? 'have' : 'has'} gone at him {hunted[0].n} times.
              </span>
            </div>
          )}
          {(leaders[0] || leaders[1]) && (
            <div className="sc-leaders">
              <span className="sc-leaders-h">{done ? 'Leaders' : 'Leaders so far'}</span>
              {leaders.map(
                (l) =>
                  l && (
                    <div key={l.side} className="sc-leader">
                      <span className="sc-play-face" style={{ boxShadow: `0 0 0 2px ${sideColor(l.side)}` }}>
                        <Face name={fullName(l.side, l.label)} size="sm" />
                      </span>
                      <span className="sc-leader-name">
                        {l.label} <span>{codes[l.side]}</span>
                      </span>
                      <span className="sc-leader-line">
                        {l.line.pts} pts · {l.line.reb} reb · {l.line.ast} ast
                      </span>
                    </div>
                  ),
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

/** The last basket on the court: at the rim, mid-range or from three, at the basket that side attacks
 * (side 0 shoots at the right one). Placed by the play's words, not tracked positions. */
function ShotMarker({ side, zone }: { side: 0 | 1; zone: 'rim' | 'mid' | 'three' }) {
  const rimX = side === 0 ? 418 : 22;
  const dir = side === 0 ? -1 : 1;
  const dist = zone === 'rim' ? 14 : zone === 'mid' ? 48 : 86;
  const y = zone === 'three' ? 50 : 84 + (zone === 'mid' ? -14 : 0);
  const x = rimX + dir * dist;
  return (
    <g className="sc-shot">
      <circle cx={x} cy={y} r="13" fill="none" stroke="#ffd479" strokeWidth="2" opacity="0.5" />
      <circle cx={x} cy={y} r="7" fill="#ffd479" />
    </g>
  );
}

function zero(): BoxLineStats {
  return { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0, min: 0 };
}

function sum(lines: BoxLineStats[]): BoxLineStats {
  return lines.reduce((acc, l) => {
    const next = { ...acc };
    for (const key of Object.keys(next) as (keyof BoxLineStats)[]) next[key] += l[key] ?? 0;
    return next;
  }, zero());
}

function QuarterRow({ name, color, q, total, upto }: { name: string; color: string; q: number[]; total: number; upto: number }) {
  return (
    <>
      <span className="is-name" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
        {name}
      </span>
      {q.map((v, i) => (
        <span key={i} className={i === upto ? 'is-now' : undefined}>
          {i <= upto ? v : ''}
        </span>
      ))}
      <span className="is-total">{total}</span>
    </>
  );
}

function TeamComparison({ lines, short }: { lines: [BoxLineStats[], BoxLineStats[]]; short: [string, string] }) {
  const [a, b] = [sum(lines[0]), sum(lines[1])];
  const pct = (m: number, t: number) => (t > 0 ? (100 * m) / t : 0);
  const rows: Array<[string, number, number, boolean]> = [
    ['FG%', pct(a.fgm, a.fga), pct(b.fgm, b.fga), true],
    ['3P%', pct(a.tpm, a.tpa), pct(b.tpm, b.tpa), true],
    ['FT%', pct(a.ftm, a.fta), pct(b.ftm, b.fta), true],
    ['Free throws', a.fta, b.fta, false],
    ['Rebounds', a.reb, b.reb, false],
    ['Assists', a.ast, b.ast, false],
    ['Steals', a.stl, b.stl, false],
    ['Blocks', a.blk, b.blk, false],
    ['Turnovers', a.tov, b.tov, false],
  ];
  return (
    <div className="sc-panel sc-compare">
      <div className="sc-compare-head">
        <span>{short[0]}</span>
        <span>{short[1]}</span>
      </div>
      {rows.map(([label, x, y, isPct]) => {
        const total = x + y || 1;
        return (
          <div key={label} className="sc-cmp">
            <span className="sc-cmp-v">{isPct ? x.toFixed(1) : x}</span>
            <span className="sc-cmp-mid">
              <span className="sc-cmp-lbl">{label}</span>
              <span className="sc-cmp-bar">
                <i style={{ width: `${(x / total) * 100}%`, background: 'var(--sc-a)' }} />
                <i style={{ width: `${(y / total) * 100}%`, background: 'var(--sc-b)' }} />
              </span>
            </span>
            <span className="sc-cmp-v is-b">{isPct ? y.toFixed(1) : y}</span>
          </div>
        );
      })}
    </div>
  );
}

function BoxTable({ title, color, labels, lines, joker, star }: { title: string; color: string; labels: string[]; lines: BoxLineStats[]; joker: string | null; star: string | null }) {
  const total = sum(lines);
  const top = Math.max(0, ...lines.map((l) => l.pts));
  const pct = (made: number, att: number) => (att > 0 ? `${Math.round((100 * made) / att)}%` : '—');
  const row = (l: BoxLineStats) => (
    <>
      <td>{Math.round(l.min)}</td>
      <td>{l.pts}</td>
      <td>{l.reb}</td>
      <td>{l.ast}</td>
      <td>{l.stl}</td>
      <td>{l.blk}</td>
      <td>{l.tov}</td>
      <td>
        {l.fgm}-{l.fga}
      </td>
      <td>
        {l.tpm}-{l.tpa}
      </td>
      <td>
        {l.ftm}-{l.fta}
      </td>
      <td className={l.pf >= 6 ? 'is-out' : undefined}>{l.pf}</td>
    </>
  );
  return (
    <div className="sc-table-wrap">
      <table className="sc-table">
        <caption style={{ boxShadow: `inset 4px 0 0 ${color}` }}>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">MIN</th>
            <th scope="col">PTS</th>
            <th scope="col">REB</th>
            <th scope="col">AST</th>
            <th scope="col">STL</th>
            <th scope="col">BLK</th>
            <th scope="col">TO</th>
            <th scope="col">FG</th>
            <th scope="col">3P</th>
            <th scope="col">FT</th>
            <th scope="col">PF</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((name, i) => {
            const l = lines[i];
            return (
              <tr key={name} className={[name === joker ? 'is-joker' : '', top > 0 && l.pts === top ? 'is-top' : ''].filter(Boolean).join(' ') || undefined}>
                <th scope="row">
                  {name === joker && '🃏 '}
                  {name}
                  {name === star && ' ★'}
                  {l.pf >= 6 && <span className="sc-out">Fouled out</span>}
                </th>
                {row({ ...l })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="sc-total">
            <th scope="row">Team</th>
            {row(total)}
          </tr>
          <tr className="sc-pct">
            <th scope="row" />
            <td colSpan={7} />
            <td>{pct(total.fgm, total.fga)}</td>
            <td>{pct(total.tpm, total.tpa)}</td>
            <td>{pct(total.ftm, total.fta)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
