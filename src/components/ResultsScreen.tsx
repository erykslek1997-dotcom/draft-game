import { lazy, Suspense, useMemo, useState } from 'react';
import { rankTeams } from '../engine/scoring';
import { evaluateLeague } from '../engine/leagueSimulation';
import { STARTER_SLOTS } from '../engine/positions';
import { allAssignments, benchWithMinutes } from '../engine/rotation';
import { draftPool } from '../data/draftPool';
import { normalizePlayerName } from '../data/schema';
import type { DraftHistoryEntry, Rotation, Team } from '../engine/types';
import { teamLabel } from '../engine/teamNames';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { computeOffensivePortability, computeDefensivePortability } from '../engine/portability';
import { computeSpacing } from '../engine/spacing';
import { computeDurability } from '../engine/durability';
import { projectedNetRating } from '../engine/netRatingProjection';
import FeedbackToggle, { type FeedbackEntry } from './FeedbackToggle';
import RotationBuilder from './RotationBuilder';
import { naturalPosition } from '../engine/naturalPosition';

// Lazy, matching App.tsx's own lazy() call for this exact component (see GameShell.tsx's
// lazy-loading docstring) — a static import here would bundle DraftPoolBrowser (plus its own
// allStarLookup.ts/grades.ts imports) into every draft session's GameShell chunk, even for the
// far more common case of a user who finishes a draft and never opens the pool browser from here.
const DraftPoolBrowser = lazy(() => import('./DraftPoolBrowser'));

interface Props {
  teams: Team[];
  /** Full draft history across every team, so each team's card can show its own pick order —
   * the user's own ask: "show team draft history in [results] screen." The live "Show Draft
   * History" toggle during the draft only covers the in-progress view; this is the same data,
   * scoped per team, on the screen that actually sticks around after the draft ends. */
  history: DraftHistoryEntry[];
  mode: 'developer' | 'player';
  onRestart: () => void;
  /** Read-only here — reactions made live during the draft (see `DraftHistory`/`GameShell`).
   * Folded into the same export as this screen's own roster-row reactions so a single downloaded
   * file has everything. */
  pickReactions: Record<number, FeedbackEntry>;
  /** Commissioner Mode's per-pick causal-reasoning notes (see `DraftHistory`/`GameShell`) — empty
   * for a normal single-human-team draft. Folded into the same export as everything else here. */
  pickReasoning: Record<number, string>;
}

/** Keyed by roster player id — one reaction per rostered player, set directly on that player's
 * row (see `FeedbackToggle`'s own docstring for why this replaced the old
 * pick-a-player-from-a-dropdown + pick-a-direction-from-a-second-dropdown flow). */
type PlayerFeedback = Record<string, FeedbackEntry>;

interface TeamFeedback {
  /** 2026-08-09, user's explicit ask: replaces the old yes/no/unsure agreement dropdown with the
   * user's own 1-16 Power Ranking placement for this team — a direct, comparable number against
   * the algorithm's own `rank`, not just a binary "do you agree." Kept as a string (not number)
   * for the same "empty string means unset" reason every other optional text field on this type
   * uses — an actual `0`/`NaN` sentinel would be ambiguous with a real rank. */
  userRank: string;
  rankingNote: string;
  playerNotes: PlayerFeedback;
  rotationNote: string;
  otherNote: string;
}

const EMPTY_FEEDBACK: TeamFeedback = { userRank: '', rankingNote: '', playerNotes: {}, rotationNote: '', otherNote: '' };

function feedbackFor(record: Record<string, TeamFeedback>, teamId: string): TeamFeedback {
  return record[teamId] ?? EMPTY_FEEDBACK;
}

/**
 * 2026-08-03, user's own ask (in Polish): a way to leave per-team feedback ("what I like / don't
 * like") on the results screen, and export it as a file with enough context that a FUTURE
 * session can actually analyze it — not just the comment text on its own, since a bare "this
 * roster feels off" without the underlying ratings/rotation/picks is nothing to act on. Exports
 * every team's full roster (every judge metric per player), rotation minutes, the complete
 * ScoreBreakdown, and that team's draft-order history alongside the comment, matching how every
 * other real-data decision this project has made needed full context, not a partial one.
 *
 * Pure client-side (no backend) — the file downloads via a Blob + a synthetic anchor click, the
 * standard no-server-needed browser download pattern. The exported JSON is meant to be handed
 * back to Claude in a later session the same way every other CSV/xlsx export in this project's
 * history has been.
 *
 * 2026-08-04, follow-up (in Polish): "give me a template I can fill in, and let me browse every
 * player the same way as during the draft." A single freeform textarea made every export equally
 * vague — this project's own established lesson (see the memory file's "Durable lessons" section)
 * is that a *specific named player + direction + reasoning* is worth far more than a general "feels
 * off" comment, so the template is structured around exactly that shape instead of open prose.
 * `DraftPoolBrowser` already existed for full-pool browsing (built for the intro screen) and is
 * reused here as-is via a full-screen toggle, rather than duplicating its search/filter/expand logic.
 */
function remainingOnBoard(teams: Team[]) {
  const draftedNames = new Set(teams.flatMap((t) => t.roster.map((p) => normalizePlayerName(p.playerName))));
  const byPlayer = new Map<string, (typeof draftPool)[number]>();
  for (const span of draftPool) {
    if (draftedNames.has(normalizePlayerName(span.playerName))) continue;
    const cur = byPlayer.get(span.playerName);
    if (!cur || computeTalent(span) > computeTalent(cur)) byPlayer.set(span.playerName, span);
  }
  return [...byPlayer.values()]
    .map((span) => ({
      playerName: span.playerName,
      spanLabel: span.spanLabel,
      primaryPosition: span.primaryPosition,
      TAL: computeTalent(span),
    }))
    .sort((a, b) => b.TAL - a.TAL);
}

/** Shared shape for both the original (auto-assigned) and corrected rotation in the export below
 * — same fields either way, so an ML pipeline can diff them directly without special-casing. */
function buildRotationExport(team: Team) {
  const assignments = allAssignments(team);
  const bench = benchWithMinutes(team);
  return {
    rotation: STARTER_SLOTS.map((slot) => ({
      slot,
      entries: assignments
        .filter((a) => a.slot === slot)
        .sort((a, b) => b.minutes - a.minutes)
        .map((a) => ({ playerName: a.player.playerName, spanLabel: a.player.spanLabel, minutes: a.minutes })),
    })),
    bench: bench.map(({ player, minutes }) => ({ playerName: player.playerName, spanLabel: player.spanLabel, minutes })),
  };
}

function buildFeedbackExport(
  teams: Team[],
  history: DraftHistoryEntry[],
  feedback: Record<string, TeamFeedback>,
  pickReactions: Record<number, FeedbackEntry>,
  pickReasoning: Record<number, string>,
  /** 2026-08-08, user's explicit ask: manual rotation corrections (any team, not just the
   * human's, made from this screen — see `RotationBuilder`'s reuse below) exported ALONGSIDE the
   * original auto-assigned rotation, always both fields present (not just when a correction was
   * made) — the user's own words, "do eksportu obie wersje," so an ML pipeline training "how to
   * fix a rotation given a roster" always has a consistent (original, corrected) pair per team,
   * even a same-as-original one when nothing was touched, rather than a sometimes-null field. */
  correctedRotations: Record<string, Rotation>,
) {
  const ranked = rankTeams(teams);
  const leagueEval = evaluateLeague(teams);
  const leagueEvalByTeamId = new Map(leagueEval.map((e) => [e.teamId, e]));
  // Live in-draft reactions (see DraftHistory/GameShell) — only flagged picks carry a
  // complaint, same "no flag = no complaint, don't export a wall of confirmations" convention
  // as the per-roster playerNotes below.
  const draftPickFeedback = Object.entries(pickReactions)
    .filter(([, entry]) => entry.status === 'flagged')
    .map(([pickNumberStr, entry]) => {
      const pickNumber = Number(pickNumberStr);
      const h = history.find((historyEntry) => historyEntry.pickNumber === pickNumber);
      const p = h ? draftPool.find((pl) => pl.id === h.playerId) : undefined;
      const team = h ? teams.find((t) => t.id === h.teamId) : undefined;
      return {
        pickNumber,
        teamLabel: team ? teamLabel(team) : null,
        playerName: p?.playerName ?? null,
        spanLabel: p?.spanLabel ?? null,
        reason: entry.reason,
      };
    })
    .sort((a, b) => a.pickNumber - b.pickNumber);

  return {
    exportedAt: new Date().toISOString(),
    remainingOnBoard: remainingOnBoard(teams),
    draftPickFeedback,
    teams: ranked.map(({ team, breakdown, rank }) => {
      const original = buildRotationExport(team);
      const correction = correctedRotations[team.id];
      const corrected = correction ? buildRotationExport({ ...team, rotation: correction }) : original;
      const teamHistory = history
        .filter((h) => h.teamId === team.id)
        .sort((a, b) => a.pickNumber - b.pickNumber)
        .map((h) => {
          const p = draftPool.find((pl) => pl.id === h.playerId);
          return {
            pickNumber: h.pickNumber,
            playerId: h.playerId,
            playerName: p?.playerName ?? null,
            spanLabel: p?.spanLabel ?? null,
            fga: p?.fga ?? null,
            TAL: p ? computeTalent(p) : null,
            // Commissioner Mode's causal note for this exact pick, if one was written — null for
            // a normal single-human-team draft (pickReasoning is empty then).
            reasoning: pickReasoning[h.pickNumber] ?? null,
          };
        });
      const roster = team.roster.map((p) => ({
        playerName: p.playerName,
        spanLabel: p.spanLabel,
        primaryPosition: p.primaryPosition,
        secondaryPositions: p.secondaryPositions,
        fga: p.fga,
        TAL: computeTalent(p),
        OTAL: computeOffensiveTalent(p),
        DTAL: computeDefensiveTalent(p),
        OPOR: computeOffensivePortability(p),
        DPOR: computeDefensivePortability(p),
        SPC: computeSpacing(p),
        DUR: computeDurability(p),
      }));
      const fb = feedback[team.id] ?? EMPTY_FEEDBACK;
      return {
        rank,
        teamId: team.id,
        label: teamLabel(team),
        isHuman: team.isHuman,
        overall: breakdown.overall,
        breakdown,
        netRatingProjection: projectedNetRating(team),
        leagueEvaluation: leagueEvalByTeamId.get(team.id) ?? null,
        roster,
        rotation: original.rotation,
        bench: original.bench,
        // Always present (see this function's own docstring on `correctedRotations`) — identical
        // to `rotation`/`bench` above when this team's rotation was never manually touched.
        correctedRotation: corrected.rotation,
        correctedBench: corrected.bench,
        rotationWasCorrected: Boolean(correction),
        draftOrder: teamHistory,
        feedback: {
          // The algorithm's own placement is already `rank` above — exporting the user's number
          // right alongside it (both null-able the same way) is what actually makes this
          // comparable, rather than requiring a join against the top-level field later.
          userRank: fb.userRank === '' ? null : Number(fb.userRank),
          algorithmicRank: rank,
          rankingNote: fb.rankingNote,
          rotationNote: fb.rotationNote,
          otherNote: fb.otherNote,
          playerNotes: Object.entries(fb.playerNotes)
            .filter(([, entry]) => entry.status === 'flagged')
            .map(([playerId, entry]) => {
              const p = team.roster.find((r) => r.id === playerId);
              return {
                playerName: p?.playerName ?? null,
                spanLabel: p?.spanLabel ?? null,
                reason: entry.reason,
              };
            }),
        },
      };
    }),
  };
}

function downloadFeedback(
  teams: Team[],
  history: DraftHistoryEntry[],
  feedback: Record<string, TeamFeedback>,
  pickReactions: Record<number, FeedbackEntry>,
  pickReasoning: Record<number, string>,
  correctedRotations: Record<string, Rotation>,
) {
  const data = buildFeedbackExport(teams, history, feedback, pickReactions, pickReasoning, correctedRotations);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `draft-feedback-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ResultsScreen({ teams, history, mode, onRestart, pickReactions, pickReasoning }: Props) {
  const ranked = rankTeams(teams);
  // Monte Carlo bracket sim (20,000 runs) — memoized on `teams` identity so it doesn't re-run on
  // every unrelated re-render (e.g. typing a feedback note), matching `ranked` above in reading
  // off the original auto-assigned rotations, not per-card rotation corrections.
  const leagueEval = useMemo(() => evaluateLeague(teams), [teams]);
  const leagueEvalByTeamId = useMemo(() => new Map(leagueEval.map((e) => [e.teamId, e])), [leagueEval]);
  const teamById = (id: string) => teams.find((t) => t.id === id);
  const playerById = (id: string) => draftPool.find((p) => p.id === id);
  const [feedback, setFeedback] = useState<Record<string, TeamFeedback>>({});
  const [showBrowser, setShowBrowser] = useState(false);
  const leftOnBoard = remainingOnBoard(teams);
  // 2026-08-08, user's explicit ask: correct ANY team's rotation from this screen (not just the
  // human's own, pre-results one — see RotationBuilder's reuse below), kept separate from the
  // original auto-assigned `team.rotation` so the export can carry both (see
  // `buildFeedbackExport`'s own docstring on `correctedRotations`).
  const [correctedRotations, setCorrectedRotations] = useState<Record<string, Rotation>>({});
  const [editingRotationTeamId, setEditingRotationTeamId] = useState<string | null>(null);

  /** The rotation actually shown on this screen for a team — its correction if one was made,
   * otherwise the original auto-assigned one. Every display/render site below should read
   * through this, not `team.rotation` directly, so a saved correction is reflected everywhere
   * (minutes list, bench, scoring) immediately, not just in the export. */
  function displayTeam(team: Team): Team {
    const correction = correctedRotations[team.id];
    return correction ? { ...team, rotation: correction } : team;
  }

  function getFeedback(teamId: string): TeamFeedback {
    return feedbackFor(feedback, teamId);
  }

  // Every mutator reads its "current" value from `prev` inside the updater, never from the
  // outer `feedback` closure — two of these firing back-to-back before a re-render must not
  // silently drop one of them.
  function patchFeedback(teamId: string, patch: Partial<TeamFeedback>) {
    setFeedback((prev) => ({ ...prev, [teamId]: { ...feedbackFor(prev, teamId), ...patch } }));
  }

  // One reaction per rostered player, set directly on their row — see FeedbackToggle's docstring
  // for why this replaced the old add-a-row/pick-a-player/pick-a-direction flow.
  function setPlayerFeedback(teamId: string, playerId: string, entry: FeedbackEntry | undefined) {
    setFeedback((prev) => {
      const current = feedbackFor(prev, teamId);
      const notes = { ...current.playerNotes };
      if (entry) notes[playerId] = entry;
      else delete notes[playerId];
      return { ...prev, [teamId]: { ...current, playerNotes: notes } };
    });
  }

  if (showBrowser) {
    return (
      <Suspense fallback={<div className="loading-panel"><p>Loading player data…</p></div>}>
        <DraftPoolBrowser mode={mode} onBack={() => setShowBrowser(false)} />
      </Suspense>
    );
  }

  return (
    <div className="results-screen">
      <h2>Final Power Ranking</h2>
      <button className="secondary-btn" onClick={() => setShowBrowser(true)}>
        Przeglądaj wszystkich graczy
      </button>
      <div className="left-on-board">
        <strong>Zostali na boardzie (top wg TAL)</strong>
        <ul>
          {leftOnBoard.slice(0, 20).map((p) => (
            <li key={p.playerName}>
              {p.playerName} ({p.spanLabel}) — {p.primaryPosition}, TAL {p.TAL}
            </li>
          ))}
        </ul>
      </div>
      {ranked.map(({ team, breakdown, rank }) => {
        const shownTeam = displayTeam(team);
        const assignments = allAssignments(shownTeam);
        const bench = benchWithMinutes(shownTeam);
        const netRating = projectedNetRating(shownTeam);
        const leagueEvalRow = leagueEvalByTeamId.get(team.id);
        const teamHistory = history.filter((h) => h.teamId === team.id).sort((a, b) => a.pickNumber - b.pickNumber);
        const fb = getFeedback(team.id);
        const isEditingRotation = editingRotationTeamId === team.id;
        return (
          <div key={team.id} className={`team-result rank-${rank}`}>
            <h3>
              #{rank} — {teamLabel(team)} {team.isHuman ? '(You)' : ''} — {breakdown.overall}
            </h3>
            <div className="subscores">
              <span>Talent: {breakdown.talentScore}</span>
              <span>Offense: {breakdown.offenseScore}</span>
              <span>Defense: {breakdown.defenseScore}</span>
              <span>Spacing: {breakdown.spacingScore}</span>
              <span>Fit: {breakdown.fitScore}</span>
              <span>Rotation: {breakdown.rotationScore}</span>
              <span>FGA spent: {team.roster.reduce((sum, p) => sum + p.fga, 0).toFixed(1)}</span>
            </div>
            <div className="subscores net-rating-projection" title="Real-NBA-units estimate (points per 100 possessions), fitted against 865 real 1997-2026 team-seasons — a different, informational question from the 0-100 scores above, not a replacement for them.">
              <span>Projected NBA net rating: {netRating.net >= 0 ? '+' : ''}{netRating.net.toFixed(1)}</span>
              <span>(ORTG {netRating.offense.toFixed(1)} / DRTG {netRating.defense.toFixed(1)})</span>
            </div>
            {leagueEvalRow && (
              <div className="subscores net-rating-projection" title="Best-of-7 series odds against each of the other 15 rosters, and championship probability from a 20,000-run single-elimination bracket simulation seeded by Final Power Ranking.">
                <span>Championship odds: {(leagueEvalRow.championshipProbability * 100).toFixed(1)}%</span>
                <span>Avg series win prob: {(leagueEvalRow.avgSeriesWinProb * 100).toFixed(0)}%</span>
                <span>
                  Best matchup: vs {teamLabel(teamById(leagueEvalRow.bestMatchup.opponentId)!)} ({(leagueEvalRow.bestMatchup.seriesWinProb * 100).toFixed(0)}%)
                </span>
                <span>
                  Worst matchup: vs {teamLabel(teamById(leagueEvalRow.worstMatchup.opponentId)!)} ({(leagueEvalRow.worstMatchup.seriesWinProb * 100).toFixed(0)}%)
                </span>
              </div>
            )}
            {isEditingRotation ? (
              <RotationBuilder
                roster={team.roster}
                initialRotation={correctedRotations[team.id] ?? team.rotation}
                onConfirm={(rotation) => {
                  setCorrectedRotations((prev) => ({ ...prev, [team.id]: rotation }));
                  setEditingRotationTeamId(null);
                }}
                onCancel={() => setEditingRotationTeamId(null)}
              />
            ) : (
              <button className="secondary-btn" onClick={() => setEditingRotationTeamId(team.id)}>
                {correctedRotations[team.id] ? '✏️ Edit corrected rotation' : '✏️ Correct rotation'}
              </button>
            )}
            <div className="lineup">
              <div>
                <strong>Rotation</strong>
                <ul className="rotation-slot-groups">
                  {STARTER_SLOTS.map((slot) => {
                    const entries = assignments
                      .filter((a) => a.slot === slot)
                      .sort((a, b) => b.minutes - a.minutes);
                    return (
                      <li key={slot} className="rotation-slot-group">
                        <span className="rotation-slot-label">{slot}</span>
                        <ul className="rotation-slot-entries">
                          {entries.map((e) => (
                            <li key={e.player.id}>
                              <span>
                                {e.player.playerName} ({e.player.spanLabel}) [{naturalPosition(e.player.playerName)}] - {e.minutes} min —
                                FGA {e.player.fga.toFixed(1)}, TAL {computeTalent(e.player)}
                              </span>
                              <FeedbackToggle
                                entry={fb.playerNotes[e.player.id]}
                                onChange={(entry) => setPlayerFeedback(team.id, e.player.id, entry)}
                                placeholder="Co jest nie tak z tym graczem?"
                              />
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <strong>Bench</strong>
                <ul className="rotation-slot-entries">
                  {bench.map(({ player, minutes }) => (
                    <li key={player.id}>
                      <span>
                        {player.playerName} ({player.spanLabel}) [{naturalPosition(player.playerName)}] — {minutes} min — FGA{' '}
                        {player.fga.toFixed(1)}, TAL {computeTalent(player)}
                      </span>
                      <FeedbackToggle
                        entry={fb.playerNotes[player.id]}
                        onChange={(entry) => setPlayerFeedback(team.id, player.id, entry)}
                        placeholder="Co jest nie tak z tym graczem?"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="notes">
              <strong>Why:</strong>
              <ul>
                {breakdown.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
            <div className="draft-order">
              <strong>Draft Order</strong>
              <ol>
                {teamHistory.map((entry) => {
                  const p = playerById(entry.playerId);
                  return (
                    <li key={entry.pickNumber}>
                      <span className="history-pick">#{entry.pickNumber}</span>{' '}
                      {p ? `${p.playerName} (${p.spanLabel})` : entry.playerId}
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="team-feedback">
              <strong>Feedback</strong>

              <p className="player-notes-hint">
                Konkretni gracze: kliknij ✓/✗ przy graczu w Rotation/Bench powyżej.
              </p>

              <div className="feedback-field">
                <label>Uwagi do rotacji</label>
                <textarea
                  className="feedback-textarea"
                  rows={2}
                  placeholder="Np. kto powinien grać więcej/mniej minut..."
                  value={fb.rotationNote}
                  onChange={(e) => patchFeedback(team.id, { rotationNote: e.target.value })}
                />
              </div>

              <div className="feedback-field">
                <label>Inne uwagi</label>
                <textarea
                  className="feedback-textarea"
                  rows={2}
                  placeholder="Cokolwiek innego..."
                  value={fb.otherNote}
                  onChange={(e) => patchFeedback(team.id, { otherNote: e.target.value })}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div className="user-power-ranking">
        <h3>Twój własny ranking (1-16)</h3>
        <p className="player-notes-hint">Twoja ocena miejsca każdej drużyny — porównywana obok rankingu algorytmu.</p>
        {ranked.map(({ team, rank }) => {
          const fb = getFeedback(team.id);
          const disagrees = fb.userRank !== '' && Number(fb.userRank) !== rank;
          return (
            <div key={team.id} className="user-power-ranking-row">
              <span className="user-power-ranking-label">
                #{rank} — {teamLabel(team)} {team.isHuman ? '(You)' : ''}
              </span>
              <input
                type="number"
                min={1}
                max={16}
                className="user-rank-input"
                value={fb.userRank}
                onChange={(e) => {
                  const value = e.target.value;
                  // Same "clear the stale reason" logic the old yes/no dropdown had — a reason
                  // typed for a previous disagreement shouldn't survive into the export once the
                  // user's own number matches the algorithm's again (or is cleared).
                  const stillDisagrees = value !== '' && Number(value) !== rank;
                  patchFeedback(team.id, { userRank: value, rankingNote: stillDisagrees ? fb.rankingNote : '' });
                }}
              />
              {fb.userRank !== '' && (
                <span className="user-rank-hint">{disagrees ? `(algorytm: #${rank})` : '(zgadza się z algorytmem)'}</span>
              )}
              {disagrees && (
                <textarea
                  className="feedback-textarea"
                  rows={2}
                  placeholder="Dlaczego Twoja kolejność jest inna?"
                  value={fb.rankingNote}
                  onChange={(e) => patchFeedback(team.id, { rankingNote: e.target.value })}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="results-actions">
        <button className="primary-btn" onClick={onRestart}>
          Draft Again
        </button>
        <button
          className="secondary-btn"
          onClick={() => downloadFeedback(teams, history, feedback, pickReactions, pickReasoning, correctedRotations)}
        >
          Zapisz feedback do pliku
        </button>
      </div>
    </div>
  );
}
