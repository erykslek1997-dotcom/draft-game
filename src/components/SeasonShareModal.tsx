import { useEffect, useRef } from 'react';
import { shareFilename, useSaveCardImage } from './shareSave';
import { PosterFive, SharePoster } from './SharePoster';

/**
 * 2026-10-15 (playtest 9: "brak share po sezonie z dokładnym wynikiem"): the season as a card to
 * save — how far you went, the record and seed, your path through the playoffs, the five with their
 * season numbers and any awards your players won.
 */
export function SeasonShareModal({
  onClose,
  teamName,
  teamCode,
  result,
  champion,
  record,
  seed,
  path,
  five,
  awards,
}: {
  onClose: () => void;
  teamName: string;
  teamCode: string;
  /** "Champions", "Out in the Semifinals", "Missed the playoffs". */
  result: string;
  champion: boolean;
  record: string;
  seed: string;
  /** Each playoff round you played: label, opponent code, wins-losses, won. */
  path: { round: string; opp: string; score: string; won: boolean }[];
  five: { name: string; line: string }[];
  awards: string[];
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const cardRef = useRef<HTMLDivElement>(null);
  const { saveState, savedImageUrl, saveImage } = useSaveCardImage(cardRef, shareFilename(teamName, 'season'), `${teamName} — the season`);

  return (
    <div className="share-modal-overlay sp-overlay" onClick={onClose}>
      <div ref={cardRef} className="share-modal-card sh-card sp-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Share your season">
        <button type="button" className="share-modal-close" onClick={onClose} aria-label="Close" data-share-exclude>
          ✕
        </button>
        <SharePoster teamName={teamName} teamCode={teamCode} kicker="The season · All-Time Draft" footRight={`${record} · ${seed}`}>
          <div className={`sp-result${champion ? ' is-champ' : ''}`}>
            {champion && (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
              </svg>
            )}
            <span className="sp-result-t">{result}</span>
            <span className="sp-result-s">
              {record} · {seed}
            </span>
          </div>
          {path.length > 0 && (
            <div className="sp-path">
              {path.map((p) => (
                <span key={p.round} className={`sp-path-r${p.won ? ' is-won' : ' is-lost'}`}>
                  <small>{p.round}</small>
                  <b>
                    {p.won ? 'W' : 'L'} {p.score}
                  </b>
                  <small>vs {p.opp}</small>
                </span>
              ))}
            </div>
          )}
          <PosterFive players={five} />
          {awards.length > 0 && <p className="sp-awards">{awards.join(' · ')}</p>}
        </SharePoster>
        <div className="share-modal-save" data-share-exclude>
          <button type="button" className="primary-btn" onClick={saveImage} disabled={saveState === 'building'}>
            {saveState === 'building' ? 'Preparing image…' : '💾 Save image'}
          </button>
          {saveState === 'error' && <p className="share-modal-save-note">Couldn’t build the image here — take a screenshot instead.</p>}
          {savedImageUrl && (
            <>
              <p className="share-modal-save-note">If nothing downloaded, press and hold the image below to save it.</p>
              <img className="share-modal-save-preview" src={savedImageUrl} alt={`${teamName} season card`} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
