import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Team } from '../engine/types';
import { teamCodes } from '../engine/teamNames';

export interface HowToPlayItem {
  title: string;
  body: ReactNode;
}

interface Props {
  teams: Team[];
  onDone: () => void;
  /** 2026-09-17, user's own ask: every mode needs a real "how to play?" affordance somewhere now
   * that the intro screen's own always-visible rules list is gone (see App.tsx's history). The
   * lottery reveal is the one screen every mode already shows before real play starts, so it's the
   * one natural shared spot — content is mode-specific (GameShell passes the full 9-round rules,
   * QuickFive its own 5-round/no-bench version), the toggle/panel itself is shared. Optional so a
   * caller that hasn't been given rules yet doesn't render a dead button. */
  howToPlay?: HowToPlayItem[];
}

const REVEAL_INTERVAL_MS = 320;
/** Extra pause once the human's own slot is revealed — a real lottery holds a beat on the
 * camera when the team that matters lands, not just cutting straight to the next card. */
const HUMAN_REVEAL_PAUSE_MS = 700;

/** Fisher-Yates — same algorithm `teamNames.ts`'s own `shuffled` uses, duplicated locally rather
 * than exported/shared since this is the only other place in the app that needs a plain array
 * shuffle and pulling it across module boundaries for one four-line function isn't worth it. */
function shuffledIndices(count: number): number[] {
  const out = Array.from({ length: count }, (_, i) => i);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 2026-08-16, user's own ask: a visible reveal moment for which draft slot the human landed on,
 * shown between the intro screen and the real draft board. The RANDOMIZATION itself already
 * existed (`createInitialTeams()` in draft.ts has always picked the human's slot randomly, and
 * every team's slot is fixed the moment `GameShell` creates its `DraftState`) — this component is
 * purely presentational: it takes the already-decided `teams` array and animates revealing it,
 * slot by slot, rather than the player just landing on the Overview grid already knowing.
 *
 * Reveal ORDER is a separate random shuffle from the slot ASSIGNMENT (`team.draftSlot`, already
 * fixed) — teams pop into their real slots in a random sequence rather than boringly filling
 * #1 → #16 in order, the same "which one lands next" suspense a real lottery draw has. The
 * human's own reveal gets an extra highlight + pause (`HUMAN_REVEAL_PAUSE_MS`) since that's the
 * one card everyone watching actually cares about.
 *
 * 2026-08-16, same-day follow-up: for a while also carried "Your team" (a name input) and the
 * "How to Play" rules as their own separate `stage === 'intro'` step, reached after "Start Draft"
 * but before this reveal — reasoning at the time was that neither made sense until Player Mode
 * was the actual choice, which the intro screen didn't know yet.
 * 2026-08-19, user's explicit ask ("merge how to play with home screen etc"): that whole step is
 * gone. Both moved back onto the intro screen itself (App.tsx), which now reacts live to the
 * selected mode instead of needing a separate step to find out — one screen instead of two. This
 * component goes straight to revealing again, for every mode, matching its own original
 * always-autoplay behavior before that split existed.
 */
export default function DraftLottery({ teams, onDone, howToPlay }: Props) {
  const teamCodeByTeamId = useMemo(() => teamCodes(teams), [teams]);
  const revealOrder = useMemo(() => shuffledIndices(teams.length), [teams]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const done = revealedCount >= teams.length;

  useEffect(() => {
    if (done) return;
    const justRevealed = teams[revealOrder[revealedCount]];
    const delay = justRevealed?.isHuman ? HUMAN_REVEAL_PAUSE_MS : REVEAL_INTERVAL_MS;
    const timer = setTimeout(() => setRevealedCount((c) => c + 1), delay);
    return () => clearTimeout(timer);
  }, [revealedCount, done, revealOrder, teams]);

  const revealedTeamIds = new Set(revealOrder.slice(0, revealedCount).map((i) => teams[i].id));
  const bySlot = [...teams].sort((a, b) => a.draftSlot - b.draftSlot);

  return (
    <div className="at-shell at-lottery">
      <div className="at-board-brand at-cond">Draft Lottery</div>

      {howToPlay && howToPlay.length > 0 && (
        <div className="at-lottery-howtoplay">
          <button
            type="button"
            className="secondary-btn how-to-play-btn at-cond"
            onClick={() => setShowHowToPlay((v) => !v)}
          >
            {showHowToPlay ? 'Hide how to play' : 'How to play?'}
          </button>
          {showHowToPlay && (
            <ol className="how-to-play-panel">
              {howToPlay.map((item) => (
                <li key={item.title}>
                  <b>{item.title}.</b> {item.body}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <p className="at-lottery-sub">
        {done ? "Draft order set — here's the field." : 'Revealing this draft’s order…'}
      </p>
      <div className="at-lottery-grid">
        {bySlot.map((team) => {
          const revealed = revealedTeamIds.has(team.id);
          return (
            <div
              key={team.id}
              className={`at-lottery-slot ${revealed ? 'at-revealed' : ''} ${revealed && team.isHuman ? 'at-you' : ''}`}
            >
              <span className="at-lottery-num">#{team.draftSlot}</span>
              {revealed ? (
                <span className="at-lottery-team">
                  {/* 2026-09-11, internal UI audit finding #2 ("Self-Scout Report"): the reveal
                      used to show only the 2-4 letter chip, full team name hover/focus-only via
                      `data-tip` — including for the player's OWN team on the one screen built
                      entirely around the "which team did I land on?" moment. DraftBoard's Overview
                      grid got the equivalent "we have the room, just show the name" fix on
                      2026-08-19 (see its own `.at-team-name-full` docstring); this mirrors that
                      same chip-plus-name pattern here, hidden below 640px by the same shared
                      `.at-team-name-full` media-query rule so the narrow layout still falls back
                      to chip-only. */}
                  <span className="at-team-chip at-name-tip" tabIndex={0} data-tip={team.name}>
                    {teamCodeByTeamId.get(team.id)}
                  </span>
                  <span className="at-team-name-full at-lottery-name-full">{team.name}</span>
                  {team.isHuman && <span className="at-lottery-you-tag">YOU</span>}
                </span>
              ) : (
                <span className="at-lottery-unrevealed">?</span>
              )}
            </div>
          );
        })}
      </div>
      {done ? (
        <button className="primary-btn at-lottery-continue" onClick={onDone}>
          Play
        </button>
      ) : (
        <button className="secondary-btn at-lottery-skip" onClick={onDone}>
          Skip
        </button>
      )}
    </div>
  );
}
