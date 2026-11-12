import { useEffect, useState } from 'react';
import { setNickname, signInWithGoogle, signOut, useAccount, type NicknameResult } from '../online/account';
import { Dialog } from '../night/frame';
import { onlineEnabled } from '../online/supabase';
import { pullDailyHistory } from '../online/sync';
import './DailyLeaderboard.css';

/**
 * 2026-11-11, the account on the menu: sign in with Google, your name on the leaderboards, and your
 * dailies' history and streak brought back from the server (`onSynced` lets the menu re-read them).
 * Renders nothing in an offline build.
 */
export function AccountBar({ onSynced, menu }: { onSynced?: () => void; /** The newspaper menu's own look (night/alltime.css). */ menu?: boolean }) {
  const { account, refresh } = useAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<NicknameResult | null>(null);
  const save = (onOk: () => void) => {
    if (!account) return;
    void setNickname(account.id, name).then((r) => {
      setError(r === 'ok' ? null : r);
      if (r === 'ok') {
        onOk();
        refresh();
      }
    });
  };
  const errorText = error === 'short' ? 'At least 2 characters.' : error === 'taken' ? 'That name is taken. Try another.' : error === 'error' ? 'Couldn’t save. Try again.' : null;
  useEffect(() => {
    if (!account) return;
    if (account.needsName) setName(account.nickname);
    let alive = true;
    void pullDailyHistory(account.id).then((n) => alive && n > 0 && onSynced?.());
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);
  if (!onlineEnabled || account === undefined) return null;
  if (menu && account?.needsName) {
    return (
      <Dialog title="Pick your name" small className="m2-pick">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(() => {});
          }}
        >
          <p>This is how you show up on the leaderboards. You can change it later.</p>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Your name on the leaderboards" autoFocus />
          {errorText && <span className="m2-acct-err">{errorText}</span>}
          <button type="submit" className="m2-acct-go">Save →</button>
        </form>
      </Dialog>
    );
  }
  if (menu) {
    return (
      <section className="m2-acct" aria-label="Your account">
        <span className="m2-tl">Your account</span>
        <div className="m2-acct-box">
          <div className="m2-acct-who">
            {editing && account ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save(() => setEditing(false));
                }}
              >
                <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Your name on the leaderboards" autoFocus />
                <button type="submit" className="lk-inline">Save</button>
                <button type="button" className="lk-inline" onClick={() => setEditing(false)}>Cancel</button>
              </form>
            ) : (
              <b>{account ? account.nickname : 'Not signed in'}</b>
            )}
            {editing && errorText && <span className="m2-acct-err">{errorText}</span>}
            <span>{account ? 'Your dailies and streak are saved to your account.' : 'Post your dailies to the leaderboard and keep your streak on any device.'}</span>
          </div>
          {account ? (
            !editing && (
              <span className="m2-acct-act">
                <button type="button" className="lk-inline" onClick={() => { setName(account.nickname); setEditing(true); }}>Rename</button>
                <button type="button" className="lk-inline" onClick={() => void signOut()}>Sign out</button>
              </span>
            )
          ) : (
            <button type="button" className="m2-acct-go" onClick={() => void signInWithGoogle()}>Sign in →</button>
          )}
        </div>
      </section>
    );
  }
  if (!account) {
    return (
      <div className="acct">
        <button type="button" className="dlb-google" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </button>
        <span className="dlb-note">to post scores and keep your streak on any device</span>
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
            save(() => setEditing(false));
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
