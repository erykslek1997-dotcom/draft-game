import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlayerSpan } from '../data/schema';
import { CapIcon, Face } from './ShotChip';
import { EraYears } from './EraYears';
import { effectiveTalent, overallTierForSpan } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';

/** How many of a player's best windows the Years sheet shows before "Show all". */
const YEARS_PICKER_TOP_COUNT = 5;

/** 2026-09-25, user-reported live ("może ten widok dostosować pod UI?"): the Team tab's Years menu
 * was a native `<select>`, so on a phone it opened the OS's own plain white list. Now a button
 * that opens an in-game sheet — era stamp, cost in caps and tier for every stretch, the current
 * one marked. */
export function YearsPicker({
  playerName,
  options,
  selectedId,
  showTal,
  onSelect,
}: {
  playerName: string;
  options: PlayerSpan[];
  selectedId: string;
  showTal: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showAllYears, setShowAllYears] = useState(false);
  const selected = options.find((o) => o.id === selectedId) ?? options[0];
  // 2026-09-25, user ("tabela jest za długa. Kilka najlepszych sezonów i przycisk show more"):
  // the sheet opens on his best windows by TAL (in career order) plus the current pick, with the
  // rest one click away.
  const chronological = [...options].sort((a, b) => a.spanLabel.localeCompare(b.spanLabel));
  const bestIds = new Set(
    [...options].sort((a, b) => effectiveTalent(b) - effectiveTalent(a)).slice(0, YEARS_PICKER_TOP_COUNT).map((o) => o.id),
  );
  bestIds.add(selected.id);
  const visibleOptions = showAllYears ? chronological : chronological.filter((o) => bestIds.has(o.id));
  const hiddenCount = chronological.length - visibleOptions.length;
  // 2026-09-25, user ("przesunięcie w lewo pozwoli na sprawdzenie całego składu"): the sheet docks
  // to the left edge on wide screens and stays open after a pick, so the Team table's grade
  // columns stay visible and update live while you click through the years. The row being edited
  // is highlighted in the table.
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const row = triggerRef.current?.closest('tr');
    if (!row) return;
    row.classList.toggle('is-editing-years', open);
    return () => row.classList.remove('is-editing-years');
  }, [open]);
  // 2026-09-25 ("zbyt bardzo na lewo … między draft board a rotację"): on wide screens the sheet
  // renders inline in the slot between the Team table and the Rotation card (no overlay, nothing
  // covered); phones keep the centred sheet.
  const [inlineSlot, setInlineSlot] = useState<HTMLElement | null>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 900px)').matches;
    const slot = wide ? document.getElementById('years-sheet-slot') : null;
    // The slot is `display: none` while empty (CSS) — only the tab switch's inline style hides it for real.
    setInlineSlot(slot && slot.style.display !== 'none' ? slot : null);
  }, [open]);
  useEffect(() => {
    if (open && inlineSlot) inlineRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open, inlineSlot]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button ref={triggerRef} type="button" className="years-picker-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <EraYears span={selected} />
        <span className="years-picker-cost">
          <CapIcon size={12} /> {selected.fga.toFixed(1)}
        </span>
        <span className="years-picker-caret" aria-hidden>▾</span>
      </button>
      {open && inlineSlot && createPortal(
        <div ref={inlineRef} className="years-picker-inline" role="region" aria-label={`${playerName} — choose years`}>
  <button type="button" className="player-peek-close" onClick={() => setOpen(false)} aria-label="Close">
      ✕
    </button>
    <div className="player-peek-head">
      <Face name={playerName} size="md" />
      <div>
        <h2 className="player-peek-name">{playerName}</h2>
        <span className="player-peek-sub">Which years of his career do you play? Pick one to see his row update.</span>
      </div>
    </div>
    <ul className="years-picker-list">
      {visibleOptions.map((o) => {
        const isSelected = o.id === selectedId;
        const tier = overallTierForSpan(tierContextFor(o));
        return (
          <li key={o.id}>
            <button
              type="button"
              className={`years-picker-option${isSelected ? ' is-selected' : ''}`}
              onClick={() => onSelect(o.id)}
            >
              <EraYears span={o} />
              <span className="years-picker-tier">{showTal ? `TAL ${effectiveTalent(o)} · ${tier}` : tier}</span>
              <span className="years-picker-cost">
                <CapIcon size={13} /> {o.fga.toFixed(1)}
              </span>
              <span className="years-picker-check" aria-hidden>{isSelected ? '✓' : ''}</span>
            </button>
          </li>
        );
      })}
    </ul>
    {(hiddenCount > 0 || showAllYears) && chronological.length > YEARS_PICKER_TOP_COUNT + 1 && (
      <button type="button" className="secondary-btn years-picker-more" onClick={() => setShowAllYears((v) => !v)}>
        {showAllYears ? 'Show best years only' : `Show all ${chronological.length} windows`}
      </button>
    )}
    <div className="years-picker-footer">
      <button type="button" className="primary-btn years-picker-done" onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
        </div>,
        inlineSlot,
      )}
      {open && !inlineSlot && (
        <div className="player-peek-overlay years-picker-overlay" onClick={() => setOpen(false)}>
          <div
            className="player-peek-card years-picker-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${playerName} — choose years`}
          >
            <button type="button" className="player-peek-close" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
            <div className="player-peek-head">
              <Face name={playerName} size="md" />
              <div>
                <h2 className="player-peek-name">{playerName}</h2>
                <span className="player-peek-sub">Which years of his career do you play? Pick one to see his row update.</span>
              </div>
            </div>
            <ul className="years-picker-list">
              {visibleOptions.map((o) => {
                const isSelected = o.id === selectedId;
                const tier = overallTierForSpan(tierContextFor(o));
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      className={`years-picker-option${isSelected ? ' is-selected' : ''}`}
                      onClick={() => onSelect(o.id)}
                    >
                      <EraYears span={o} />
                      <span className="years-picker-tier">{showTal ? `TAL ${effectiveTalent(o)} · ${tier}` : tier}</span>
                      <span className="years-picker-cost">
                        <CapIcon size={13} /> {o.fga.toFixed(1)}
                      </span>
                      <span className="years-picker-check" aria-hidden>{isSelected ? '✓' : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {(hiddenCount > 0 || showAllYears) && chronological.length > YEARS_PICKER_TOP_COUNT + 1 && (
              <button type="button" className="secondary-btn years-picker-more" onClick={() => setShowAllYears((v) => !v)}>
                {showAllYears ? 'Show best years only' : `Show all ${chronological.length} windows`}
              </button>
            )}
            <div className="years-picker-footer">
              <button type="button" className="primary-btn years-picker-done" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
