import { useEffect, useState } from 'react';
import { setNickname, suggestNicknames, signInWithGoogle, signOut, useAccount, type NicknameResult } from '../online/account';
import { Dialog } from '../night/frame';
import { onlineEnabled } from '../online/supabase';
import { pullDailyHistory } from '../online/sync';
import { careerStats, clearCareer, levelOf, setCareerUser, syncCareer } from '../online/career';
import { clearAllDailyDrafts, dailyDraftTotals } from './dailyDraftProgress';

/**
 * 2026-11-12, whose progress this browser holds (the user, signed out: "jestem wylogowany ale no xd").
 * A guest's games stay here and join the account at the first sign-in; once they belong to an account
 * they leave with it: signing out (or another account signing in) clears them here, the server keeps them.
 */
const OWNER_KEY = 'draftverse.owner.v1';
function claimProgress(id: string | null): boolean {
  try {
    const owner = localStorage.getItem(OWNER_KEY);
    if (owner && owner !== id) {
      clearCareer();
      clearAllDailyDrafts();
    }
    if (id) localStorage.setItem(OWNER_KEY, id);
    else localStorage.removeItem(OWNER_KEY);
    return Boolean(owner && owner !== id);
  } catch {
    return false;
  }
}
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
  // 2026-11-12: a taken name comes with three free ones to tap.
  const [ideas, setIdeas] = useState<string[]>([]);
  const save = (onOk: () => void) => {
    if (!account) return;
    void setNickname(account.id, name).then((r) => {
      setError(r === 'ok' ? null : r);
      setIdeas([]);
      if (r === 'taken') void suggestNicknames(name).then(setIdeas);
      if (r === 'ok') {
        onOk();
        refresh();
      }
    });
  };
  const errorText = error === 'short' ? 'At least 2 characters.' : error === 'taken' ? 'That name is taken. Try another.' : error === 'error' ? 'Couldn’t save. Try again.' : null;
  useEffect(() => {
    if (account === null && claimProgress(null)) onSynced?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account === null]);
  useEffect(() => {
    if (!account) return;
    if (!account.needsName) claimProgress(account.id);
    if (account.needsName) setName(account.nickname);
    let alive = true;
    setCareerUser(account.needsName ? null : account.id);
    void Promise.all([pullDailyHistory(account.id), account.needsName ? false : syncCareer(account.id)]).then(([n, more]) => alive && (n > 0 || more) && onSynced?.());
    return () => {
      alive = false;
      setCareerUser(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, account?.needsName]);
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
          {error === 'taken' && ideas.length > 0 && (
            <span className="m2-acct-ideas">
              {ideas.map((n) => (
                <button key={n} type="button" onClick={() => setName(n)}>
                  {n}
                </button>
              ))}
            </span>
          )}
          <span className="m2-pick-row">
            <button type="submit" className="m2-acct-go">Save →</button>
            <button type="button" className="lk-inline" onClick={() => void signOut()}>Sign out</button>
          </span>
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
            {editing && error === 'taken' && ideas.length > 0 && (
              <span className="m2-acct-ideas">
                {ideas.map((n) => (
                  <button key={n} type="button" onClick={() => setName(n)}>
                    {n}
                  </button>
                ))}
              </span>
            )}
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
        <CareerPanel />
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

/** 2026-11-12, the career on the account panel: level, drafts per mode, wins, titles, records. */
function CareerPanel() {
  const stats = careerStats();
  const daily = dailyDraftTotals();
  const lv = levelOf(stats.xp);
  const best = Math.max(0, ...Object.values(stats.bestOverall).map((v) => v ?? 0));
  const cells: [string, string][] = [
    ['Draw Five', String(stats.played.drawfive)],
    ['Mini', String(stats.played.mini)],
    ['All-Time', String(stats.played.alltime)],
    ['The Bomb', String(stats.played.bomb)],
    ['Draw Five wins', String(stats.drawFiveWins)],
    ['Drafts won', String(stats.wins)],
    ['Titles', String(stats.titles)],
    ['Best Overall', best ? best.toFixed(1) : '—'],
    ['Daily days', String(daily.days)],
    ['Best streak', String(daily.bestStreak)],
    ['Best week', stats.bestWeekPoints ? `+${stats.bestWeekPoints.toFixed(1)}` : '—'],
    ['Drafts', String(stats.total)],
  ];
  return (
    <div className="m2-career">
      <div className="m2-lv">
        <b>Level {lv.level}</b>
        <span className="m2-lv-bar" aria-hidden><i style={{ width: `${Math.round((100 * lv.into) / lv.next)}%` }} /></span>
        <span>{lv.into} / {lv.next} XP</span>
      </div>
      <dl className="m2-stats">
        {cells.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="m2-career-note">Free drafts count on the week’s table too: top half adds points, bottom half takes them away.</p>
    </div>
  );
}
