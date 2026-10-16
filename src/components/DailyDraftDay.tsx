import { useMemo } from 'react';
import { dailyDayLabel, type DailyDraftDay } from '../dailyDraftDay';
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
}) {
  // How many top players the rule takes from you (the star cap takes none outright).
  const topOut = useMemo(() => {
    if (day.rule.kind !== 'team' && day.rule.kind !== 'era') return null;
    return peakDraftPool.filter((s) => effectiveTalent(s) >= TOP_TAL && dailyRuleBlocks(day.rule, s, [])).length;
  }, [day.rule]);
  const capText = Number.isInteger(day.cap) ? String(day.cap) : day.cap.toFixed(1);
  return (
    <div className="dd-day at-stage-in">
      <div className="at-calm-header">
        <button type="button" className="at-calm-btn at-calm-btn--ghost" onClick={onBack}>
          ← Menu
        </button>
        <h1 className="at-calm-title">{day.mode === 'bomb' ? 'Daily Bomb' : `Daily ${day.mode === 'mini' ? 'Mini' : 'All-Time'} Draft`}</h1>
        <span className="rs-header-spacer" aria-hidden />
      </div>
      <p className="dd-date">{dailyDayLabel(day.day)}</p>
      <h2 className="dd-title">{day.title}</h2>
      <div className="dd-rules">
        <div className="dd-rule">
          <span className="dd-ic dd-ic--cap">{capText}</span>
          <span className="dd-who">Every team</span>
          <span className="dd-what">
            {capText} caps for your {rosterSize === 5 ? 'five' : `${rosterSize} players`}
          </span>
          <span className="dd-why">The CPU teams draft under the same cap.</span>
        </div>
        {bomb && day.bomb && (
          <div className="dd-rule is-today is-bomb">
            <span className="dd-ic">💣</span>
            <span className="dd-who">Only you</span>
            <span className="dd-what">A hidden player joins you in round {day.bomb.round}</span>
            <span className="dd-why">
              His {bomb.fga.toFixed(1)} caps are set aside from your first pick. Who he is waits for the results; he plays at least{' '}
              {BOMB_MIN_MINUTES} minutes.
            </span>
          </div>
        )}
        {day.rule.kind !== 'open' && (
          <div className="dd-rule is-today">
            <span className="dd-ic">{day.rule.kind === 'stars' ? '1★' : '⊘'}</span>
            <span className="dd-who">Only you</span>
            <span className="dd-what">{day.ruleLine}</span>
            <span className="dd-why">
              The CPU can still take them.
              {topOut !== null && topOut > 0 && ` ${topOut} of the top players are out for you.`}
              {day.rule.kind === 'stars' && ' MVP, Greatest peak and GOAT count.'}
            </span>
          </div>
        )}
        <div className="dd-rule">
          <span className="dd-ic">#{slot}</span>
          <span className="dd-who">Everyone today</span>
          <span className="dd-what">You pick {ordinal(slot)}</span>
          <span className="dd-why">The same league and the same rivals for every player today. One try.</span>
        </div>
      </div>
      <button type="button" className="rs-primary dd-start" onClick={onStart}>
        Start today's draft
      </button>
    </div>
  );
}
