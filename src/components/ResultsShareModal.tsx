import { useEffect, useRef } from 'react';
import type { Team } from '../engine/types';
import { shareFilename, useSaveCardImage } from './shareSave';
import { ordinal } from './ResultsScreen';
import { rosterLineup, type ProfileRow } from './ResultsReport';
import { PosterFive, PosterGrades, SharePoster } from './SharePoster';

/** 2026-09-11, user-reported live ("zamiast copy result to może 'share the result' i wyskakuje
 * ekran z naszymi wynikami?") — a real card to look at before saving it as an image.
 * 2026-10-08, the user (the card "nie wydaje się do końca spójne" with the game): it is now a small
 * copy of the results page — the same place and tag, the same three tiles, the same profile bars
 * and the same player rows as the roster, the bench on one line. Nothing drawn its own way. */
export function ShareModal({
  onClose,
  teamName,
  teamCode,
  rank,
  fieldSize,
  tier,
  overall,
  topOverall,
  gap,
  titleOdds,
  identity,
  profile,
  team,
}: {
  onClose: () => void;
  teamName: string;
  teamCode: string;
  rank: number;
  fieldSize: number;
  tier: { label: string; tone: 1 | 2 | 3 | 4 | 5 | 6 };
  overall: number;
  topOverall: number | null;
  gap: number | null;
  titleOdds: number | null;
  identity: string | null;
  profile: ProfileRow[];
  team: Team;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 2026-09-25, user-reported ("brak możliwości zapisu"): the card is saved as a PNG captured
  // from this DOM — the logic lives in shareSave.ts, shared with the other modes' share cards.
  const cardRef = useRef<HTMLDivElement>(null);
  const { saveState, savedImageUrl, saveImage } = useSaveCardImage(cardRef, shareFilename(teamName, 'all-time-draft'), `${teamName} — All-Time Draft`);
  const { starters, bench } = rosterLineup(team);

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div ref={cardRef} className="share-modal-card sh-card sp-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Share result">
        <button type="button" className="share-modal-close" onClick={onClose} aria-label="Close" data-share-exclude>
          ✕
        </button>
        <SharePoster teamName={teamName} teamCode={teamCode} kicker="All-Time Draft" footRight={`${rank}${ordinal(rank).slice(String(rank).length)} of ${fieldSize}`}>
          <div className="sp-hero">
            <span className="sp-place">
              {rank}
              <sup>{ordinal(rank).slice(String(rank).length)}</sup>
            </span>
            <span className="sp-hero-t">
              <span className="sp-of">of {fieldSize}</span>
              <span className={`rr-tag rr-tag--t${tier.tone}`}>{tier.label}</span>
            </span>
            <span className="sp-kpis">
              <span>
                <b>{overall}</b> team
              </span>
              <span>
                <b>{topOverall ?? overall}</b> best
              </span>
              {titleOdds !== null ? (
                <span>
                  <b>{`${(titleOdds * 100).toFixed(titleOdds >= 0.1 ? 0 : 1)}%`}</b> title odds
                </span>
              ) : (
                gap !== null && gap > 0 && (
                  <span>
                    <b>{gap}</b> behind
                  </span>
                )
              )}
            </span>
          </div>
          {identity && <p className="sp-title">{identity}.</p>}
          <PosterFive players={starters.map((e) => ({ name: e.name, line: `${e.slot} · ${e.years}` }))} />
          <PosterGrades rows={profile} />
          {bench.length > 0 && <p className="sp-bench">Bench: {bench.map((e) => e.name.split(' ').slice(-1)[0]).join(' · ')}</p>}
        </SharePoster>
        <div className="share-modal-save" data-share-exclude>
          <button type="button" className="primary-btn" onClick={saveImage} disabled={saveState === 'building'}>
            {saveState === 'building' ? 'Preparing image…' : '💾 Save image'}
          </button>
          {saveState === 'error' && <p className="share-modal-save-note">Couldn’t build the image here — take a screenshot instead.</p>}
          {savedImageUrl && (
            <>
              <p className="share-modal-save-note">If nothing downloaded, press and hold the image below to save it.</p>
              <img className="share-modal-save-preview" src={savedImageUrl} alt={`${teamName} result card`} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
