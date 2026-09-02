import { useMemo, useState } from 'react';
import { fitScore } from '../engine/fit';
import type { TeamLeagueEvaluation } from '../engine/leagueSimulation';
import { explainMatchup } from '../engine/matchupExplanation';
import { teamLabel } from '../engine/teamNames';
import type { Team } from '../engine/types';

export default function MatchupMatrix({ teams, evaluations, focusTeamId }: { teams: Team[]; evaluations: TeamLeagueEvaluation[]; focusTeamId?: string }) {
  const [selected, setSelected] = useState<{ teamId: string; opponentId: string } | null>(null);
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
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
      <h3>Your team's matchups — BO7</h3>
      <p className="player-notes-hint">Click a percentage to view the matchup analysis. The row shows your team.</p>
      <div className="matchup-matrix-scroll">
        <table className="at-roster-table matchup-matrix-table">
          <thead><tr><th>Team</th>{ordered.map((row) => <th key={row.teamId} title={teamLabel(teamById.get(row.teamId)!)}>#{row.globalRank}</th>)}</tr></thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.teamId}>
                <th>#{row.globalRank} {teamLabel(teamById.get(row.teamId)!)}</th>
                {ordered.map((column) => {
                  if (row.teamId === column.teamId) return <td key={column.teamId}>—</td>;
                  const matchup = row.matchups.find((entry) => entry.opponentId === column.teamId);
                  const probability = matchup?.seriesWinProb ?? 0.5;
                  const pct = Math.round(probability * 100);
                  return (
                    <td key={column.teamId}>
                      <button
                        className="matchup-matrix-cell"
                        style={{ backgroundColor: probability >= 0.5 ? `rgba(59, 155, 92, ${0.12 + Math.abs(probability - 0.5)})` : `rgba(190, 67, 67, ${0.12 + Math.abs(probability - 0.5)})` }}
                        onClick={() => setSelected({ teamId: row.teamId, opponentId: column.teamId })}
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
            <strong>{(detail.matchup.seriesWinProb * 100).toFixed(0)}% series win probability</strong>
            <span className="matchup-detail-margin">Projected margin: {detail.margin >= 0 ? '+' : ''}{detail.margin.toFixed(1)}</span>
          </div>
          <p className="matchup-detail-explanation">{detail.explanation}</p>
          <div className="matchup-detail-grid">
            {([
              ['Creation', detail.ownFit.components.creationStructure, detail.opponentFit.components.creationStructure],
              ['Spacing', detail.ownFit.components.spacingCompatibility, detail.opponentFit.components.spacingCompatibility],
              ['Defense', detail.ownFit.components.defensiveRoleCoverage, detail.opponentFit.components.defensiveRoleCoverage],
              ['Size', detail.ownFit.components.sizeCoverage, detail.opponentFit.components.sizeCoverage],
              ['Rebounding', detail.ownFit.components.reboundingBalance, detail.opponentFit.components.reboundingBalance],
              ['Switchability', detail.ownFit.inputs.switchability, detail.opponentFit.inputs.switchability],
            ] as Array<[string, number, number]>).map(([label, own, opponent]) => (
              <div className="matchup-detail-metric" key={label}>
                <span>{label}</span>
                <b>{Math.round(own)}</b><i>vs</i><b className="opponent-score">{Math.round(opponent)}</b>
              </div>
            ))}
          </div>
          <div className="matchup-detail-notes">
            <span><b>Your profile:</b> {detail.ownArchetype ?? '—'}</span>
            <span><b>Opponent profile:</b> {detail.opponentArchetype ?? '—'}</span>
            <span><b>Your defense:</b> POA {detail.ownFit.inputs.guardContainmentProvider ?? '—'} · wing {detail.ownFit.inputs.wingCoverageProvider ?? '—'} · rim {detail.ownFit.inputs.rimProtectionProvider ?? '—'}</span>
            {detail.ownFit.inputs.defensiveWeakLinkIsHuntable && <span><b>Target to protect:</b> {detail.ownFit.inputs.defensiveWeakLinkPlayer ?? 'weak link'}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
