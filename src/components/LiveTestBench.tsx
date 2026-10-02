import { useMemo, useState } from 'react';
import './BestFive.css';
import { STARTER_SLOTS } from '../engine/positions';
import { computedShotsCap, dailyPool, scoreLineup, talMaxLineup, type Lineup } from '../engine/bestFive';
import { headToHeadMargin, pregameOdds, simulateLiveGame } from '../engine/liveGame';
import type { LegendFive } from '../engine/dailyMeta';
import LiveGame from './LiveGame';

/**
 * 2026-10-02, stage 2 (simulations), the user: "będzie potrzebny oddzielny tryb do testów, dwie
 * losowe drużyny". Two random fives (each the best five under the cap from its own random deal)
 * play the live game; the bench shows what the engine expected and, on demand, how 100 replays of
 * the same matchup land — the yardstick for calibrating the live simulation. Testing only
 * (`LIVE_TEST_BENCH_FOR_TESTING`).
 */
const BATCH_GAMES = 100;

function randomFive(key: string): Lineup {
  const pool = dailyPool(key);
  return talMaxLineup(pool, computedShotsCap(pool));
}

function teamLabel(side: 'A' | 'B'): LegendFive {
  return { id: 'ai', name: `Team ${side}`, short: `Team ${side}`, endYear: 0, players: ['', '', '', '', ''] };
}

export default function LiveTestBench({ onBack }: { onBack: () => void }) {
  const [matchup, setMatchup] = useState(() => Math.floor(Math.random() * 1e9));
  const [take, setTake] = useState(0);
  const [batch, setBatch] = useState<{ avg: number; winPct: number; spread: number } | null>(null);

  const teams = useMemo(() => [randomFive(`bench-${matchup}-a`), randomFive(`bench-${matchup}-b`)] as const, [matchup]);
  const margin = useMemo(() => headToHeadMargin(teams[0], teams[1]), [teams]);
  const game = useMemo(() => simulateLiveGame(teams[0], teams[1], margin, `bench-${matchup}-${take}`), [teams, margin, matchup, take]);
  const scores = useMemo(() => teams.map((t) => scoreLineup(t)), [teams]);
  const odds = pregameOdds(margin);

  function nextMatchup() {
    setMatchup(Math.floor(Math.random() * 1e9));
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
        {teams.map((five, side) => (
          <div key={side} className="bench-team">
            <div className="at-cond">
              Team {side === 0 ? 'A' : 'B'} · score {scores[side].composite.toFixed(1)}
            </div>
            <ul>
              {STARTER_SLOTS.map((slot) => {
                const s = five[slot];
                return (
                  <li key={slot}>
                    <b>{slot}</b> {s ? `${s.playerName} ${s.spanLabel}` : '—'}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <p className="bench-expect">
        Engine: Team A by {margin >= 0 ? '+' : ''}
        {margin.toFixed(1)} · {odds.clear ? 'clear favourite (always wins)' : `Team A wins ${Math.round(odds.you * 100)}%`}
        {' · '}
        <button type="button" className="bf-btn" onClick={runBatch}>
          Simulate {BATCH_GAMES}
        </button>
        {batch && (
          <span>
            {' '}
            → avg margin {batch.avg >= 0 ? '+' : ''}
            {batch.avg.toFixed(1)}, Team A won {batch.winPct.toFixed(0)}%, spread ±{batch.spread.toFixed(1)}
          </span>
        )}
      </p>

      <LiveGame key={`${matchup}-${take}`} game={game} opponent={teamLabel('B')} autoStart={false} />
    </div>
  );
}
