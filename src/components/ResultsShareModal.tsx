import { useEffect, useRef } from 'react';
import { STARTER_SLOTS } from '../engine/positions';
import type { ShareRosterRow } from './shareCardImage';
import { Face, shortenName } from './ShotChip';
import { ScoreBoard } from './ScoreBoard';
import { shareFilename, useSaveCardImage } from './shareSave';
import { ScoreChip, SPOT_MINUTES, ordinal } from './ResultsScreen';

/** 2026-09-11, user-reported live ("zamiast copy result to może 'share the result' i wyskakuje
 * ekran z naszymi wynikami?") — a real card to look at before/instead of a blind clipboard copy.
 * Reuses the hero's own tier-tone language (`results-hero-tier-t{N}`) so it reads as the same
 * result, not a second visual system invented for one modal. Still no backend/share-sheet — the
 * "Copy as text" button inside is the exact same `copyResult` clipboard write the old button did. */
export function ShareModal({
  onClose,
  teamName,
  rank,
  fieldSize,
  tier,
  overall,
  topOverall,
  gap,
  titleOdds,
  identity,
  failureMode,
  roster,
  scores,
}: {
  onClose: () => void;
  teamName: string;
  rank: number;
  fieldSize: number;
  tier: { label: string; tone: 1 | 2 | 3 | 4 | 5 | 6 };
  overall: number;
  topOverall: number | null;
  gap: number | null;
  titleOdds: number | null;
  identity: string | null;
  failureMode: string | null;
  roster: ShareRosterRow[];
  /** 2026-09-18, user-reported live ("można dodać tu podstawowe metryki" — the basic metrics
   * could go here too): the same 7 `ScoreChip` values the hero's own "Team profile" row already
   * shows for this team. */
  scores: { talent: number; benchDepth: number; offense: number; defense: number; spacing: number; fit: number; rotation: number };
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 2026-09-25, user-reported ("brak możliwości zapisu"): the card is saved as a PNG captured
  // from this DOM — the logic now lives in shareSave.ts, shared with the other modes' share cards.
  const cardRef = useRef<HTMLDivElement>(null);
  const { saveState, savedImageUrl, saveImage } = useSaveCardImage(
    cardRef,
    shareFilename(teamName, 'all-time-draft'),
    `${teamName} — All-Time Draft`,
  );

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div ref={cardRef} className="share-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Share result">
        <button type="button" className="share-modal-close" onClick={onClose} aria-label="Close" data-share-exclude>
          ✕
        </button>
        <span className="share-modal-team">{teamName}</span>
        <div className="share-modal-rank">
          <b>{ordinal(rank)}</b>
          <i>/ {fieldSize}</i>
        </div>
        <span className={`share-modal-tier results-hero-tier-t${tier.tone}`}>{tier.label}</span>
        <ScoreBoard
          cells={[
            { label: 'Your team', value: overall, you: overall },
            { label: 'Best in field', value: topOverall ?? overall },
            titleOdds !== null
              ? { label: 'Title odds', value: `${(titleOdds * 100).toFixed(titleOdds >= 0.1 ? 0 : 1)}%` }
              : { label: 'Behind the best', value: gap !== null && gap > 0 ? gap : '—' },
          ]}
        />
        {(identity || failureMode) && (
          <p className="share-modal-identity">
            {identity && <b>{identity}</b>}
            {identity && failureMode && ' — '}
            {failureMode}
          </p>
        )}
        <div className="share-modal-scores">
          <ScoreChip label="Talent" value={scores.talent} />
          <ScoreChip label="Bench" value={scores.benchDepth} />
          <ScoreChip label="Offense" value={scores.offense} />
          <ScoreChip label="Defense" value={scores.defense} />
          <ScoreChip label="Spacing" value={scores.spacing} />
          <ScoreChip label="Fit" value={scores.fit} />
          <ScoreChip label="Rotation" value={scores.rotation} />
        </div>
        {roster.length > 0 && (() => {
          // 2026-09-12, user-reported live (screenshot of this exact modal): the roster section
          // was a plain two-column text grid with no faces at all — the PNG `shareCardImage.ts`
          // builds already has a real starting-five headshot row, but this in-modal preview (what
          // the user actually looks at before downloading) never matched it. Face cards added.
          // 2026-09-18, user-reported live (screenshot: Jerry West "18m" with no visible link to
          // who covers his other 30 — "brak dokładnej rotacji", "rotacja jako jedna statystyka w
          // oddzielnej linii źle wygląda"): the original "Starting five" row / "Bench" row split
          // read as two disconnected lists — you had to match position labels across two separate
          // groups by eye to see who actually backs up whom. Grouped by SLOT instead, one card per
          // position with every real contributor stacked inside (starter first, then by minutes) —
          // same shape as the hero's own "Rotation" panel above (`results-hero-rotation-columns`),
          // so a slot's full picture (e.g. West 18m / White 30m, both SG) reads at a glance instead
          // of needing to be reassembled from two separate rows.
          const bySlot = STARTER_SLOTS.map((slot) => ({
            slot,
            rows: roster
              .filter((row) => row.position === slot)
              .sort((a, b) => (a.isStarter === b.isStarter ? b.minutes - a.minutes : a.isStarter ? -1 : 1)),
          })).filter((group) => group.rows.length > 0);
          return (
            <div className="share-modal-roster">
              <span className="share-modal-roster-label">Roster &amp; rotation</span>
              <div className="share-modal-face-row">
                {bySlot.map(({ slot, rows }) => (
                  <div className="share-modal-face-group" key={slot}>
                    <span className="share-modal-face-group-label">{slot}</span>
                    {rows.filter((row) => row.minutes > 0 && (row.isStarter || row.minutes >= SPOT_MINUTES)).map((row) => (
                      <div className="share-modal-face-card" key={`${row.position}-${row.name}`}>
                        <Face name={row.name} size="sm" />
                        <span className="share-modal-face-info">
                          <span className="share-modal-face-name">{shortenName(row.name, 11)}</span>
                          <span className="share-modal-face-meta">
                            <span>{Math.round(row.minutes)}m</span>
                            <span className="share-modal-face-caps">{row.fga.toFixed(1)} caps</span>
                          </span>
                        </span>
                      </div>
                    ))}
                    {rows.some((row) => row.minutes > 0 && !row.isStarter && row.minutes < SPOT_MINUTES) && (
                      <span className="rotation-spot-line">
                        {rows
                          .filter((row) => row.minutes > 0 && !row.isStarter && row.minutes < SPOT_MINUTES)
                          .map((row) => (
                            <span className="rotation-spot-entry" key={row.name} title={`${row.name} · ${Math.round(row.minutes)} min`}>
                              <Face name={row.name} size="xs" />
                              {Math.round(row.minutes)}m
                            </span>
                          ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
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
