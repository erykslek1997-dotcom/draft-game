import { useEffect, useState } from 'react';
import { setNickname, signInWithGoogle, signOut, useAccount } from '../online/account';
import { onlineEnabled } from '../online/supabase';
import { pullDailyHistory } from '../online/sync';
import './DailyLeaderboard.css';

/**
 * 2026-11-11, the account on the menu: sign in with Google, your name on the leaderboards, and your
 * dailies' history and streak brought back from the server (`onSynced` lets the menu re-read them).
 * Renders nothing in an offline build.
 */
export function AccountBar({ onSynced }: { onSynced?: () => void }) {
  const { account, refresh } = useAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    if (!account) return;
    let alive = true;
    void pullDailyHistory(account.id).then((n) => alive && n > 0 && onSynced?.());
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);
  if (!onlineEnabled || account === undefined) return null;
  if (!account) {
    return (
      <div className="acct">
        <button type="button" className="dlb-google" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </button>
        <span className="dlb-note">Leaderboards, and your streak on every device.</span>
      </div>
    );
  }
  return (
    <div className="acct">
      {editing ? (
        <form
          className="dlb-me"
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
          <input id="acct-nick" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Your name on the leaderboards" />
          <button type="submit" className="dlb-link">Save</button>
        </form>
      ) : (
        <span className="dlb-me">
          Signed in as <b>{account.nickname}</b>
          <button type="button" className="dlb-link" onClick={() => { setName(account.nickname); setEditing(true); }}>Rename</button>
          <button type="button" className="dlb-link" onClick={() => void signOut()}>Sign out</button>
        </span>
      )}
    </div>
  );
}
