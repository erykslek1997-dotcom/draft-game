import { useEffect } from 'react';
import { updateSettings, useSettings, type DraftSpeed } from '../settings';

const SPEED_OPTIONS: { id: DraftSpeed; label: string; hint: string }[] = [
  { id: 'calm', label: 'Calm', hint: 'Every CPU pick has a moment to read — the first round slowest.' },
  { id: 'fast', label: 'Fast', hint: 'About three times quicker; you can still follow the board.' },
  { id: 'instant', label: 'Instant', hint: 'The CPU picks straight through to your turn.' },
];

/** 2026-10-16: the settings window, from the menu and the draft headers (⚙). */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const speed = SPEED_OPTIONS.find((o) => o.id === settings.draftSpeed) ?? SPEED_OPTIONS[0];
  return (
    <div className="mode-help-backdrop" onClick={onClose}>
      <div className="mode-help-modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="mode-help-modal-head">
          <span className="mode-help-modal-title at-cond">Settings</span>
          <button type="button" className="mode-help-modal-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-row">
          <span className="settings-label">Draft speed</span>
          <div className="at-calm-seg settings-seg" role="radiogroup" aria-label="Draft speed">
            {SPEED_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={o.id === speed.id}
                className={o.id === speed.id ? 'is-on' : ''}
                onClick={() => updateSettings({ draftSpeed: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="settings-hint">{speed.hint} Applies to the All-Time and Mini Drafts, right away.</p>
        </div>
      </div>
    </div>
  );
}

/** The ⚙ button that opens it. */
export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="at-calm-icon settings-btn" aria-label="Settings" title="Settings" onClick={onClick}>
      ⚙
    </button>
  );
}
