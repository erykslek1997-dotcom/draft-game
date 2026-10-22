import { Fragment, memo, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { maskName } from './bombMask';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, isPositionEligible } from '../engine/positions';
import { GAME_MINUTES, MAX_MINUTES_PER_PLAYER, autoAssignRotation, suggestBasicRotation } from '../engine/rotation';
import { playableMinutesCap } from '../engine/rotationRoleMinutes';
import type { Rotation, SlotAssignment } from '../engine/types';


interface Props {
  roster: PlayerSpan[];
  onConfirm: (rotation: Rotation) => void;
  /** 2026-08-08, reused for the Results screen's rotation-correction feature (any team, not just
   * the human's pre-results one): seeds the editor from an existing rotation (a prior correction,
   * or the AI's own auto-assigned one) instead of always starting over from a fresh auto-fill —
   * so reopening an edit doesn't discard earlier work. Omitted (the original pre-results flow)
   * falls back to `autoAssignRotation`, unchanged. */
  initialRotation?: Rotation | null;
  /** 2026-08-08, same feature — the pre-results flow has no way to back out (you must set SOME
   * rotation to proceed), but correcting an already-final team's rotation is optional and should
   * be cancelable without side effects. Omitted hides the button, matching the original flow. */
  onCancel?: () => void;
  /** 2026-08-16, added for DraftBoard's Team tab reuse (see that file's own docstring on the
   * merged span+rotation section) — lets the caller relabel the confirm action ("Submit Team"
   * there) instead of always showing this component's own two default labels. */
  confirmLabel?: string;
  /** Same reuse: an extra gate on top of this component's own `allValid` check — the Team tab
   * uses it to block submission until the draft itself is actually done, since `allValid` alone
   * only checks that whatever's currently drafted has a legal rotation, not that drafting is over. */
  confirmDisabled?: boolean;
  /** Shown as the disabled button's `title` tooltip when `confirmDisabled` is the reason (not
   * `!allValid`) — e.g. "Finish drafting before you can submit." */
  confirmDisabledHint?: string;
  /** A player who must get at least this many minutes before the team can be submitted — the Bomb
   * daily's hidden player (2026-10-16, TODO 3.4: "w rotacji min. 10 min"). */
  minMinutes?: { playerId: string; minutes: number; label: string };
  /** 2026-09-12, user-reported live (screenshot: PG 2/48 + PF 38/48, both LeBron, right after his
   * very first pick) — the Team tab opens this editor from pick 1 on, and until this flag existed
   * the initial auto-seed ran `autoAssignRotation` against whatever partial roster existed at the
   * time, producing exactly that kind of nonsense partial fill (one drafted player smeared across
   * two starter slots, the other three left empty) instead of waiting for a real 9-man roster to
   * actually assign. Omitted defaults to `true` (unchanged behavior for the results-screen reuse,
   * which only ever seeds this from an already-final team) — the Team tab call site is the only
   * one that passes `false` while picks remain. */
  rosterComplete?: boolean;
  /** 2026-09-24: how an empty editor gets seeded once the roster is complete. 'optimal' (default,
   * the Results screen's AI-team correction reuse) is `autoAssignRotation`; 'basic' (the human's
   * own Team tab) is `suggestBasicRotation` — a legal but deliberately unoptimized starting point,
   * shown with a note saying so. */
  seedStrategy?: 'optimal' | 'basic';
  /** 2026-09-24: localStorage key to keep in-progress edits under (the Team tab passes the saved-
   * draft key, so a resumed draft comes back with the rotation the player had set). Restored only
   * when it was saved for exactly this roster. */
  persistKey?: string;
  /** The host's own Submit (the night Team screen's aside) calls this. */
  submitRef?: MutableRefObject<(() => void) | null>;
  /** Whether the rotation can be submitted, and why not, for the host's button. */
  onStatus?: (status: { valid: boolean; reason?: string }) => void;
  /** Show this component's own Submit under the table (the phone, or no host button). */
  showSubmit?: boolean;
}

interface PersistedRows {
  rosterIds: string[];
  rows: RowsBySlot;
}

function readPersistedRows(key: string | undefined, roster: PlayerSpan[]): RowsBySlot | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as PersistedRows;
    const ids = roster.map((p) => p.id);
    if (!Array.isArray(saved?.rosterIds) || saved.rosterIds.join('|') !== ids.join('|')) return null;
    return STARTER_SLOTS.every((slot) => Array.isArray(saved.rows?.[slot])) ? saved.rows : null;
  } catch {
    return null;
  }
}

interface Row {
  playerId: string;
  minutes: number;
}

/** A slot can end up with more than 2 contributors (a 3rd covers whatever minutes the first
 * backup couldn't, once minutes/distinct-slot caps limit them) — rows are a variable-length
 * list, not a fixed starter+backup pair. */
type RowsBySlot = Record<Position, Row[]>;

const MAX_ROWS_PER_SLOT = 4;

/** `rosterComplete = false` skips `autoAssignRotation` entirely and returns every slot empty —
 * see `Props.rosterComplete`'s own comment for why: auto-assigning against a still-growing roster
 * produces a partial, nonsensical fill instead of waiting for all 9 picks to actually be in. */
function buildInitialRows(
  roster: PlayerSpan[],
  seed?: Rotation | null,
  rosterComplete = true,
  seedStrategy: 'optimal' | 'basic' = 'optimal',
): RowsBySlot {
  const autoSeed = () => (seedStrategy === 'basic' ? suggestBasicRotation(roster) : autoAssignRotation(roster));
  const source = rosterComplete ? (seed ?? autoSeed()) : { slots: {} as Record<Position, SlotAssignment[]> };
  const result = {} as RowsBySlot;
  for (const slot of STARTER_SLOTS) {
    const assignments = source.slots[slot] ?? [];
    const rows: Row[] = assignments.map((a) => ({ playerId: a.playerId, minutes: a.minutes }));
    if (rows.length === 0) rows.push({ playerId: '', minutes: 36 });
    result[slot] = rows;
  }
  return result;
}

function rowsToSlots(rows: RowsBySlot): Record<Position, SlotAssignment[]> {
  const slots = {} as Record<Position, SlotAssignment[]>;
  for (const slot of STARTER_SLOTS) {
    slots[slot] = rows[slot].filter((r) => r.playerId).map((r) => ({ playerId: r.playerId, minutes: r.minutes }));
  }
  return slots;
}

function slotTotal(rows: RowsBySlot, slot: Position): number {
  return rows[slot].reduce((sum, r) => sum + (r.playerId ? r.minutes : 0), 0);
}

function playerTotalMinutes(rows: RowsBySlot, playerId: string): number {
  let total = 0;
  for (const slot of STARTER_SLOTS) {
    for (const r of rows[slot]) {
      if (r.playerId === playerId) total += r.minutes;
    }
  }
  return total;
}

/**
 * 2026-09-12, user-reported live (Auto-finish appearing to hang on a full 144-pick draft, after
 * the Draft tab's Rotation card stopped unmounting on every tab switch — see that card's own
 * "always mounted" fix in DraftBoard.tsx): with the card always in the tree, this component now
 * renders on every pick in the whole draft, not just the human's own 9 — including 135 AI-only
 * picks whose roster/rotation data it never actually uses. `React.memo` plus the caller now
 * passing a memoized `roster` and a ref-stabilized `onConfirm` (both in DraftBoard.tsx) lets React
 * skip this component's own render — and the `optionsFor`/`benchWithMinutes` work inside it —
 * entirely for those picks, instead of quietly recomputing the same output 15x over.
 */
function RotationBuilderComponent({
  roster,
  onConfirm,
  initialRotation,
  onCancel,
  confirmLabel,
  confirmDisabled,
  confirmDisabledHint,
  minMinutes,
  rosterComplete = true,
  seedStrategy = 'optimal',
  persistKey,
  submitRef,
  onStatus,
  showSubmit = true,
}: Props) {
  const [restoredRows] = useState(() => readPersistedRows(persistKey, roster));
  const [rows, setRows] = useState<RowsBySlot>(
    () => restoredRows ?? buildInitialRows(roster, initialRotation, rosterComplete, seedStrategy),
  );
  useEffect(() => {
    if (!persistKey) return;
    try {
      const saved: PersistedRows = { rosterIds: roster.map((p) => p.id), rows };
      window.localStorage.setItem(persistKey, JSON.stringify(saved));
    } catch {
      // Not persisted — edits still work for this session.
    }
  }, [persistKey, roster, rows]);
  // 2026-10-14 (playtest 10: "była rotacja, wybrałem gracza i zniknęła rotacja"): changing a
  // player's years swaps his span id, and the Team tab used to remount this whole editor for it,
  // wiping every row. Now a row keeps its place and minutes and follows the player to his new years;
  // only a player who left the roster entirely empties his rows.
  const prevRosterRef = useRef(roster);
  useEffect(() => {
    const prev = prevRosterRef.current;
    prevRosterRef.current = roster;
    if (prev === roster) return;
    const ids = new Set(roster.map((p) => p.id));
    const idByName = new Map(roster.map((p) => [p.playerName, p.id]));
    const nameById = new Map(prev.map((p) => [p.id, p.playerName]));
    setRows((cur) => {
      let changed = false;
      const next = { ...cur } as RowsBySlot;
      for (const slot of STARTER_SLOTS) {
        next[slot] = cur[slot].map((r) => {
          if (!r.playerId || ids.has(r.playerId)) return r;
          changed = true;
          return { ...r, playerId: idByName.get(nameById.get(r.playerId) ?? '') ?? '' };
        });
      }
      return changed ? next : cur;
    });
  }, [roster]);
  // Whether the rows currently on screen came from the automatic seed and haven't been touched —
  // drives the "suggested, not optimized" note below.
  const [isSuggestion, setIsSuggestion] = useState(() => !restoredRows && rosterComplete && !initialRotation && seedStrategy === 'basic');
  // 2026-09-24: the Team tab mounts this from the human's FIRST pick, with every slot empty until
  // the roster is full — and nothing ever filled it after that, so the player faced ten blank
  // controls at the end of the draft. Seed it the moment the roster completes, but only if the
  // player hasn't already started setting it by hand while picks were still coming in.
  useEffect(() => {
    if (!rosterComplete || initialRotation) return;
    const untouched = STARTER_SLOTS.every((slot) => rows[slot].every((r) => !r.playerId));
    if (!untouched) return;
    setRows(buildInitialRows(roster, null, true, seedStrategy));
    setIsSuggestion(seedStrategy === 'basic');
    // Only the incomplete -> complete transition matters here; `roster` changing afterwards
    // remounts this component via its `key` in DraftBoard instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterComplete]);
  const splitBarRefs = useRef<Partial<Record<Position, HTMLDivElement | null>>>({});
  // The line being dragged, so it shows red with the two minutes.
  const [splitActive, setSplitActive] = useState<{ slot: Position; leftIdx: number } | null>(null);
  // The row whose player list is open (playtest 2026-10-14: our own list instead of the system one).
  const [picker, setPicker] = useState<{ slot: Position; rowIdx: number } | null>(null);

  function updateRow(slot: Position, rowIdx: number, patch: Partial<Row>) {
    setIsSuggestion(false);
    setRows((prev) => {
      const next = { ...prev, [slot]: [...prev[slot]] };
      next[slot][rowIdx] = { ...next[slot][rowIdx], ...patch };
      return next;
    });
  }

  function addRow(slot: Position) {
    setIsSuggestion(false);
    setRows((prev) => ({ ...prev, [slot]: [...prev[slot], { playerId: '', minutes: 0 }] }));
  }

  function removeRow(slot: Position, rowIdx: number) {
    setIsSuggestion(false);
    setRows((prev) => ({ ...prev, [slot]: prev[slot].filter((_, i) => i !== rowIdx) }));
  }

  /** The bin (playtest 2026-10-14, "brakuje czegoś jak usuń/kosz"): a backup row goes, a starter
   * row stays and is emptied — the position keeps its minutes for whoever comes in. */
  function clearRow(slot: Position, rowIdx: number) {
    if (rowIdx > 0) removeRow(slot, rowIdx);
    else updateRow(slot, 0, { playerId: '' });
  }

  /** A click on a position's bar (playtest 2026-10-14: "powinno wystarczyć że wcisnę pasek"): a
   * player's part opens his row's list; the open part opens the first empty row, or a new one. */
  function openFromBar(slot: Position, rowIdx?: number) {
    if (rowIdx !== undefined) {
      setPicker({ slot, rowIdx });
      return;
    }
    const empty = rows[slot].findIndex((r) => !r.playerId);
    if (empty >= 0) setPicker({ slot, rowIdx: empty });
    else if (rows[slot].length < MAX_ROWS_PER_SLOT) {
      addRow(slot);
      setPicker({ slot, rowIdx: rows[slot].length });
    }
  }

  /** Dragging the divider between two neighbouring rows in a position's bar moves minutes between
   * just those two, so the position's total never changes. */
  function startSplitDrag(event: ReactPointerEvent<HTMLElement>, slot: Position, leftIdx: number) {
    const bar = splitBarRefs.current[slot];
    if (!bar) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const filled = rows[slot].map((r, i) => ({ r, i })).filter(({ r }) => r.playerId);
    const pos = filled.findIndex(({ i }) => i === leftIdx);
    const right = filled[pos + 1];
    if (!right) return;
    const before = filled.slice(0, pos).reduce((sum, { r }) => sum + r.minutes, 0);
    const pairTotal = filled[pos].r.minutes + right.r.minutes;
    setSplitActive({ slot, leftIdx });
    const move = (e: PointerEvent) => {
      const rect = bar.getBoundingClientRect();
      const atMinute = Math.round(((e.clientX - rect.left) / rect.width) * GAME_MINUTES);
      const leftMinutes = Math.max(0, Math.min(pairTotal, atMinute - before));
      setIsSuggestion(false);
      setRows((prev) => {
        const list = [...prev[slot]];
        list[leftIdx] = { ...list[leftIdx], minutes: leftMinutes };
        list[right.i] = { ...list[right.i], minutes: pairTotal - leftMinutes };
        return { ...prev, [slot]: list };
      });
    };
    const stop = () => {
      setSplitActive(null);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function splitHandleKey(event: ReactKeyboardEvent<HTMLElement>, slot: Position, leftIdx: number) {
    const filled = rows[slot].map((r, i) => ({ r, i })).filter(({ r }) => r.playerId);
    const pos = filled.findIndex(({ i }) => i === leftIdx);
    const right = filled[pos + 1];
    if (!right) return;
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const leftMinutes = filled[pos].r.minutes + delta;
    const rightMinutes = right.r.minutes - delta;
    if (leftMinutes < 0 || rightMinutes < 0) return;
    setIsSuggestion(false);
    setRows((prev) => {
      const list = [...prev[slot]];
      list[leftIdx] = { ...list[leftIdx], minutes: leftMinutes };
      list[right.i] = { ...list[right.i], minutes: rightMinutes };
      return { ...prev, [slot]: list };
    });
  }

  /** Natural fits first, then the out-of-position fallbacks, so the sensible picks are on top. */
  function optionsFor(slot: Position): { player: PlayerSpan; eligible: boolean }[] {
    return roster
      .map((player) => ({ player, eligible: isPositionEligible(player, slot) }))
      .sort((a, b) => Number(b.eligible) - Number(a.eligible));
  }

  // A slot must total EXACTLY 48 — somebody is on the floor at that spot for the whole game (see
  // rotation.ts). It used to only reject `> 48`, so a rotation with, say, PG at 30/48 could be
  // submitted (user-reported 2026-09-23).
  const slotErrors = STARTER_SLOTS.filter((slot) => !rows[slot][0]?.playerId || slotTotal(rows, slot) !== GAME_MINUTES);
  const wrongSlotTotals = STARTER_SLOTS.filter((slot) => rows[slot][0]?.playerId && slotTotal(rows, slot) !== GAME_MINUTES);
  const overworkedPlayers = roster.filter((p) => playerTotalMinutes(rows, p.id) > GAME_MINUTES);
  const underMinimum =
    minMinutes && roster.some((p) => p.id === minMinutes.playerId) && playerTotalMinutes(rows, minMinutes.playerId) < minMinutes.minutes
      ? minMinutes
      : null;
  const allValid = slotErrors.length === 0 && overworkedPlayers.length === 0 && !underMinimum;

  // Not a validation error — allowed, same as the human's uncapped FGA at draft time, but it
  // costs rotationScore (see scoring.ts's DURABILITY_OVERWORK_PENALTY_*). Surfaced here so the
  // cost isn't a surprise on the results screen.
  const durabilityOverworked = roster
    .map((p) => ({ player: p, minutes: playerTotalMinutes(rows, p.id), cap: playableMinutesCap(p, MAX_MINUTES_PER_PLAYER) }))
    .filter(({ minutes, cap }) => minutes > cap);


  const submitBlockedReason = confirmDisabled
    ? confirmDisabledHint
    : slotErrors.length > 0
      ? `Every position needs a starter and exactly ${GAME_MINUTES} minutes — still open: ${slotErrors.join(', ')}.`
      : overworkedPlayers.length > 0
        ? `Nobody can play more than ${GAME_MINUTES} minutes: ${overworkedPlayers.map((p) => maskName(p.playerName)).join(', ')}.`
        : underMinimum
          ? `${underMinimum.label} plays at least ${underMinimum.minutes} minutes.`
          : undefined;

  const openMinutes = STARTER_SLOTS.reduce((sum, slot) => sum + Math.max(0, GAME_MINUTES - slotTotal(rows, slot)), 0);

  function handleConfirm() {
    if (!allValid) return;
    onConfirm({ slots: rowsToSlots(rows) });
  }

  // The aside's "Play the season" reads this: whether the rotation can go, and why not.
  useEffect(() => {
    onStatus?.({ valid: allValid && !confirmDisabled, reason: submitBlockedReason });
  }, [allValid, confirmDisabled, submitBlockedReason, onStatus]);
  if (submitRef) submitRef.current = handleConfirm;

  const nameOf = (id: string) => maskName(roster.find((p) => p.id === id)?.playerName ?? '');
  const totalOf = (id: string) => playerTotalMinutes(rows, id);
  const capOf = (p: PlayerSpan) => playableMinutesCap(p, MAX_MINUTES_PER_PLAYER);
  const placedTotal = STARTER_SLOTS.reduce((sum, slot) => sum + slotTotal(rows, slot), 0);
  const who = [...roster].sort((a, b) => totalOf(b.id) - totalOf(a.id));

  // Night edition (mockup `alltime.html#minutes3`): each position is one bar — the starter on cream,
  // who comes in after him on grey — with a line to drag between two players; a tap on a player
  // opens who could come in for him; + adds a third player, − takes him out again.
  return (
    <div className="rotation-builder nt-rot">
      <section>
        <h3>
          Rotation
          <span>
            {placedTotal} / {GAME_MINUTES * STARTER_SLOTS.length}
            {allValid ? ' · ready' : openMinutes > 0 ? ` · ${openMinutes} open` : ''}
          </span>
        </h3>
        {isSuggestion && <p className="empty-note">Suggested from your draft order and listed positions, not optimized. Check who starts where.</p>}
        <div className="rot3">
          {STARTER_SLOTS.map((slot) => {
            const total = slotTotal(rows, slot);
            const filled = rows[slot].map((row, idx) => ({ row, idx })).filter(({ row }) => row.playerId);
            const open = picker?.slot === slot ? picker.rowIdx : null;
            const canAdd = rows[slot].length < MAX_ROWS_PER_SLOT && !!rows[slot][0]?.playerId;
            const extra = rows[slot].length > 2;
            return (
              <div key={slot} className="r3w">
                <div className="r3">
                  <span className="r3p">{slot}</span>
                  <div className="r3b" ref={(el) => { splitBarRefs.current[slot] = el; }}>
                    {filled.map(({ row, idx }, k) => {
                      const player = roster.find((p) => p.id === row.playerId);
                      const name = maskName(player?.playerName ?? '');
                      const sp = name.indexOf(' ');
                      return (
                        <Fragment key={idx}>
                          {k > 0 && (
                            <u
                              className={splitActive?.slot === slot && splitActive.leftIdx === filled[k - 1].idx ? 'act' : undefined}
                              role="slider"
                              tabIndex={0}
                              aria-label={`Minutes between ${nameOf(filled[k - 1].row.playerId)} and ${name} at ${slot}`}
                              aria-valuemin={0}
                              aria-valuemax={filled[k - 1].row.minutes + row.minutes}
                              aria-valuenow={filled[k - 1].row.minutes}
                              onPointerDown={(e) => startSplitDrag(e, slot, filled[k - 1].idx)}
                              onKeyDown={(e) => splitHandleKey(e, slot, filled[k - 1].idx)}
                            >
                              {splitActive?.slot === slot && splitActive.leftIdx === filled[k - 1].idx && (
                                <em>
                                  {filled[k - 1].row.minutes} · {row.minutes}
                                </em>
                              )}
                            </u>
                          )}
                          <button
                            type="button"
                            className={`sg${k === 0 ? ' st' : k >= 2 ? ' third' : ''}${open === idx ? ' sel' : ''}${player && !isPositionEligible(player, slot) ? ' oop' : ''}`}
                            style={{ flex: row.minutes || 0.0001 }}
                            onClick={() => setPicker(open === idx ? null : { slot, rowIdx: idx })}
                            title={`${name} · ${row.minutes} min — tap to change`}
                          >
                            <b>
                              {sp > 0 ? (
                                <>
                                  <span className="fn">{name.slice(0, sp)} </span>
                                  {name.slice(sp + 1)}
                                </>
                              ) : (
                                name
                              )}
                              {open === idx && ' ▾'}
                            </b>
                            <i>{row.minutes}</i>
                          </button>
                        </Fragment>
                      );
                    })}
                    {total < GAME_MINUTES && (
                      <button type="button" className="sg open" style={{ flex: GAME_MINUTES - total }} onClick={() => openFromBar(slot)}>
                        <b>{filled.length === 0 ? 'Choose a starter' : 'Open'}</b>
                        <i>{GAME_MINUTES - total}</i>
                      </button>
                    )}
                  </div>
                  {extra ? (
                    <button type="button" className="r3x" aria-label={`Take the third player out at ${slot}`} onClick={() => clearRow(slot, rows[slot].length - 1)}>
                      −
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="r3x"
                      aria-label={`Add a player at ${slot}`}
                      disabled={!canAdd}
                      onClick={() => {
                        addRow(slot);
                        setPicker({ slot, rowIdx: rows[slot].length });
                      }}
                    >
                      +
                    </button>
                  )}
                </div>
                {open !== null && rows[slot][open] && (
                  <div className="swap" role="listbox" aria-label={`${slot}: who plays here`}>
                    <span className="pop-h">
                      {slot} ·{' '}
                      {rows[slot][open].playerId ? `who comes in for ${nameOf(rows[slot][open].playerId).split(' ').slice(-1)[0]}?` : open === 0 ? 'who starts?' : 'who comes in?'}
                    </span>
                    {optionsFor(slot).map(({ player, eligible }) => {
                      const mins = totalOf(player.id);
                      const cap = capOf(player);
                      return (
                        <button
                          key={player.id}
                          type="button"
                          role="option"
                          aria-selected={rows[slot][open].playerId === player.id}
                          className={`pop-r${rows[slot][open].playerId === player.id ? ' on' : ''}`}
                          onClick={() => {
                            updateRow(slot, open, { playerId: player.id, minutes: rows[slot][open].minutes || (open === 0 ? 36 : GAME_MINUTES - slotTotal(rows, slot)) });
                            setPicker(null);
                          }}
                        >
                          <b>{maskName(player.playerName)}</b>
                          <small>{player.primaryPosition}</small>
                          <span className={`fit${eligible ? '' : ' bad'}`}>{eligible ? 'fits' : 'out of position'}</span>
                          <span className="now">
                            {mins} min · can take {cap}
                          </span>
                        </button>
                      );
                    })}
                    {(rows[slot][open].playerId || open > 0) && (
                      <button type="button" className="pop-r pop-out" onClick={() => { clearRow(slot, open); setPicker(null); }}>
                        <b>{open > 0 ? 'Take him out' : 'Empty the spot'}</b>
                        <small />
                        <span className="fit">his minutes go back to the spot</span>
                        <span className="now" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <h3>
          Who plays how much<span>total · what his legs can take</span>
        </h3>
        <table className="who3">
          <tbody>
            {who.map((p) => {
              const m = totalOf(p.id);
              const cap = capOf(p);
              const over = m > cap;
              return (
                <tr key={p.id} className={over ? 'over' : undefined}>
                  <td className="n">{maskName(p.playerName)}</td>
                  <td className="m">{m}</td>
                  <td>
                    <div className="cb">
                      <i style={{ width: `${Math.min(100, (m / GAME_MINUTES) * 100)}%` }} />
                      <u style={{ left: `${(cap / GAME_MINUTES) * 100}%` }} />
                    </div>
                  </td>
                  <td className="c">{m === 0 ? 'not in the rotation' : over ? `over by ${m - cap} · costs Rotation` : `can take ${cap}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rosterComplete && wrongSlotTotals.length > 0 && (
          <p className="empty-note warn">
            Each spot needs exactly {GAME_MINUTES}: {wrongSlotTotals.map((slot) => `${slot} ${slotTotal(rows, slot)}`).join(', ')}.
          </p>
        )}
        {overworkedPlayers.length > 0 && <p className="empty-note warn">Nobody can play more than {GAME_MINUTES}: {overworkedPlayers.map((p) => maskName(p.playerName)).join(', ')}.</p>}
        {underMinimum && <p className="empty-note warn">{underMinimum.label} plays at least {underMinimum.minutes} minutes.</p>}
        <p className="empty-note" style={{ marginTop: 10 }}>
          {durabilityOverworked.length > 0
            ? `Allowed, but ${durabilityOverworked.map(({ player, minutes }) => `${maskName(player.playerName).split(' ').slice(-1)[0]} at ${minutes}`).join(', ')} lowers your Rotation score. `
            : `${GAME_MINUTES} minutes a spot; drag the ‖ handle between two players to move minutes. `}
          {rosterComplete && (
            <>
              <button
                type="button"
                className="lk-inline"
                onClick={() => {
                  setRows(buildInitialRows(roster, null, true, 'basic'));
                  setIsSuggestion(true);
                  setPicker(null);
                }}
              >
                Suggest a rotation
              </button>
              {' · '}
            </>
          )}
          <button
            type="button"
            className="lk-inline"
            onClick={() => {
              setRows(buildInitialRows(roster, null, false));
              setIsSuggestion(false);
              setPicker(null);
            }}
          >
            Reset
          </button>
        </p>
        {showSubmit && (
          <>
            <button type="button" className={`btn ${allValid && !confirmDisabled ? 'go' : 'off'}`} disabled={!allValid || confirmDisabled} onClick={handleConfirm}>
              {confirmLabel ?? 'Confirm rotation'}
            </button>
            {submitBlockedReason && <p className="empty-note">{submitBlockedReason}</p>}
          </>
        )}
        {onCancel && (
          <button type="button" className="btn line" onClick={onCancel}>
            Cancel
          </button>
        )}
      </section>
    </div>
  );
}

export default memo(RotationBuilderComponent);
