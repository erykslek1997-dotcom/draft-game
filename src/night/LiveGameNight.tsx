import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlayerSpan } from '../data/schema';
import { pregameOdds, type BoxLineStats, type GameMoment, type LiveGameResult } from '../engine/liveGame';
import { gameCalls, sayPlay } from '../engine/gameCalls';
import { gameWinProbability } from '../engine/matchup';
import { maskName } from '../components/bombMask';
import { reducedMotion } from '../settings';
import { Actions, Btn, H3, Mast, NFace, NightGame, Prompt, SLOTS, Tally, buzz, shortName, type NavLinks } from './ui';

/**
 * A game played out live, night edition (mockups: Draw Five `index.html#game` / `#preGame`, All-Time
 * `alltime.html#liveGame` / `#liveBox`). The aside carries the score, the clock and the broadcast
 * controls; the stage carries the headline of the moment, the play-by-play and the box score — the
 * whole game or one quarter, with who is on the floor and each player's +/−. The game itself is
 * `simulateLiveGame` / `playPairingGame`; this only plays it back.
 *
 * Pace (2026-10-14, the user: "ważne żeby wyważyć czas trwania"): about 12 s a quarter for the first
 * three, the fourth slower, a close finish about a second a play, a blowout's fourth fast.
 */
const PACE = { early: 250, fourth: 420, blowout: 170, clutchPlay: 1500, clutchQuiet: 500, quarterBreak: 2500 };
const CLUTCH = { seconds: 120, margin: 8 };
const BLOWOUT_MARGIN = 20;
// 2026-10-15 (playtest 7: "brakuje szybkości 1/8, 1/4, 1/2"): the slow speeds stay.
const SPEEDS = [0.125, 0.25, 0.5, 1, 2, 4, 8] as const;
type Speed = (typeof SPEEDS)[number];
/** The feed shows the newest lines; the rest open on request. */
const FEED_ROWS = 12;
const SPEED_LABEL: Record<Speed, string> = { 0.125: '⅛', 0.25: '¼', 0.5: '½', 1: '1×', 2: '2×', 4: '4×', 8: '8×' };
/** "Key moments" starts here: the last six minutes of the game. 2026-10-22 (playtest): back from the
 * pre-night live game, before tip-off and while the game runs. */
const KEY_MOMENTS_LEFT = 360;

function isClutch(m: GameMoment | undefined): boolean {
  return !!m && m.quarter >= 3 && m.left <= CLUTCH.seconds && Math.abs(m.score[0] - m.score[1]) <= CLUTCH.margin;
}

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

/** Side 0's chance to win from the score, the clock and the model's expected margin. */
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
  return `${Math.floor(quarterLeft / 60)}:${String(Math.floor(quarterLeft % 60)).padStart(2, '0')}`;
}


export function zeroLine(): BoxLineStats {
  return { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0, min: 0 };
}

function sumLines(lines: BoxLineStats[]): BoxLineStats {
  return lines.reduce((acc, l) => {
    const next = { ...acc };
    for (const key of Object.keys(next) as (keyof BoxLineStats)[]) next[key] += l[key] ?? 0;
    return next;
  }, zeroLine());
}

function diffLine(a: BoxLineStats, b: BoxLineStats | undefined): BoxLineStats {
  if (!b) return a;
  const out = zeroLine();
  for (const key of Object.keys(out) as (keyof BoxLineStats)[]) out[key] = (a[key] ?? 0) - (b[key] ?? 0);
  return out;
}

/** The player's game so far after this play, as a broadcast says it. */
function playStat(text: string, line: BoxLineStats | undefined): string | undefined {
  if (!line) return undefined;
  if (/\bturnover\b/.test(text)) return `${line.tov} TO`;
  if (/\bmisses a three\b/.test(text)) return `${line.tpm}/${line.tpa} 3PT`;
  if (/\bmisses\b/.test(text)) return `${line.fgm}/${line.fga} FG`;
  if (/\bblocks\b/.test(text)) return `${line.blk} blocks`;
  if (/\bsteals\b/.test(text)) return `${line.stl} steals`;
  return `${line.pts} ${line.pts === 1 ? 'point' : 'points'}`;
}

function shotZone(text: string): 'rim' | 'mid' | 'three' | null {
  if (/\bthree\b/i.test(text)) return 'three';
  if (/layup|dunk|putback|tip-in|alley|hook|at the rim|and one/i.test(text)) return 'rim';
  if (/jumper|fadeaway|floater|mid-range|pull-up|elbow/i.test(text)) return 'mid';
  return null;
}

/** Bold every box-score name in a play, as the mockups print them. */
function withNames(text: string, labels: string[]): ReactNode {
  const names = [...labels].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const re = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(re).map((part, i) => (names.includes(part) ? <b key={i}>{maskName(part)}</b> : <Fragment key={i}>{part}</Fragment>));
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** The run going into moment `i`: one side's points since the other last scored more than two. */
function runNow(moments: GameMoment[], i: number): { side: 0 | 1; pts: number; opp: number } | null {
  let side = -1;
  let pts = 0;
  let opp = 0;
  for (let k = 0; k <= i; k++) {
    const before = k > 0 ? moments[k - 1].score : [0, 0];
    for (const s of [0, 1] as const) {
      const d = moments[k].score[s] - before[s];
      if (d <= 0) continue;
      if (s === side) pts += d;
      else {
        opp += d;
        if (opp > 2) {
          side = s;
          pts = opp;
          opp = 0;
        }
      }
    }
  }
  return side < 0 ? null : { side: side as 0 | 1, pts, opp };
}

export interface LiveSides {
  /** Full names, short names ("Tulsa", "You") and the who-column codes ("TUL", "YOU"), side 0 first. */
  names: [string, string];
  short: [string, string];
  codes: [string, string];
  /** Your side. */
  you: 0 | 1;
}

type FeedRow =
  | { key: string; kind: 'play'; side: 0 | 1; time: string; text: ReactNode; score: string; minor?: boolean; scored: boolean }
  | { key: string; kind: 'call'; tone?: 'up' | 'dn'; text: string }
  | { key: string; kind: 'q'; text: string };

/** Who was on the floor for moment `i`: each line whose minutes grew on that trip. */
function onFloor(moments: GameMoment[], i: number, side: 0 | 1): boolean[] {
  const m = moments[i];
  if (!m) return [];
  const prev = i > 0 ? moments[i - 1].lines[side] : null;
  return m.lines[side].map((l, k) => l.min > (prev ? prev[k].min : 0) + 1e-9);
}

export default function LiveGameNight({
  game,
  sides,
  variant = 'full',
  mast,
  autoStart,
  autoPlay = false,
  onFinish,
  done: doneSlot,
  pregame,
  links,
  onPlayer,
  intro,
  asideExtra,
}: {
  game: LiveGameResult;
  sides: LiveSides;
  /** Draw Five's lighter layout (broadcast + team stats in the aside) or the full one. */
  variant?: 'd5' | 'full';
  mast: { title: ReactNode; sub: ReactNode; daily?: boolean; liveSub?: ReactNode; preSub?: ReactNode };
  autoStart: boolean;
  /** Start playing at once, without the pre-game screen. */
  autoPlay?: boolean;
  onFinish?: () => void;
  /** The aside's buttons once the final is in. */
  done?: ReactNode;
  /** The pre-game screen: what the aside says, the headline and its line. */
  pregame?: { aside?: ReactNode; eb: ReactNode; title: ReactNode; line: ReactNode; now?: boolean; tally?: [ReactNode, ReactNode] };
  links?: NavLinks;
  onPlayer?: (side: 0 | 1, span: PlayerSpan) => void;
  /** One line before tip-off on what came before (the series' last game). */
  intro?: string;
  asideExtra?: ReactNode;
}) {
  const total = game.moments.length;
  const reduced = reducedMotion();
  const [shown, setShown] = useState(autoStart && !reduced ? (autoPlay ? 0 : -1) : total);
  const [running, setRunning] = useState(autoStart && autoPlay && !reduced);
  const [speed, setSpeed] = useState<Speed>(1);
  const [tab, setTab] = useState<'feed' | 'box' | 'teams'>('feed');
  const [boxSide, setBoxSide] = useState<0 | 1>(sides.you);
  // Who started: the five on the floor for the first trip of the game.
  const starterIdx = useMemo(
    () =>
      ([0, 1] as const).map((side) => {
        const on = onFloor(game.moments, 0, side).flatMap((x, k) => (x ? [k] : []));
        // Fall back to the listed order if the first trip doesn't show exactly five.
        return on.length === 5 ? on : game.labels[side].slice(0, 5).map((_l, k) => k);
      }) as [number[], number[]],
    [game],
  );
  const benchIdx = (side: 0 | 1, rows: { min: number }[]) =>
    rows
      .map((_l, k) => k)
      .filter((k) => !starterIdx[side].includes(k))
      .sort((a, b) => rows[b].min - rows[a].min);
  const [period, setPeriod] = useState<'game' | 0 | 1 | 2 | 3>('game');
  // a phone shows a finished game's key moments only, the rest one tap away (playtest 2026-10-22)
  const [phoneFull, setPhoneFull] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const timer = useRef<number | null>(null);
  const { names, short, codes, you } = sides;
  const them = (1 - you) as 0 | 1;

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
  const finishedOnce = useRef(false);
  useEffect(() => {
    if (!done || finishedOnce.current) return;
    finishedOnce.current = true;
    if (autoStart) buzz([30, 60, 30]);
    onFinish?.();
  }, [done, onFinish, autoStart]);

  const upto = Math.max(0, Math.min(shown, total));
  const keyMomentIdx = game.moments.findIndex((m) => m.left <= KEY_MOMENTS_LEFT);
  const now = upto > 0 ? game.moments[upto - 1] : undefined;
  const score = now?.score ?? [0, 0];
  const lines = now?.lines ?? [game.labels[0].map(zeroLine), game.labels[1].map(zeroLine)];

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

  const callsAt = useMemo(() => {
    const at = new Map<number, { side?: 0 | 1; text: string }[]>();
    for (const c of gameCalls(game, short)) at.set(c.at, [...(at.get(c.at) ?? []), c]);
    return at;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, short[0], short[1]]);

  const feed = useMemo(() => {
    const rows: FeedRow[] = [];
    let runSide = -1;
    let runPts = 0;
    let runOpp = 0;
    let called = 0;
    let leader = 0;
    let qStart: [BoxLineStats[], BoxLineStats[]] | null = null;
    const tone = (side: 0 | 1 | undefined): 'up' | 'dn' | undefined => (side === undefined ? undefined : side === you ? 'up' : 'dn');
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
        rows.push({ key: `r${i}`, kind: 'call', tone: tone(runSide as 0 | 1), text: `${short[runSide]} on a ${runPts}–${runOpp} run` });
      }
      const prevLines = i > 0 ? game.moments[i - 1].lines : null;
      for (const side of [0, 1] as const) {
        m.lines[side].forEach((l, k) => {
          const b = prevLines ? prevLines[side][k].pf : 0;
          if (l.pf >= 6 && b < 6) rows.push({ key: `f${i}-${side}-${k}`, kind: 'q', text: `${maskName(game.labels[side][k])} fouls out. His minutes go to the bench.` });
          else if (l.pf === 5 && b < 5) rows.push({ key: `f${i}-${side}-${k}`, kind: 'q', text: `${maskName(game.labels[side][k])} picks up his fifth foul.` });
        });
      }
      const lead = Math.sign(m.score[0] - m.score[1]);
      if (lead !== 0 && leader !== 0 && lead !== leader && m.quarter >= 3) rows.push({ key: `l${i}`, kind: 'call', tone: tone(lead > 0 ? 0 : 1), text: `Lead change · ${short[lead > 0 ? 0 : 1]} in front` });
      if (lead !== 0) leader = lead;
      if (m.play && !m.play.quiet) {
        const side = m.play.side;
        const label = game.labels[side].find((l) => m.play!.text.startsWith(l));
        const said = label ? sayPlay(m.play.text, label, i) : m.play.text;
        const stat = label && !m.play.minor && m.score[side] > before[side] ? playStat(m.play.text, m.lines[side][game.labels[side].indexOf(label)]) : undefined;
        rows.push({
          key: `p${i}`,
          kind: 'play',
          side,
          time: quarterClock(m),
          text: (
            <>
              {withNames(/[.!?)]$/.test(said) ? said : `${said}.`, [...game.labels[0], ...game.labels[1]])}
              {stat && <> {stat}.</>}
            </>
          ),
          score: `${m.score[0]}–${m.score[1]}`,
          minor: m.play.minor,
          scored: m.score[side] > before[side],
        });
      }
      for (const c of callsAt.get(i) ?? []) rows.push({ key: `c${i}-${c.text}`, kind: 'call', tone: tone(c.side), text: c.text });
      const next = game.moments[i + 1];
      if (!next || next.quarter !== m.quarter) {
        let best = { side: 0 as 0 | 1, label: '', pts: 0 };
        for (const side of [0, 1] as const) {
          m.lines[side].forEach((l, k) => {
            const pts = l.pts - (qStart ? qStart[side][k].pts : 0);
            if (pts > best.pts) best = { side, label: game.labels[side][k], pts };
          });
        }
        if (next) rows.push({ key: `q${i}`, kind: 'q', text: `End of Q${m.quarter + 1}: ${short[0]} ${m.score[0]}, ${short[1]} ${m.score[1]}.${best.pts > 0 ? ` ${maskName(best.label)} ${best.pts} in the quarter.` : ''}` });
        qStart = m.lines;
      }
    }
    if (done) rows.push({ key: 'final', kind: 'q', text: `Final: ${short[0]} ${game.final[0]}, ${short[1]} ${game.final[1]}.` });
    return rows.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, upto, done, short[0], short[1], callsAt, you]);


  const lastShot = useMemo(() => {
    for (let i = upto - 1; i >= 0; i--) {
      const m = game.moments[i];
      if (!m.play || m.play.quiet) continue;
      const before = i > 0 ? game.moments[i - 1].score : [0, 0];
      const pts = m.score[m.play.side] - before[m.play.side];
      if (pts <= 0) continue;
      const zone = shotZone(m.play.text);
      if (!zone) continue;
      const side = m.play.side;
      const label = game.labels[side].find((l) => m.play!.text.startsWith(l)) ?? '';
      const k = game.labels[side].indexOf(label);
      return { i, side, zone, label, pts, time: quarterClock(m), text: m.play.text.split(' (')[0].slice(label.length).trim().replace(/\.$/, ''), line: k >= 0 ? m.lines[side][k] : undefined };
    }
    return null;
  }, [game.moments, game.labels, upto]);

  const p0 = Math.round(winProbability(now, game.expectedMargin) * 100);
  const wp: [number, number] = [p0, 100 - p0];
  const won = game.final[you] > game.final[them];

  function start(from = 0) {
    setShown(from);
    setSpeed(1);
    setRunning(true);
  }
  const skip = () => {
    setRunning(false);
    setShown(total);
  };

  /* ---------- the moment's headline ---------- */
  const headline = useMemo(() => {
    if (done) {
      const margin = Math.abs(game.final[0] - game.final[1]);
      const title = won ? `${short[you]} win` : `${short[them]} win`;
      // Your side's best line, said once (playtest 2026-10-22: "Pippen did what he could. Pippen: 23
      // points…", and "They were the better team" read wrong when you play as the second side).
      const lines = Object.entries(game.box[you]);
      const [starLabel, l] = lines.reduce((best, cur) => (cur[1].pts + cur[1].reb + cur[1].ast > best[1].pts + best[1].reb + best[1].ast ? cur : best), lines[0]);
      const stat = `${l.pts} points, ${l.reb} rebounds, ${l.ast} assists`;
      // The engine's recap speaks for side 0; keep it when it says something the line below doesn't
      // (who got hunted on defense), else say it plainly from your side.
      if (you === 0 && !game.recap.includes(game.star.name)) return { eb: 'Final', title, line: <>{game.recap} {maskName(starLabel)}: {stat}.</>, margin };
      const line = won ? `${maskName(starLabel)} led the way: ${stat}.` : `The ${short[them]} were the better team. ${maskName(starLabel)} did what he could: ${stat}.`;
      return { eb: 'Final', title, line: <>{line}</>, margin };
    }
    const at = `Live · Q${(now?.quarter ?? 0) + 1} · ${quarterClock(now)}`;
    for (let i = upto - 1; i >= Math.max(0, upto - 6); i--) {
      const m = game.moments[i];
      if (!m.play || m.play.quiet || m.play.minor) continue;
      const before = i > 0 ? game.moments[i - 1].score : [0, 0];
      const side = m.play.side;
      if (m.score[side] <= before[side]) continue;
      const label = game.labels[side].find((l) => m.play!.text.startsWith(l)) ?? short[side];
      const leadBefore = before[side] - before[1 - side];
      const leadNow = m.score[side] - m.score[1 - side];
      const who = maskName(label);
      const title = leadBefore <= 0 && leadNow > 0 ? `${who} puts ${short[side]} ahead` : leadNow === 0 ? `${who} ties it` : leadBefore < 0 ? `${who} answers` : /three/.test(m.play.text) ? `${who} from deep` : `${who} scores`;
      const lead = m.score[you] - m.score[them];
      const minutes = Math.round(m.left / 60);
      const when = m.quarter >= 3 ? (minutes > 1 ? ` with ${WORDS[minutes] ?? minutes} minutes left` : ' in the final minute') : ` in Q${m.quarter + 1}`;
      const run = runNow(game.moments, i);
      const runText = run && run.pts >= 6 ? `${run.side === you ? (short[you] === 'You' ? 'Your five' : short[you]) : short[run.side]} on a ${run.pts}–${run.opp} run. ` : '';
      const line = (
        <>
          {runText}
          {lead === 0 ? (
            <>All square{when}.</>
          ) : (
            <>
              <b className={lead > 0 ? 'up' : 'dn'}>{lead > 0 ? `+${lead}` : `−${-lead}`}</b>
              {when}.
            </>
          )}
        </>
      );
      return { eb: at, title, line, margin: lead };
    }
    return { eb: at, title: `${short[0]} ${score[0]}, ${short[1]} ${score[1]}`, line: <>Tip-off. The fives as drafted.</>, margin: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, upto, game, short[0], short[1], you]);

  /* ---------- the box by period ---------- */
  const periodBox = useMemo(() => {
    const ends: number[] = [];
    for (let q = 0; q < 4; q++) {
      let last = -1;
      for (let i = 0; i < upto; i++) if (game.moments[i].quarter === q) last = i;
      ends.push(last);
    }
    const startOf = (q: number) => (q === 0 ? null : ends[q - 1] >= 0 ? game.moments[ends[q - 1]].lines : null);
    const endOf = (q: number) => (ends[q] >= 0 ? game.moments[ends[q]].lines : null);
    const pm: [number[], number[]] = [game.labels[0].map(() => 0), game.labels[1].map(() => 0)];
    for (let i = 0; i < upto; i++) {
      const m = game.moments[i];
      if (period !== 'game' && m.quarter !== period) continue;
      const before = i > 0 ? game.moments[i - 1].score : [0, 0];
      const d0 = m.score[0] - before[0] - (m.score[1] - before[1]);
      for (const side of [0, 1] as const) {
        const on = onFloor(game.moments, i, side);
        on.forEach((o, k) => {
          if (o) pm[side][k] += side === 0 ? d0 : -d0;
        });
      }
    }
    const rows = ([0, 1] as const).map((side) => {
      if (period === 'game') return lines[side];
      const end = endOf(period);
      if (!end) return null;
      const s = startOf(period);
      return end[side].map((l, k) => diffLine(l, s ? s[side][k] : undefined));
    }) as [BoxLineStats[] | null, BoxLineStats[] | null];
    const floor = upto > 0 ? ([0, 1] as const).map((side) => onFloor(game.moments, upto - 1, side)) : [[], []];
    return { rows, pm, floor, quartersPlayed: ends.map((e) => e >= 0) };
  }, [game, upto, period, lines]);

  const liveQuarter = now?.quarter ?? 0;
  const periodName = period === 'game' ? 'Game' : `Q${period + 1}`;

  /* ---------- pieces ---------- */
  const tallyEl = (
    <Tally
      you={done || shown >= 0 ? score[0] : '0'}
      mid={done ? 'Final' : shown < 0 ? 'Tip-off' : quarterClock(now)}
      ai={done || shown >= 0 ? score[1] : '0'}
      youK={short[0]}
      midK={done ? `Q4 0:00` : shown < 0 ? 'Q1' : `Q${liveQuarter + 1}`}
      aiK={short[1]}
      clock={!done && shown >= 0}
      plain
    />
  );

  const speedsEl = (
    <div className="speeds" role="group" aria-label="Speed">
      {SPEEDS.map((s) => (
        <button key={s} type="button" className={speed === s ? 'on' : undefined} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
          {SPEED_LABEL[s]}
        </button>
      ))}
    </div>
  );
  // 2026-10-22, the playtest: Play is the main action (filled), Skip the shortcut (outline); once the
  // game is over the controls go, and "Watch again" sits once under the next step (`endActions`).
  const controls = (cls: string) =>
    done ? null : (
      <div className={cls}>
        <Btn onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Play'}</Btn>
        {keyMomentIdx > upto && (
          <Btn kind="line" onClick={() => setShown(keyMomentIdx)}>
            Key moments
          </Btn>
        )}
        <Btn kind="line" onClick={skip}>
          Skip to final
        </Btn>
      </div>
    );
  const endActions = (
    <>
      {doneSlot}
      <Btn kind="line" onClick={() => start(0)}>
        Watch again
      </Btn>
    </>
  );

  const wpEl = (
    <div className="wp">
      <div className="bar">
        <i style={{ width: `${wp[0]}%` }} />
        <u style={{ width: `${wp[1]}%` }} />
      </div>
      <div className="lb">
        {you === 0 ? <b>{short[0]} {wp[0]}%</b> : <span>{short[0]} {wp[0]}%</span>}
        {you === 1 ? <b>{short[1]} {wp[1]}%</b> : <span>{short[1]} {wp[1]}%</span>}
      </div>
    </div>
  );

  const leaderOf = (side: 0 | 1, key: 'pts' | 'reb' | 'ast') => {
    let best = -1;
    lines[side].forEach((l, k) => {
      if (best < 0 || l[key] > lines[side][best][key]) best = k;
    });
    return best >= 0 ? { label: maskName(game.labels[side][best]), v: lines[side][best][key] } : null;
  };

  const teamStats = (
    <table className="ts">
      <tbody>
        {(() => {
          const [a, b] = [sumLines(lines[0]), sumLines(lines[1])];
          const pct = (m: number, t: number) => (t > 0 ? `${Math.round((100 * m) / t)}%` : '—');
          return (
            [
              [pct(a.fgm, a.fga), 'FG', pct(b.fgm, b.fga)],
              [`${a.tpm}/${a.tpa}`, '3PT', `${b.tpm}/${b.tpa}`],
              [a.reb, 'REB', b.reb],
              [a.ast, 'AST', b.ast],
              [a.tov, 'TO', b.tov],
            ] as const
          ).map(([x, m, y]) => (
            <tr key={m}>
              <td>{x}</td>
              <td className="m">{m}</td>
              <td className="r">{y}</td>
            </tr>
          ));
        })()}
      </tbody>
    </table>
  );

  const quarterTable = (
    <table className="box">
      <tbody>
        <tr>
          <th>Team</th>
          <th>Q1</th>
          <th>Q2</th>
          <th>Q3</th>
          <th>Q4</th>
          <th>T</th>
        </tr>
        {([0, 1] as const).map((side) => (
          <tr key={side}>
            <td>{variant === 'd5' ? names[side] : short[side]}</td>
            {quarters[side].map((v, q) => (
              <td key={q}>{done || q <= liveQuarter ? (shown < 0 ? '' : v) : ''}</td>
            ))}
            <td className={score[side] > score[1 - side] ? 'hi' : undefined}>{shown < 0 ? '' : score[side]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const feedRows = showAll ? feed : feed.slice(0, FEED_ROWS);
  const feedEl = (
    <div className={`feed${done && !phoneFull ? ' moments' : ''}`} aria-live="off">
      {feedRows.map((r, idx) =>
        r.kind === 'play' ? (
          <div key={r.key} className={`ln ${r.side === you ? 'y' : 'k'}${idx === 0 && !done && r.scored ? ' hot' : ''}${r.minor ? ' minor' : ''}`}>
            <span className="t">{r.time}</span>
            <span className="w">{codes[r.side]}</span>
            <span>{r.text}</span>
            <span className="sc">{r.score}</span>
          </div>
        ) : r.kind === 'call' ? (
          <div key={r.key} className={`call${r.tone ? ` ${r.tone}` : ''}`}>
            {r.text}
          </div>
        ) : (
          <div key={r.key} className="q">
            {r.text}
          </div>
        ),
      )}
      {feed.length === 0 && <div className="q">Tip-off.</div>}
      {done && !phoneFull && (
        <button type="button" className="more-btn ph-full" onClick={() => setPhoneFull(true)}>
          Full play-by-play ›
        </button>
      )}
      {feed.length > FEED_ROWS && (
        <button type="button" className="more-btn" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show the latest plays' : `Show all ${feed.length} lines`}
        </button>
      )}
    </div>
  );


  const court = (
    <svg className="court" viewBox="0 0 300 200" aria-hidden="true">
      <rect x="1" y="1" width="298" height="198" fill="none" stroke="#38383A" strokeWidth="1.5" />
      <rect x="100" y="1" width="100" height="120" fill="none" stroke="#38383A" strokeWidth="1.5" />
      <circle cx="150" cy="121" r="30" fill="none" stroke="#38383A" strokeWidth="1.5" />
      <path d="M 20 1 L 20 60 A 132 132 0 0 0 280 60 L 280 1" fill="none" stroke="#38383A" strokeWidth="1.5" />
      <circle cx="150" cy="22" r="7" fill="none" stroke="#A9A395" strokeWidth="2" />
      {lastShot &&
        (() => {
          const spread = ((lastShot.i * 37) % 7) - 3;
          const [x, y] = lastShot.zone === 'rim' ? [150 + spread * 6, 42] : lastShot.zone === 'mid' ? [150 + spread * 18, 100 + Math.abs(spread) * 4] : spread === 0 ? [150, 176] : [150 + spread * 40, spread > 0 ? 190 - spread * 30 : 190 + spread * 30];
          return (
            <>
              <circle cx={x} cy={y} r="7" fill={lastShot.side === you ? '#ECE6D7' : '#E0525A'} />
              <text x={x + 10} y={y + 4} fill="#ECE6D7" fontFamily="JetBrains Mono Variable, JetBrains Mono, monospace" fontSize="11">
                +{lastShot.pts}
              </text>
            </>
          );
        })()}
    </svg>
  );

  const fullBox = (
    <>
      <div className="seg" role="group" aria-label="Period and team">
        {(['game', 0, 1, 2, 3] as const).map((q) => {
          const played = q === 'game' || periodBox.quartersPlayed[q];
          return (
            <button key={String(q)} type="button" className={period === q ? 'on' : undefined} disabled={!played} onClick={() => setPeriod(q)}>
              {q === 'game' ? 'Game' : `Q${q + 1}`}
              {q !== 'game' && !done && q === liveQuarter && shown >= 0 && <small>now</small>}
            </button>
          );
        })}
        <span className="gap" />
        {([you, them] as const).map((s) => (
          <button key={s} type="button" className={boxSide === s ? 'on' : undefined} onClick={() => setBoxSide(s)}>
            {short[s]}
          </button>
        ))}
      </div>
      {(() => {
        const rows = periodBox.rows[boxSide];
        if (!rows) return <p className="lb-note">Not played yet.</p>;
        const tot = sumLines(rows);
        const pmTot = rows.reduce((s, _l, k) => s + periodBox.pm[boxSide][k], 0) / 5;
        const pq = period === 'game' ? null : period;
        const qScore = pq === null ? score : [quarters[0][pq], quarters[1][pq]];
        const top = Math.max(...rows.map((l) => l.pts));
        const pmCell = (v: number) => (
          <td className={v > 0 ? 'pos' : v < 0 ? 'neg' : undefined}>{v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'}</td>
        );
        return (
          <div className="lbx-wrap">
          <table className="lbx">
            <tbody>
              <tr>
                <th>
                  {periodName} · {short[0]} {qScore[0]}, {short[1]} {qScore[1]}
                </th>
                <th>MIN</th>
                <th>PTS</th>
                <th>REB</th>
                <th>AST</th>
                <th className="c-hide">FG</th>
                <th className="c-hide">3PT</th>
                <th className="c-hide">PF</th>
                <th>+/−</th>
              </tr>
              {/* 2026-10-22 (playtest): the five who started first, then a "Bench" line and the bench by
                  minutes — the rows used to come in position pairs, starters and backups mixed. */}
              {(benchIdx(boxSide, rows).length ? [...starterIdx[boxSide], -1, ...benchIdx(boxSide, rows)] : starterIdx[boxSide]).map((k) => {
                if (k < 0)
                  return (
                    <tr key="bench" className="grp">
                      <td colSpan={9}>Bench</td>
                    </tr>
                  );
                const l = rows[k];
                const label = game.labels[boxSide][k];
                const name = maskName(game.players[boxSide][k]?.playerName ?? label);
                const sp = name.indexOf(' ');
                const nameEl = (
                  <>
                    {!done && <i className={periodBox.floor[boxSide]?.[k] ? undefined : 'off'} />}
                    {sp > 0 ? (
                      <>
                        <span className="fn">{name.slice(0, sp)} </span>
                        {name.slice(sp + 1)}
                      </>
                    ) : (
                      name
                    )}
                    {l.pf >= 6 && <em className="fo"> fouled out</em>}
                  </>
                );
                const cellName = onPlayer ? (
                  <button type="button" className="pname" onClick={() => onPlayer(boxSide, game.players[boxSide][k])}>
                    {nameEl}
                  </button>
                ) : (
                  nameEl
                );
                if (l.min < 0.5)
                  return (
                    <tr key={label} className="bn">
                      <td>{cellName}</td>
                      <td colSpan={8} className="dnp">
                        Did not play{period === 'game' ? '' : ` in ${periodName}`}
                      </td>
                    </tr>
                  );
                return (
                  <tr key={label}>
                    <td>{cellName}</td>
                    <td>{Math.round(l.min)}</td>
                    <td className={top > 0 && l.pts === top ? 'k' : undefined}>{l.pts}</td>
                    <td>{l.reb}</td>
                    <td>{l.ast}</td>
                    <td className="c-hide">
                      {l.fgm}-{l.fga}
                    </td>
                    <td className="c-hide">
                      {l.tpm}-{l.tpa}
                    </td>
                    <td className="c-hide">{l.pf}</td>
                    {pmCell(periodBox.pm[boxSide][k])}
                  </tr>
                );
              })}
              <tr className="tot">
                <td>{short[boxSide]}</td>
                <td>{Math.round(tot.min)}</td>
                <td>{tot.pts}</td>
                <td>{tot.reb}</td>
                <td>{tot.ast}</td>
                <td className="c-hide">
                  {tot.fgm}-{tot.fga}
                </td>
                <td className="c-hide">
                  {tot.tpm}-{tot.tpa}
                </td>
                <td className="c-hide">{tot.pf}</td>
                {pmCell(Math.round(pmTot))}
              </tr>
            </tbody>
          </table>
          </div>
        );
      })()}
      {!done && <p className="lb-note">● on the floor now · ○ on the bench</p>}
    </>
  );

  /* ---------- pre-game ---------- */
  const odds = useMemo(() => {
    const o = variant === 'd5' ? pregameOdds(game.expectedMargin) : { you: gameWinProbability(game.expectedMargin), clear: false };
    const side0 = Math.round(o.you * 100);
    return { side0: Math.max(1, Math.min(99, side0)), clear: o.clear };
  }, [game.expectedMargin, variant]);

  if (shown < 0) {
    const starters = ([0, 1] as const).map((side) => {
      const first = game.moments[0]?.lines[side];
      return game.players[side].filter((_, k) => !first || first[k].min > 0).slice(0, 5);
    });
    return (
      <NightGame
        aside={
          <>
            <Mast title={mast.title} sub={mast.preSub ?? mast.liveSub ?? mast.sub} daily={mast.daily} />
            {pregame?.tally ? <Tally you={pregame.tally[0]} mid="Tip-off" ai={pregame.tally[1]} youK={short[0]} midK="Q1" aiK={short[1]} plain /> : tallyEl}
            {pregame?.aside}
            <Actions links={links}>
              <Btn onClick={() => start(0)}>Tip-off</Btn>
              {keyMomentIdx > 0 && (
                <Btn kind="line" onClick={() => start(keyMomentIdx)}>
                  Key moments
                </Btn>
              )}
            </Actions>
          </>
        }
      >
        <Prompt eb={pregame?.eb ?? 'Before tip-off'} title={pregame?.title ?? 'Starting fives'} now={pregame?.now}>
          {intro ? `${intro} ` : ''}
          {pregame?.line}
        </Prompt>
        <section>
          <H3 note="the engine's odds">Pre-game</H3>
          <div className="odds">
            <i style={{ width: `${odds.side0}%` }} />
            <u style={{ width: `${100 - odds.side0}%` }} />
          </div>
          <div className="odds-l">
            <span>
              <b>
                {short[0]} {odds.side0}%
              </b>
            </span>
            <span>
              {short[1]} {100 - odds.side0}%
            </span>
          </div>
        </section>
        <section>
          <div className="vs5-h">
            <span>{names[0]}</span>
            <span>{names[1]}</span>
          </div>
          <table className="vs5">
            <tbody>
              {SLOTS.map((slot, i) => {
                const side = (sp: PlayerSpan | undefined) =>
                  sp ? (
                    <div className="pl">
                      <NFace name={sp.playerName} span={sp} />
                      <div>
                        <b>
                          {(() => {
                            const n = maskName(sp.playerName);
                            const at = n.indexOf(' ');
                            return at > 0 ? (
                              <>
                                <span className="fn">{n.slice(0, at)} </span>
                                {n.slice(at + 1)}
                              </>
                            ) : (
                              n
                            );
                          })()}
                        </b>
                        <small>
                          <span className="yy">{sp.spanLabel} · </span>
                          <span className="pp">{sp.box.ppg.toFixed(1)} ppg</span>
                        </small>
                      </div>
                    </div>
                  ) : null;
                return (
                  <tr key={slot}>
                    <td>{side(starters[0][i])}</td>
                    <td className="ps">{slot}</td>
                    <td className="r">{side(starters[1][i])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <Btn className="phone-only" onClick={() => start(0)}>
          Tip-off
        </Btn>
        {keyMomentIdx > 0 && (
          <Btn kind="line" className="phone-only" onClick={() => start(keyMomentIdx)}>
            Key moments
          </Btn>
        )}
      </NightGame>
    );
  }

  /* ---------- live / final ---------- */
  const prompt = (
    <Prompt eb={headline.eb} title={headline.title} now={!done}>
      {headline.line}
    </Prompt>
  );

  if (variant === 'd5') {
    return (
      <NightGame
        aside={
          <>
            <Mast title={mast.title} sub={done ? mast.sub : (mast.liveSub ?? mast.sub)} daily={mast.daily} />
            {tallyEl}
            {!done && (
              <section>
                <H3>Broadcast</H3>
                {speedsEl}
                {controls('stackb')}
              </section>
            )}
            <section>
              <H3 note={`${short[0].toLowerCase()} · ${short[1]}`}>Team stats</H3>
              {teamStats}
            </section>
            {asideExtra}
            <Actions links={links}>{done && endActions}</Actions>
          </>
        }
      >
        {prompt}
        {!done && (
          <section className="phone-only">
            <H3>Broadcast</H3>
            {speedsEl}
            {controls('stackb')}
          </section>
        )}
        {done && <div className="phone-only stackb">{endActions}</div>}
        <div className="split">
          <section>
            <H3 note={done ? 'newest first' : `Q${liveQuarter + 1} · newest first`}>Play-by-play</H3>
            {feedEl}
          </section>
          <div className="stack">
            <section>
              <H3>Score by quarter</H3>
              {quarterTable}
            </section>
            <section>
              <div className="tabs">
                {([you, them] as const).map((s) => (
                  <button key={s} type="button" className={boxSide === s ? 'on' : undefined} onClick={() => setBoxSide(s)}>
                    {s === you ? 'Your five' : names[s]}
                  </button>
                ))}
              </div>
              <table className="box">
                <tbody>
                  <tr>
                    <th>Player</th>
                    <th>PTS</th>
                    <th>REB</th>
                    <th>AST</th>
                    <th>FG</th>
                  </tr>
                  {lines[boxSide].map((l, k) => {
                    const top = Math.max(...lines[boxSide].map((x) => x.pts));
                    return (
                      <tr key={k}>
                        <td>
                          {shortName(game.players[boxSide][k]?.playerName ?? game.labels[boxSide][k])}
                          {boxSide === 0 && game.jokerLabel === game.labels[0][k] && <span className="jk-tag"> Joker</span>}
                        </td>
                        <td className={top > 0 && l.pts === top ? 'hi' : undefined}>{l.pts}</td>
                        <td>{l.reb}</td>
                        <td>{l.ast}</td>
                        <td>
                          {l.fgm}-{l.fga}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </NightGame>
    );
  }

  const l0 = (['pts', 'reb', 'ast'] as const).map((k) => ({ k, a: leaderOf(0, k), b: leaderOf(1, k) }));
  return (
    <NightGame
      aside={
        <>
          <Mast title={mast.title} sub={done ? mast.sub : (mast.liveSub ?? mast.sub)} daily={mast.daily} />
          {tallyEl}
          {/* the quarters right under the score (playtest 2026-10-22), not at the foot of the court */}
          <section className="keep">
            <H3>Score by quarter</H3>
            {quarterTable}
          </section>
          {!done && (
            <section className="keep">
              <H3>Win probability</H3>
              {wpEl}
            </section>
          )}
          {!done && (
            <section className="keep live-aside">
              <H3>Speed</H3>
              {speedsEl}
              {controls('stackb')}
            </section>
          )}
          <section>
            <H3 note={`${short[0]} · ${short[1]}`}>{done ? 'Leaders' : 'Leaders so far'}</H3>
            {l0.map(({ k, a, b }) => (
              <div key={k} className="ldr2">
                <span className="k">{k.toUpperCase()}</span>
                <span>
                  <b>{a?.label}</b> {a?.v} · {b?.label} {b?.v}
                </span>
                <em />
              </div>
            ))}
          </section>
          {asideExtra}
          <Actions links={links}>{done && endActions}</Actions>
        </>
      }
    >
      {prompt}
      {done && <div className="phone-only stackb">{endActions}</div>}
      <div className="split live-split">
        <section>
          <div className="tabs2" role="tablist">
            {(
              [
                ['feed', 'Play-by-play'],
                ['box', 'Box score'],
                ['teams', 'Team stats'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : undefined} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'feed' && feedEl}
          {tab === 'box' && fullBox}
          {tab === 'teams' && teamStats}
        </section>
        <div className="stack">
          <section>
            <H3 note={lastShot ? `${maskName(lastShot.label)} · ${lastShot.time}` : undefined}>Last basket</H3>
            {court}
            {lastShot && (
              <p className="court-l">
                <b>{maskName(lastShot.label)}</b> {lastShot.text} · +{lastShot.pts}
                {lastShot.line ? ` · ${lastShot.line.fgm} of ${lastShot.line.fga} tonight` : ''}
              </p>
            )}
          </section>
        </div>
      </div>
    </NightGame>
  );
}
