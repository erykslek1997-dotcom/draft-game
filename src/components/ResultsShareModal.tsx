import { useEffect, useRef } from 'react';
import type { Team } from '../engine/types';
import { shareFilename, useSaveCardImage } from './shareSave';
import { ordinal } from './ResultsScreen';
import { ProfileBars, TeamMark, rosterLineup, type ProfileRow } from './ResultsReport';
import { PlayerRow, RowsLabel } from './PlayerRow';

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
      <div ref={cardRef} className="share-modal-card sh-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Share result">
        <button type="button" className="share-modal-close" onClick={onClose} aria-label="Close" data-share-exclude>
          ✕
        </button>
        <div className="sh-pad">
          <span className="rr-team">
            <TeamMark code={teamCode} name={teamName} size="md" />
            <h2>{teamName}</h2>
          </span>
          <span className="rr-place">
            <b>
              {rank}
              <sup>{ordinal(rank).slice(String(rank).length)}</sup>
            </b>
            <span>of {fieldSize}</span>
          </span>
          <span className={`rr-tag rr-tag--t${tier.tone}`}>{tier.label}</span>
          <div className="rs-kpis sh-kpis">
            <div className="rs-kpi rs-kpi--you">
              <b>{overall}</b>
              <span>Your team</span>
            </div>
            <div className="rs-kpi">
              <b>{topOverall ?? overall}</b>
              <span>Best</span>
            </div>
            {titleOdds !== null ? (
              <div className="rs-kpi">
                <b>{`${(titleOdds * 100).toFixed(titleOdds >= 0.1 ? 0 : 1)}%`}</b>
                <span>Title odds</span>
              </div>
            ) : (
              <div className="rs-kpi">
                <b>{gap !== null && gap > 0 ? gap : '—'}</b>
                <span>Behind the best</span>
              </div>
            )}
          </div>
          {identity && <p className="rr-headline">{identity}.</p>}
          <ProfileBars rows={profile} />
        </div>
        <div className="sh-roster">
          <RowsLabel>Starting five</RowsLabel>
          {starters.map((e) => (
            <PlayerRow key={e.id} size="lead" tag={e.slot} name={e.name} meta={e.years} value={e.minutes} unit="min" />
          ))}
          {bench.length > 0 && <p className="sh-bench">Bench: {bench.map((e) => `${e.name} ${e.minutes}m`).join(' · ')}</p>}
        </div>
        <div className="sh-foot">
          <span>Draftverse</span>
          <span>All-Time Draft</span>
        </div>
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
