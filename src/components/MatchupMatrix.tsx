import { useMemo, useState } from 'react';
import { fitScore } from '../engine/fit';
import type { TeamLeagueEvaluation } from '../engine/leagueSimulation';
import { explainMatchup } from '../engine/matchupExplanation';
import { archetypeDisplayName } from '../engine/championshipArchetype';
import { teamCodes, teamLabel } from '../engine/teamNames';
import type { Team } from '../engine/types';

/** Diverging red↔green scale for a BO7 series win probability, tuned for the dark board. A toss-up
 * sits near-grey; a decisive matchup saturates toward red (underdog) or green (favourite). The old
 * `rgba(…, 0.12 + |p-0.5|)` only varied alpha over a near-black ground, so the whole low end
 * (4%, 9%, 34%) collapsed into one muddy red — here 4% is a deep saturated red and 34% is a washed
 * grey-red, which is the reading a heat cell is supposed to give. */
function matchupCellColor(probability: number): string {
  const edge = Math.min(1, Math.abs(probability - 0.5) * 2); // 0 at a coin flip, 1 at 0% / 100%
  const hue = probability >= 0.5 ? 148 : 2;
  const saturation = 6 + edge * 52;
  const lightness = 27 - edge * 3;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export default function MatchupMatrix({ teams, evaluations, focusTeamId }: { teams: Team[]; evaluations: TeamLeagueEvaluation[]; focusTeamId?: string }) {
  const [selected, setSelected] = useState<{ teamId: string; opponentId: string } | null>(null);
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const codeByTeamId = useMemo(() => teamCodes(teams), [teams]);
  const evaluationById = useMemo(() => new Map(evaluations.map((row) => [row.teamId, row])), [evaluations]);
  const ordered = [...evaluations].sort((a, b) => a.globalRank - b.globalRank);
  const visibleRows = focusTeamId ? ordered.filter((row) => row.teamId === focusTeamId) : ordered;
  const detail = useMemo(() => {
    if (!selected) return null;
    const team = teamById.get(selected.teamId);
    const opponent = teamById.get(selected.opponentId);
    const matchup = evaluationById.get(selected.teamId)?.matchups.find((entry) => entry.opponentId === selected.opponentId);
    if (!team || !opponent || !matchup) return null;
    const ownFit = fitScore(team);
    const opponentFit = fitScore(opponent);
    return {
      team,
      opponent,
      matchup,
      margin: matchup.marginA,
      explanation: explainMatchup({ own: ownFit, opponent: opponentFit, seriesWinProb: matchup.seriesWinProb })[0],
      ownArchetype: ownFit.inputs.primaryArchetype,
      opponentArchetype: opponentFit.inputs.primaryArchetype,
      ownFit,
      opponentFit,
    };
  }, [evaluationById, selected, teamById]);

  if (ordered.length < 2) return null;
  return (
    <section className="matchup-matrix-section">
      <h3>Your chances in a best-of-7 series</h3>
      <div className="matchup-matrix-legend">
        <p className="player-notes-hint">Your chance to beat each team in a best-of-7 series. Click one for the breakdown.</p>
        <span className="matchup-matrix-scale">
          <i>Underdog</i>
          <span className="matchup-matrix-scale-bar" aria-hidden />
          <i>Favorite</i>
        </span>
      </div>
      {/* 2026-09-24: on a phone the one-row, 16-column table below needs ~760px of sideways
          scrolling with nothing hinting at it. Narrow screens get the same cells as a wrapping
          grid instead (CSS swaps which of the two is shown); same click-to-open behaviour. */}
      {visibleRows.length === 1 && (
        <div className="matchup-matrix-compact">
          {ordered
            .filter((column) => column.teamId !== visibleRows[0].teamId)
            .map((column) => {
              const row = visibleRows[0];
              const probability = row.matchups.find((entry) => entry.opponentId === column.teamId)?.seriesWinProb ?? 0.5;
              const isOpen = selected?.teamId === row.teamId && selected?.opponentId === column.teamId;
              return (
                <button
                  key={column.teamId}
                  className={`matchup-matrix-cell matchup-matrix-compact-cell ${isOpen ? 'is-open' : ''}`}
                  style={{ backgroundColor: matchupCellColor(probability) }}
                  title={`#${column.globalRank} ${teamLabel(teamById.get(column.teamId)!)}`}
                  onClick={() => setSelected(isOpen ? null : { teamId: row.teamId, opponentId: column.teamId })}
                >
                  <span className="matchup-matrix-compact-code">
                    #{column.globalRank} {codeByTeamId.get(column.teamId)}
                  </span>
                  {Math.round(probability * 100)}%
                </button>
              );
            })}
        </div>
      )}
      <div className={`matchup-matrix-scroll ${visibleRows.length === 1 ? 'has-compact' : ''}`}>
        <table className="at-roster-table matchup-matrix-table">
          <thead><tr><th>Opponent</th>{ordered.map((row) => (
            <th key={row.teamId} title={`#${row.globalRank} ${teamLabel(teamById.get(row.teamId)!)}`}>
              <span className="matchup-col-rank">#{row.globalRank}</span>
              <span className="matchup-col-code">{codeByTeamId.get(row.teamId)}</span>
            </th>
          ))}</tr></thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.teamId}>
                <th className="matchup-row-label" title={`#${row.globalRank} ${teamLabel(teamById.get(row.teamId)!)}`}>
                  #{row.globalRank} {teamLabel(teamById.get(row.teamId)!)}
                </th>
                {ordered.map((column) => {
                  if (row.teamId === column.teamId) return <td key={column.teamId} className="matchup-matrix-self">—</td>;
                  const matchup = row.matchups.find((entry) => entry.opponentId === column.teamId);
                  const probability = matchup?.seriesWinProb ?? 0.5;
                  const pct = Math.round(probability * 100);
                  return (
                    <td key={column.teamId}>
                      <button
                        className="matchup-matrix-cell"
                        style={{ backgroundColor: matchupCellColor(probability) }}
                        title={`#${column.globalRank} ${teamLabel(teamById.get(column.teamId)!)}`}
                        onClick={() =>
                          // 2026-09-11, user-reported live ("po rozwinięciu nie można zamknąć"):
                          // this used to always set `selected`, so a panel once opened could only
                          // ever be replaced by a different matchup, never closed. Clicking the
                          // same cell again now toggles it shut (an explicit close button on the
                          // panel below covers the rest).
                          setSelected((current) =>
                            current?.teamId === row.teamId && current?.opponentId === column.teamId
                              ? null
                              : { teamId: row.teamId, opponentId: column.teamId },
                          )
                        }
                      >{pct}%</button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && (
        <div className="fit-v2-shadow-panel matchup-matrix-detail">
          <div className="matchup-detail-heading">
            <span className="fit-v2-shadow-label">{teamLabel(detail.team)} vs {teamLabel(detail.opponent)}</span>
            <strong>{(detail.matchup.seriesWinProb * 100).toFixed(0)}% chance to win the series</strong>
            <span className="matchup-detail-margin">Projected margin: {detail.margin >= 0 ? '+' : ''}{detail.margin.toFixed(1)} pts a game</span>
            <button className="matchup-detail-close" onClick={() => setSelected(null)} aria-label="Close matchup analysis">
              ✕
            </button>
          </div>
          <p className="matchup-detail-explanation">{detail.explanation}</p>
          <div className="matchup-detail-grid">
            {([
              ['Creation', detail.ownFit.components.creationStructure, detail.opponentFit.components.creationStructure],
              ['Spacing fit', detail.ownFit.components.spacingCompatibility, detail.opponentFit.components.spacingCompatibility],
              ['Rim pressure', detail.ownFit.components.rimPressureTeam, detail.opponentFit.components.rimPressureTeam],
              ['Role coverage', detail.ownFit.components.defensiveRoleCoverage, detail.opponentFit.components.defensiveRoleCoverage],
              ['Size', detail.ownFit.components.sizeCoverage, detail.opponentFit.components.sizeCoverage],
              ['Rebounding', detail.ownFit.components.reboundingBalance, detail.opponentFit.components.reboundingBalance],
              ['Switchability', detail.ownFit.components.switchability, detail.opponentFit.components.switchability],
              ['Hunt resistance', detail.ownFit.components.huntResistance, detail.opponentFit.components.huntResistance],
            ] as Array<[string, number, number]>).map(([label, own, opponent]) => (
              <div className="matchup-detail-metric" key={label}>
                <span>{label}</span>
                <b>{Math.round(own)}</b><i>vs</i><b className="opponent-score">{Math.round(opponent)}</b>
              </div>
            ))}
          </div>
          {/* 2026-09-11, user-reported live ("'your defense' albo to usuwamy albo dodajemy coś
              dodatkowego... usuwamy, zostawiamy tylko profil drużyny") — the POA/wing/rim provider
              dump duplicated info the matchup-detail-grid rows above it already cover (Defense,
              Switchability, Hunt resistance) without adding a new decision-relevant read; profile
              stays as the two-line summary. */}
          <div className="matchup-detail-notes">
            <span><b>Your style:</b> {detail.ownArchetype ? archetypeDisplayName(detail.ownArchetype) : '—'}</span>
            <span><b>Their style:</b> {detail.opponentArchetype ? archetypeDisplayName(detail.opponentArchetype) : '—'}</span>
            {detail.ownFit.inputs.defensiveWeakLinkIsHuntable && <span><b>Your defender they'll attack:</b> {detail.ownFit.inputs.defensiveWeakLinkPlayer ?? 'weak link'}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
