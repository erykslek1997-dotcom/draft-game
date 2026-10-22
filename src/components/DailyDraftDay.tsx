import { useMemo } from 'react';
import type { DailyDraftDay } from '../dailyDraftDay';
import { Btn, CapI, Links, Mast, dayLabel, fmtCaps } from '../night/frame';
import { peakDraftPool } from '../engine/peakDraftPool';
import { effectiveTalent } from '../engine/grades';
import { dailyRuleBlocks } from '../engine/dailyDraft';
import { ordinal } from './dailyDraftProgress';
import type { PlayerSpan } from '../data/schema';
import { BOMB_MIN_MINUTES } from '../engine/dailyBomb';

/** Players this good count as "top" when the screen says how many the rule takes away. */
const TOP_TAL = 80;

/**
 * 2026-10-16, the daily drafts (mockup `docs/mockups/daily-drafts.html`, screen 2): the day's
 * rules before the lottery, each saying who it binds — the cap every team, the rule only you, the
 * draft slot everyone today.
 */
export function DailyDraftDayScreen({
  day,
  slot,
  rosterSize,
  bomb,
  onStart,
  onBack,
  onHowTo,
  onSettings,
}: {
  day: DailyDraftDay;
  /** Your place in today's draft order. */
  slot: number;
  /** "for your five" / "for nine players". */
  rosterSize: number;
  /** The Bomb daily: his caps and round are known from the start, nothing else. */
  bomb?: PlayerSpan;
  onStart: () => void;
  onBack: () => void;
  onHowTo?: () => void;
  onSettings?: () => void;
}) {
  // How many top players the rule takes from you (the star cap takes none outright).
  const topOut = useMemo(() => {
    if (day.rule.kind !== 'team' && day.rule.kind !== 'era') return null;
    return peakDraftPool.filter((s) => effectiveTalent(s) >= TOP_TAL && dailyRuleBlocks(day.rule, s, [])).length;
  }, [day.rule]);
  return (
    <div className="nt">
      <div className="game solo">
        <main>
          <div className="dday">
            <Mast title={day.mode === 'bomb' ? 'Daily Bomb' : `Daily ${day.mode === 'mini' ? 'Mini' : 'All-Time'} Draft`} sub={`${dayLabel(day.day, true)} · one try, the same league for everyone`} />
            <h2>{day.title}</h2>
            <p className="lead">Every rule of today’s draft, before the lottery.</p>
            <div className="drule">
              <span className="ic cap">
                <CapI />
              </span>
              <div>
                <span className="who">Every team</span>
                <b>
                  {fmtCaps(day.cap)} caps for your {rosterSize === 5 ? 'five' : `${['', '', '', '', '', 'five', 'six', 'seven', 'eight', 'nine'][rosterSize] ?? rosterSize} players`}
                </b>
                <p>The CPU teams draft under the same cap.</p>
              </div>
            </div>
            {bomb && day.bomb && (
              <div className="drule only">
                <span className="ic">?</span>
                <div>
                  <span className="who">Only you</span>
                  <b>A hidden player joins you in round {day.bomb.round}</b>
                  <p>
                    His {fmtCaps(bomb.fga)} caps are set aside from your first pick. Who he is waits for the results; he plays at least {BOMB_MIN_MINUTES} minutes.
                  </p>
                </div>
              </div>
            )}
            {day.rule.kind !== 'open' && (
              <div className="drule only">
                <span className="ic">{day.rule.kind === 'stars' ? '1★' : '⊘'}</span>
                <div>
                  <span className="who">Only you</span>
                  <b>{day.ruleLine}</b>
                  <p>
                    The CPU can still take them.
                    {topOut !== null && topOut > 0 && ` ${topOut} of the top players are out for you.`}
                    {day.rule.kind === 'stars' && ' MVP, Greatest peak and GOAT count.'}
                  </p>
                </div>
              </div>
            )}
            <div className="drule">
              <span className="ic">#{slot}</span>
              <div>
                <span className="who">Everyone today</span>
                <b>You pick {ordinal(slot)}</b>
                <p>The same league and the same rivals for every player today. One try.</p>
              </div>
            </div>
            <Btn onClick={onStart}>Start today’s draft</Btn>
            <Links onMenu={onBack} onHowTo={onHowTo} onSettings={onSettings} />
          </div>
        </main>
      </div>
    </div>
  );
}
