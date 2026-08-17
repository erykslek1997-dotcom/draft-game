import { useEffect, useMemo, useState } from 'react';
import type { Team } from '../engine/types';
import { teamCodes, randomTeamNames } from '../engine/teamNames';
// Real import, not App.tsx's own hand-kept `DISPLAY_CAP_LIMIT` copy — safe here since this
// component only ever renders inside the already-lazy-loaded GameShell (see that file's own
// docstring on why App.tsx itself avoids any `engine/` import), so there's no eager-load cost
// to pulling the real constant instead of a second synced-by-hand duplicate.
import { CAP_LIMIT } from '../engine/positions';

interface Props {
  teams: Team[];
  mode: 'developer' | 'player';
  onDone: () => void;
  /** 2026-08-16, user's own ask: renaming the human's team moved here from the intro screen (see
   * this file's own docstring on the `stage === 'intro'` step) — GameShell owns `draftState`, so
   * the actual rename has to happen up there; this just forwards the edited string. */
  onRenameTeam: (name: string) => void;
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
 * 2026-08-16, same-day follow-up: also carries the "How to Play" rules — user's own correction
 * after an earlier pass put them on the intro screen instead ("w sensie how to play po tym jak
 * wcisniemy start draft" — they meant after Start Draft, not after picking Player Mode).
 *
 * 2026-08-16, second same-day follow-up (this session): split into two explicit sub-screens
 * (`stage`), player mode only —
 *   1. `'intro'` — "Your team" (the name input, ALSO moved here from the intro screen, same
 *      reasoning: it only matters once Player Mode is the actual choice) + How to Play, static,
 *      with a "Start Lottery" button. The reveal animation no longer autoplays the instant this
 *      component mounts; it waits for that click.
 *   2. `'revealing'` — the original slot-by-slot reveal grid, unchanged, except its finishing
 *      button now reads "Play" (was "Enter the Draft") to match the "Start Lottery" verb pairing.
 * Tester Mode skips `'intro'` entirely and starts straight into `'revealing'`, same as this
 * component's original always-autoplay behavior — nobody there needs to name a team or read the
 * rules.
 */
export default function DraftLottery({ teams, mode, onDone, onRenameTeam }: Props) {
  const teamCodeByTeamId = useMemo(() => teamCodes(teams), [teams]);
  const revealOrder = useMemo(() => shuffledIndices(teams.length), [teams]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [stage, setStage] = useState<'intro' | 'revealing'>(mode === 'player' ? 'intro' : 'revealing');
  const done = revealedCount >= teams.length;
  const humanTeam = teams.find((t) => t.isHuman);

  useEffect(() => {
    if (stage !== 'revealing' || done) return;
    const justRevealed = teams[revealOrder[revealedCount]];
    const delay = justRevealed?.isHuman ? HUMAN_REVEAL_PAUSE_MS : REVEAL_INTERVAL_MS;
    const timer = setTimeout(() => setRevealedCount((c) => c + 1), delay);
    return () => clearTimeout(timer);
  }, [stage, revealedCount, done, revealOrder, teams]);

  const revealedTeamIds = new Set(revealOrder.slice(0, revealedCount).map((i) => teams[i].id));
  const bySlot = [...teams].sort((a, b) => a.draftSlot - b.draftSlot);

  return (
    <div className="at-shell at-lottery">
      <div className="at-board-brand at-cond">Draft Lottery</div>

      {stage === 'intro' && humanTeam ? (
        <>
          <p className="at-lottery-sub">Before the order is drawn — who are you?</p>
          <div className="team-name-row">
            <label htmlFor="lottery-team-name" className="team-name-label">
              Your team
            </label>
            <input
              id="lottery-team-name"
              type="text"
              className="team-name-input"
              value={humanTeam.name}
              maxLength={40}
              onChange={(e) => onRenameTeam(e.target.value)}
            />
            <button
              type="button"
              className="secondary-btn team-name-randomize"
              title="Randomize a new suggestion"
              onClick={() => onRenameTeam(randomTeamNames(1)[0])}
            >
              🎲
            </button>
          </div>
          <ol className="how-to-play-panel">
            <li>
              <b>Draft.</b> 16 teams take turns, 8 rounds — one player each round. You control one team; the rest
              are CPU.
            </li>
            <li>
              <b>FGA cap.</b> Every pick costs shot volume (FGA). Your whole roster has to fit under {CAP_LIMIT}{' '}
              FGA — the best player isn't always the pick that fits.
            </li>
            <li>
              <b>Spans.</b> You're not limited to a player's peak — draft any real multi-season window of their
              career. A cheaper, less-peak span can be the one that fits your cap.
            </li>
            <li>
              <b>Rotation.</b> Set minutes for your 5 starters and 3 bench players — the Team tab opens for it as
              soon as you have your first pick, no need to wait for the draft to finish.
            </li>
            <li>
              <b>Grading.</b> The judge scores every team — talent, offense, defense, spacing, fit, rotation — and
              ranks the whole field, yours included.
            </li>
          </ol>
          <button className="primary-btn at-lottery-continue" onClick={() => setStage('revealing')}>
            Start Lottery
          </button>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
