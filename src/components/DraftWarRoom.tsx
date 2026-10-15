import type { ReactNode } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import type { Team } from '../engine/types';
import { STARTER_SLOTS } from '../engine/positions';
import { teamLabel, teamPlace } from '../engine/teamNames';
import { CapIcon, Face } from './ShotChip';
import { MagnifierIcon } from './MagnifierIcon';
import { boardName } from './boardNames';

/**
 * 2026-10-14, the draft screen redesign (approved mockups "v2 Desktop"/"v2 Phone"): the pieces
 * around the board and the player list — the status bar (whose pick, the round, your caps), the
 * "Before you pick again" lane of rival teams, and your five (a half court on desktop, five dots
 * on a phone).
 */

/** One upcoming pick in snake order. */
export interface UpcomingPick {
  /** 1-based overall pick number. */
  pick: number;
  teamIdx: number;
}

/** Every pick from `start` (0-based overall index) to the end of the draft, in order. */
export function upcomingPicks(start: number, teamCount: number, rounds: number): UpcomingPick[] {
  const out: UpcomingPick[] = [];
  for (let k = start; k < teamCount * rounds; k++) {
    const round = Math.floor(k / teamCount);
    const inRound = k % teamCount;
    out.push({ pick: k + 1, teamIdx: round % 2 === 0 ? inRound : teamCount - 1 - inRound });
  }
  return out;
}

export function DraftStatus({
  youOnClock,
  complete,
  onClockTeam,
  pickNumber,
  picksAway,
  nextPick,
  round,
  rounds,
  capLeft,
  capLimit,
  slotsLeft,
  maxThisPick,
  scoutsLeft,
  onScoutsInfo,
  phone,
  children,
}: {
  youOnClock: boolean;
  complete: boolean;
  onClockTeam: Team;
  /** The pick being made now. */
  pickNumber: number;
  /** Picks until yours (0 = yours now), null when you have none left. */
  picksAway: number | null;
  /** Your next pick after this one when you're on the clock, else your next pick; null if none. */
  nextPick: number | null;
  round: number;
  rounds: number;
  capLeft: number;
  capLimit: number;
  slotsLeft: number;
  /** This pick's hard ceiling, only when it rules someone out. */
  maxThisPick: number | null;
  scoutsLeft: number | null;
  onScoutsInfo: () => void;
  /** Phone the Desk's chip (PhoneDesk.tsx), next to the scouting reports. */
  phone?: ReactNode;
  /** Extra row (the phone's five dots). */
  children?: ReactNode;
}) {
  const used = Math.max(0, Math.min(1, 1 - capLeft / capLimit));
  return (
    <div className={`wr-status${youOnClock ? ' is-yours' : ''}`} role="status" aria-live="polite">
      <div className="wr-status-row">
        {complete ? (
          <span className="wr-pill is-done">Draft complete</span>
        ) : youOnClock ? (
          <span className="wr-pill is-yours">Your pick · #{pickNumber}</span>
        ) : (
          <span className="wr-pill" title={teamLabel(onClockTeam)}>
            <span className="wr-pill-dot" aria-hidden />
            {teamPlace(onClockTeam)} on the clock · #{pickNumber}
          </span>
        )}
        {!complete && (
          <span className="wr-status-round">
            Round <b className="at-calm-num">{round}</b> of {rounds}
            {youOnClock
              ? nextPick !== null && <> · then #{nextPick}</>
              : picksAway !== null &&
                nextPick !== null && (
                  <>
                    {' '}· you're up {picksAway === 1 ? 'next' : `in ${picksAway}`} · #{nextPick}
                  </>
                )}
          </span>
        )}
        <span className="wr-status-gap" />
        {scoutsLeft !== null && (
          <button
            type="button"
            className="wr-scouts"
            onClick={onScoutsInfo}
            title="Open a player's card to use a scouting report"
            aria-label={`${scoutsLeft} scouting report${scoutsLeft === 1 ? '' : 's'} left`}
          >
            <MagnifierIcon /> {scoutsLeft}
            <span className="wr-scouts-label"> scouting report{scoutsLeft === 1 ? '' : 's'} left</span>
          </button>
        )}
        {phone}
        {slotsLeft > 0 && (
          <span className="wr-caps">
            <span className="wr-caps-track" aria-hidden>
              <span style={{ width: `${used * 100}%` }} />
            </span>
            <CapIcon /> <b className="at-calm-num">{capLeft.toFixed(1)}</b> left
            {maxThisPick !== null && <span className="at-calm-soft"> · max {maxThisPick.toFixed(1)} this pick</span>}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * 2026-10-14 (playtest 7: "podgląd ile mam caps powinien być widoczny cały czas podczas przeglądania
 * graczy"): on a phone the status card scrolls away with the list, so once it's gone a slim strip
 * stays pinned to the top — whose pick, and your caps left (and this pick's ceiling).
 */
export function DraftCapsStrip({
  youOnClock,
  onClockTeam,
  pickNumber,
  picksAway,
  capLeft,
  maxThisPick,
}: {
  youOnClock: boolean;
  onClockTeam: Team;
  pickNumber: number;
  picksAway: number | null;
  capLeft: number;
  maxThisPick: number | null;
}) {
  return (
    <div className={`wr-strip${youOnClock ? ' is-yours' : ''}`} aria-hidden>
      <span className="wr-strip-who">
        {youOnClock ? `Your pick · #${pickNumber}` : picksAway !== null ? `#${pickNumber} ${teamPlace(onClockTeam)} · you in ${picksAway}` : `#${pickNumber} ${teamPlace(onClockTeam)}`}
      </span>
      <span className="wr-strip-caps">
        <CapIcon /> <b className="at-calm-num">{capLeft.toFixed(1)}</b> left
        {maxThisPick !== null && <span className="at-calm-soft"> · max {maxThisPick.toFixed(1)}</span>}
      </span>
    </div>
  );
}

/** Starter slots a roster has filled, by the same best assignment the rest of the screen uses. */
export type FiveAssignment = Partial<Record<Position, PlayerSpan>>;

function filledText(assignment: FiveAssignment): { open: Position[]; has: Position[] } {
  const open = STARTER_SLOTS.filter((s) => !assignment[s]);
  const has = STARTER_SLOTS.filter((s) => assignment[s]);
  return { open, has };
}

export function RivalsLane({
  title,
  picks,
  teams,
  assignmentOf,
  yourPick,
}: {
  title: string;
  picks: UpcomingPick[];
  teams: Team[];
  assignmentOf: (team: Team) => FiveAssignment;
  /** Your pick number at the end of the lane. */
  yourPick: number;
}) {
  if (picks.length === 0) return null;
  return (
    <section className="wr-lane" aria-label={title}>
      <div className="wr-lane-head">
        <span className="wr-lane-title">{title}</span>
        <span className="at-calm-soft">
          {picks.length} pick{picks.length === 1 ? '' : 's'} · you're #{yourPick}
        </span>
      </div>
      <div className="wr-lane-row">
        {picks.map(({ pick, teamIdx }, i) => {
          const team = teams[teamIdx];
          const { open, has } = filledText(assignmentOf(team));
          return (
            <div key={pick} className={`wr-rival${i === 0 ? ' is-first' : ''}`} title={teamLabel(team)}>
              <span className="wr-rival-pick">
                #{pick} · {teamPlace(team)}
              </span>
              <span className="wr-rival-open">{open.length === 0 ? 'Five set' : has.length === 0 ? 'Open: all five' : `Open: ${open.join(', ')}`}</span>
              <span className="wr-rival-has">{has.length === 0 ? 'No picks yet' : `Has ${has.join(', ')}`}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Spots on the half court, as % of its width and px from its top. */
const COURT_SPOT: Record<Position, { left: number; top: number }> = {
  PG: { left: 50, top: 10 },
  SG: { left: 16, top: 54 },
  SF: { left: 84, top: 54 },
  PF: { left: 30, top: 118 },
  C: { left: 70, top: 118 },
};

export function YourFiveCourt({
  assignment,
  bench,
  benchSlots,
  onOpenTeam,
}: {
  assignment: FiveAssignment;
  bench: PlayerSpan[];
  benchSlots: number;
  onOpenTeam: () => void;
}) {
  return (
    <section className="wr-five" aria-label="Your five">
      <div className="wr-five-head">
        <span className="wr-five-title">Your five</span>
        <span className="at-calm-soft">
          bench {bench.length}/{benchSlots}
        </span>
      </div>
      <div className="wr-court">
        <span className="wr-court-key" aria-hidden />
        <span className="wr-court-arc" aria-hidden />
        <span className="wr-court-rim" aria-hidden />
        {STARTER_SLOTS.map((slot) => {
          const p = assignment[slot];
          const spot = COURT_SPOT[slot];
          return (
            <span key={slot} className={`wr-spot${p ? ' is-filled' : ''}`} style={{ left: `${spot.left}%`, top: spot.top }} title={p?.playerName}>
              {p ? <Face name={p.playerName} size="md" /> : <span className="wr-spot-open">{slot}</span>}
              <span className="wr-spot-name">{p ? boardName(p.playerName) : 'open'}</span>
            </span>
          );
        })}
      </div>
      {bench.length > 0 && (
        <div className="wr-bench">
          {bench.map((p) => (
            <span key={p.id} className="wr-bench-chip" title={p.playerName}>
              <Face name={p.playerName} size="xs" />
              {boardName(p.playerName)}
            </span>
          ))}
        </div>
      )}
      <button type="button" className="wr-five-link" onClick={onOpenTeam}>
        Years &amp; rotation →
      </button>
    </section>
  );
}

/** The phone's version: five dots in the status bar; a tap opens the Team tab. */
export function FiveDots({
  assignment,
  benchCount,
  benchSlots,
  onOpenTeam,
}: {
  assignment: FiveAssignment;
  benchCount: number;
  benchSlots: number;
  onOpenTeam: () => void;
}) {
  return (
    <button type="button" className="wr-dots" onClick={onOpenTeam} aria-label="Your team — open the Team tab">
      {STARTER_SLOTS.map((slot) => {
        const p = assignment[slot];
        return (
          <span key={slot} className={`wr-dot${p ? ' is-filled' : ''}`}>
            {p ? <Face name={p.playerName} size="sm" /> : <span className="wr-dot-open">+</span>}
            <b>{slot}</b>
          </span>
        );
      })}
      <span className="wr-dot-bench">
        <b className="at-calm-num">
          {benchCount}/{benchSlots}
        </b>
        bench
      </span>
    </button>
  );
}

export interface BigBoardEntry {
  name: string;
  span: PlayerSpan;
  /** Can be drafted with this pick. */
  legal: boolean;
}

/**
 * 2026-10-14, the Big Board (the user: "queue … nazwę bardziej pod naszą grę"): your own ranking of
 * who you want next, the way a front office keeps one. Star a player in the list to add him; players
 * other teams take drop off by themselves. "Draft top of board" takes the highest one you can afford.
 */
export function BigBoardPanel({
  entries,
  canPick,
  onDraft,
  onMove,
  onRemove,
}: {
  entries: BigBoardEntry[];
  canPick: boolean;
  onDraft: (span: PlayerSpan) => void;
  onMove: (name: string, dir: -1 | 1) => void;
  onRemove: (name: string) => void;
}) {
  const top = entries.find((e) => e.legal);
  return (
    <section className="wr-board" aria-label="Your Big Board">
      <div className="wr-board-head">
        <span className="wr-five-title">Your Big Board</span>
        <span className="at-calm-soft">Your own ranking — star players in the list to add them</span>
      </div>
      {entries.length === 0 ? (
        <p className="wr-board-empty">No one yet. Tap ☆ next to a player.</p>
      ) : (
        <ol className="wr-board-list">
          {entries.map((e, i) => (
            <li key={e.name} className={`wr-board-item${e.legal || !canPick ? '' : ' is-out'}`}>
              <span className="wr-board-rank">{i + 1}</span>
              <Face name={e.name} size="sm" />
              <span className="wr-board-name" title={e.name}>
                {boardName(e.name)}
              </span>
              <span className="wr-board-caps">
                <CapIcon size={11} /> {Math.round(e.span.fga)}
              </span>
              <span className="wr-board-moves">
                <button type="button" aria-label={`Move ${e.name} up`} disabled={i === 0} onClick={() => onMove(e.name, -1)}>
                  ↑
                </button>
                <button type="button" aria-label={`Move ${e.name} down`} disabled={i === entries.length - 1} onClick={() => onMove(e.name, 1)}>
                  ↓
                </button>
                <button type="button" aria-label={`Remove ${e.name} from your Big Board`} onClick={() => onRemove(e.name)}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {entries.length > 0 && (
        <button type="button" className="wr-board-draft" disabled={!canPick || !top} onClick={() => top && onDraft(top.span)}>
          {top ? `Draft top of board · ${boardName(top.name)}` : 'Nobody on your board fits this pick'}
        </button>
      )}
    </section>
  );
}
