import type { ReactNode } from 'react';
import { qualityColor } from './ResultsScreen';
import { challengeVerdict } from '../modeChallenge';

export interface ScoreBoardCell {
  label: string;
  value: ReactNode;
  /** The player's own number: tinted with the shared score scale and drawn largest. */
  you?: number;
  title?: string;
}

/**
 * 2026-09-27 results audit, pack C ("jedna tablica wyniku"): the same three-number scoreboard on
 * every result screen — Roulette (your five / fan-vote five / best on the board), Mini Draft (your
 * team / best in the field / behind) and the All-Time Draft (your team / best in the field / title
 * odds). The player's own cell comes first, in the same colour scale as every other score.
 */
export function ScoreBoard({ cells, note }: { cells: ScoreBoardCell[]; note?: ReactNode }) {
  return (
    <div className="score-board-wrap">
      <div className="score-board">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className={`score-board-cell ${cell.you !== undefined ? 'score-board-cell--you' : ''}`}
            style={cell.you !== undefined ? { background: qualityColor(cell.you) } : undefined}
            title={cell.title}
          >
            <b>{cell.value}</b>
            <span className="at-cond">{cell.label}</span>
          </div>
        ))}
      </div>
      {note && <span className="score-board-note">{note}</span>}
    </div>
  );
}

/** Under a challenged result's scoreboard: the friend's score on the same board and who won. */
export function ChallengeNote({ yours, theirs, who }: { yours: number; theirs: number; who?: string | null }) {
  const verdict = challengeVerdict(yours, theirs);
  return (
    <span className={`challenge-note challenge-note--${verdict}`}>
      ⚔️ {who ? <b>{who}</b> : 'Your friend'} scored <b>{theirs}</b> on this board —{' '}
      {verdict === 'won' ? 'you won the challenge.' : verdict === 'lost' ? 'they won this one.' : 'a tie.'}
    </span>
  );
}
