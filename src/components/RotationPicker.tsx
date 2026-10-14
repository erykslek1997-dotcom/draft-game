import { useEffect, useRef } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { Face } from './ShotChip';

/** A bin, for "take him out of the rotation". */
export function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6M6.8 7v4.5M9.2 7v4.5" />
    </svg>
  );
}

export interface PickerOption {
  player: PlayerSpan;
  eligible: boolean;
  /** Minutes he already has across the whole rotation. */
  minutes: number;
}

/**
 * 2026-10-14, the user (playtest 6: the starter dropdown opened the phone's own system list — "mogłoby
 * wyświetlać bardziej pod nasze UI"): who plays a row, picked from a list in the game's own look —
 * face, name, position, out-of-position flag and the minutes he already has. Drops down under the
 * row on a wide screen, a sheet from the bottom on a phone. Esc or a click outside closes it.
 */
export function RotationPicker({
  slot,
  starter,
  options,
  selectedId,
  onPick,
  onRemove,
  onClose,
}: {
  slot: Position;
  starter: boolean;
  options: PickerOption[];
  selectedId: string;
  onPick: (playerId: string) => void;
  onRemove: (() => void) | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      // The row's own button toggles the picker itself.
      if ((target as Element).closest?.('.rb-pick')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    ref.current?.querySelector<HTMLButtonElement>('.rb-opt.is-on, .rb-opt')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  return (
    <>
      <div className="rb-menu-scrim" aria-hidden onClick={onClose} />
      <div ref={ref} className="rb-menu" role="listbox" aria-label={`${slot} ${starter ? 'starter' : 'backup'}`}>
        <div className="rb-menu-head">
          <span>
            {slot} · {starter ? 'starter' : 'backup'}
          </span>
          <button type="button" className="rb-menu-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="rb-menu-list">
          {options.map(({ player, eligible, minutes }) => {
            const on = player.id === selectedId;
            return (
              <button
                key={player.id}
                type="button"
                role="option"
                aria-selected={on}
                className={`rb-opt${on ? ' is-on' : ''}${eligible ? '' : ' is-off'}`}
                onClick={() => {
                  onPick(player.id);
                  onClose();
                }}
              >
                <Face name={player.playerName} />
                <span className="rb-opt-main">
                  <span className="rb-opt-name">{player.playerName}</span>
                  <span className="rb-opt-sub">
                    {player.primaryPosition} · {player.spanLabel}
                    {minutes > 0 && ` · ${minutes} min in the rotation`}
                  </span>
                </span>
                {!eligible && <span className="rb-opt-flag">Out of position</span>}
                {on && (
                  <span className="rb-opt-check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {onRemove && (
          <button
            type="button"
            className="rb-menu-remove"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            <TrashIcon /> Take him out of the rotation
          </button>
        )}
      </div>
    </>
  );
}
