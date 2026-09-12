import { useState } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, isPositionEligible } from '../engine/positions';
import { GAME_MINUTES, MAX_MINUTES_PER_PLAYER, autoAssignRotation, benchWithMinutes } from '../engine/rotation';
import { computeDurability, maxSustainableMinutes } from '../engine/durability';
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { displayTalentForSpan, offensiveGrade, defensiveGrade } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { AtGrade, OverallTierBadge } from './DraftBoard';
import { Face } from './ShotChip';
import type { Rotation, SlotAssignment, Team } from '../engine/types';

/** 2026-08-19, user's explicit ask ("maybe in TEAM section we can see player value in offense
 * defense etc"): a per-row Offense/Defense/Tier readout for whichever player is currently
 * assigned to a slot — the pick is already locked in by the time anyone reaches this screen, so
 * showing real letter grades here (same `AtGrade`/`OverallTierBadge` the Draft tab already uses)
 * enriches understanding without spoiling anything upstream. Only rendered once a player is
 * actually selected — an empty row has nothing to grade yet.
 * 2026-08-19 follow-up: briefly gated the two `AtGrade`s to Tester Mode for consistency with the
 * Team tab's own roster table — reverted same-day on the user's own direct clarification: Player
 * Mode's "blind scouting" is specifically about the DRAFT decision (Draft tab), not about hiding
 * what you already own. "you kind of drafting blindly but you can see what did you draft" — once
 * a player is actually on the roster, showing the full picture here is the point, not a leak. */
function PlayerValueBadges({ player }: { player: PlayerSpan }) {
  return (
    <span className="rotation-value-badges">
      <OverallTierBadge span={player} />
      <AtGrade grade={offensiveGrade(computeOffensiveTalent(player), computeUncappedOffensiveTalent(player))} />
      <AtGrade grade={defensiveGrade(computeDefensiveTalent(player))} />
    </span>
  );
}

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
   * the initial auto-seed (and the "Auto-fill" button) ran `autoAssignRotation` against whatever
   * partial roster existed at the time, producing exactly that kind of nonsense partial fill (one
   * drafted player smeared across two starter slots, the other three left empty) instead of
   * waiting for a real 9-man roster to actually assign. Omitted defaults to `true` (unchanged
   * behavior for the results-screen reuse, which only ever seeds this from an already-final
   * team) — the Team tab call site is the only one that passes `false` while picks remain. */
  rosterComplete?: boolean;
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

/** `rosterComplete = false` skips `autoAssignRotation` entirely and returns every slot empty —
 * see `Props.rosterComplete`'s own comment for why: auto-assigning against a still-growing roster
 * produces a partial, nonsensical fill instead of waiting for all 9 picks to actually be in. */
function buildInitialRows(roster: PlayerSpan[], seed?: Rotation | null, rosterComplete = true): RowsBySlot {
  const source = rosterComplete ? (seed ?? autoAssignRotation(roster)) : { slots: {} as Record<Position, SlotAssignment[]> };
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
  rosterComplete = true,
}: Props) {
  const [rows, setRows] = useState<RowsBySlot>(() => buildInitialRows(roster, initialRotation, rosterComplete));

  function handleAutoFill() {
    if (!rosterComplete) return;
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
      <button
        className="secondary-btn"
        onClick={handleAutoFill}
        disabled={!rosterComplete}
        title={rosterComplete ? undefined : 'Finish drafting your full roster before auto-filling the rotation.'}
      >
        Auto-fill (best fit)
      </button>
      {!rosterComplete && (
        <p className="rotation-incomplete-hint">
          Set minutes manually if you'd like, but auto-fill waits for your full roster — a partial
          one just gets smeared across a couple of slots instead of assigned sensibly.
        </p>
      )}

      {/* 2026-09-11, user-reported live ("głębsza przebudowa", "brzydko to wygląda") — the table
          this replaced (itself a 2026-08-19 rebuild away from an earlier card grid) matched the
          Team roster table's row shape, but every control in it was a bare, unstyled native
          `<select>`/`<input type=number>` — the one surface in the app that still looked like
          default browser chrome next to everywhere else's Face avatars and colored pills. Real
          cards again, but this time built FROM the same Face+badge language the rest of the app
          (Quick Five, Best Five, the Draft tab's own team strip) already established, with the
          native controls heavily reskinned rather than swapped for a custom dropdown — same real
          <select>/<input>, so nothing about keyboard/accessibility behavior changed underneath. */}
      <div className="rotation-cards">
        {STARTER_SLOTS.map((slot) => {
          const total = slotTotal(rows, slot);
          const canAddMore = rows[slot].length < MAX_ROWS_PER_SLOT;
          const full = total === GAME_MINUTES;
          return (
            <div key={slot} className={`rotation-card ${full ? 'rotation-card--full' : 'rotation-card--short'}`}>
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
              {rows[slot].map((row, rowIdx) => {
                const selectedPlayer = row.playerId ? roster.find((p) => p.id === row.playerId) : undefined;
                return (
                  <div key={rowIdx} className="rotation-card-row">
                    {selectedPlayer ? (
                      <Face name={selectedPlayer.playerName} />
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
                            title={`Durability-safe minutes cap, DUR ${computeDurability(selectedPlayer)}`}
                          >
                            cap {maxSustainableMinutes(selectedPlayer, MAX_MINUTES_PER_PLAYER)}m
                          </span>
                          <OverallTierBadge span={selectedPlayer} />
                          <AtGrade grade={offensiveGrade(computeOffensiveTalent(selectedPlayer), computeUncappedOffensiveTalent(selectedPlayer))} />
                          <AtGrade grade={defensiveGrade(computeDefensiveTalent(selectedPlayer))} />
                        </span>
                      )}
                    </div>
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
                      value={row.playerId ? row.minutes : ''}
                      placeholder="—"
                      disabled={!row.playerId}
                      className={`rotation-minutes-input ${row.playerId && overCapIds.has(row.playerId) ? 'minutes-warning' : ''}`}
                      onChange={(e) => updateRow(slot, rowIdx, { minutes: Number(e.target.value) })}
                    />
                    {rowIdx > 0 && (
                      <button className="remove-row-btn" title="Remove this contributor" onClick={() => removeRow(slot, rowIdx)}>
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              {canAddMore && (
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
          <li key={player.id} className="bench-list-row">
            <Face name={player.playerName} />
            <span className="bench-list-name">
              {player.playerName} ({player.spanLabel})
              <span className="bench-list-role">{player.offensiveArchetype} / {player.defensiveRole}</span>
            </span>
            {/* 2026-08-19, user's explicit ask: real Offense/Defense/Tier badges here too, same
                component the rotation rows above now use — a bare "TAL 68" text string used to be
                the only signal, with no sense of what it means on this game's own scale. */}
            <span className="bench-list-meta">
              <PlayerValueBadges player={player} />
              <span className="mini-fact">TAL {displayTalentForSpan(tierContextFor(player))}</span>
              <span className="mini-fact">{minutes} min</span>
            </span>
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
