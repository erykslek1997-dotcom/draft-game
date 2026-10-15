import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlayerSpan } from '../data/schema';
import type { Team } from '../engine/types';
import { teamCodes, teamLabel, teamPlace } from '../engine/teamNames';
import { FitText } from './FitName';
import { TeamLogo } from './TeamLogo';
import { Face } from './ShotChip';
import { boardName } from './boardNames';

/** Rounds shown before "All rounds": at least this many, and always one past the current round. */
const MIN_ROUNDS_SHOWN = 4;

/** Chronological pick number of a team's pick in a round (snake order). */
export function boardPickNumber(teamIdx: number, round: number, teamCount: number): number {
  const pickInRound = round % 2 === 0 ? teamIdx : teamCount - 1 - teamIdx;
  return round * teamCount + pickInRound + 1;
}

interface DraftGridProps {
  teams: Team[];
  rounds: number;
  /** 0-based round in progress. */
  round: number;
  /** Index of the team on the clock. */
  onClockIdx: number;
  complete: boolean;
  tierColor: (span: PlayerSpan) => string;
  pickTip: (span: PlayerSpan) => string;
}

/**
 * 2026-10-14, the draft board redesign (approved mockup "v2 Desktop", the user: "facecard, pozycja
 * słabszym fontem, nazwisko"): teams across, rounds down, one cell per pick — the player's face
 * ringed in his tier colour, his position, and the one name fans call him (`boardName`). Shows the
 * rounds around the current one; the rest open with "All rounds".
 */
export function DraftGrid({ teams, rounds, round, onClockIdx, complete, tierColor, pickTip }: DraftGridProps) {
  const [allRounds, setAllRounds] = useState(false);
  const humanIdx = teams.findIndex((t) => t.isHuman);
  const humanNext = humanIdx >= 0 ? teams[humanIdx].roster.length : rounds;
  const shown = complete || allRounds ? rounds : Math.min(rounds, Math.max(MIN_ROUNDS_SHOWN, round + 2, humanNext + 1));
  // 2026-10-14 (playtest 3: "wygląda jakby pierwsza drużyna zawsze miała pierwszy pick"): a column
  // on each side, the round's arrow on the side it starts from, and every open cell numbered.
  const codes = teamCodes(teams);
  const columns: CSSProperties = { gridTemplateColumns: `34px repeat(${teams.length}, minmax(68px, 1fr)) 24px` };
  // Where the board is wider than the screen (phones, small laptops), open it on your own column.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scrollRef.current;
    const you = box?.querySelector<HTMLElement>('.dg-team.is-you');
    if (!box || !you || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = you.offsetLeft - (box.clientWidth - you.offsetWidth) / 2;
  }, []);

  return (
    <div className="dg">
      <div className="dg-scroll" ref={scrollRef}>
        <div className="dg-grid" style={columns} role="table" aria-label="Draft board">
          <div role="row" className="dg-row">
            <span role="columnheader" className="dg-corner" />
            {teams.map((team) => (
              <span
                role="columnheader"
                key={team.id}
                className={`dg-team${team.isHuman ? ' is-you' : ''}`}
                title={teamLabel(team)}
              >
                <TeamLogo name={team.name} size={26} />
                {/* 2026-10-15 (UI audit): "Cincinn…" → the team's code when the city does not fit. */}
                <FitText className="dg-team-name" title={teamLabel(team)} variants={team.isHuman ? ['You'] : [teamPlace(team), codes.get(team.id) ?? teamPlace(team)]} />
              </span>
            ))}
            <span role="columnheader" className="dg-corner is-end" />
          </div>
          {Array.from({ length: shown }, (_, r) => (
            <div role="row" className="dg-row" key={r}>
              <span role="rowheader" className="dg-round" title={r % 2 === 0 ? 'Picks run left to right' : 'Picks run right to left'}>
                R{r + 1}
                {r % 2 === 0 && <span className="dg-dir">→</span>}
              </span>
              {teams.map((team, i) => {
                const pick = team.roster[r];
                const n = boardPickNumber(i, r, teams.length);
                const mine = team.isHuman ? ' is-mine' : '';
                if (pick) {
                  const color = tierColor(pick);
                  return (
                    <span
                      role="cell"
                      key={team.id}
                      className={`dg-cell is-filled${mine}`}
                      style={{ '--dg-tier': color } as CSSProperties}
                      title={`#${n} ${pick.playerName} (${pick.spanLabel}) — ${pickTip(pick)}`}
                    >
                      <Face name={pick.playerName} size="md" />
                      <span className="dg-pos">{pick.primaryPosition}</span>
                      <span className="dg-name">{boardName(pick.playerName)}</span>
                    </span>
                  );
                }
                if (!complete && i === onClockIdx && r === team.roster.length) {
                  return (
                    <span role="cell" key={team.id} className={`dg-cell is-clock${team.isHuman ? ' is-you' : ''}`}>
                      <span className="dg-state">On the clock</span>
                      <span className="dg-num">#{n}</span>
                    </span>
                  );
                }
                if (!complete && i === humanIdx && r === humanNext) {
                  return (
                    <span role="cell" key={team.id} className={`dg-cell is-next${mine}`}>
                      <span className="dg-state">Next</span>
                      <span className="dg-num">#{n}</span>
                    </span>
                  );
                }
                return (
                  <span role="cell" key={team.id} className={`dg-cell is-empty${mine}`} aria-label={`Pick ${n}`}>
                    <span className="dg-num is-faint">{n}</span>
                  </span>
                );
              })}
              <span className="dg-round is-end" aria-hidden>
                {r % 2 === 1 && <span className="dg-dir">←</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
      {!complete && (allRounds || shown < rounds) && (
        <button type="button" className="dg-more" aria-expanded={allRounds} onClick={() => setAllRounds((v) => !v)}>
          {allRounds ? 'Fewer rounds ▴' : shown + 1 === rounds ? `Round ${rounds} ▾` : `Rounds ${shown + 1}–${rounds} ▾`}
        </button>
      )}
    </div>
  );
}
