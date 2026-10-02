import { useMemo, useState } from 'react';
import './BestFive.css';
import { spanById } from '../engine/bestFive';
import { gameWinProbability, projectMatchup } from '../engine/matchup';
import { playTeamGame } from '../engine/liveGame';
import { autoAssignRotation, primaryStarters, totalMinutesForPlayer } from '../engine/rotation';
import { scoreTeam } from '../engine/scoring';
import { gameScorePerGame, simulateLiveSeason, type LiveSeasonResult, type SeasonPlayerLine } from '../engine/liveSeason';
import type { LegendFive } from '../engine/dailyMeta';
import type { PlayerSpan } from '../data/schema';
import type { Team } from '../engine/types';
import benchLeagues from '../data/benchTeams.json';
import LiveGame from './LiveGame';

/**
 * 2026-10-02, stage 2 (simulations), the user: "będzie potrzebny oddzielny tryb do testów, dwie
 * losowe drużyny" — then "rodem z 16-osobowego składu": teams drawn from real 16-team AI drafts
 * (`benchTeams.json`, ten leagues built by `scripts/buildBenchTeams.ts`), full rotations on the live
 * engine. Two parts: one game between two teams (with a 100-game check against the engine's
 * expectation), and a whole league's regular season (`liveSeason.ts`) — standings, awards, leaders
 * and every player's averages. Testing only (`LIVE_TEST_BENCH_FOR_TESTING`).
 */
const BATCH_GAMES = 100;

type BenchLeague = { seed: number; teams: { name: string; ids: string[] }[] };
const LEAGUES = benchLeagues as BenchLeague[];

function buildTeam(league: number, index: number): Team {
  const entry = LEAGUES[league].teams[index];
  const roster = entry.ids.map((id) => spanById(id)).filter((span): span is PlayerSpan => Boolean(span));
  return { id: `bench-${league}-${index}`, name: entry.name, draftSlot: index + 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
}

function randomPair(): [[number, number], [number, number]] {
  const pick = (): [number, number] => [Math.floor(Math.random() * LEAGUES.length), Math.floor(Math.random() * 16)];
  const a = pick();
  let b = pick();
  while (b[0] === a[0] && b[1] === a[1]) b = pick();
  return [a, b];
}

function teamLabel(name: string): LegendFive {
  return { id: 'ai', name, short: name, endYear: 0, players: ['', '', '', '', ''] };
}

export default function LiveTestBench({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'game' | 'season'>('game');
  return (
    <div className="bf-page">
      <div className="bf-subhead">
        <button type="button" className="bf-btn" onClick={onBack}>
          ← Back
        </button>
        <span className="at-cond">Live engine test bench</span>
        <span className="bf-subhead-actions">
          <button type="button" className={`bf-btn${tab === 'game' ? ' is-active' : ''}`} onClick={() => setTab('game')}>
            One game
          </button>
          <button type="button" className={`bf-btn${tab === 'season' ? ' is-active' : ''}`} onClick={() => setTab('season')}>
            Season
          </button>
        </span>
      </div>
      {tab === 'game' ? <GameBench /> : <SeasonBench />}
    </div>
  );
}

function GameBench() {
  const [pair, setPair] = useState(randomPair);
  const [take, setTake] = useState(0);
  const [batch, setBatch] = useState<{ avg: number; winPct: number; spread: number } | null>(null);
  const matchup = `${pair[0].join('.')}-${pair[1].join('.')}`;

  const teams = useMemo(() => [buildTeam(...pair[0]), buildTeam(...pair[1])] as const, [pair]);
  const margin = useMemo(() => projectMatchup(teams[0], teams[1], undefined, undefined, 'season').marginA, [teams]);
  const game = useMemo(() => playTeamGame(teams[0], teams[1], margin, `bench-${matchup}-${take}`), [teams, margin, matchup, take]);
  const overall = useMemo(() => teams.map((team) => scoreTeam(team).overall), [teams]);

  function nextMatchup() {
    setPair(randomPair());
    setTake(0);
    setBatch(null);
  }

  function runBatch() {
    const margins: number[] = [];
    for (let i = 0; i < BATCH_GAMES; i++) {
      const g = playTeamGame(teams[0], teams[1], margin, `bench-${matchup}-batch-${i}`, { record: false });
      margins.push(g.final[0] - g.final[1]);
    }
    const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
    const spread = Math.sqrt(margins.reduce((a, b) => a + (b - avg) ** 2, 0) / margins.length);
    setBatch({ avg, winPct: (100 * margins.filter((m) => m > 0).length) / margins.length, spread });
  }

  return (
    <>
      <div className="bench-actions">
        <button type="button" className="bf-btn" onClick={() => setTake((n) => n + 1)}>
          Replay
        </button>
        <button type="button" className="bf-btn" onClick={nextMatchup}>
          Next matchup
        </button>
      </div>
      <div className="bench-teams">
        {teams.map((team, index) => {
          const starters = new Set(primaryStarters(team).map((e) => e.player.id));
          return (
            <div key={team.id} className="bench-team">
              <div className="at-cond">
                {index === 0 ? 'A' : 'B'} · {team.name} (draft {LEAGUES[pair[index][0]].seed}) · overall {overall[index]}
              </div>
              <ul>
                {primaryStarters(team).map(({ slot, player }) => (
                  <li key={slot}>
                    <b>{slot}</b> {player.playerName} {player.spanLabel} · {totalMinutesForPlayer(team.rotation, player.id)} min
                  </li>
                ))}
                {team.roster
                  .filter((s) => !starters.has(s.id))
                  .map((s) => (
                    <li key={s.id} className="bench-sub">
                      <b>—</b> {s.playerName} {s.spanLabel} · {totalMinutesForPlayer(team.rotation, s.id)} min
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="bench-expect">
        Engine (season margin): A by {margin >= 0 ? '+' : ''}
        {margin.toFixed(1)} · A wins {Math.round(gameWinProbability(margin) * 100)}%{' · '}
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

      <LiveGame key={`${matchup}-${take}`} game={game} opponent={teamLabel(teams[1].name)} autoStart={false} />
    </>
  );
}

type SortKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'tpm' | 'min' | 'fg' | 'tp' | 'ft' | 'ts' | 'gmsc';
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'min', label: 'MIN' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'tov', label: 'TO' },
  { key: 'tpm', label: '3PM' },
  { key: 'fg', label: 'FG%' },
  { key: 'tp', label: '3P%' },
  { key: 'ft', label: 'FT%' },
  { key: 'ts', label: 'TS%' },
  { key: 'gmsc', label: 'GmSc' },
];

function stat(line: SeasonPlayerLine, key: SortKey): number {
  const t = line.totals;
  const g = Math.max(1, line.games);
  switch (key) {
    case 'fg':
      return t.fga > 0 ? (100 * t.fgm) / t.fga : 0;
    case 'tp':
      return t.tpa > 0 ? (100 * t.tpm) / t.tpa : 0;
    case 'ft':
      return t.fta > 0 ? (100 * t.ftm) / t.fta : 0;
    case 'ts':
      return t.fga + t.fta > 0 ? (100 * t.pts) / (2 * (t.fga + 0.44 * t.fta)) : 0;
    case 'gmsc':
      return gameScorePerGame(line);
    default:
      return t[key] / g;
  }
}

function SeasonBench() {
  const [league, setLeague] = useState(0);
  const [result, setResult] = useState<LiveSeasonResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortKey>('pts');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const teams = useMemo(() => LEAGUES[league].teams.map((_, i) => buildTeam(league, i)), [league]);
  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  function run() {
    setBusy(true);
    // Let the "Simulating…" state paint before the season blocks the thread for a few seconds.
    window.setTimeout(() => {
      setResult(simulateLiveSeason(teams, `bench-season-${league}-${Date.now()}`));
      setBusy(false);
    }, 30);
  }

  const players = result
    ? result.players
        .filter((l) => (teamFilter === 'all' ? l.games >= 20 : l.teamId === teamFilter))
        .sort((a, b) => stat(b, sort) - stat(a, sort))
    : [];
  const award = (label: string, line: SeasonPlayerLine | null) =>
    line && (
      <li>
        <b>{label}</b> {line.span.playerName} {line.span.spanLabel} ({teamName.get(line.teamId)}) — {stat(line, 'pts').toFixed(1)} pts,{' '}
        {stat(line, 'reb').toFixed(1)} reb, {stat(line, 'ast').toFixed(1)} ast
      </li>
    );

  return (
    <>
      <div className="bench-actions">
        <label>
          League{' '}
          <select
            value={league}
            onChange={(e) => {
              setLeague(Number(e.target.value));
              setResult(null);
              setTeamFilter('all');
            }}
          >
            {LEAGUES.map((l, i) => (
              <option key={l.seed} value={i}>
                Draft {l.seed}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="bf-btn" onClick={run} disabled={busy}>
          {busy ? 'Simulating…' : result ? 'Simulate again' : 'Simulate season'}
        </button>
      </div>

      {result && (
        <>
          <div className="bench-season-grid">
            <div>
              <div className="at-cond">Standings</div>
              <table className="bf-live-table">
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col">W-L</th>
                    <th scope="col">PF</th>
                    <th scope="col">PA</th>
                    <th scope="col">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {result.standings.map((r) => {
                    const g = Math.max(1, r.wins + r.losses);
                    return (
                      <tr key={r.teamId}>
                        <th scope="row">
                          <button type="button" className="bench-link" onClick={() => setTeamFilter(r.teamId)}>
                            {teamName.get(r.teamId)}
                          </button>
                        </th>
                        <td>
                          {r.wins}-{r.losses}
                        </td>
                        <td>{(r.pointsFor / g).toFixed(1)}</td>
                        <td>{(r.pointsAgainst / g).toFixed(1)}</td>
                        <td>{scoreTeam(teams.find((t) => t.id === r.teamId)!).overall}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <div className="at-cond">Awards</div>
              <ul className="bench-awards">
                {award('MVP', result.awards.mvp)}
                {award('DPOY', result.awards.dpoy)}
                {award('6MOY', result.awards.sixthMan)}
              </ul>
            </div>
          </div>

          <div className="bench-actions">
            <span className="at-cond">Players</span>
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="all">All (20+ games)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="bench-hint">Click a column to sort. In brackets: his real numbers.</span>
          </div>
          <div className="bf-live-table-wrap">
            <table className="bf-live-table bench-players">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Team</th>
                  <th scope="col">G</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col">
                      <button type="button" className={`bench-link${sort === c.key ? ' is-active' : ''}`} onClick={() => setSort(c.key)}>
                        {c.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((l) => (
                  <tr key={`${l.teamId}-${l.span.id}`}>
                    <th scope="row">
                      {l.span.playerName} <span className="bench-sub">{l.span.spanLabel}</span>
                    </th>
                    <td>{teamName.get(l.teamId)}</td>
                    <td>{l.games}</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key}>
                        {stat(l, c.key).toFixed(1)}
                        {c.key === 'pts' && <span className="bench-real"> ({l.span.box.ppg})</span>}
                        {c.key === 'reb' && <span className="bench-real"> ({l.span.box.rpg})</span>}
                        {c.key === 'ast' && <span className="bench-real"> ({l.span.box.apg})</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

