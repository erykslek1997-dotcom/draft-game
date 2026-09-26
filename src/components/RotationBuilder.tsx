import { memo, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, isPositionEligible } from '../engine/positions';
import { GAME_MINUTES, MAX_MINUTES_PER_PLAYER, autoAssignRotation, benchWithMinutes, suggestBasicRotation } from '../engine/rotation';
import { computeDurability, maxSustainableMinutes } from '../engine/durability';
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { offensiveGrade, defensiveGrade } from '../engine/grades';
import { AtGrade, OverallTierBadge } from './DraftBoard';
import { Face } from './ShotChip';
import type { Rotation, SlotAssignment, Team } from '../engine/types';


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
/** Minutes a −/+ tap moves (group C mockup 21B). */
const MINUTE_STEP = 2;

/** Where a dragged or tap-selected player comes from: the bench, or a row of another position. */
interface MoveSource {
  playerId: string;
  from?: { slot: Position; rowIdx: number };
}

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
  rosterComplete = true,
  seedStrategy = 'optimal',
  persistKey,
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
  // 2026-09-16, user-reported live ("jak ustalam minuty zawodnika, to wkurzające jest jak tam
  // nic nie może być... jak wykasuje wszystko to pojawia się zero"): the minutes `<input>` below
  // is fully controlled off `row.minutes` (a plain number) — clearing it to type a fresh value
  // made `onChange` read `Number('')` (== 0) and commit that immediately, so the box re-rendered
  // showing "0" mid-edit instead of staying blank, fighting every attempt to retype a 2-digit
  // number. This tracks the raw text the user is actively typing, per row, separately from the
  // committed numeric `row.minutes` — blank/in-progress text renders as blank without forcing a
  // 0 into the real rotation state; a valid number still commits live (on-cap warnings etc. keep
  // reacting as you type); losing focus while empty just reverts the box to the last committed
  // value instead of silently zeroing it.
  const [minutesDraft, setMinutesDraft] = useState<Record<string, string>>({});
  // Group C mockup 21: tap-to-place selection (phone) and the drag in progress (desktop).
  const [selected, setSelected] = useState<MoveSource | null>(null);
  const [dragging, setDragging] = useState<MoveSource | null>(null);
  const [dropSlot, setDropSlot] = useState<Position | null>(null);
  const splitBarRefs = useRef<Partial<Record<Position, HTMLSpanElement | null>>>({});

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

  /**
   * Group C mockup 21: put a player into a position by drag (desktop) or tap (phone).
   * - Onto an existing row: that row changes player, minutes stay.
   * - Onto the position: a new row that takes half of the last row's minutes, so the total stays.
   * A player moved out of another position hands his minutes to the row above him there, so that
   * position keeps its total too.
   */
  function placePlayer(source: MoveSource, slot: Position, targetRowIdx?: number) {
    setIsSuggestion(false);
    setRows((prev) => {
      const next = { ...prev } as RowsBySlot;
      let moved = 0;
      if (source.from) {
        const { slot: fromSlot, rowIdx } = source.from;
        if (fromSlot === slot && (targetRowIdx === undefined || targetRowIdx === rowIdx)) return prev;
        const fromRows = [...prev[fromSlot]];
        moved = fromRows[rowIdx]?.minutes ?? 0;
        if (fromRows.length > 1) {
          fromRows.splice(rowIdx, 1);
          const heir = Math.max(0, rowIdx - 1);
          fromRows[heir] = { ...fromRows[heir], minutes: fromRows[heir].minutes + moved };
        } else {
          fromRows[0] = { playerId: '', minutes: fromRows[0].minutes };
        }
        next[fromSlot] = fromRows;
      }
      const target = [...next[slot]];
      if (targetRowIdx !== undefined && target[targetRowIdx]) {
        target[targetRowIdx] = { ...target[targetRowIdx], playerId: source.playerId };
      } else if (!target[0]?.playerId) {
        target[0] = { playerId: source.playerId, minutes: target[0]?.minutes || GAME_MINUTES };
      } else if (target.length < MAX_ROWS_PER_SLOT) {
        const last = target.length - 1;
        const share = Math.floor(target[last].minutes / 2 / MINUTE_STEP) * MINUTE_STEP;
        target[last] = { ...target[last], minutes: target[last].minutes - share };
        target.push({ playerId: source.playerId, minutes: share });
      } else {
        return prev;
      }
      next[slot] = target;
      return next;
    });
    setMinutesDraft({});
    setSelected(null);
    setDragging(null);
    setDropSlot(null);
  }

  function stepMinutes(slot: Position, rowIdx: number, delta: number) {
    const row = rows[slot][rowIdx];
    if (!row?.playerId) return;
    setMinutesDraft((prev) => {
      const key = `${slot}-${rowIdx}`;
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    updateRow(slot, rowIdx, { minutes: Math.max(0, Math.min(GAME_MINUTES, row.minutes + delta)) });
  }

  /** Dragging the divider between two neighbouring rows in a position's bar moves minutes between
   * just those two, so the position's total never changes. */
  function startSplitDrag(event: ReactPointerEvent<HTMLSpanElement>, slot: Position, leftIdx: number) {
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
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function splitHandleKey(event: ReactKeyboardEvent<HTMLSpanElement>, slot: Position, leftIdx: number) {
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
  const allValid = slotErrors.length === 0 && overworkedPlayers.length === 0;

  // Not a validation error — allowed, same as the human's uncapped FGA at draft time, but it
  // costs rotationScore (see scoring.ts's DURABILITY_OVERWORK_PENALTY_*). Surfaced here so the
  // cost isn't a surprise on the results screen.
  const durabilityOverworked = roster
    .map((p) => ({ player: p, minutes: playerTotalMinutes(rows, p.id), cap: maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER) }))
    .filter(({ minutes, cap }) => minutes > cap);
  const overCapIds = new Set(durabilityOverworked.map((o) => o.player.id));

  // Throwaway Team purely so `benchWithMinutes` can be reused on an in-progress rotation —
  // never rendered, so its name/draftSlot are placeholders.
  const previewTeam: Team = {
    id: 'preview',
    name: 'preview',
    draftSlot: 0,
    isHuman: true,
    roster,
    rotation: { slots: rowsToSlots(rows) },
  };
  const bench = benchWithMinutes(previewTeam);

  const submitBlockedReason = confirmDisabled
    ? confirmDisabledHint
    : slotErrors.length > 0
      ? `Every position needs a starter and exactly ${GAME_MINUTES} minutes — still open: ${slotErrors.join(', ')}.`
      : overworkedPlayers.length > 0
        ? `Nobody can play more than ${GAME_MINUTES} minutes: ${overworkedPlayers.map((p) => p.playerName).join(', ')}.`
        : undefined;

  function handleConfirm() {
    if (!allValid) return;
    onConfirm({ slots: rowsToSlots(rows) });
  }

  return (
    <div className="rotation-builder">
      <h2>Set Your Rotation</h2>
      <p>
        Every position needs {GAME_MINUTES} minutes a game: the starter plays most of them and backups cover the rest.
        One backup can cover two positions (e.g. a combo guard backing up both PG and SG), and a third player can
        fill in minutes one backup can't.
      </p>

      {/* 2026-09-11, user-reported live ("głębsza przebudowa", "brzydko to wygląda") — the table
          this replaced (itself a 2026-08-19 rebuild away from an earlier card grid) matched the
          Team roster table's row shape, but every control in it was a bare, unstyled native
          `<select>`/`<input type=number>` — the one surface in the app that still looked like
          default browser chrome next to everywhere else's Face avatars and colored pills. Real
          cards again, but this time built FROM the same Face+badge language the rest of the app
          (Quick Five, Best Five, the Draft tab's own team strip) already established, with the
          native controls heavily reskinned rather than swapped for a custom dropdown — same real
          <select>/<input>, so nothing about keyboard/accessibility behavior changed underneath. */}
      {isSuggestion && (
        <p className="rotation-suggestion-note">
          Suggested lineup — filled in from your draft order and listed positions only, not optimized.
          It's probably not your best rotation: check who starts where and how the minutes are split.
        </p>
      )}

      <p className="rotation-dnd-hint">
        Drag a player from the bench onto a position, or between positions, and drag the divider in a position's bar to
        split its {GAME_MINUTES} minutes. On a phone, tap a bench player, then a position.
      </p>

      <div className="rotation-cards">
        {STARTER_SLOTS.map((slot) => {
          const total = slotTotal(rows, slot);
          const canAddMore = rows[slot].length < MAX_ROWS_PER_SLOT;
          const full = total === GAME_MINUTES;
          const active = dragging ?? selected;
          const activePlayer = active ? roster.find((p) => p.id === active.playerId) : undefined;
          const fits = activePlayer ? isPositionEligible(activePlayer, slot) : false;
          const filled = rows[slot].map((row, idx) => ({ row, idx })).filter(({ row }) => row.playerId);
          const cardClass = [
            'rotation-card',
            full ? 'rotation-card--full' : 'rotation-card--short',
            active ? (fits ? 'rotation-card--fits' : 'rotation-card--off') : '',
            dragging && dropSlot === slot ? 'rotation-card--drop' : '',
          ].join(' ');
          return (
            <div
              key={slot}
              className={cardClass}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                if (dropSlot !== slot) setDropSlot(slot);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropSlot((cur) => (cur === slot ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) placePlayer(dragging, slot);
              }}
            >
              <div className="rotation-card-head">
                <span className="rotation-card-pos at-cond">{slot}</span>
                <span className="rotation-card-minutes-track">
                  <span
                    className="rotation-card-minutes-fill"
                    style={{ width: `${Math.min(100, (total / GAME_MINUTES) * 100)}%` }}
                  />
                </span>
                <span className={full ? 'minutes-ok' : 'minutes-bad'}>
                  {total}/{GAME_MINUTES}
                </span>
              </div>
              {filled.length > 0 && (
                <span className="rotation-split" ref={(el) => { splitBarRefs.current[slot] = el; }}>
                  {filled.map(({ row, idx }, k) => {
                    const player = roster.find((p) => p.id === row.playerId);
                    return (
                      <span
                        key={idx}
                        className={`rotation-split-seg is-${Math.min(k, 2)}`}
                        style={{ width: `${(row.minutes / GAME_MINUTES) * 100}%` }}
                        title={`${player?.playerName ?? ''} ${row.minutes} min`}
                      >
                        <span className="rotation-split-label">
                          {player ? player.playerName.split(' ').slice(-1)[0] : ''} {row.minutes}
                        </span>
                        {k < filled.length - 1 && (
                          <span
                            className="rotation-split-handle"
                            role="slider"
                            tabIndex={0}
                            aria-label={`Minutes split between ${player?.playerName ?? 'this player'} and the next player at ${slot}`}
                            aria-valuemin={0}
                            aria-valuemax={row.minutes + filled[k + 1].row.minutes}
                            aria-valuenow={row.minutes}
                            onPointerDown={(e) => startSplitDrag(e, slot, idx)}
                            onKeyDown={(e) => splitHandleKey(e, slot, idx)}
                          />
                        )}
                      </span>
                    );
                  })}
                </span>
              )}
              {rows[slot].map((row, rowIdx) => {
                const selectedPlayer = row.playerId ? roster.find((p) => p.id === row.playerId) : undefined;
                return (
                  <div
                    key={rowIdx}
                    className="rotation-card-row"
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      e.stopPropagation();
                      placePlayer(dragging, slot, rowIdx);
                    }}
                  >
                    {selectedPlayer ? (
                      <span
                        className="rotation-drag-handle"
                        draggable
                        title={`Drag ${selectedPlayer.playerName} to another position`}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', selectedPlayer.id);
                          setDragging({ playerId: selectedPlayer.id, from: { slot, rowIdx } });
                        }}
                        onDragEnd={() => { setDragging(null); setDropSlot(null); }}
                      >
                        <svg className="rotation-grip" width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
                          <g fill="currentColor">
                            <circle cx="2" cy="2" r="1.3" /><circle cx="8" cy="2" r="1.3" />
                            <circle cx="2" cy="7" r="1.3" /><circle cx="8" cy="7" r="1.3" />
                            <circle cx="2" cy="12" r="1.3" /><circle cx="8" cy="12" r="1.3" />
                          </g>
                        </svg>
                        <Face name={selectedPlayer.playerName} />
                      </span>
                    ) : (
                      <span className="bf-face bf-face--sm bf-face--empty" aria-hidden />
                    )}
                    <div className="rotation-card-row-main">
                      <select
                        className="rotation-select"
                        value={row.playerId}
                        onChange={(e) => updateRow(slot, rowIdx, { playerId: e.target.value })}
                      >
                        <option value="">{rowIdx === 0 ? '-- starter --' : '-- backup (optional) --'}</option>
                        {/* Every rostered player is listed, not just the position-eligible ones:
                            a thin roster can force somebody to cover out of position (auto-fill
                            does exactly that to keep each slot at 48 minutes), and the dropdown
                            has to be able to show and preserve that assignment. Out-of-position
                            choices are marked rather than hidden — they're allowed but penalized,
                            contributing no talent at that slot. */}
                        {optionsFor(slot).map(({ player, eligible }) => (
                          <option key={player.id} value={player.id}>
                            {eligible ? '' : '⚠ '}
                            {player.playerName} ({player.spanLabel}) — {player.primaryPosition}
                            {eligible ? '' : ' (out of position)'}
                          </option>
                        ))}
                      </select>
                      {selectedPlayer && (
                        <span className="rotation-card-row-meta">
                          <span
                            className="durability-cap"
                            title={`Most minutes he can handle without wearing down (durability ${computeDurability(selectedPlayer)})`}
                          >
                            cap {maxSustainableMinutes(selectedPlayer, MAX_MINUTES_PER_PLAYER)}m
                          </span>
                          <OverallTierBadge span={selectedPlayer} />
                          <AtGrade grade={offensiveGrade(computeOffensiveTalent(selectedPlayer), computeUncappedOffensiveTalent(selectedPlayer))} />
                          <AtGrade grade={defensiveGrade(computeDefensiveTalent(selectedPlayer))} />
                        </span>
                      )}
                    </div>
                    <span className="rotation-stepper">
                      <button
                        type="button"
                        className="rotation-step-btn"
                        aria-label={`${MINUTE_STEP} minutes less`}
                        disabled={!row.playerId || row.minutes <= 0}
                        onClick={() => stepMinutes(slot, rowIdx, -MINUTE_STEP)}
                      >
                        −
                      </button>
                      {/* 2026-09-11, internal UI audit finding #3 ("Self-Scout Report"): an empty
                          starter row used to show a real "36" in this field before anyone was
                          assigned — the state still defaults new rows to 36 (so picking a starter
                          fills in a sensible minutes value for free, unchanged), but the field now
                          only displays it once `playerId` is actually set, matching the disabled
                          state it's already in either way. */}
                      <input
                        type="number"
                        min={0}
                        max={GAME_MINUTES}
                        value={row.playerId ? (minutesDraft[`${slot}-${rowIdx}`] ?? String(row.minutes)) : ''}
                        placeholder="—"
                        disabled={!row.playerId}
                        className={`rotation-minutes-input ${row.playerId && overCapIds.has(row.playerId) ? 'minutes-warning' : ''}`}
                        onChange={(e) => {
                          const key = `${slot}-${rowIdx}`;
                          const text = e.target.value;
                          setMinutesDraft((prev) => ({ ...prev, [key]: text }));
                          // Leave `row.minutes` alone while the box is genuinely empty or the user
                          // is still mid-keystroke on a partial number — only a value that already
                          // parses commits, same "don't snap to 0" reasoning as the state comment
                          // above.
                          if (text === '') return;
                          const parsed = Number(text);
                          if (!Number.isNaN(parsed)) updateRow(slot, rowIdx, { minutes: parsed });
                        }}
                        onBlur={() => {
                          const key = `${slot}-${rowIdx}`;
                          setMinutesDraft((prev) => {
                            if (!(key in prev)) return prev;
                            const next = { ...prev };
                            delete next[key];
                            return next;
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="rotation-step-btn"
                        aria-label={`${MINUTE_STEP} minutes more`}
                        disabled={!row.playerId || row.minutes >= GAME_MINUTES}
                        onClick={() => stepMinutes(slot, rowIdx, MINUTE_STEP)}
                      >
                        +
                      </button>
                    </span>
                    {rowIdx > 0 && (
                      <button className="remove-row-btn" title="Remove this contributor" onClick={() => removeRow(slot, rowIdx)}>
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              {selected && activePlayer ? (
                <button
                  type="button"
                  className={`rotation-drop-zone is-tap ${fits ? 'is-fit' : 'is-off'}`}
                  disabled={!canAddMore && !!rows[slot][0]?.playerId}
                  onClick={() => placePlayer(selected, slot)}
                >
                  Add {activePlayer.playerName.split(' ').slice(-1)[0]} here{fits ? '' : ' (out of position)'}
                </button>
              ) : (
                <span className={`rotation-drop-zone${dragging && dropSlot === slot ? ' is-over' : ''}`} aria-hidden>
                  {dragging ? (dropSlot === slot ? 'Drop here to add' : fits ? 'Fits here' : 'Out of position') : '+ drag a player here'}
                </span>
              )}
              {canAddMore && (
                <button className="add-row-btn" onClick={() => addRow(slot)}>
                  + add contributor
                </button>
              )}
            </div>
          );
        })}
      </div>

      {wrongSlotTotals.length > 0 && (
        <p className="validation-error">
          Each position needs exactly {GAME_MINUTES} minutes: {wrongSlotTotals.map((slot) => `${slot} ${slotTotal(rows, slot)}/${GAME_MINUTES}`).join(', ')}
        </p>
      )}

      {overworkedPlayers.length > 0 && (
        <p className="validation-error">
          Playing more than 48 minutes a game (not possible): {overworkedPlayers.map((p) => p.playerName).join(', ')}
        </p>
      )}

      {durabilityOverworked.length > 0 && (
        <p className="validation-warning">
          Playing more minutes than they can handle (allowed, but it lowers your Rotation score):{' '}
          {durabilityOverworked.map(({ player, minutes, cap }) => `${player.playerName} (${minutes} of ${cap} min)`).join(', ')}
        </p>
      )}

      {/* 2026-09-25: the old bench list repeated every backup the cards above show; only who isn't
          playing at all stays. Group C mockup 21: those players are now drag / tap sources. */}
      {bench.some(({ minutes }) => minutes === 0) && (
        <div className="rotation-bench">
          <span className="rotation-bench-title">Bench — not in the rotation</span>
          <div className="rotation-bench-chips">
            {bench
              .filter(({ minutes }) => minutes === 0)
              .map(({ player }) => {
                const isSelected = selected?.playerId === player.id && !selected.from;
                return (
                  <button
                    type="button"
                    key={player.id}
                    className={`rotation-bench-chip${isSelected ? ' is-selected' : ''}`}
                    draggable
                    aria-pressed={isSelected}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', player.id);
                      setDragging({ playerId: player.id });
                    }}
                    onDragEnd={() => { setDragging(null); setDropSlot(null); }}
                    onClick={() => setSelected(isSelected ? null : { playerId: player.id })}
                  >
                    <Face name={player.playerName} />
                    <span className="rotation-bench-name">{player.playerName} ({player.spanLabel})</span>
                    <OverallTierBadge span={player} />
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {selected && (() => {
        const player = roster.find((p) => p.id === selected.playerId);
        return player ? (
          <div className="rotation-selected-bar" role="status">
            <Face name={player.playerName} />
            <span className="rotation-selected-text">
              <b>{player.playerName} selected</b>
              <span>Tap a position to add him</span>
            </span>
            <button type="button" className="rotation-selected-cancel" aria-label="Cancel selection" onClick={() => setSelected(null)}>
              ×
            </button>
          </div>
        ) : null;
      })()}

      <button
        className="primary-btn"
        disabled={!allValid || confirmDisabled}
        title={submitBlockedReason}
        onClick={handleConfirm}
      >
        {confirmLabel ?? (onCancel ? 'Save Rotation' : 'Confirm Rotation & See Results')}
      </button>
      {/* 2026-09-24: a disabled Submit used to explain itself only through a hover tooltip, and
          not at all when the rotation itself was the blocker. */}
      {submitBlockedReason && <p className="rotation-submit-hint">{submitBlockedReason}</p>}
      {onCancel && (
        <button className="secondary-btn" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

export default memo(RotationBuilderComponent);
