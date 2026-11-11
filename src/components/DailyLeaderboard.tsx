import { useEffect, useState } from 'react';
import type { DailyDraftMode } from '../dailyDraftDay';
import { setNickname, signInWithGoogle, signOut, useAccount } from '../online/account';
import { fetchDailyLeaderboard, submitDailyScore, type LeaderboardRow } from '../online/leaderboard';
import { onlineEnabled } from '../online/supabase';
import { dailyDraftResult } from './dailyDraftProgress';
import './DailyLeaderboard.css';

/**
 * 2026-11-11, the daily drafts' leaderboard (Supabase, Google sign-in). The day's first result is
 * already kept in this browser (dailyDraftProgress.ts); signed in, it is sent once and the table
 * shows everyone who played the same draft today. Signing in leaves the page and comes back to the
 * menu, so the result is sent the next time the table is shown, not only right after the draft.
 * Without the online build settings this renders nothing.
 */
export function DailyLeaderboard({ mode, day, testing }: { mode: DailyDraftMode; day: string; testing?: boolean }) {
  const { account, refresh } = useAccount();
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'saved' | 'error'>('idle');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!onlineEnabled || testing) return;
    let alive = true;
    void (async () => {
      const mine = dailyDraftResult(mode, day);
      if (account && mine) {
        setStatus('sending');
        const r = await submitDailyScore(account.id, mode, day, mine);
        if (alive) setStatus(r === 'error' ? 'error' : 'saved');
      }
      const board = await fetchDailyLeaderboard(mode, day);
      if (alive) {
        setRows(board);
        setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [account, mode, day, testing]);

  if (!onlineEnabled || testing) return null;
  const myIndex = account ? (rows ?? []).findIndex((r) => r.userId === account.id) : -1;

  return (
    <section className="dlb" aria-label="Today's leaderboard">
      <div className="dlb-head">
        <h3>Today’s leaderboard</h3>
        {account ? (
          <span className="dlb-me">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void setNickname(account.id, name).then((ok) => {
                    if (ok) {
                      setEditing(false);
                      refresh();
                    }
                  });
                }}
              >
                <input id="dlb-nick" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Your name on the leaderboard" />
                <button type="submit" className="dlb-link">Save</button>
              </form>
            ) : (
              <>
                {account.nickname}
                <button type="button" className="dlb-link" onClick={() => { setName(account.nickname); setEditing(true); }}>Rename</button>
                <button type="button" className="dlb-link" onClick={() => void signOut()}>Sign out</button>
              </>
            )}
          </span>
        ) : account === null ? (
          <button type="button" className="dlb-google" onClick={() => void signInWithGoogle()}>
            Sign in with Google to post your score
          </button>
        ) : null}
      </div>
      {status === 'error' && <p className="dlb-note">Couldn’t send your score. It’s saved here; it will go up next time.</p>}
      {rows === null ? (
        <p className="dlb-note">{loaded ? 'The leaderboard is offline right now. Your result is saved here.' : 'Loading…'}</p>
      ) : rows.length === 0 ? (
        <p className="dlb-note">Nobody has posted today yet. Be the first.</p>
      ) : (
        <ol className="dlb-rows">
          {rows.slice(0, 10).map((r, i) => (
            <li key={r.userId} className={i === myIndex ? 'is-me' : undefined}>
              <span className="dlb-rank">{i + 1}</span>
              <span className="dlb-name">{r.nickname}</span>
              <span className="dlb-score">{r.overall.toFixed(1)}</span>
            </li>
          ))}
          {myIndex >= 10 && rows[myIndex] && (
            <li className="is-me">
              <span className="dlb-rank">{myIndex + 1}</span>
              <span className="dlb-name">{rows[myIndex].nickname}</span>
              <span className="dlb-score">{rows[myIndex].overall.toFixed(1)}</span>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
