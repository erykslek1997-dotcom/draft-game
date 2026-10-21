import { Fragment, useEffect } from 'react';
import { maskName, maskText, maskYears } from './bombMask';
import type { PlayerSpan } from '../data/schema';
import { DESK_CAST, type DeskLine } from '../engine/desk';
import { CALLS_PER_DRAFT, type CallId, type CallOption, type CallResult } from '../engine/deskCalls';
import { Btn, CapI, Dialog, NFace, fmtCaps } from '../night/ui';

/**
 * 2026-10-15, "Phone the Desk" (approved mockup https://claude.ai/artifact/5ZSUn6nxWsoiybnPvmtGDm):
 * the chip in the status bar, the sheet of tonight's on-call experts, the call itself, and the
 * War Room banner over the list. The engine (deskCalls.ts) decides who answers what; this file only
 * shows it. A call never drafts for you — names go to your Big Board, the pick stays yours.
 */

function Badge({ id }: { id: CallId }) {
  if (id === 'desk') return <span className="pd-av tv" aria-hidden>TV</span>;
  return <span className="pd-av" aria-hidden>{DESK_CAST[id].mono}</span>;
}

/** The voices of a call (mockup `alltime.html#call`): the one you rang speaks plain, anyone who
 * barges in is set off with his name. Stage cues written as *text* show in italics. */
function CallVoices({ voices, caller }: { voices: DeskLine[]; caller: CallId }) {
  const first = voices[0]?.who;
  const lead = caller === 'desk' ? first : caller;
  return (
    <>
      {voices.map((v, i) => {
        const parts = maskText(v.text)
          .split(/\*(.+?)\*/g)
          .map((part, j) => (j % 2 ? <i key={j}>{part}</i> : <Fragment key={j}>{part}</Fragment>));
        const barge = v.kind === 'burst' || v.who !== lead;
        return (
          <p key={i} className={barge ? 'pd-say barge' : 'pd-say'}>
            {barge && v.kind !== 'burst' && <em>{DESK_CAST[v.who].name.split(' ').slice(-1)[0]}</em>}
            {parts}
          </p>
        );
      })}
    </>
  );
}

/** The aside button: how many calls are left, live only on your pick. */
export function PhoneChip({ left, live, onOpen }: { left: number; live: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`btn ${live && left >= 0 ? 'line' : 'off'}`}
      onClick={onOpen}
      disabled={!live}
      title={live ? 'Call an expert from the studio' : 'Calls open on your pick'}
    >
      Phone the desk · {left} left
    </button>
  );
}

/** Tonight's on-call experts, the desk and Moonbat (mockup `alltime.html#callSheet`). */
export function CallSheet({ options, left, pickLabel, onCall, onClose }: { options: CallOption[]; left: number; pickLabel: string; onCall: (id: CallId) => void; onClose: () => void }) {
  return (
    <Dialog title="Who are you calling?" onClose={onClose}>
      <p className="lead" style={{ margin: '6px 0 4px' }}>
        {pickLabel} · <b style={{ color: 'var(--ink)' }}>{left} of {CALLS_PER_DRAFT} calls left</b>
      </p>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`pd-line${o.unavailable ? ' off' : ''}${o.free ? ' free' : ''}`}
          disabled={!!o.unavailable}
          onClick={() => onCall(o.id)}
        >
          <Badge id={o.id} />
          <div>
            <b>
              {o.name}
              {o.tag && <small>{o.tag}</small>}
            </b>
            <p>{o.blurb}</p>
          </div>
          <span className="bdg">{o.unavailable ?? o.badge}</span>
        </button>
      ))}
      <Btn kind="line" className="pd-back" onClick={onClose}>
        Back to the board
      </Btn>
    </Dialog>
  );
}

/** The call: the expert (and whoever barges in), then his names with a star for your Big Board. */
export function CallWindow({
  result,
  callNumber,
  starred,
  onToggleStar,
  onStarAll,
  onClose,
}: {
  result: CallResult | null;
  callNumber: number | null;
  starred: (name: string) => boolean;
  onToggleStar: (name: string) => void;
  onStarAll: (players: PlayerSpan[]) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const id = result?.id;
  const title = id === undefined ? 'Dialling…' : id === 'desk' ? 'The Desk' : DESK_CAST[id].name;
  // No lens in the subtitle either: the names give the taste away soon enough.
  const sub = id === undefined ? '' : id === 'moonbat' ? 'free call' : `${id === 'desk' ? 'chalk talk · ' : id === 'host' ? 'league sources · ' : ''}call ${callNumber ?? '?'} of ${CALLS_PER_DRAFT}`;
  return (
    <>
      <div className="drawer-dim" onClick={onClose} aria-hidden />
      <div className="dlg" role="dialog" aria-modal="true" aria-label={title}>
        <div className="pd-top">
          {id !== undefined && <Badge id={id} />}
          <div>
            <b>{title}</b>
            <small>{sub}</small>
          </div>
          <span className="air">
            <i aria-hidden />
            {id === 'desk' ? 'LIVE' : 'ON THE LINE'}
          </span>
        </div>
        <div aria-live="polite">
          {result ? <CallVoices voices={result.lines} caller={result.id} /> : <p className="pd-say">Ringing the studio…</p>}
          {result?.picks.map((p) => (
            <div key={p.id} className="pd-pick">
              <NFace name={p.playerName} />
              <div>
                <b>{maskName(p.playerName)}</b>
                <small>
                  {p.primaryPosition} · {maskYears(p.playerName, p.spanLabel)}
                </small>
              </div>
              <span className="cst">
                <CapI />
                {fmtCaps(p.fga)}
              </span>
              <button
                type="button"
                className={`star${starred(p.playerName) ? ' on' : ''}`}
                onClick={() => onToggleStar(p.playerName)}
                aria-pressed={starred(p.playerName)}
                aria-label={`${starred(p.playerName) ? 'Remove' : 'Add'} ${maskName(p.playerName)} ${starred(p.playerName) ? 'from' : 'to'} your Big Board`}
              >
                ★
              </button>
            </div>
          ))}
        </div>
        {result && result.picks.length > 0 && (
          <p className="empty-note" style={{ margin: '10px 0 16px' }}>
            Stars go to your Big Board. The pick stays yours.
          </p>
        )}
        <div className="btn2" style={{ marginTop: 16 }}>
          <Btn onClick={onClose}>Back to the board</Btn>
          {result && result.picks.length > 1 && (
            <Btn kind="line" onClick={() => onStarAll(result.picks)}>
              Star all {result.picks.length}
            </Btn>
          )}
        </div>
      </div>
    </>
  );
}

/** Over the list while Onoffsky's War Room is on. */
export function WarRoomBanner({ count, showAll, onToggle }: { count: number; showAll: boolean; onToggle: () => void }) {
  return (
    <div className="notice quiet">
      <i>ON</i>
      <p>
        <b>Jake Onoffsky cut your board to {count}.</b> {showAll ? 'Showing everyone for now.' : 'No order, no numbers: the rest won’t move your number. Ends after your pick.'}
      </p>
      <button type="button" className="na" onClick={onToggle}>
        {showAll ? `Back to the ${count}` : 'Show everyone'}
      </button>
    </div>
  );
}
