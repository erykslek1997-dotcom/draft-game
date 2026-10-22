import { useState, type ReactNode } from 'react';
import { BRAND, BRAND_TAGLINE } from '../brand';
import { franchiseByName } from '../data/franchises';
import { LeagueMark, franchiseCode } from './league';
import { DAILY_REPLAY_FOR_TESTING, currentStreak, dailyEntry, dailySeed, localDayKey, yesterdayJokers } from '../components/dailyProgress';
import { dailyMeta } from '../engine/dailyMeta';
import { dailyDayLabel, dailyDraftDay, type DailyDraftDay, type DailyDraftMode } from '../dailyDraftDay';
import { dailyDraftResult, dailyDraftStreak, ordinal } from '../components/dailyDraftProgress';
import { readDraftSaveSummary, type DraftSaveSummary } from '../draftSaveSummary';
import { Btn, Dialog } from './frame';
import { NightSettings } from './Dialogs';

export type MenuMode = 'bestfive' | 'quickfive' | 'draft';

const MODES: { id: MenuMode; name: string; line: string; time: string }[] = [
  { id: 'bestfive', name: 'Draw Five', line: 'Five cards, one cap, beat the AI.', time: '5 min' },
  { id: 'quickfive', name: 'Mini Draft', line: 'A real 16-team draft, five rounds.', time: '8 min' },
  { id: 'draft', name: 'All-Time Draft', line: 'Nine rounds, then a season and the playoffs.', time: '30 min' },
];

/**
 * The menu (night edition, mockup `alltime.html#menu2`): the masthead, your team, a draft to
 * continue, the three modes as a numbered list, today's dailies and the quiet links. Light on
 * purpose: no engine import, so it shows at once while the player data downloads.
 */
export function NightMenu({
  teamName,
  onTeamReroll,
  savedDraft,
  sharedSeed,
  onContinue,
  onMode,
  onDailyDrawFive,
  onDailyDraft,
  dailyOffset,
  onReroll,
  howTo,
  dataStatus,
  stepDone,
  confirm,
  onLiveTest,
}: {
  teamName: string;
  onTeamReroll: () => void;
  savedDraft: DraftSaveSummary | null;
  sharedSeed: number | null;
  onContinue: () => void;
  onMode: (mode: MenuMode) => void;
  onDailyDrawFive: () => void;
  onDailyDraft: (day: DailyDraftDay) => void;
  /** Testing: days from today each daily draft is rerolled to. */
  dailyOffset: Record<DailyDraftMode, number>;
  onReroll: (mode: DailyDraftMode, offset: number) => void;
  howTo: Record<MenuMode, { title: string; body: string }[]>;
  dataStatus?: ReactNode;
  stepDone: (mode: MenuMode) => boolean;
  /** A dialog the host shows over the menu (Start a new draft?). */
  confirm?: ReactNode;
  /** Testing: the live game bench. */
  onLiveTest?: () => void;
}) {
  const [dialog, setDialog] = useState<'settings' | 'howto' | null>(null);
  const [howToMode, setHowToMode] = useState<MenuMode>('bestfive');
  const today = localDayKey();
  const franchise = franchiseByName(teamName);
  const drawFive = dailyEntry(today);
  const meta = dailyMeta(dailySeed(today));
  const yesterday = yesterdayJokers(today);
  const draftDay = (mode: DailyDraftMode): DailyDraftDay => {
    const offset = dailyOffset[mode];
    const key = offset ? localDayKey(new Date(Date.now() + offset * 864e5)) : today;
    return { ...dailyDraftDay(mode, key), ...(offset ? { testing: true } : {}) };
  };
  const streak = Math.max(currentStreak(today).current, dailyDraftStreak('mini', today), dailyDraftStreak('alltime', today), dailyDraftStreak('bomb', today));
  const draftCell = (mode: DailyDraftMode, label: string) => {
    const day = draftDay(mode);
    const played = day.testing ? null : dailyDraftResult(mode, today);
    const saved = mode !== 'mini' && !played && !day.testing ? readDraftSaveSummary(mode === 'bomb' ? 'bomb' : 'daily') : null;
    const inProgress = saved?.day === today ? saved : null;
    const open = !played || DAILY_REPLAY_FOR_TESTING;
    return (
      <button key={mode} type="button" className={`m2-d${played ? ' done' : ''}`} onClick={() => open && onDailyDraft(day)} disabled={!open}>
        <b>{label}</b>
        <span>
          {played
            ? `✓ ${ordinal(played.place)} of ${played.field}`
            : inProgress
              ? `continue · ${inProgress.humanPicks}/${inProgress.rosterSize}`
              : day.testing
                ? `testing: ${dailyDayLabel(day.day)}`
                : mode === 'bomb' && day.bomb
                  ? `round ${day.bomb.round}`
                  : day.title}
        </span>
      </button>
    );
  };
  return (
    <div className="nt">
      <div className="game solo">
        <main>
          <div className="m2">
            <div className="m2-mast">
              <b>{BRAND}</b>
              <span>{BRAND_TAGLINE}</span>
            </div>
            <div className="m2-team">
              {franchise && <LeagueMark name={teamName} code={franchiseCode(teamName)} />}
              <span>{franchise ? `${franchise.city} ${franchise.name}` : teamName}</span>
              <button type="button" className="lk-inline" onClick={onTeamReroll}>
                change
              </button>
            </div>
            {sharedSeed !== null && (
              <div className="m2-resume">
                <span>Duel loaded: the All-Time Draft opens on a friend’s board</span>
                <button type="button" onClick={() => onMode('draft')}>
                  Play it →
                </button>
              </div>
            )}
            {savedDraft && (
              <div className="m2-resume">
                <span>
                  <small>Draft in progress</small>
                  <b>
                    {savedDraft.teamName} · {savedDraft.humanPicks} of {savedDraft.rosterSize} picks
                  </b>
                </span>
                <button type="button" onClick={onContinue}>
                  Continue →
                </button>
              </div>
            )}
            <ol className="m2-modes">
              {MODES.map((m, i) => (
                <li key={m.id}>
                  <button type="button" className="m2-row" onClick={() => onMode(m.id)}>
                    <span className="m2-n">{i + 1}</span>
                    <div>
                      <b>{m.name}</b>
                      <span>
                        {m.line}
                        {stepDone(m.id) && ' ✓'}
                      </span>
                    </div>
                    <em>{m.time}</em>
                    <span className="m2-go">Play →</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="m2-today">
              <span className="m2-tl">Today’s dailies{streak > 0 ? ` · 🔥 ${streak}` : ''}</span>
              <button type="button" className={`m2-d${drawFive && !DAILY_REPLAY_FOR_TESTING ? ' done' : ''}`} onClick={onDailyDrawFive}>
                <b>Draw Five</b>
                <span>{drawFive?.game ? `✓ ${drawFive.game.you > drawFive.game.them ? 'beat' : 'lost to'} the ${drawFive.game.opponent}` : drawFive ? '✓ played' : `vs ${meta.opponent.short}`}</span>
              </button>
              {draftCell('mini', 'Mini')}
              {draftCell('alltime', 'All-Time')}
              {draftCell('bomb', 'The Bomb')}
            </div>
            {yesterday.length > 0 && (
              <p className="m2-note">
                Yesterday’s {yesterday.length > 1 ? 'Jokers' : 'Joker'}:{' '}
                {yesterday.map((j, i) => (
                  <span key={j.slot}>
                    {i > 0 && ' · '}
                    <b>{j.name}</b>, {j.legend ? 'a legend' : 'a scrub'}
                  </span>
                ))}
              </p>
            )}
            {DAILY_REPLAY_FOR_TESTING && (
              <p className="m2-note">
                Testing · reroll the day:{' '}
                {(['mini', 'alltime', 'bomb'] as const).map((m, i) => (
                  <span key={m}>
                    {i > 0 && ' · '}
                    <button type="button" className="lk-inline" onClick={() => onReroll(m, 1 + Math.floor(Math.random() * 365))}>
                      {m === 'mini' ? 'Mini' : m === 'alltime' ? 'All-Time' : 'Bomb'}
                    </button>
                    {dailyOffset[m] !== 0 && (
                      <>
                        {' '}
                        (
                        <button type="button" className="lk-inline" onClick={() => onReroll(m, 0)}>
                          today
                        </button>
                        )
                      </>
                    )}
                  </span>
                ))}
              </p>
            )}
            {dataStatus}
            <div className="m2-foot">
              <button type="button" onClick={() => setDialog('howto')}>
                How to play
              </button>
              <button type="button" onClick={() => setDialog('settings')}>
                Settings
              </button>
              {onLiveTest && (
                <button type="button" onClick={onLiveTest}>
                  Live game bench (testing)
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
      {dialog === 'settings' && <NightSettings onClose={() => setDialog(null)} />}
      {dialog === 'howto' && (
        <Dialog title="How to play" onClose={() => setDialog(null)}>
          <div className="sw2 howto-tabs">
            {MODES.map((m) => (
              <button key={m.id} type="button" className={howToMode === m.id ? 'on' : undefined} onClick={() => setHowToMode(m.id)}>
                {m.name}
              </button>
            ))}
          </div>
          <ol className="rules">
            {howTo[howToMode].map((r, i) => (
              <li key={r.title}>
                <span>{i + 1}</span>
                <div>
                  <b>{r.title}</b>
                  <p>{r.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <Btn onClick={() => setDialog(null)}>Got it</Btn>
        </Dialog>
      )}
      {confirm}
    </div>
  );
}
