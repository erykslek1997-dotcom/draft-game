import { useEffect, useRef, type ReactNode } from 'react';
import type { Position } from '../data/schema';
import { Face, shortenName } from './ShotChip';
import { ScoreBoard, type ScoreBoardCell } from './ScoreBoard';
import { ScoreChip } from './ResultsScreen';
import { shareFilename, useSaveCardImage } from './shareSave';

export interface ShareFiveRow {
  slot: Position;
  name: string;
  years: string;
}

/**
 * 2026-09-27 results audit pack C ("udostępnianie wszędzie"): the share card for Mini Draft and
 * Roulette — the same look and the same "Save image" as the All-Time Draft's card (ShareModal in
 * ResultsScreen.tsx), cut down to a starting five: headline, the result's scoreboard, the score
 * chips and the five.
 */
export default function ShareResultModal({
  onClose,
  mode,
  title,
  headline,
  tier,
  cells,
  chips,
  five,
}: {
  onClose: () => void;
  mode: 'Mini Draft' | 'Draw Five';
  /** Team name (Mini Draft) or "My Slot Machine five". */
  title: string;
  /** "4th / 16" style finish; omitted in the Slot Machine, where the tier is the headline. */
  headline?: ReactNode;
  tier: { label: string; tone: 1 | 2 | 3 | 4 | 5 | 6 };
  cells: ScoreBoardCell[];
  chips: { label: string; value: number }[];
  five: ShareFiveRow[];
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const cardRef = useRef<HTMLDivElement>(null);
  const { saveState, savedImageUrl, saveImage } = useSaveCardImage(
    cardRef,
    shareFilename(title, mode.toLowerCase().replace(' ', '-')),
    `${title} — ${mode}`,
  );

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div ref={cardRef} className="share-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Share result">
        <button type="button" className="share-modal-close" onClick={onClose} aria-label="Close" data-share-exclude>
          ✕
        </button>
        <span className="share-modal-mode at-cond">{mode}</span>
        <span className="share-modal-team">{title}</span>
        {headline && <div className="share-modal-rank">{headline}</div>}
        <span className={`share-modal-tier results-hero-tier-t${tier.tone}`}>{tier.label}</span>
        <ScoreBoard cells={cells} />
        <div className="share-modal-scores">
          {chips.map((c) => (
            <ScoreChip key={c.label} label={c.label} value={c.value} />
          ))}
        </div>
        <div className="share-modal-roster">
          <span className="share-modal-roster-label">Starting five</span>
          <div className="share-modal-face-row">
            {five.map((row) => (
              <div className="share-modal-face-group" key={row.slot}>
                <span className="share-modal-face-group-label">{row.slot}</span>
                <div className="share-modal-face-card">
                  <Face name={row.name} size="sm" />
                  <span className="share-modal-face-info">
                    <span className="share-modal-face-name">{shortenName(row.name, 14)}</span>
                    <span className="share-modal-face-meta">
                      <span>{row.years}</span>
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="share-modal-save" data-share-exclude>
          <button type="button" className="primary-btn" onClick={saveImage} disabled={saveState === 'building'}>
            {saveState === 'building' ? 'Preparing image…' : '💾 Save image'}
          </button>
          {saveState === 'error' && <p className="share-modal-save-note">Couldn’t build the image here — take a screenshot instead.</p>}
          {savedImageUrl && (
            <>
              <p className="share-modal-save-note">If nothing downloaded, press and hold the image below to save it.</p>
              <img className="share-modal-save-preview" src={savedImageUrl} alt={`${title} result card`} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
