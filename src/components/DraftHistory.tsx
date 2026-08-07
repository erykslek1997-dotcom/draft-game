import { draftPool as players } from '../data/draftPool';
import type { DraftHistoryEntry, Team } from '../engine/types';
import { teamLabel } from '../engine/teamNames';
import FeedbackToggle, { type FeedbackEntry } from './FeedbackToggle';

interface Props {
  history: DraftHistoryEntry[];
  teams: Team[];
  /** Per-pick reactions (keyed by pick number, stable across the whole draft) — lifted up to
   * `GameShell` so they survive the phase transition into `ResultsScreen`'s export, matching the
   * user's explicit ask to react to picks live during the draft, not only after it ends. */
  reactions: Record<number, FeedbackEntry>;
  onReactionChange: (pickNumber: number, entry: FeedbackEntry | undefined) => void;
}

export default function DraftHistory({ history, teams, reactions, onReactionChange }: Props) {
  const teamName = (id: string) => {
    const team = teams.find((t) => t.id === id);
    return team ? teamLabel(team) : id;
  };
  const player = (id: string) => players.find((p) => p.id === id);

  return (
    <div className="draft-history">
      <h4>Draft History</h4>
      {history.length === 0 ? (
        <p className="history-empty">No picks yet.</p>
      ) : (
        <ol className="history-list">
          {[...history].reverse().map((entry) => {
            const p = player(entry.playerId);
            return (
              <li key={entry.pickNumber}>
                <span className="history-pick">#{entry.pickNumber}</span>
                <span className="history-team">{teamName(entry.teamId)}</span>
                <span className="history-player">{p ? `${p.playerName} (${p.spanLabel})` : entry.playerId}</span>
                <FeedbackToggle
                  entry={reactions[entry.pickNumber]}
                  onChange={(e) => onReactionChange(entry.pickNumber, e)}
                  placeholder="Co jest nie tak z tym pickiem?"
                />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
