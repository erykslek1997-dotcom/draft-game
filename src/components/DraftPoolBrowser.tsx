import { useMemo, useState } from 'react';
import type { Position } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { computeOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { computeOffensivePortability, computeDefensivePortability } from '../engine/portability';
import { computeSpacing } from '../engine/spacing';
import { computeDurability } from '../engine/durability';
import { allStarCount } from '../engine/allStarLookup';
import { offensiveGrade, defensiveGrade, offensivePortabilityGrade, defensivePortabilityGrade, displayTalentForSpan, displayNumberForSpan } from '../engine/grades';
import {
  ALL_POSITIONS,
  groupByPlayer,
  SpacingTierBadge,
  OverallTierBadge,
  PlayoffPerformanceBadge,
  DurabilityTierBadge,
  tierContextFor,
  type PlayerGroup,
} from './DraftBoard';

interface Props {
  mode: 'developer' | 'player';
  onBack: () => void;
}

/**
 * Read-only browse of the full in-game 300-player pool, outside of an active draft — the user's
 * own ask: "add 'draft pool' in main menu so I can look at full roster." Deliberately a separate
 * component rather than a mode flag on `DraftBoard`: that component's search/position/expand
 * logic is tightly coupled to a live `DraftState` (per-team cap tracking, pick legality, whose
 * turn it is), and none of that applies here — there's no team, no cap, nothing to draft. Reuses
 * `DraftBoard`'s exported grouping/badge helpers rather than re-deriving them, so the two views
 * can't silently drift on how a tier or a grade is computed.
 */
export default function DraftPoolBrowser({ mode, onBack }: Props) {
  const showJudgeMetrics = mode === 'developer';
  const [search, setSearch] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<Position | 'ALL' | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isSearching = search.trim() !== '';
  const isBrowsing = selectedPosition !== null || isSearching;

  const allGroups = useMemo(() => groupByPlayer(draftPool), []);

  // Same stable-tiebreak shape as DraftBoard's player-mode sort, simplified: the pool here never
  // shrinks (nothing gets drafted), so it only ever needs computing once.
  const randomTiebreak = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of draftPool) if (!map.has(p.playerName)) map.set(p.playerName, Math.random());
    return map;
  }, []);

  function careerPosition(g: PlayerGroup): Position {
    const counts = new Map<Position, number>();
    for (const span of g.spans) counts.set(span.primaryPosition, (counts.get(span.primaryPosition) ?? 0) + 1);
    return ALL_POSITIONS.reduce((best, pos) => ((counts.get(pos) ?? 0) > (counts.get(best) ?? 0) ? pos : best), ALL_POSITIONS[0]);
  }

  const positionCounts = new Map<Position, number>(
    ALL_POSITIONS.map((pos) => [pos, allGroups.filter((g) => careerPosition(g) === pos).length]),
  );

  // Same fix as DraftBoard.tsx's identical pattern (2026-07-30): every judge metric computed
  // exactly once per visible player here, not once per sort comparison (a ~325-player sort
  // calls its comparator ~2,700 times) and again for display. `showJudgeMetrics` gates the
  // other five so player mode never pays for metrics it doesn't show or sort by.
  //
  // Skipped entirely (`[]`) when `!isBrowsing`, same as DraftBoard.tsx (2026-07-31): the
  // position-grid view only reads `allGroups.length`/`positionCounts`, never `groups`.
  const groups = !isBrowsing
    ? []
    : allGroups
        .filter((g) => (selectedPosition && selectedPosition !== 'ALL' ? careerPosition(g) === selectedPosition : true))
        .filter((g) => g.playerName.toLowerCase().includes(search.toLowerCase()))
        .map((g) => {
          // See DraftBoard.tsx's identical comments (2026-08-05): sort key and displayed number
          // must be the same (capped) value, or a tier-capped player can sort above/below where
          // their own displayed number would put them — and "best span" itself has to be picked
          // by that same capped value, or a player's harshest-capped span (highest raw TAL, but
          // gated hardest) can hide a different span that reaches a genuinely better tier.
          const bestTalentSpan = showJudgeMetrics
            ? g.spans.reduce(
                (best, s) =>
                  displayTalentForSpan(tierContextFor(s)) > displayTalentForSpan(tierContextFor(best)) ? s : best,
                g.spans[0],
              )
            : g.spans[0];
          return {
            ...g,
            bestTalentSpan,
            bestTalent: showJudgeMetrics ? displayTalentForSpan(tierContextFor(bestTalentSpan)) : 0,
            bestOffensiveTalent: showJudgeMetrics ? Math.max(...g.spans.map(computeOffensiveTalent)) : 0,
            bestDefensiveTalent: showJudgeMetrics ? Math.max(...g.spans.map(computeDefensiveTalent)) : 0,
            bestOffensivePortability: showJudgeMetrics ? Math.max(...g.spans.map(computeOffensivePortability)) : 0,
            bestDefensivePortability: showJudgeMetrics ? Math.max(...g.spans.map(computeDefensivePortability)) : 0,
            bestSpacing: showJudgeMetrics ? Math.max(...g.spans.map(computeSpacing)) : 0,
            bestDurability: showJudgeMetrics ? Math.max(...g.spans.map(computeDurability)) : 0,
          };
        })
        .sort((a, b) => {
          if (mode === 'player') {
            const starDiff = allStarCount(b.playerName) - allStarCount(a.playerName);
            if (starDiff !== 0) return starDiff;
            return (randomTiebreak.get(a.playerName) ?? 0) - (randomTiebreak.get(b.playerName) ?? 0);
          }
          return b.bestTalent - a.bestTalent;
        });

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function backToPositions() {
    setSelectedPosition(null);
    setSearch('');
  }

  return (
    <div className="draft-board draft-pool-browser">
      <div className="draft-status">
        <strong>Draft Pool</strong> — {draftPool.length} spans, {allGroups.length} players
        <button className="history-toggle" onClick={onBack}>
          ← Back
        </button>
      </div>

      <div className="player-pool">
        <div className="pool-controls">
          <input placeholder="Search players…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {!isBrowsing ? (
          <div className="position-grid">
            <button key="ALL" className="position-card" onClick={() => setSelectedPosition('ALL')}>
              <span className="position-card-label">ALL</span>
              <span className="position-card-count">{allGroups.length} players</span>
            </button>
            {ALL_POSITIONS.map((pos) => (
              <button key={pos} className="position-card" onClick={() => setSelectedPosition(pos)}>
                <span className="position-card-label">{pos}</span>
                <span className="position-card-count">{positionCounts.get(pos)} players</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="browse-header">
              <button className="secondary-btn" onClick={backToPositions}>
                ← Positions
              </button>
              <span className="browse-title">
                {selectedPosition
                  ? `${selectedPosition === 'ALL' ? 'All positions' : selectedPosition} — sorted by ${mode === 'player' ? 'All-Star appearances' : 'talent'}`
                  : `Search results for "${search}"`}
              </span>
            </div>

            <div className="player-groups">
              {groups.map((group) => {
                const isOpen = expanded.has(group.playerName);
                const fgas = group.spans.map((s) => s.fga);
                const minFga = Math.min(...fgas);
                const maxFga = Math.max(...fgas);
                const {
                  bestTalentSpan,
                  bestOffensiveTalent,
                  bestDefensiveTalent,
                  bestOffensivePortability,
                  bestDefensivePortability,
                  bestSpacing,
                  bestDurability,
                } = group;
                return (
                  <div key={group.playerName} className="player-group">
                    <button className="player-group-header" onClick={() => toggleExpand(group.playerName)}>
                      <span className="pg-caret">{isOpen ? '▾' : '▸'}</span>
                      <span className="pg-name">{group.playerName}</span>
                      <span className="pg-meta">
                        {group.spans.length} season{group.spans.length > 1 ? 's' : ''}
                      </span>
                      <span className="pg-fga">
                        {minFga === maxFga ? minFga.toFixed(1) : `${minFga.toFixed(1)}–${maxFga.toFixed(1)}`} FGA
                      </span>
                      {showJudgeMetrics && (
                        <span className="pg-tal">
                          TAL {displayNumberForSpan(bestTalentSpan, tierContextFor(bestTalentSpan))} <OverallTierBadge span={bestTalentSpan} />
                        </span>
                      )}
                      {showJudgeMetrics && <span className="pg-otal">O-TAL {offensiveGrade(bestOffensiveTalent)}</span>}
                      {showJudgeMetrics && <span className="pg-dtal">D-TAL {defensiveGrade(bestDefensiveTalent)}</span>}
                      {showJudgeMetrics && (
                        <span className="pg-opor">O-POR {offensivePortabilityGrade(bestOffensivePortability)}</span>
                      )}
                      {showJudgeMetrics && (
                        <span className="pg-dpor">D-POR {defensivePortabilityGrade(bestDefensivePortability)}</span>
                      )}
                      {showJudgeMetrics && <span className="pg-spc">SPC {bestSpacing}</span>}
                      {showJudgeMetrics && <span className="pg-dur">DUR {bestDurability}</span>}
                    </button>
                    {isOpen && (
                      <div className="table-scroll">
                        <table className="span-table">
                          <thead>
                            <tr>
                              <th>Span</th>
                              <th>Pos</th>
                              <th>FGA</th>
                              {showJudgeMetrics && <th>TAL</th>}
                              {showJudgeMetrics && <th>Tier</th>}
                              {showJudgeMetrics && <th>O-TAL</th>}
                              {showJudgeMetrics && <th>D-TAL</th>}
                              {showJudgeMetrics && <th>O-POR</th>}
                              {showJudgeMetrics && <th>D-POR</th>}
                              {showJudgeMetrics && <th>SPC</th>}
                              {showJudgeMetrics && <th>Shooter</th>}
                              {showJudgeMetrics && <th>Playoffs</th>}
                              {showJudgeMetrics && <th>DUR</th>}
                              <th>PTS</th>
                              <th>REB</th>
                              <th>AST</th>
                              <th>3PT%</th>
                              <th>Archetype</th>
                              <th>Defense</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.spans.map((span) => (
                              <tr key={span.id}>
                                <td>{span.spanLabel}</td>
                                <td>
                                  {span.primaryPosition}
                                  {span.secondaryPositions.length ? ` / ${span.secondaryPositions.join(',')}` : ''}
                                </td>
                                <td>{span.fga.toFixed(1)}</td>
                                {showJudgeMetrics && <td>{displayNumberForSpan(span, tierContextFor(span))}</td>}
                                {showJudgeMetrics && (
                                  <td>
                                    <OverallTierBadge span={span} />
                                  </td>
                                )}
                                {showJudgeMetrics && <td>{offensiveGrade(computeOffensiveTalent(span))}</td>}
                                {showJudgeMetrics && <td>{defensiveGrade(computeDefensiveTalent(span))}</td>}
                                {showJudgeMetrics && <td>{offensivePortabilityGrade(computeOffensivePortability(span))}</td>}
                                {showJudgeMetrics && <td>{defensivePortabilityGrade(computeDefensivePortability(span))}</td>}
                                {showJudgeMetrics && <td>{computeSpacing(span)}</td>}
                                {showJudgeMetrics && (
                                  <td>
                                    <SpacingTierBadge span={span} />
                                  </td>
                                )}
                                {showJudgeMetrics && (
                                  <td>
                                    <PlayoffPerformanceBadge span={span} />
                                  </td>
                                )}
                                {showJudgeMetrics && (
                                  <td>
                                    {computeDurability(span)} <DurabilityTierBadge span={span} />
                                  </td>
                                )}
                                <td>{span.box.ppg.toFixed(1)}</td>
                                <td>{span.box.rpg.toFixed(1)}</td>
                                <td>{span.box.apg.toFixed(1)}</td>
                                <td>{(span.box.threePct * 100).toFixed(1)}%</td>
                                <td>{span.offensiveArchetype}</td>
                                <td>{span.defensiveRole}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
