import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Team } from '../engine/types';
import { franchiseByName } from '../data/franchises';
import { teamHue } from '../components/teamLogoKit';
import { teamLabel } from '../engine/teamNames';
import { createLotteryDrum, drumHeight, type LotteryDrum } from '../components/lotteryDrum';
import { ordinal } from '../components/dailyDraftProgress';
import { bandInk } from './color';
import { Actions, Btn, H3, Kv, Mast, NightGame, Prompt, Tally, fmtCaps, type NavLinks } from './frame';

/** League team marks and the lottery: light pieces (no player data), so the menu's early lottery
 * can show them before the engine loads. */

/** A league franchise's swatch colours: its logo's field and accent; names outside the pool get
 * the old hash hue. */
export function leagueColors(name: string): { bg: string; fg: string } {
  const f = franchiseByName(name);
  if (f) return { bg: f.logo.field, fg: f.logo.accent };
  return { bg: `hsl(${teamHue(name)} 45% 32%)`, fg: '#FFFFFF' };
}

/** A league team's printed mark (`.tm`): dark ink on light colours (AUDIT.md item 2). */
export function LeagueMark({ name, code, lg }: { name: string; code: string; lg?: boolean }) {
  const { bg, fg } = leagueColors(name);
  const ink = bg.startsWith('#') ? bandInk(bg, fg) : fg;
  return (
    <span className={`tm${lg ? ' lg' : ''}`} style={{ background: bg, color: ink }} title={name}>
      {code}
    </span>
  );
}

/** Overall pick numbers (1-based) a team in `slot` makes in a snake draft. */
export function snakePicks(slot: number, teamCount: number, rounds: number): number[] {
  return Array.from({ length: rounds }, (_, r) => r * teamCount + (r % 2 === 0 ? slot - 1 : teamCount - slot) + 1);
}

/* ------------------------------ the lottery ------------------------------ */

/**
 * The draft lottery (mockup `mini.html#lottery`): the drum spins (2026-09-28, the user's
 * "klasyczne kulki"), then the stage shows your pick on a cream ball, the picks it means in a snake
 * draft and the whole draft order with your row in reverse.
 */
export function NightLottery({
  teams,
  rounds,
  title,
  sub,
  codeOf,
  capLimit,
  howItWorks,
  onDone,
  onRevealed,
  links,
}: {
  teams: Team[];
  rounds: number;
  title: string;
  sub: string;
  codeOf: (t: Team) => string;
  capLimit: number;
  howItWorks: [string, ReactNode][];
  onDone: () => void;
  onRevealed?: () => void;
  links: NavLinks;
}) {
  const human = teams.find((t) => t.isHuman) ?? teams[0];
  const teamCount = teams.length;
  const slot = human.draftSlot;
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState('Your ball is the red one.');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drumRef = useRef<LotteryDrum | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drum = createLotteryDrum(canvas, {
      slot,
      teamCount,
      onStatus: (text) => setStatus(text),
      onLanded: () => {
        setStarted(true);
        setDone(true);
      },
    });
    drumRef.current = drum;
    return () => {
      drum.destroy();
      drumRef.current = null;
    };
  }, [slot, teamCount]);
  useEffect(() => {
    if (!done || !onRevealed) return;
    const id = window.setTimeout(onRevealed, 250);
    return () => window.clearTimeout(id);
  }, [done, onRevealed]);
  const picks = useMemo(() => snakePicks(slot, teamCount, rounds), [slot, teamCount, rounds]);
  const gaps = picks.slice(1).map((p, i) => p - picks[i] - 1);
  const order = [...teams].sort((a, b) => a.draftSlot - b.draftSlot);
  const half = Math.ceil(order.length / 2);
  // Two columns read down: 1–8 on the left, 9–16 on the right.
  const columns = [order.slice(0, half), order.slice(half)];
  return (
    <NightGame
      aside={
        <>
          <Mast title={title} sub={sub} />
          <Tally you={fmtCaps(capLimit)} mid={teamCount} ai={rounds} youK="Cap" midK="Teams" aiK="Rounds" plain />
          <section>
            <H3>How it works</H3>
            {howItWorks.map(([k, v]) => (
              <Kv key={k} k={k} v={v} />
            ))}
          </section>
          <Actions links={links}>
            {done ? (
              <Btn onClick={onDone}>Start the draft</Btn>
            ) : !started ? (
              <Btn
                onClick={() => {
                  setStarted(true);
                  drumRef.current?.start();
                }}
              >
                Draw the lottery
              </Btn>
            ) : (
              <Btn kind="line" onClick={() => drumRef.current?.finish()}>
                Skip
              </Btn>
            )}
          </Actions>
        </>
      }
    >
      <Prompt eb="Draft lottery" title={done ? `You pick ${ordinal(slot)}` : started ? 'The balls are out' : 'The lottery'}>
        {done ? (
          <>
            {teamLabel(human)}. In a snake draft that’s picks <b className="w">{picks.join(' · ')}</b>.
          </>
        ) : (
          status
        )}
      </Prompt>
      <canvas
        ref={canvasRef}
        className={`drum${done ? ' is-done' : ''}`}
        width={800}
        height={drumHeight(teamCount) * 2}
        aria-label={`Lottery drum: ${teamCount} team balls, yours in red`}
      />
      {done && (
        <div className="lot">
          <div>
            <div className="ball">
              <div>
                <b>{slot}</b>
                <span>your pick</span>
              </div>
            </div>
            {gaps.length > 0 && (
              <p className="lot-note">
                Between your picks:{' '}
                {gaps.map((g, i) => (
                  <span key={i}>
                    {i > 0 && (i === gaps.length - 1 ? ' and ' : ', ')}
                    <b>{g}</b>
                  </span>
                ))}{' '}
                picks by the CPU teams.
              </p>
            )}
          </div>
          <section>
            <H3 note="round 1 · reverses each round">Draft order</H3>
            <div className="order16-cols">
              {columns.map((col, c) => (
                <ol key={c} className="order16 one">
                  {col.map((t) => (
                    <li key={t.id} className={t.isHuman ? 'you' : undefined}>
                      <span className="n">{t.draftSlot}</span>
                      <LeagueMark name={t.name} code={codeOf(t)} />
                      <b>{teamLabel(t)}</b>
                    </li>
                  ))}
                </ol>
              ))}
            </div>
          </section>
        </div>
      )}
      {done ? (
        <Btn className="phone-only" onClick={onDone}>
          Start the draft
        </Btn>
      ) : !started ? (
        <Btn
          className="phone-only"
          onClick={() => {
            setStarted(true);
            drumRef.current?.start();
          }}
        >
          Draw the lottery
        </Btn>
      ) : (
        <Btn kind="line" className="phone-only" onClick={() => drumRef.current?.finish()}>
          Skip
        </Btn>
      )}
    </NightGame>
  );
}


/** A franchise's three-letter code from its full name ("Tulsa Twisters" → "TUL"). */
export function franchiseCode(name: string): string {
  return franchiseByName(name)?.code ?? name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}
