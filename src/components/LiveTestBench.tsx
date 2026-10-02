import { useMemo, useState } from 'react';
import './BestFive.css';
import { STARTER_SLOTS } from '../engine/positions';
import { spanById, type Lineup } from '../engine/bestFive';
import { headToHeadMargin, pregameOdds, simulateLiveGame } from '../engine/liveGame';
import { autoAssignRotation, primaryStarters, totalMinutesForPlayer } from '../engine/rotation';
import { scoreTeam } from '../engine/scoring';
import type { LegendFive } from '../engine/dailyMeta';
import type { PlayerSpan } from '../data/schema';
import type { Team } from '../engine/types';
import benchLeagues from '../data/benchTeams.json';
import LiveGame from './LiveGame';

/**
 * 2026-10-02, stage 2 (simulations), the user: "będzie potrzebny oddzielny tryb do testów, dwie
 * losowe drużyny" — then "rodem z 16-osobowego składu": two teams drawn from real 16-team AI
 * drafts (`benchTeams.json`, built by `scripts/buildBenchTeams.ts`); their starting fives play the
 * live game (the live game does not use the bench yet); the bench shows what the engine expected and, on demand, how 100 replays of
 * the same matchup land — the yardstick for calibrating the live simulation. Testing only
 * (`LIVE_TEST_BENCH_FOR_TESTING`).
 */
const BATCH_GAMES = 100;

const BENCH_TEAMS = (benchLeagues as { seed: number; teams: { name: string; ids: string[] }[] }[]).flatMap((league) =>
  league.teams.map((team) => ({ ...team, seed: league.seed })),
);

function benchTeam(index: number): { team: Team; five: Lineup; label: string } {
  const entry = BENCH_TEAMS[index];
  const roster = entry.ids.map((id) => spanById(id)).filter((span): span is PlayerSpan => Boolean(span));
  const team: Team = { id: `bench-${index}`, name: entry.name, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const five: Lineup = {};
  for (const { slot, player } of primaryStarters(team)) five[slot] = player;
  return { team, five, label: `${entry.name} (draft ${entry.seed})` };
}

function randomPair(): [number, number] {
  const a = Math.floor(Math.random() * BENCH_TEAMS.length);
  let b = Math.floor(Math.random() * (BENCH_TEAMS.length - 1));
  if (b >= a) b++;
  return [a, b];
}

function teamLabel(name: string): LegendFive {
  return { id: 'ai', name, short: name, endYear: 0, players: ['', '', '', '', ''] };
}

export default function LiveTestBench({ onBack }: { onBack: () => void }) {
  const [pair, setPair] = useState(randomPair);
  const [take, setTake] = useState(0);
  const [batch, setBatch] = useState<{ avg: number; winPct: number; spread: number } | null>(null);
  const matchup = `${pair[0]}-${pair[1]}`;

  const sides = useMemo(() => [benchTeam(pair[0]), benchTeam(pair[1])] as const, [pair]);
  const teams = useMemo(() => [sides[0].five, sides[1].five] as const, [sides]);
  const margin = useMemo(() => headToHeadMargin(teams[0], teams[1]), [teams]);
  const game = useMemo(() => simulateLiveGame(teams[0], teams[1], margin, `bench-${matchup}-${take}`), [teams, margin, matchup, take]);
  const overall = useMemo(() => sides.map((side) => scoreTeam(side.team).overall), [sides]);
  const odds = pregameOdds(margin);

  function nextMatchup() {
    setPair(randomPair());
    setTake(0);
    setBatch(null);
  }

  function runBatch() {
    const margins: number[] = [];
    for (let i = 0; i < BATCH_GAMES; i++) {
      const g = simulateLiveGame(teams[0], teams[1], margin, `bench-${matchup}-batch-${i}`);
      margins.push(g.final[0] - g.final[1]);
    }
    const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
    const spread = Math.sqrt(margins.reduce((a, b) => a + (b - avg) ** 2, 0) / margins.length);
    setBatch({ avg, winPct: (100 * margins.filter((m) => m > 0).length) / margins.length, spread });
  }

  return (
    <div className="bf-page">
      <div className="bf-subhead">
        <button type="button" className="bf-btn" onClick={onBack}>
          ← Back
        </button>
        <span className="at-cond">Live game test bench</span>
        <span className="bf-subhead-actions">
          <button type="button" className="bf-btn" onClick={() => setTake((n) => n + 1)}>
            Replay
          </button>
          <button type="button" className="bf-btn" onClick={nextMatchup}>
            Next matchup
          </button>
        </span>
      </div>

      <div className="bench-teams">
        {sides.map((side, index) => {
          const starters = new Set(STARTER_SLOTS.map((slot) => side.five[slot]?.id));
          return (
            <div key={index} className="bench-team">
              <div className="at-cond">
                {index === 0 ? 'A' : 'B'} · {side.label} · overall {overall[index]}
              </div>
              <ul>
                {STARTER_SLOTS.map((slot) => {
                  const s = side.five[slot];
                  return (
                    <li key={slot}>
                      <b>{slot}</b> {s ? `${s.playerName} ${s.spanLabel}` : '—'} · {s ? totalMinutesForPlayer(side.team.rotation, s.id) : 0} min
                    </li>
                  );
                })}
                {side.team.roster
                  .filter((s) => !starters.has(s.id))
                  .map((s) => (
                    <li key={s.id} className="bench-sub">
                      <b>—</b> {s.playerName} {s.spanLabel} · {totalMinutesForPlayer(side.team.rotation, s.id)} min
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="bench-expect">
        Engine (starting fives): A by {margin >= 0 ? '+' : ''}
        {margin.toFixed(1)} · {odds.clear ? 'clear favourite (always wins)' : `A wins ${Math.round(odds.you * 100)}%`}
        {' · '}
        <button type="button" className="bf-btn" onClick={runBatch}>
          Simulate {BATCH_GAMES}
        </button>
        {batch && (
          <span>
            {' '}
            → avg margin {batch.avg >= 0 ? '+' : ''}
            {batch.avg.toFixed(1)}, A won {batch.winPct.toFixed(0)}%, spread ±{batch.spread.toFixed(1)}
          </span>
        )}
      </p>

      <LiveGame key={`${matchup}-${take}`} game={game} opponent={teamLabel(sides[1].team.name)} autoStart={false} />
    </div>
  );
}
