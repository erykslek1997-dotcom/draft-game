import { useMemo, useState } from 'react';
import { draftPool } from '../data/draftPool';
import { normalizePlayerName, type PlayerSpan, type Position } from '../data/schema';
import { fitScore } from '../engine/fit';
import { isPickCapLegal } from '../engine/positions';
import { scoreTeam } from '../engine/scoring';
import { seasonProfile } from '../engine/seasonProfile';
import { computeTalent } from '../engine/talent';
import type { Rotation, Team } from '../engine/types';

const positionsFor = (player: PlayerSpan) => new Set<Position>([player.primaryPosition, ...player.secondaryPositions]);
const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;

function replacePlayer(team: Team, outgoingId: string, incoming: PlayerSpan): Team {
  if (!team.rotation) return { ...team, roster: team.roster.map((p) => p.id === outgoingId ? incoming : p) };
  return {
    ...team,
    roster: team.roster.map((p) => p.id === outgoingId ? incoming : p),
    rotation: {
      slots: Object.fromEntries(Object.entries(team.rotation.slots).map(([slot, assignments]) => [
        slot,
        assignments.map((entry) => entry.playerId === outgoingId ? { ...entry, playerId: incoming.id } : entry),
      ])) as Rotation['slots'],
    },
  };
}

export default function WhatIfPanel({ team }: { team: Team }) {
  const [outgoingId, setOutgoingId] = useState(team.roster[0]?.id ?? '');
  const [incomingId, setIncomingId] = useState('');
  const [incomingQuery, setIncomingQuery] = useState('');
  const outgoing = team.roster.find((player) => player.id === outgoingId);
  const occupiedSlots = useMemo(() => {
    if (!team.rotation || !outgoing) return new Set<Position>();
    return new Set(Object.entries(team.rotation.slots)
      .filter(([, entries]) => entries.some((entry) => entry.playerId === outgoing.id))
      .map(([slot]) => slot as Position));
  }, [team.rotation, outgoing]);
  const rosterNames = useMemo(
    () => new Set(team.roster.map((player) => normalizePlayerName(player.playerName))),
    [team.roster],
  );
  const currentFga = team.roster.reduce((sum, player) => sum + player.fga, 0);
  // The roster's FGAs with `outgoing` removed — the exact base the real draft's cap check runs on
  // (`isPickCapLegal` → `totalFga`, 1-decimal rounding), so a swap legal here is legal in the game.
  const remainingFgas = useMemo(
    () => (outgoing ? team.roster.filter((p) => p.id !== outgoing.id).map((p) => p.fga) : []),
    [team.roster, outgoing],
  );
  const candidates = useMemo(() => {
    if (!outgoing) return [];
    return draftPool.filter((candidate) => {
      if (rosterNames.has(normalizePlayerName(candidate.playerName))) return false;
      if (!isPickCapLegal(remainingFgas, candidate.fga)) return false;
      const positions = positionsFor(candidate);
      return [...occupiedSlots].every((slot) => positions.has(slot));
    }).sort((a, b) => computeTalent(b) - computeTalent(a) || a.playerName.localeCompare(b.playerName));
  }, [remainingFgas, occupiedSlots, outgoing, rosterNames]);
  const incoming = candidates.find((player) => player.id === incomingId);
  const candidateLabel = (player: PlayerSpan) => `${player.playerName} (${player.spanLabel})`;
  const candidateListId = `what-if-candidates-${team.id}`;
  const comparison = useMemo(() => {
    if (!outgoing || !incoming) return null;
    const hypothetical = replacePlayer(team, outgoing.id, incoming);
    const beforeBreakdown = scoreTeam(team);
    const afterBreakdown = scoreTeam(hypothetical);
    const beforeFit = fitScore(team);
    const afterFit = fitScore(hypothetical);
    return {
      beforeBreakdown,
      afterBreakdown,
      beforeFit,
      afterFit,
      beforeSeason: seasonProfile(beforeBreakdown, beforeFit),
      afterSeason: seasonProfile(afterBreakdown, afterFit),
      fga: currentFga - outgoing.fga + incoming.fga,
    };
  }, [currentFga, incoming, outgoing, team]);

  return (
    <details className="result-accordion-section what-if-panel">
      <summary>What-if — replace one player</summary>
      <label>
        Out
        <select value={outgoingId} onChange={(event) => { setOutgoingId(event.target.value); setIncomingId(''); setIncomingQuery(''); }}>
          {team.roster.map((player) => <option key={player.id} value={player.id}>{player.playerName} ({player.spanLabel})</option>)}
        </select>
      </label>
      <label>
        In
        <input
          type="search"
          list={candidateListId}
          value={incomingQuery}
          placeholder={`Type or select a legal replacement (${candidates.length})`}
          onChange={(event) => {
            const value = event.target.value;
            setIncomingQuery(value);
            const exact = candidates.find((player) => candidateLabel(player) === value)
              ?? candidates.find((player) => normalizePlayerName(player.playerName) === normalizePlayerName(value));
            setIncomingId(exact?.id ?? '');
          }}
        />
        <datalist id={candidateListId}>
          {candidates.map((player) => (
            <option key={player.id} value={candidateLabel(player)}>
              TAL {Math.round(computeTalent(player))} · FGA {player.fga.toFixed(1)}
            </option>
          ))}
        </datalist>
      </label>
      {comparison && (
        <>
          <span>FGA {currentFga.toFixed(1)} → {comparison.fga.toFixed(1)}</span>
          <span>Overall {comparison.beforeBreakdown.overall} → {comparison.afterBreakdown.overall} ({signed(comparison.afterBreakdown.overall - comparison.beforeBreakdown.overall)})</span>
          <span>FIT {comparison.beforeFit.score} → {comparison.afterFit.score} ({signed(comparison.afterFit.score - comparison.beforeFit.score)})</span>
          <span>RS {comparison.beforeSeason.regularSeason} → {comparison.afterSeason.regularSeason} · PO {comparison.beforeSeason.playoffs} → {comparison.afterSeason.playoffs}</span>
          <span>Spacing {comparison.beforeBreakdown.spacingScore} → {comparison.afterBreakdown.spacingScore} · Defense {comparison.beforeBreakdown.defenseScore} → {comparison.afterBreakdown.defenseScore}</span>
          <span>Identity {comparison.beforeFit.inputs.primaryArchetype ?? '—'} → {comparison.afterFit.inputs.primaryArchetype ?? '—'}</span>
        </>
      )}
    </details>
  );
}
