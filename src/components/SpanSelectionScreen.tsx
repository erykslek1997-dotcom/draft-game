import { useMemo, useState } from 'react';
import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanOptionsFor } from '../engine/spanOptimizer';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { totalFga } from '../engine/positions';

interface Props {
  /** The human's 9 drafted players, each currently represented by their Phase 1 peak span. */
  roster: PlayerSpan[];
  onConfirm: (roster: PlayerSpan[]) => void;
}

/**
 * Phase 2 of the "draft the player, then choose their span" mechanic (2026-08-04, user's own
 * design, see spanOptimizer.ts's docstring for the full rationale). This is the human-facing
 * half: AI teams get `optimizeSpans()` applied automatically, but the human picks freely here,
 * same as their draft-time FGA cap exemption (draft.ts: "the human drafts with no FGA cap at
 * all") — so there is deliberately no cap indicator or validation blocking confirmation here,
 * only informational totals.
 */
/** Every player's own peak span (Phase 1's pick), keyed by normalized name — the selection both
 * the initial state and "Reset to peak spans" resolve to. */
function peakSelection(roster: PlayerSpan[]): Record<string, string> {
  return Object.fromEntries(roster.map((p) => [normalizePlayerName(p.playerName), p.id]));
}

export default function SpanSelectionScreen({ roster, onConfirm }: Props) {
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>(() => peakSelection(roster));

  // `roster` never changes after mount (only `selectedIds` does, on every dropdown change) —
  // memoized so the full-pool filter+sort for all 9 players runs once, not on every interaction.
  const optionsByPlayer = useMemo(
    () =>
      roster.map((p) => ({
        key: normalizePlayerName(p.playerName),
        playerName: p.playerName,
        options: [...spanOptionsFor(p.playerName)].sort((a, b) => computeTalent(b) - computeTalent(a)),
      })),
    [roster]
  );

  function handleReset() {
    setSelectedIds(peakSelection(roster));
  }

  // Resolved once per player per render — both the totals below and the dropdowns' rendered
  // selection reuse the same `current` value instead of each re-deriving it independently.
  const chosen = optionsByPlayer.map(({ key, playerName, options }) => ({
    key,
    playerName,
    options,
    current: options.find((o) => o.id === selectedIds[key]) ?? options[0],
  }));
  const totalTal = chosen.reduce((s, p) => s + computeTalent(p.current), 0);
  const totalFgaVal = totalFga(chosen.map((p) => p.current.fga));

  function handleConfirm() {
    onConfirm(chosen.map((p) => p.current));
  }

  return (
    <div className="span-selection-screen">
      <h2>Choose Each Player's Span</h2>
      <p>
        You drafted the player, not a specific era — now pick which career window to actually roster for each of
        your 9 picks. No FGA cap here, same as the draft itself: pick whichever span is best for your team.
      </p>
      <button className="secondary-btn" onClick={handleReset}>
        Reset to peak spans
      </button>

      <div className="span-selection-list">
        {chosen.map(({ key, playerName, options, current }) => {
          return (
            <div key={key} className="span-selection-row">
              <span className="span-selection-name">{playerName}</span>
              <select
                value={current.id}
                onChange={(e) => setSelectedIds((prev) => ({ ...prev, [key]: e.target.value }))}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.spanLabel} — TAL {computeTalent(o)} (OTAL {computeOffensiveTalent(o)} / DTAL{' '}
                    {computeDefensiveTalent(o)}) — FGA {o.fga}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="span-selection-totals">
        <span>Total TAL: {totalTal}</span>
        <span>Total FGA: {totalFgaVal}</span>
      </div>

      <button className="primary-btn" onClick={handleConfirm}>
        Confirm Spans &amp; Build Rotation
      </button>
    </div>
  );
}
