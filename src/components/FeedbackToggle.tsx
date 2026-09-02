export type FeedbackStatus = 'ok' | 'flagged';

export interface FeedbackEntry {
  status: FeedbackStatus;
  reason: string;
}

interface Props {
  entry: FeedbackEntry | undefined;
  onChange: (entry: FeedbackEntry | undefined) => void;
  placeholder?: string;
}

/**
 * Shared tick/cross feedback control (2026-08-05, explicit user request), used both on live
 * draft picks (`DraftHistory`) and on the finished-roster screen (`ResultsScreen`) — replaces the
 * old free-standing "add a player note: pick a player from a dropdown, pick a too_high/too_low
 * direction from a second dropdown, then type a reason" flow. That flow was directly responsible
 * for at least two confirmed cases in the 2026-08-05 feedback batch (Michael Jordan, Chris Paul)
 * where the direction dropdown ended up flatly contradicting the typed reason — a structured
 * field that's easy to misclick, disconnected from the row it's about, and redundant with what
 * the reason text already says on its own.
 *
 * Green ✓ = "looks right, nothing to say" — a transient UI confirmation only, not exported;
 * absence of a red flag already means "no complaint" once exported, so there's nothing extra to
 * persist. Red ✗ = flags this exact row and reveals a reason box; nothing else to categorize —
 * *which* player/pick is being flagged is now implicit in which row the click happened on, so
 * there's no separate player-picker to get wrong either, and no `direction` to contradict the
 * reason with.
 */
export default function FeedbackToggle({ entry, onChange, placeholder }: Props) {
  const status = entry?.status;
  return (
    <span className="feedback-toggle">
      <button
        type="button"
        className={`feedback-toggle-btn feedback-toggle-ok ${status === 'ok' ? 'active' : ''}`}
        title="Looks right"
        onClick={() => onChange({ status: 'ok', reason: '' })}
      >
        ✓
      </button>
      <button
        type="button"
        className={`feedback-toggle-btn feedback-toggle-flag ${status === 'flagged' ? 'active' : ''}`}
        title="Report a problem"
        onClick={() => onChange({ status: 'flagged', reason: entry?.reason ?? '' })}
      >
        ✗
      </button>
      {status === 'flagged' && (
        <input
          type="text"
          className="feedback-toggle-reason"
          placeholder={placeholder ?? 'Dlaczego?'}
          value={entry?.reason ?? ''}
          onChange={(e) => onChange({ status: 'flagged', reason: e.target.value })}
          autoFocus
        />
      )}
    </span>
  );
}
