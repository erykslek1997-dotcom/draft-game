import { computeFinishing } from '../engine/finishing';
import { useEffect, useMemo } from 'react';
import type { PlayerSpan } from '../data/schema';
import { isPickLegal, type DraftState } from '../engine/draft';
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { computeOffensivePortability, computeDefensivePortability } from '../engine/portability';
import { computeSpacing } from '../engine/spacing';
import type { Team } from '../engine/types';
import { Face } from './ShotChip';
import { NOT_YET, STEALS_BLOCKS_NOTE, THREE_POINT_LINE_NOTE, hadStealsBlocksRecorded, hadThreePointLine } from './eraNotes';
import { EraYears } from './EraYears';
import { TeamChip } from './TeamBadge';
import { teamsForSpan } from '../engine/spanTeams';
import { draftPool as fullDraftPool } from '../data/draftPool';
import { offensiveGrade, defensiveGrade, offensivePortabilityGrade, defensivePortabilityGrade, spacingGrade, durabilityGrade, finishingGrade, overallTierForSpan } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { computeDurability } from '../engine/durability';
import { naturalPosition } from '../engine/naturalPosition';
import { AtGrade, SCOUT_REPORTS_PER_DRAFT, draftButtonTitle } from './DraftBoard';

/** Every career window the database has for a player, including the ones this draft's lean pool
 * leaves out (a star keeps only his peak windows there). Built once, on first open. */
let fullCareerByPlayer: Map<string, PlayerSpan[]> | null = null;
function fullCareerFor(playerName: string): PlayerSpan[] {
  if (!fullCareerByPlayer) {
    fullCareerByPlayer = new Map();
    for (const span of fullDraftPool) {
      const list = fullCareerByPlayer.get(span.playerName);
      if (list) list.push(span);
      else fullCareerByPlayer.set(span.playerName, [span]);
    }
  }
  return fullCareerByPlayer.get(playerName) ?? [];
}

/** 2026-09-11, user-reported live ("modal zamiast obecnego rozwijania karty") — the magnifying
 * glass on a player face-card opens this instead of expanding the card in place.
 * 2026-09-25: lists every career window on record (raw box score only), in career order, each
 * one draftable (draft.ts knows every window, not just the lean pool's). A scouting report (3 per
 * draft) adds his tier and the
 * offense/defense/portability/spacing/durability grades for every window. */
export function PlayerPeekModal({
  group,
  state,
  canPick,
  currentTeam,
  onClose,
  onPick,
  scouted,
  scoutsLeft,
  onScout,
}: {
  group: { playerName: string; spans: PlayerSpan[]; spansByAiValue: PlayerSpan[] };
  state: DraftState;
  canPick: boolean;
  currentTeam: Team;
  onClose: () => void;
  onPick: (id: string) => void;
  scouted: boolean;
  scoutsLeft: number;
  onScout: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    const byId = new Map<string, PlayerSpan>();
    for (const span of fullCareerFor(group.playerName)) byId.set(span.id, span);
    for (const span of group.spans) byId.set(span.id, span);
    return [...byId.values()].sort((a, b) => a.spanLabel.localeCompare(b.spanLabel));
  }, [group.playerName, group.spans]);

  return (
    <div className="player-peek-overlay" onClick={onClose}>
      <div
        className="player-peek-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${group.playerName} — seasons`}
      >
        <button type="button" className="player-peek-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="player-peek-head">
          <Face name={group.playerName} size="md" />
          <div>
            <h2 className="player-peek-name">{group.playerName}</h2>
            <span className="player-peek-sub">
              {naturalPosition(group.playerName)} · {rows.length} stretch{rows.length > 1 ? 'es' : ''} of his career to choose from
            </span>
          </div>
          <div className="player-peek-scout">
            {scouted ? (
              <span className="player-peek-scouted">✓ Scouting report</span>
            ) : (
              <button
                type="button"
                className="secondary-btn player-peek-scout-btn"
                disabled={scoutsLeft <= 0}
                onClick={onScout}
                title={
                  scoutsLeft > 0
                    ? 'Reveal his tier and offense, defense, portability, spacing and durability grades for every stretch.'
                    : 'You have used all your scouting reports for this draft.'
                }
              >
                🔍 Scout him · {scoutsLeft}/{SCOUT_REPORTS_PER_DRAFT} left
              </button>
            )}
          </div>
        </div>
        <div className="table-scroll">
          <table className="span-table at-draft-span-table">
            <thead>
              <tr>
                <th>Years</th>
                <th>Team</th>
                <th>Pos</th>
                <th className="num">PTS</th>
                <th className="num">AST</th>
                <th className="num">REB</th>
                <th className="num">STL</th>
                <th className="num">BLK</th>
                <th className="num">FG%</th>
                <th className="num">3PT%</th>
                <th className="num">FT%</th>
                <th className="num">Caps</th>
                {scouted && (
                  <>
                    <th>Tier</th>
                    <th title="Offense">OFF</th>
                    <th title="Defense">DEF</th>
                    <th title="Offensive portability">O-POR</th>
                    <th title="Defensive portability">D-POR</th>
                    <th title="Spacing">SPC</th>
                    <th title="Finishing">FIN</th>
                    <th title="Durability">DUR</th>
                  </>
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((span) => {
                const legal = canPick && isPickLegal(state, span.id);
                return (
                  <tr key={span.id}>
                    <td className="peek-years"><EraYears span={span} /></td>
                    <td className="peek-teams" data-label="Team">
                      {teamsForSpan(span).map((t) => (
                        <TeamChip key={t.code} code={t.code} seasonStart={t.seasonStart} seasonEnd={t.seasonEnd} />
                      ))}
                    </td>
                    <td data-label="Pos">{span.primaryPosition}</td>
                    <td className="num" data-label="PTS">{span.box.ppg.toFixed(1)}</td>
                    <td className="num" data-label="AST">{span.box.apg.toFixed(1)}</td>
                    <td className="num" data-label="REB">{span.box.rpg.toFixed(1)}</td>
                    {hadStealsBlocksRecorded(span) ? (
                      <>
                        <td className="num" data-label="STL">{span.box.spg.toFixed(1)}</td>
                        <td className="num" data-label="BLK">{span.box.bpg.toFixed(1)}</td>
                      </>
                    ) : (
                      <>
                        <td className="num era-na" data-label="STL" title={STEALS_BLOCKS_NOTE}>{NOT_YET}</td>
                        <td className="num era-na" data-label="BLK" title={STEALS_BLOCKS_NOTE}>{NOT_YET}</td>
                      </>
                    )}
                    <td className="num" data-label="FG%">{(span.box.fgPct * 100).toFixed(1)}%</td>
                    {hadThreePointLine(span) ? (
                      <td className="num" data-label="3PT%">{(span.box.threePct * 100).toFixed(1)}%</td>
                    ) : (
                      <td className="num era-na" data-label="3PT%" title={THREE_POINT_LINE_NOTE}>{NOT_YET}</td>
                    )}
                    <td className="num" data-label="FT%">{(span.box.ftPct * 100).toFixed(1)}%</td>
                    <td className="num" data-label="Caps">{span.fga.toFixed(1)}</td>
                    {scouted && (
                      <>
                        <td className="tier-cell peek-tier" data-label="Tier">{overallTierForSpan(tierContextFor(span))}</td>
                        <td data-label="OFF"><AtGrade grade={offensiveGrade(computeOffensiveTalent(span), computeUncappedOffensiveTalent(span))} /></td>
                        <td data-label="DEF"><AtGrade grade={defensiveGrade(computeDefensiveTalent(span))} /></td>
                        <td data-label="O-POR"><AtGrade grade={offensivePortabilityGrade(computeOffensivePortability(span))} /></td>
                        <td data-label="D-POR"><AtGrade grade={defensivePortabilityGrade(computeDefensivePortability(span))} /></td>
                        <td data-label="SPC"><AtGrade grade={spacingGrade(computeSpacing(span), span)} /></td>
                        <td data-label="FIN"><AtGrade grade={finishingGrade(computeFinishing(span), span)} /></td>
                        <td data-label="DUR"><AtGrade grade={durabilityGrade(computeDurability(span))} /></td>
                      </>
                    )}
                    <td className="peek-action">
                      <button
                        type="button"
                        className="at-draft-btn"
                        disabled={!legal}
                        title={draftButtonTitle(state, span.id, canPick, currentTeam)}
                        onClick={() => onPick(span.id)}
                      >
                        Draft
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
