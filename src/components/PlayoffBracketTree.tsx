import { useEffect, useRef, useState } from 'react';
import type { PlayoffResult, PlayoffSeriesResult } from '../engine/playoffSimulation';
import type { Team } from '../engine/types';
import { teamLabel } from '../engine/teamNames';

/**
 * 2026-08-19, user's own ask ("can you make playoff bracket like that?", a CBS Sports-style
 * two-side bracket screenshot): the flat per-round text list this replaces worked, but didn't
 * read as a bracket. This app's `playoffSimulation.ts` has no conference concept — one undivided
 * 16-team bracket — so rather than inventing a fake East/West split, this reuses the bracket's
 * OWN existing structure: `SEED_ORDER_16` already keeps seed 1 and seed 2 on opposite halves so
 * they can only meet in the Finals (see leagueSimulation.ts's own docstring on that array) — the
 * first 8 First Round entries are already "one side," the last 8 are already "the other." That
 * split is used here purely as a LAYOUT choice (left half / right half converging to a center
 * Finals), with no East/West labels, since it isn't a real conference.
 *
 * Positioned with plain pixel math (not CSS Grid/Flexbox auto-layout) specifically so the
 * connector lines are guaranteed to meet each match at its exact center — every card and every
 * line segment is computed from the SAME row/column formulas, so they can't disagree the way a
 * CSS-layout-driven card + a separately-hand-tuned connector overlay could. `LEAF_COUNT` (4) is
 * this app's real bracket depth (16 teams -> First Round has 4 matches per side); the row-doubling
 * math generalizes correctly for any power-of-two leaf count if that ever changes, so nothing here
 * hardcodes "4" beyond this one constant.
 *
 * Not verified live in the browser (per explicit user instruction not to touch the shared
 * dev-session tab) — logic double-checked against the known bracket structure (SEED_ORDER_16
 * pairs, round sizes 8/4/2/1) and kept deliberately simple pixel arithmetic rather than anything
 * relying on runtime-measured layout, but a first look from the user is still the real check.
 */
const BRACKET_CARD_W = 236;
const BRACKET_CARD_H = 46;
const BRACKET_ROW_UNIT = 58;
const BRACKET_COL_GAP = 22;
const BRACKET_COL_W = BRACKET_CARD_W + BRACKET_COL_GAP;

/** 2026-09-24: the bracket's size now follows the actual result (the simulated playoffs became
 * top-8, 3 rounds — see playoffSimulation.ts) instead of fixed 16-team constants. `leafCount` is
 * first-round matches per side, `roundsPerSide` every round except the shared Finals column. */
interface BracketLayout {
  leafCount: number;
  roundsPerSide: number;
  width: number;
  height: number;
}

function bracketLayout(result: PlayoffResult): BracketLayout {
  const roundsPerSide = Math.max(1, result.rounds.length - 1);
  const leafCount = Math.max(1, result.rounds[0].length / 2);
  return {
    leafCount,
    roundsPerSide,
    width: 2 * roundsPerSide * BRACKET_COL_W + BRACKET_CARD_W,
    height: leafCount * BRACKET_ROW_UNIT,
  };
}

/** Vertical center of match `indexInRound` within a round whose matches each span `2^round`
 * leaf-slots — first-round matches occupy exactly 1 slot each, the next round 2 slots, and so on.
 * A match's center is always exactly the midpoint of the two matches that feed it, by construction
 * of this doubling — no separate "connector midpoint" math needed beyond reusing this same function
 * one round up. */
function bracketMatchCenterY(round: number, indexInRound: number): number {
  const rowSpan = 2 ** round;
  return (indexInRound * rowSpan + rowSpan / 2) * BRACKET_ROW_UNIT;
}

/** Left edge x-position for a match card. `mirrored` (the right-side bracket) counts rounds in
 * from the far right instead of the far left, so the last round before the Finals sits nearest
 * the center column on both sides and the first round on the outside edge on both sides — the
 * actual visual shape a bracket is supposed to have. */
function bracketMatchX(round: number, mirrored: boolean, width: number): number {
  return mirrored ? width - BRACKET_CARD_W - round * BRACKET_COL_W : round * BRACKET_COL_W;
}

interface BracketTeamRowProps {
  team: Team | undefined;
  seed: number;
  isWinner: boolean;
}

// 2026-09-24, user-reported live ("nasz zespół powinien być lepiej zaznaczony"): the YOU tag used
// to sit INSIDE the ellipsis-truncated name, so a long name ("Wichita Mudcats…") cut it off, and
// series winners were drawn in the same blue the standings used for "you". Now: the human's row
// gets the red "you" treatment (tint + tag outside the truncated name), and a winner is marked by
// weight and a check, the loser dimmed — no colour shared with "you".
function BracketTeamRow({ team, seed, isWinner, games }: BracketTeamRowProps & { games: number }) {
  if (!team) return null;
  return (
    <div
      className={`bracket-team-row ${isWinner ? 'bracket-team-winner' : 'bracket-team-loser'} ${team.isHuman ? 'bracket-team-you' : ''}`}
      title={team.isHuman ? `${teamLabel(team)} (you)` : teamLabel(team)}
    >
      <span className="bracket-seed">#{seed}</span>
      <span className="bracket-team-name">{teamLabel(team)}</span>
      <span className="bracket-games">{games}</span>
    </div>
  );
}

// 2026-09-24, user-reported live ("dość brzydko"): the shared "4-3" badge floated over the
// second row (squeezing both names), and "you" was a tinted, struck-through row plus a big pill.
// Each row now carries its own game count (winner's in bold), and "you" is just the red accent:
// name colour + a thin left bar, with a thin red frame on the series.
function BracketMatchCard({
  series,
  teamById,
  style,
}: {
  series: PlayoffSeriesResult;
  teamById: (id: string) => Team | undefined;
  style?: React.CSSProperties;
}) {
  const teamA = teamById(series.teamAId);
  const teamB = teamById(series.teamBId);
  const involvesYou = Boolean(teamA?.isHuman || teamB?.isHuman);
  return (
    <div className={`bracket-match ${involvesYou ? 'bracket-match--you' : ''}`} style={style} title={series.roundLabel}>
      <BracketTeamRow team={teamA} seed={series.teamASeed} isWinner={series.winnerId === series.teamAId} games={series.gamesWonA} />
      <BracketTeamRow team={teamB} seed={series.teamBSeed} isWinner={series.winnerId === series.teamBId} games={series.gamesWonB} />
    </div>
  );
}

/** One sentence on how the human team's playoff run ended — the bracket alone only shows it in
 * the rounds it reached, so an early exit was easy to miss. */
function humanPlayoffRun(result: PlayoffResult, teamById: (id: string) => Team | undefined): string | null {
  const human = result.rounds.flat().find((s) => teamById(s.teamAId)?.isHuman || teamById(s.teamBId)?.isHuman);
  if (!human) return null;
  const humanId = teamById(human.teamAId)?.isHuman ? human.teamAId : human.teamBId;
  if (result.championId === humanId) return 'Your run: champions! 🏆';
  const lost = result.rounds.flat().find((s) => (s.teamAId === humanId || s.teamBId === humanId) && s.winnerId !== humanId);
  if (!lost) return null;
  const youAreA = lost.teamAId === humanId;
  const opponent = teamById(youAreA ? lost.teamBId : lost.teamAId);
  const own = youAreA ? lost.gamesWonA : lost.gamesWonB;
  const theirs = youAreA ? lost.gamesWonB : lost.gamesWonA;
  const seed = youAreA ? lost.teamBSeed : lost.teamASeed;
  const stage = lost.roundLabel === 'Finals' ? 'lost in the Finals' : `knocked out in the ${lost.roundLabel}`;
  return `Your run: ${stage}, ${own}-${theirs} vs #${seed} ${opponent ? teamLabel(opponent) : ''}.`;
}

/** Below this width the tree (even scaled) gets unreadable — rounds are listed top to bottom instead. */
const BRACKET_LIST_BREAKPOINT = 640;
/** Smallest the tree is ever scaled down to fit; narrower than that it scrolls sideways again. */
const BRACKET_MIN_SCALE = 0.72;

export function PlayoffBracketTree({ result, teamById }: { result: PlayoffResult; teamById: (id: string) => Team | undefined }) {
  // 2026-09-24, user-reported live ("brak widoczności playoffs, trzeba przesuwać"): the tree is a
  // fixed-pixel layout (see the constants above) that was always wider than its modal, so it had
  // to be scrolled sideways. It's now scaled to the space it actually gets, and on a phone it
  // becomes a top-to-bottom list of rounds instead of an unreadably small tree.
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const layout = bracketLayout(result);
  const { roundsPerSide, width: BRACKET_WIDTH, height: BRACKET_HEIGHT } = layout;
  const finals = result.rounds[result.rounds.length - 1]?.[0];
  if (!finals) return null;

  // Each non-final round splits in half: the first half of its series feeds the left side of the
  // bracket, the second half the right (the engine plays rounds in seed order, so halves stay
  // together all the way to the Finals).
  const sideRounds = (half: 0 | 1) =>
    result.rounds.slice(0, roundsPerSide).map((round) => {
      const mid = round.length / 2;
      return half === 0 ? round.slice(0, mid) : round.slice(mid);
    });
  const sides: { mirrored: boolean; rounds: PlayoffSeriesResult[][] }[] = [
    { mirrored: false, rounds: sideRounds(0) },
    { mirrored: true, rounds: sideRounds(1) },
  ];

  const cards: { x: number; y: number; series: PlayoffSeriesResult }[] = [];
  const connectors: { key: string; d: string }[] = [];

  for (const { mirrored, rounds } of sides) {
    rounds.forEach((matches, round) => {
      matches.forEach((series, indexInRound) => {
        const x = bracketMatchX(round, mirrored, BRACKET_WIDTH);
        const y = bracketMatchCenterY(round, indexInRound);
        cards.push({ x, y, series });
      });
      // Connectors from this round's matches to the NEXT round's matches (the last side round
      // connects to the shared Finals card separately, below).
      if (round < roundsPerSide - 1) {
        const cardRightX = mirrored ? bracketMatchX(round, true, BRACKET_WIDTH) : bracketMatchX(round, false, BRACKET_WIDTH) + BRACKET_CARD_W;
        const nextLeftX = mirrored
          ? bracketMatchX(round + 1, true, BRACKET_WIDTH) + BRACKET_CARD_W
          : bracketMatchX(round + 1, false, BRACKET_WIDTH);
        const midX = (cardRightX + nextLeftX) / 2;
        for (let i = 0; i + 1 < matches.length; i += 2) {
          const yTop = bracketMatchCenterY(round, i);
          const yBottom = bracketMatchCenterY(round, i + 1);
          const yMid = bracketMatchCenterY(round + 1, i / 2);
          connectors.push({
            key: `${mirrored}-${round}-${i}`,
            d: `M${cardRightX},${yTop} H${midX} M${cardRightX},${yBottom} H${midX} M${midX},${yTop} V${yBottom} M${midX},${yMid} H${nextLeftX}`,
          });
        }
      }
    });
  }

  // Last side round -> Finals: both of those winners sit at the vertical center (each spans its
  // side's full height), the same center-Y the Finals card uses, so these are straight lines.
  const finalsX = BRACKET_WIDTH / 2 - BRACKET_CARD_W / 2;
  const finalsY = BRACKET_HEIGHT / 2;
  const leftLastRightX = bracketMatchX(roundsPerSide - 1, false, BRACKET_WIDTH) + BRACKET_CARD_W;
  const rightLastLeftX = bracketMatchX(roundsPerSide - 1, true, BRACKET_WIDTH);
  connectors.push({ key: 'left-final', d: `M${leftLastRightX},${finalsY} H${finalsX}` });
  connectors.push({ key: 'right-final', d: `M${rightLastLeftX},${finalsY} H${finalsX + BRACKET_CARD_W}` });
  cards.push({ x: finalsX, y: finalsY, series: finals });

  const champion = teamById(result.championId);

  const runLine = humanPlayoffRun(result, teamById);
  const championLine = champion && (
    <p className={`playoff-champion ${champion.isHuman ? 'playoff-champion--you' : ''}`}>
      🏆 Champion: {teamLabel(champion)} {champion.isHuman ? '(You)' : ''}
    </p>
  );

  if (available !== null && available < BRACKET_LIST_BREAKPOINT) {
    return (
      <div className="bracket-scroll" ref={containerRef}>
        {runLine && <p className="playoff-run">{runLine}</p>}
        {result.rounds.map((round, i) => (
          <div className="bracket-list-round" key={i}>
            <span className="bracket-list-round-label at-cond">{round[0]?.roundLabel}</span>
            <div className="bracket-list-grid">
              {round.map((series) => (
                <BracketMatchCard key={`${series.teamAId}-${series.teamBId}`} series={series} teamById={teamById} />
              ))}
            </div>
          </div>
        ))}
        {championLine}
      </div>
    );
  }

  const treeHeight = BRACKET_HEIGHT + BRACKET_CARD_H;
  const scale = available === null ? 1 : Math.min(1, Math.max(BRACKET_MIN_SCALE, available / BRACKET_WIDTH));

  return (
    <div className="bracket-scroll" ref={containerRef}>
      {runLine && <p className="playoff-run">{runLine}</p>}
      <div style={{ width: BRACKET_WIDTH * scale, height: treeHeight * scale }}>
      <div
        className="bracket-tree"
        style={{ width: BRACKET_WIDTH, height: treeHeight, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        <svg
          className="bracket-lines"
          width={BRACKET_WIDTH}
          height={BRACKET_HEIGHT + BRACKET_CARD_H}
          viewBox={`0 0 ${BRACKET_WIDTH} ${BRACKET_HEIGHT + BRACKET_CARD_H}`}
        >
          {connectors.map((c) => (
            <path key={c.key} d={c.d} className="bracket-line" />
          ))}
        </svg>
        {cards.map(({ x, y, series }) => (
          <BracketMatchCard
            key={`${series.teamAId}-${series.teamBId}`}
            series={series}
            teamById={teamById}
            style={{ position: 'absolute', left: x, top: y - BRACKET_CARD_H / 2, width: BRACKET_CARD_W, height: BRACKET_CARD_H }}
          />
        ))}
      </div>
      </div>
      {championLine}
    </div>
  );
}
