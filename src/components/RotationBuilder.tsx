import { useState } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, isPositionEligible } from '../engine/positions';
import { GAME_MINUTES, MAX_MINUTES_PER_PLAYER, autoAssignRotation, benchWithMinutes } from '../engine/rotation';
import { computeDurability, maxSustainableMinutes } from '../engine/durability';
import { displayTalentForSpan, overallTierForSpan } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
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
}

interface Row {
  playerId: string;
  minutes: number;
}

/** A slot can end up with more than 2 contributors (a 3rd covers whatever minutes the first
 * backup couldn't, once minutes/distinct-slot caps limit them) — rows are a variable-length
 * list, not a fixed starter+backup pair, so manual editing can match whatever auto-fill produced. */
type RowsBySlot = Record<Position, Row[]>;

const MAX_ROWS_PER_SLOT = 4;

function buildInitialRows(roster: PlayerSpan[], seed?: Rotation | null): RowsBySlot {
  const source = seed ?? autoAssignRotation(roster);
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

export default function RotationBuilder({
  roster,
  onConfirm,
  initialRotation,
  onCancel,
  confirmLabel,
  confirmDisabled,
  confirmDisabledHint,
}: Props) {
  const [rows, setRows] = useState<RowsBySlot>(() => buildInitialRows(roster, initialRotation));

  function handleAutoFill() {
    setRows(buildInitialRows(roster));
  }

  function updateRow(slot: Position, rowIdx: number, patch: Partial<Row>) {
    setRows((prev) => {
      const next = { ...prev, [slot]: [...prev[slot]] };
      next[slot][rowIdx] = { ...next[slot][rowIdx], ...patch };
      return next;
    });
  }

  function addRow(slot: Position) {
    setRows((prev) => ({ ...prev, [slot]: [...prev[slot], { playerId: '', minutes: 0 }] }));
  }

  function removeRow(slot: Position, rowIdx: number) {
    setRows((prev) => ({ ...prev, [slot]: prev[slot].filter((_, i) => i !== rowIdx) }));
  }

  /** Natural fits first, then the out-of-position fallbacks, so the sensible picks are on top. */
  function optionsFor(slot: Position): { player: PlayerSpan; eligible: boolean }[] {
    return roster
      .map((player) => ({ player, eligible: isPositionEligible(player, slot) }))
      .sort((a, b) => Number(b.eligible) - Number(a.eligible));
  }

  const slotErrors = STARTER_SLOTS.filter((slot) => !rows[slot][0]?.playerId || slotTotal(rows, slot) > GAME_MINUTES);
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

  function handleConfirm() {
    if (!allValid) return;
    onConfirm({ slots: rowsToSlots(rows) });
  }

  return (
    <div className="rotation-builder">
      <h2>Set Your Rotation</h2>
      <p>
        Each position totals {GAME_MINUTES} minutes, split across a starter and one or more backups. A backup can
        cover more than one position (e.g. a combo guard backing up both PG and SG), and a 3rd contributor can pick
        up minutes a single backup can't (minutes/positions caps permitting).
      </p>
      <button className="secondary-btn" onClick={handleAutoFill}>
        Auto-fill (best fit)
      </button>

      <div className="slot-grid">
        {STARTER_SLOTS.map((slot) => {
          const total = slotTotal(rows, slot);
          return (
            <div key={slot} className="slot-block">
              <div className="slot-block-header">
                <label>{slot}</label>
                <span className={total === GAME_MINUTES ? 'minutes-ok' : 'minutes-bad'}>
                  {total} / {GAME_MINUTES} min
                </span>
              </div>
              {rows[slot].map((row, rowIdx) => (
                <div key={rowIdx} className="slot-row">
                  <select
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
                  <input
                    type="number"
                    min={0}
                    max={GAME_MINUTES}
                    value={row.minutes}
                    disabled={!row.playerId}
                    className={row.playerId && overCapIds.has(row.playerId) ? 'minutes-warning' : undefined}
                    onChange={(e) => updateRow(slot, rowIdx, { minutes: Number(e.target.value) })}
                  />
                  <span className="min-label">
                    min
                    {row.playerId && (() => {
                      const player = roster.find((p) => p.id === row.playerId);
                      if (!player) return null;
                      const cap = maxSustainableMinutes(player, MAX_MINUTES_PER_PLAYER);
                      return (
                        <span className="durability-cap" title={`Durability-safe minutes cap, DUR ${computeDurability(player)}`}>
                          {' '}
                          (cap {cap}m)
                        </span>
                      );
                    })()}
                  </span>
                  {rowIdx > 0 && (
                    <button className="remove-row-btn" title="Remove this contributor" onClick={() => removeRow(slot, rowIdx)}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              {rows[slot].length < MAX_ROWS_PER_SLOT && (
                <button className="add-row-btn" onClick={() => addRow(slot)}>
                  + add contributor
                </button>
              )}
            </div>
          );
        })}
      </div>

      {overworkedPlayers.length > 0 && (
        <p className="validation-error">
          Over 48 total minutes: {overworkedPlayers.map((p) => p.playerName).join(', ')}
        </p>
      )}

      {durabilityOverworked.length > 0 && (
        <p className="validation-warning">
          Past their durability-safe minutes (allowed, but costs Rotation score):{' '}
          {durabilityOverworked.map(({ player, minutes, cap }) => `${player.playerName} (${minutes}/${cap}m)`).join(', ')}
        </p>
      )}

      <h3>Bench ({bench.length})</h3>
      <ul className="bench-list">
        {bench.map(({ player, minutes }) => (
          <li key={player.id}>
            {/* 2026-08-19, user's explicit ask: a bare "TAL 68" here was one number with no sense
                of what it means on this game's own scale — the named tier (already computed
                everywhere else a player's overall quality is shown) gives it real context. */}
            {player.playerName} ({player.spanLabel}) — {player.offensiveArchetype} / {player.defensiveRole} — TAL{' '}
            {displayTalentForSpan(tierContextFor(player))} ({overallTierForSpan(tierContextFor(player))}) — {minutes} min
          </li>
        ))}
      </ul>

      <button
        className="primary-btn"
        disabled={!allValid || confirmDisabled}
        title={!allValid ? undefined : confirmDisabled ? confirmDisabledHint : undefined}
        onClick={handleConfirm}
      >
        {confirmLabel ?? (onCancel ? 'Save Rotation' : 'Confirm Rotation & See Results')}
      </button>
      {onCancel && (
        <button className="secondary-btn" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
