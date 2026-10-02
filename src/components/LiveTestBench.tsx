import { useMemo, useState } from "react";
import "./BestFive.css";
import { spanById } from "../engine/bestFive";
import { gameWinProbability, projectMatchup } from "../engine/matchup";
import { playTeamGame } from "../engine/liveGame";
import {
  autoAssignRotation,
  primaryStarters,
  totalMinutesForPlayer,
} from "../engine/rotation";
import { scoreTeam } from "../engine/scoring";
import {
  engineTeamViews,
  gameScorePerGame,
  simulateLiveSeason,
  type EngineTeamView,
  type LiveSeasonResult,
  type SeasonPlayerLine,
} from "../engine/liveSeason";
import type { LegendFive } from "../engine/dailyMeta";
import type { PlayerSpan } from "../data/schema";
import type { Team } from "../engine/types";
import benchLeagues from "../data/benchTeams.json";
import LiveGame from "./LiveGame";

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
  const roster = entry.ids
    .map((id) => spanById(id))
    .filter((span): span is PlayerSpan => Boolean(span));
  return {
    id: `bench-${league}-${index}`,
    name: entry.name,
    draftSlot: index + 1,
    isHuman: false,
    roster,
    rotation: autoAssignRotation(roster),
  };
}

function randomPair(): [[number, number], [number, number]] {
  const pick = (): [number, number] => [
    Math.floor(Math.random() * LEAGUES.length),
    Math.floor(Math.random() * 16),
  ];
  const a = pick();
  let b = pick();
  while (b[0] === a[0] && b[1] === a[1]) b = pick();
  return [a, b];
}

function teamLabel(name: string): LegendFive {
  return {
    id: "ai",
    name,
    short: name,
    endYear: 0,
    players: ["", "", "", "", ""],
  };
}

export default function LiveTestBench({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"game" | "season">("game");
  return (
    <div className="bf-page">
      <div className="bf-subhead">
        <button type="button" className="bf-btn" onClick={onBack}>
          ← Back
        </button>
        <span className="at-cond">Live engine test bench</span>
        <span className="bf-subhead-actions">
          <button
            type="button"
            className={`bf-btn${tab === "game" ? " is-active" : ""}`}
            onClick={() => setTab("game")}
          >
            One game
          </button>
          <button
            type="button"
            className={`bf-btn${tab === "season" ? " is-active" : ""}`}
            onClick={() => setTab("season")}
          >
            Season
          </button>
        </span>
      </div>
      {tab === "game" ? <GameBench /> : <SeasonBench />}
    </div>
  );
}

function GameBench() {
  const [pair, setPair] = useState(randomPair);
  const [take, setTake] = useState(0);
  const [batch, setBatch] = useState<{
    avg: number;
    winPct: number;
    spread: number;
  } | null>(null);
  const matchup = `${pair[0].join(".")}-${pair[1].join(".")}`;

  const teams = useMemo(
    () => [buildTeam(...pair[0]), buildTeam(...pair[1])] as const,
    [pair],
  );
  const margin = useMemo(
    () =>
      projectMatchup(teams[0], teams[1], undefined, undefined, "season")
        .marginA,
    [teams],
  );
  const game = useMemo(
    () => playTeamGame(teams[0], teams[1], margin, `bench-${matchup}-${take}`),
    [teams, margin, matchup, take],
  );
  const overall = useMemo(
    () => teams.map((team) => scoreTeam(team).overall),
    [teams],
  );

  function nextMatchup() {
    setPair(randomPair());
    setTake(0);
    setBatch(null);
  }

  function runBatch() {
    const margins: number[] = [];
    for (let i = 0; i < BATCH_GAMES; i++) {
      const g = playTeamGame(
        teams[0],
        teams[1],
        margin,
        `bench-${matchup}-batch-${i}`,
        { record: false },
      );
      margins.push(g.final[0] - g.final[1]);
    }
    const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
    const spread = Math.sqrt(
      margins.reduce((a, b) => a + (b - avg) ** 2, 0) / margins.length,
    );
    setBatch({
      avg,
      winPct: (100 * margins.filter((m) => m > 0).length) / margins.length,
      spread,
    });
  }

  return (
    <>
      <div className="bench-actions">
        <button
          type="button"
          className="bf-btn"
          onClick={() => setTake((n) => n + 1)}
        >
          Replay
        </button>
        <button type="button" className="bf-btn" onClick={nextMatchup}>
          Next matchup
        </button>
      </div>
      <div className="bench-teams">
        {teams.map((team, index) => {
          const starters = new Set(
            primaryStarters(team).map((e) => e.player.id),
          );
          return (
            <div key={team.id} className="bench-team">
              <div className="at-cond">
                {index === 0 ? "A" : "B"} · {team.name} (draft{" "}
                {LEAGUES[pair[index][0]].seed}) · overall {overall[index]}
              </div>
              <ul>
                {primaryStarters(team).map(({ slot, player }) => (
                  <li key={slot}>
                    <b>{slot}</b> {player.playerName} {player.spanLabel} ·{" "}
                    {totalMinutesForPlayer(team.rotation, player.id)} min
                  </li>
                ))}
                {team.roster
                  .filter((s) => !starters.has(s.id))
                  .map((s) => (
                    <li key={s.id} className="bench-sub">
                      <b>—</b> {s.playerName} {s.spanLabel} ·{" "}
                      {totalMinutesForPlayer(team.rotation, s.id)} min
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="bench-expect">
        Engine (season margin): A by {margin >= 0 ? "+" : ""}
        {margin.toFixed(1)} · A wins{" "}
        {Math.round(gameWinProbability(margin) * 100)}%{" · "}
        <button type="button" className="bf-btn" onClick={runBatch}>
          Simulate {BATCH_GAMES}
        </button>
        {batch && (
          <span>
            {" "}
            → avg margin {batch.avg >= 0 ? "+" : ""}
            {batch.avg.toFixed(1)}, A won {batch.winPct.toFixed(0)}%, spread ±
            {batch.spread.toFixed(1)}
          </span>
        )}
      </p>

      <LiveGame
        key={`${matchup}-${take}`}
        game={game}
        opponent={teamLabel(teams[1].name)}
        autoStart={false}
      />
    </>
  );
}

type SortKey =
  | "pts"
  | "reb"
  | "ast"
  | "stl"
  | "blk"
  | "tov"
  | "tpm"
  | "min"
  | "fg"
  | "tp"
  | "ft"
  | "ts"
  | "gmsc";
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "min", label: "MIN" },
  { key: "pts", label: "PTS" },
  { key: "reb", label: "REB" },
  { key: "ast", label: "AST" },
  { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" },
  { key: "tov", label: "TO" },
  { key: "tpm", label: "3PM" },
  { key: "fg", label: "FG%" },
  { key: "tp", label: "3P%" },
  { key: "ft", label: "FT%" },
  { key: "ts", label: "TS%" },
  { key: "gmsc", label: "GmSc" },
];

function stat(line: SeasonPlayerLine, key: SortKey): number {
  const t = line.totals;
  const g = Math.max(1, line.games);
  switch (key) {
    case "fg":
      return t.fga > 0 ? (100 * t.fgm) / t.fga : 0;
    case "tp":
      return t.tpa > 0 ? (100 * t.tpm) / t.tpa : 0;
    case "ft":
      return t.fta > 0 ? (100 * t.ftm) / t.fta : 0;
    case "ts":
      return t.fga + t.fta > 0
        ? (100 * t.pts) / (2 * (t.fga + 0.44 * t.fta))
        : 0;
    case "gmsc":
      return gameScorePerGame(line);
    default:
      return t[key] / g;
  }
}

/** His real per-game number for the stats that have one in the data. */
function realValue(line: SeasonPlayerLine, key: SortKey): number | null {
  const b = line.span.box;
  if (key === "pts") return b.ppg;
  if (key === "reb") return b.rpg;
  if (key === "ast") return b.apg;
  if (key === "stl") return b.spg;
  if (key === "blk") return b.bpg;
  return null;
}

const shortTeam = (name: string | undefined) =>
  (name ?? "").split(" ").slice(-1)[0];
const PERCENT_KEYS: SortKey[] = ["fg", "tp", "ft", "ts"];

/** Plain-text export of a simulated season, to paste into a calibration session. */
function seasonExportText(
  seed: number,
  result: LiveSeasonResult,
  teams: Team[],
  engine: Map<string, EngineTeamView>,
): string {
  const name = new Map(teams.map((t) => [t.id, t.name]));
  const pad = (v: string, n: number) => v.padEnd(n);
  const num = (v: number) => v.toFixed(1).padStart(5);
  const out: string[] = [
    `LIVE SEASON EXPORT — AI draft ${seed}, ${new Date().toISOString().slice(0, 10)}`,
    "",
    "STANDINGS",
  ];
  out.push(
    "    team                       W-L    PF     PA    | engine: rank  exp W  overall  T   O   D   S   F",
  );
  result.standings.forEach((r, i) => {
    const g = Math.max(1, r.wins + r.losses);
    const e = engine.get(r.teamId)!;
    const n = (v: number) => String(Math.round(v)).padStart(3);
    out.push(
      `${String(i + 1).padStart(2)}. ${pad(name.get(r.teamId) ?? "", 26)} ${`${r.wins}-${r.losses}`.padEnd(6)} ${(r.pointsFor / g).toFixed(1)}  ${(r.pointsAgainst / g).toFixed(1)}  |  ${String(e.rank).padStart(2)}    ${e.expectedWins.toFixed(1).padStart(4)}   ${n(e.overall)}   ${n(e.talent)} ${n(e.offense)} ${n(e.defense)} ${n(e.spacing)} ${n(e.fit)}`,
    );
  });
  out.push("", "AWARDS");
  const aw = (label: string, l: SeasonPlayerLine | null) =>
    l &&
    out.push(
      `${label}: ${l.span.playerName} ${l.span.spanLabel} (${name.get(l.teamId)}) ${stat(l, "pts").toFixed(1)}/${stat(l, "reb").toFixed(1)}/${stat(l, "ast").toFixed(1)}`,
    );
  aw("MVP", result.awards.mvp);
  aw("DPOY", result.awards.dpoy);
  aw("6MOY", result.awards.sixthMan);
  out.push(
    "",
    "PLAYERS — per game in the sim, (real) = his real per game; by team, most minutes first",
  );
  out.push(
    `${pad("Player", 34)}${pad("Team", 14)}  G   MIN  PTS (real)   REB (real)   AST (real)   STL  BLK   TO  3PM  FG%  3P%  FT%  TS%`,
  );
  for (const team of teams) {
    const lines = result.players
      .filter((l) => l.teamId === team.id)
      .sort((a, b) => b.totals.min - a.totals.min);
    for (const l of lines) {
      const r = (k: SortKey) =>
        `${num(stat(l, k))} (${(realValue(l, k) ?? 0).toFixed(1).padStart(4)})`;
      out.push(
        `${pad(`${l.span.playerName} ${l.span.spanLabel}`, 34)}${pad(shortTeam(team.name), 14)}${String(l.games).padStart(3)} ${num(stat(l, "min"))} ${r("pts")} ${r("reb")} ${r("ast")}${num(stat(l, "stl"))}${num(stat(l, "blk"))}${num(stat(l, "tov"))}${num(stat(l, "tpm"))}${PERCENT_KEYS.map((k) => num(stat(l, k))).join("")}`,
      );
    }
  }
  return out.join("\n");
}

function SeasonBench() {
  const [league, setLeague] = useState(0);
  const [result, setResult] = useState<LiveSeasonResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortKey>("pts");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [exported, setExported] = useState<"idle" | "copied" | "saved">("idle");
  const teams = useMemo(
    () => LEAGUES[league].teams.map((_, i) => buildTeam(league, i)),
    [league],
  );
  const teamName = useMemo(
    () => new Map(teams.map((t) => [t.id, t.name])),
    [teams],
  );
  const engine = useMemo(
    () => (result ? engineTeamViews(teams) : null),
    [result, teams],
  );

  function run() {
    setBusy(true);
    setExported("idle");
    // Let the "Simulating…" state paint before the season blocks the thread for a few seconds.
    window.setTimeout(() => {
      setResult(
        simulateLiveSeason(teams, `bench-season-${league}-${Date.now()}`),
      );
      setBusy(false);
    }, 30);
  }

  async function exportSeason() {
    if (!result || !engine) return;
    const text = seasonExportText(LEAGUES[league].seed, result, teams, engine);
    try {
      await navigator.clipboard.writeText(text);
      setExported("copied");
    } catch {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `live-season-${LEAGUES[league].seed}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      setExported("saved");
    }
  }

  const players = result
    ? result.players
        .filter((l) =>
          teamFilter === "all" ? l.games >= 20 : l.teamId === teamFilter,
        )
        .sort((a, b) => stat(b, sort) - stat(a, sort))
    : [];
  const award = (label: string, line: SeasonPlayerLine | null) =>
    line && (
      <li>
        <b>{label}</b> {line.span.playerName}{" "}
        <span className="bench-dim">{line.span.spanLabel}</span> ·{" "}
        {shortTeam(teamName.get(line.teamId))} · {stat(line, "pts").toFixed(1)}{" "}
        pts, {stat(line, "reb").toFixed(1)} reb, {stat(line, "ast").toFixed(1)}{" "}
        ast
      </li>
    );

  return (
    <>
      <div className="bench-actions">
        <label>
          League{" "}
          <select
            value={league}
            onChange={(e) => {
              setLeague(Number(e.target.value));
              setResult(null);
              setTeamFilter("all");
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
          {busy ? "Simulating…" : result ? "Simulate again" : "Simulate season"}
        </button>
        {result && (
          <button type="button" className="bf-btn" onClick={exportSeason}>
            {exported === "copied"
              ? "Copied ✓ — paste it to Claude"
              : exported === "saved"
                ? "Saved as .txt ✓"
                : "Copy export for Claude"}
          </button>
        )}
      </div>

      {result && (
        <>
          <div className="bench-season-grid">
            <div>
              <div className="at-cond">
                Standings · gold = the engine's view; bold gold = far from what
                happened
              </div>
              <div className="bench-table-wrap">
                <table className="bench-table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Team</th>
                      <th scope="col">W-L</th>
                      <th scope="col">Pts for</th>
                      <th scope="col">Pts against</th>
                      <th
                        scope="col"
                        className="bench-engine"
                        title="The engine's rank by overall"
                      >
                        Engine #
                      </th>
                      <th
                        scope="col"
                        className="bench-engine"
                        title="Wins the engine's season projection expects"
                      >
                        Exp. W
                      </th>
                      <th scope="col" className="bench-engine">
                        Overall
                      </th>
                      <th scope="col" className="bench-engine">
                        Talent
                      </th>
                      <th scope="col" className="bench-engine">
                        Off
                      </th>
                      <th scope="col" className="bench-engine">
                        Def
                      </th>
                      <th scope="col" className="bench-engine">
                        Spacing
                      </th>
                      <th scope="col" className="bench-engine">
                        Fit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.standings.map((r, i) => {
                      const g = Math.max(1, r.wins + r.losses);
                      const e = engine?.get(r.teamId);
                      return (
                        <tr
                          key={r.teamId}
                          className={
                            teamFilter === r.teamId ? "is-picked" : undefined
                          }
                        >
                          <td>{i + 1}</td>
                          <th scope="row">
                            <button
                              type="button"
                              className="bench-link"
                              onClick={() => setTeamFilter(r.teamId)}
                            >
                              {teamName.get(r.teamId)}
                            </button>
                          </th>
                          <td>
                            <b>
                              {r.wins}-{r.losses}
                            </b>
                          </td>
                          <td>{(r.pointsFor / g).toFixed(1)}</td>
                          <td>{(r.pointsAgainst / g).toFixed(1)}</td>
                          {e && (
                            <>
                              <td
                                className={`bench-engine${Math.abs(e.rank - (i + 1)) >= 5 ? " is-off" : ""}`}
                              >
                                {e.rank}
                              </td>
                              <td
                                className={`bench-engine${Math.abs(e.expectedWins - r.wins) >= 8 ? " is-off" : ""}`}
                              >
                                {e.expectedWins.toFixed(1)}
                              </td>
                              <td className="bench-engine">{e.overall}</td>
                              <td className="bench-engine">
                                {Math.round(e.talent)}
                              </td>
                              <td className="bench-engine">
                                {Math.round(e.offense)}
                              </td>
                              <td className="bench-engine">
                                {Math.round(e.defense)}
                              </td>
                              <td className="bench-engine">
                                {Math.round(e.spacing)}
                              </td>
                              <td className="bench-engine">
                                {Math.round(e.fit)}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="at-cond">Awards</div>
              <ul className="bench-awards">
                {award("MVP", result.awards.mvp)}
                {award("DPOY", result.awards.dpoy)}
                {award("6MOY", result.awards.sixthMan)}
              </ul>
            </div>
          </div>

          <div className="bench-actions">
            <span className="at-cond">Players</span>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
            >
              <option value="all">All teams (20+ games)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="bench-hint">
              Per game. Click a column to sort. Small number = difference from
              his real per-game average.
            </span>
          </div>
          <div className="bench-table-wrap">
            <table className="bench-table bench-players">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Team</th>
                  <th scope="col">G</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={sort === c.key ? "is-sorted" : undefined}
                    >
                      <button
                        type="button"
                        className="bench-sort"
                        onClick={() => setSort(c.key)}
                      >
                        {c.label}
                        {sort === c.key ? " ▼" : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((l) => (
                  <tr key={`${l.teamId}-${l.span.id}`}>
                    <th scope="row">
                      {l.span.playerName}{" "}
                      <span className="bench-dim">{l.span.spanLabel}</span>
                    </th>
                    <td className="bench-dim">
                      {shortTeam(teamName.get(l.teamId))}
                    </td>
                    <td>{l.games}</td>
                    {COLUMNS.map((c) => {
                      const value = stat(l, c.key);
                      const real = realValue(l, c.key);
                      const diff = real === null ? null : value - real;
                      return (
                        <td
                          key={c.key}
                          className={sort === c.key ? "is-sorted" : undefined}
                        >
                          {value.toFixed(1)}
                          {diff !== null && (
                            <span
                              className={`bench-diff${Math.abs(diff) >= 3 ? " is-big" : ""}`}
                            >
                              {diff >= -0.05 ? "+" : "−"}
                              {Math.abs(diff).toFixed(1)}
                            </span>
                          )}
                        </td>
                      );
                    })}
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
