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
  /** 2026-08-07, Commissioner Mode's causal-reasoning capture — an always-visible free-text box
   * per pick (not gated behind a red-flag click like `FeedbackToggle`, since every pick gets a
   * "why," not just the ones something's wrong with). Only rendered when `commissionerMode` is
   * true, so the normal single-human-team draft UI stays exactly as it was. */
  commissionerMode: boolean;
  reasoning: Record<number, string>;
  onReasoningChange: (pickNumber: number, reasoning: string) => void;
}

export default function DraftHistory({ history, teams, reactions, onReactionChange, commissionerMode, reasoning, onReasoningChange }: Props) {
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
                {commissionerMode ? (
                  <input
                    type="text"
                    className="commissioner-reasoning-input"
                    placeholder="Dlaczego ten pick? (opcjonalne)"
                    value={reasoning[entry.pickNumber] ?? ''}
                    onChange={(e) => onReasoningChange(entry.pickNumber, e.target.value)}
                  />
                ) : (
                  <FeedbackToggle
                    entry={reactions[entry.pickNumber]}
                    onChange={(e) => onReactionChange(entry.pickNumber, e)}
                    placeholder="Co jest nie tak z tym pickiem?"
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
