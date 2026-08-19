import { useEffect, useMemo, useState } from 'react';
import type { Team } from '../engine/types';
import { teamCodes } from '../engine/teamNames';

interface Props {
  teams: Team[];
  onDone: () => void;
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
export default function DraftLottery({ teams, onDone }: Props) {
  const teamCodeByTeamId = useMemo(() => teamCodes(teams), [teams]);
  const revealOrder = useMemo(() => shuffledIndices(teams.length), [teams]);
  const [revealedCount, setRevealedCount] = useState(0);
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
                  <span className="at-team-chip at-name-tip" tabIndex={0} data-tip={team.name}>
                    {teamCodeByTeamId.get(team.id)}
                  </span>
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
