import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Team } from '../engine/types';
import {
  engineTeamViews,
  playLivePlayoffGame,
  gameScorePerGame,
  type LivePlayoffResult,
  type LivePlayoffSeries,
  type LiveSeasonResult,
  type SeasonPlayerLine,
  type SimProgress,
} from '../engine/liveSeason';
import LiveGame, { type LiveMatchup } from './LiveGame';
import { TeamMark } from './ResultsReport';
import './BestFive.css';

/**
 * 2026-10-08, the user (season simulation, mockup B: "Bo"): the season after a draft — one recap
 * top to bottom (record, the playoffs, standings and leaders, awards, your players), with the full
 * stats and the bracket a click away. Every game was played on the live engine; your playoff games
 * can be watched play by play ("tylko gracz" — only yours), and the playoffs stay hidden until you
 * watch them or ask for the results, so watching is not spoiled.
 */

export type SeasonState =
  | { status: 'running'; progress: SimProgress | null }
  | { status: 'done'; season: LiveSeasonResult; playoffs: LivePlayoffResult | null };

type Reveal = { mode: 'hidden' } | { mode: 'live'; round: number; game: number } | { mode: 'all' };
type View = { kind: 'recap' } | { kind: 'stats' } | { kind: 'bracket' } | { kind: 'watch'; round: number; series: number; game: number };

const ROUND_SHORT = ['QF', 'SF', 'Finals'];
const AWARD_MIN_GAMES = 58;
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const per = (l: SeasonPlayerLine, k: keyof SeasonPlayerLine['totals']) => l.totals[k] / Math.max(1, l.games);
const f1 = (x: number) => x.toFixed(1);
const pct = (made: number, att: number) => (att > 0 ? ((100 * made) / att).toFixed(1) : '—');
const mascot = (team: Team | undefined) => team?.name.split(' ').slice(-1)[0] ?? '';

export default function SeasonView({ teams, codes, state, onClose }: { teams: Team[]; codes: Map<string, string>; state: SeasonState; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'recap' });
  const [reveal, setReveal] = useState<Reveal>({ mode: 'hidden' });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ss-backdrop" onClick={onClose}>
      <div className="ss-sheet at-calm" role="dialog" aria-modal="true" aria-label="Your season" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ss-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        {state.status === 'running' ? (
          <Playing progress={state.progress} />
        ) : (
          <Season teams={teams} codes={codes} season={state.season} playoffs={state.playoffs} view={view} setView={setView} reveal={reveal} setReveal={setReveal} />
        )}
      </div>
    </div>
  );
}

function Playing({ progress }: { progress: SimProgress | null }) {
  const share = progress ? progress.played / Math.max(1, progress.total) : 0;
  return (
    <div className="ss-playing">
      <div className="ss-kicker">Your season</div>
      <h2 className="ss-h">Playing the season…</h2>
      <p className="ss-note">82 games for every team, each one played on the game engine. Then the top 8 play the playoffs.</p>
      <div className="ss-progress">
        <i style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <p className="ss-note">{progress ? `${progress.played} / ${progress.total} games` : 'Tip-off…'}</p>
    </div>
  );
}

function Season({
  teams,
  codes,
  season,
  playoffs,
  view,
  setView,
  reveal,
  setReveal,
}: {
  teams: Team[];
  codes: Map<string, string>;
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult | null;
  view: View;
  setView: (v: View) => void;
  reveal: Reveal;
  setReveal: (r: Reveal) => void;
}) {
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const you = teams.find((t) => t.isHuman) ?? teams[0];
  const views = useMemo(() => engineTeamViews(teams), [teams]);
  const rank = season.standings.findIndex((r) => r.teamId === you.id) + 1;
  const record = season.standings[rank - 1];
  const mark = (id: string, size: 'sm' | 'md' = 'sm') => <TeamMark code={codes.get(id) ?? ''} name={byId.get(id)?.name ?? ''} size={size} />;

  // How much of the playoffs is on the page: nothing yet, up to a game of a round, or all of it.
  const visibleGames = (round: number, series: LivePlayoffSeries) => {
    if (reveal.mode === 'all') return series.games.length;
    if (reveal.mode === 'hidden') return 0;
    if (round < reveal.round) return series.games.length;
    if (round > reveal.round) return 0;
    return Math.min(series.games.length, reveal.game);
  };
  const isYours = (s: LivePlayoffSeries) => s.teamAId === you.id || s.teamBId === you.id;
  const yourRuns = playoffs ? playoffs.rounds.map((r, round) => ({ round, index: r.findIndex(isYours) })).filter((x) => x.index >= 0) : [];
  const madePlayoffs = yourRuns.length > 0;
  const finalsSeries = playoffs ? playoffs.rounds[playoffs.rounds.length - 1][0] : null;
  // Everything is out once the Finals are on the page (asked for, or watched to the end).
  const complete = reveal.mode === 'all' || (playoffs !== null && finalsSeries !== null && visibleGames(playoffs.rounds.length - 1, finalsSeries) >= finalsSeries.games.length);
  const lastRun = yourRuns[yourRuns.length - 1];
  const lastSeries = playoffs && lastRun ? playoffs.rounds[lastRun.round][lastRun.index] : null;

  // Your next game to watch (live mode): the first one not yet on the page in the current round.
  const nextGame = (() => {
    if (!playoffs || reveal.mode !== 'live') return null;
    const run = yourRuns.find((r) => r.round === reveal.round);
    if (!run) return null;
    const s = playoffs.rounds[run.round][run.index];
    return reveal.game < s.games.length ? { round: run.round, series: run.index, game: reveal.game } : null;
  })();
  const yourSeriesDone = (() => {
    if (!playoffs || reveal.mode !== 'live') return null;
    const run = yourRuns.find((r) => r.round === reveal.round);
    if (!run) return null;
    const s = playoffs.rounds[run.round][run.index];
    return reveal.game >= s.games.length ? s : null;
  })();
  const markWatched = (round: number, game: number) => {
    if (reveal.mode === 'live' && reveal.round === round && reveal.game <= game) setReveal({ mode: 'live', round, game: game + 1 });
  };

  if (view.kind === 'watch' && playoffs) {
    const series = playoffs.rounds[view.round][view.series];
    return (
      <Watch
        key={`${view.round}-${view.series}-${view.game}`}
        teams={teams}
        codes={codes}
        series={series}
        gameIndex={view.game}
        youId={you.id}
        byId={byId}
        onFinish={() => markWatched(view.round, view.game)}
        onNext={view.game + 1 < series.games.length ? () => setView({ ...view, game: view.game + 1 }) : null}
        onBack={() => setView({ kind: 'recap' })}
      />
    );
  }
  if (view.kind === 'stats') {
    return <AllStats teams={teams} season={season} playoffs={complete ? playoffs : null} youId={you.id} mark={mark} onBack={() => setView({ kind: 'recap' })} />;
  }
  if (view.kind === 'bracket' && playoffs) {
    return (
      <div>
        <BackBar onBack={() => setView({ kind: 'recap' })} title="Playoffs" />
        <div className="ss-bracket">
          {playoffs.rounds.map((round, r) => (
            <div key={r} className="ss-bracket-col">
              <div className="ss-kicker">{round[0].roundLabel}</div>
              <div className="ss-bracket-games">
                {round.map((s, i) => (
                  <SeriesCard key={i} s={s} shown={visibleGames(r, s)} youId={you.id} byId={byId} mark={mark} onWatch={isYours(s) ? (g) => setView({ kind: 'watch', round: r, series: i, game: g }) : null} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const yourLines = season.players.filter((l) => l.teamId === you.id).sort((a, b) => b.totals.min - a.totals.min);
  const best = [...yourLines].filter((l) => l.games >= AWARD_MIN_GAMES / 2).sort((a, b) => gameScorePerGame(b) - gameScorePerGame(a))[0];
  const projected = views.get(you.id)?.expectedWins ?? record.wins;
  const vs = Math.round(record.wins - projected);

  // The sentence and the playoff tile: what the page may already tell.
  let story: string;
  let tile: string;
  if (!playoffs || !madePlayoffs) {
    const eighth = season.standings[7];
    story = `Missed the playoffs — ${ord(rank)}, ${eighth.wins - record.wins} game${eighth.wins - record.wins === 1 ? '' : 's'} behind 8th.`;
    tile = '—';
  } else if (reveal.mode === 'hidden') {
    story = `Into the playoffs as the ${ord(rank)} seed.`;
    tile = `#${rank}`;
  } else if (lastSeries && visibleGames(lastRun.round, lastSeries) >= lastSeries.games.length) {
    const won = lastSeries.winnerId === you.id;
    const opp = byId.get(lastSeries.teamAId === you.id ? lastSeries.teamBId : lastSeries.teamAId);
    const [w, l] = lastSeries.teamAId === you.id ? [lastSeries.gamesWonA, lastSeries.gamesWonB] : [lastSeries.gamesWonB, lastSeries.gamesWonA];
    story = won ? `Champions — beat the ${mascot(opp)} ${w}-${l} in the Finals.` : `Out in the ${lastSeries.roundLabel}, ${w}-${l} to the ${mascot(opp)}.`;
    tile = won ? 'Champs' : ROUND_SHORT[lastRun.round];
  } else {
    story = 'The playoffs are under way.';
    tile = '…';
  }
  const champion = playoffs && complete ? byId.get(playoffs.championId) : undefined;
  const finals = finalsSeries;
  const champSeed = finals ? (finals.winnerId === finals.teamAId ? finals.teamASeed : finals.teamBSeed) : 0;
  const finalsLoser = finals ? byId.get(finals.winnerId === finals.teamAId ? finals.teamBId : finals.teamAId) : undefined;

  const regulars = season.players.filter((l) => l.games >= AWARD_MIN_GAMES);
  const a = season.awards;
  return (
    <div className="ss-recap">
      <section className="ss-hero">
        <div className="ss-kicker">Your season</div>
        <div className="ss-hero-grid">
          <div>
            <div className="ss-record">
              {record.wins}-{record.losses}
            </div>
            <div className="ss-team">
              {mark(you.id, 'md')}
              <span>
                {you.name} · {ord(rank)}
              </span>
            </div>
            <p className="ss-story">
              {story}
              {best && ` ${best.span.playerName} led the way — ${f1(per(best, 'pts'))} points a night.`}
            </p>
          </div>
          <div className="ss-kpis">
            <Kpi value={String(Math.round(projected))} label="Projected W" />
            <Kpi value={`${vs >= 0 ? '+' : ''}${vs}`} label="vs projection" tone={vs > 0 ? 'good' : vs < 0 ? 'bad' : undefined} />
            <Kpi value={tile} label="Playoffs" />
          </div>
        </div>
        {champion && finals && (
          <p className="ss-champ">
            🏆 <b>Champion: {champion.name}</b>
            <span>
              {ord(champSeed)} seed · beat the {mascot(finalsLoser)} {Math.max(finals.gamesWonA, finals.gamesWonB)}-{Math.min(finals.gamesWonA, finals.gamesWonB)} in the Finals
              {playoffs?.finalsMvp && ` · Finals MVP ${playoffs.finalsMvp.span.playerName}`}
            </span>
          </p>
        )}
      </section>

      {playoffs && (
        <section className="ss-card">
          <div className="ss-card-head">
            <h3 className="ss-kicker">Playoffs</h3>
            <button type="button" className="ss-link" onClick={() => setView({ kind: 'bracket' })}>
              Full bracket
            </button>
          </div>
          {reveal.mode === 'hidden' ? (
            <div className="ss-actions">
              {madePlayoffs && (
                <button type="button" className="rs-primary" onClick={() => { setReveal({ mode: 'live', round: 0, game: 0 }); setView({ kind: 'watch', round: yourRuns[0].round, series: yourRuns[0].index, game: 0 }); }}>
                  ▶ Watch your playoffs
                </button>
              )}
              <button type="button" className="at-calm-btn" onClick={() => setReveal({ mode: 'all' })}>
                Show the results
              </button>
              <span className="ss-note">{madePlayoffs ? 'Your games play out live, one at a time; the rest of the bracket fills in between them.' : 'The top 8 played on without you.'}</span>
            </div>
          ) : (
            <>
              <div className="ss-series-row">
                {yourRuns
                  .filter((run) => playoffs && visibleGames(run.round, playoffs.rounds[run.round][run.index]) > 0)
                  .map((run) => {
                    const s = playoffs.rounds[run.round][run.index];
                    return (
                      <div key={run.round}>
                        <div className="ss-kicker ss-kicker--small">{s.roundLabel}</div>
                        <SeriesCard s={s} shown={visibleGames(run.round, s)} youId={you.id} byId={byId} mark={mark} onWatch={(g) => setView({ kind: 'watch', round: run.round, series: run.index, game: g })} />
                      </div>
                    );
                  })}
              </div>
              {reveal.mode === 'live' && (
                <div className="ss-actions">
                  {nextGame && (
                    <button type="button" className="rs-primary" onClick={() => setView({ kind: 'watch', ...nextGame })}>
                      ▶ Watch game {nextGame.game + 1}
                    </button>
                  )}
                  {yourSeriesDone && yourSeriesDone.winnerId === you.id && reveal.round + 1 < playoffs.rounds.length && (
                    <button type="button" className="rs-primary" onClick={() => setReveal({ mode: 'live', round: reveal.round + 1, game: 0 })}>
                      On to the {playoffs.rounds[reveal.round + 1][0].roundLabel}
                    </button>
                  )}
                  {!complete && (
                    <button type="button" className="at-calm-btn" onClick={() => setReveal({ mode: 'all' })}>
                      {yourSeriesDone && yourSeriesDone.winnerId !== you.id ? 'Show the rest of the playoffs' : 'Show all results'}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      <div className="ss-two">
        <section className="ss-card">
          <h3 className="ss-kicker">Standings</h3>
          <Standings season={season} byId={byId} youId={you.id} mark={mark} />
        </section>
        <div className="ss-stack">
          <Leaders title="Points" lines={regulars} value={(l) => per(l, 'pts')} youId={you.id} mark={mark} count={3} />
          <Leaders title="Rebounds" lines={regulars} value={(l) => per(l, 'reb')} youId={you.id} mark={mark} count={3} />
          <Leaders title="Assists" lines={regulars} value={(l) => per(l, 'ast')} youId={you.id} mark={mark} count={3} />
          <button type="button" className="at-calm-btn ss-self-start" onClick={() => setView({ kind: 'stats' })}>
            All stats
          </button>
        </div>
      </div>

      <section className="ss-card">
        <h3 className="ss-kicker">Awards</h3>
        <div className="ss-awards">
          {a.mvp && <Award title="Most Valuable Player" line={a.mvp} byId={byId} icon="🏆" />}
          {complete && playoffs?.finalsMvp && <Award title="Finals MVP" line={playoffs.finalsMvp} byId={byId} icon="🏅" />}
          {a.dpoy && <Award title="Defensive Player of the Year" line={a.dpoy} byId={byId} icon="🛡️" sub={`${f1(per(a.dpoy, 'stl'))} stl · ${f1(per(a.dpoy, 'blk'))} blk · ${f1(per(a.dpoy, 'reb'))} reb`} />}
          {a.sixthMan && <Award title="Sixth Man of the Year" line={a.sixthMan} byId={byId} icon="⚡" />}
        </div>
        <h4 className="ss-kicker ss-kicker--small">All-NBA</h4>
        {a.allNba.map((five, i) => (
          <Five key={i} label={['First team', 'Second team', 'Third team'][i]} five={five} youId={you.id} codes={codes} />
        ))}
        <h4 className="ss-kicker ss-kicker--small">All-Defensive</h4>
        {a.allDefense.map((five, i) => (
          <Five key={i} label={['First team', 'Second team'][i]} five={five} youId={you.id} codes={codes} />
        ))}
        <h4 className="ss-kicker ss-kicker--small">All-Stars · {a.allStars.length}</h4>
        <div className="ss-chips">
          {a.allStars.map((l) => (
            <span key={`${l.teamId}${l.span.id}`} className={`ss-chip${l.teamId === you.id ? ' is-you' : ''}`}>
              {l.span.playerName} <small>{codes.get(l.teamId)}</small>
            </span>
          ))}
        </div>
      </section>

      <section className="ss-card">
        <h3 className="ss-kicker">{you.name} · season stats</h3>
        <PlayerTable lines={yourLines} />
      </section>
    </div>
  );
}

function Kpi({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`ss-kpi${tone ? ` is-${tone}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="ss-backbar">
      <button type="button" className="at-calm-btn" onClick={onBack}>
        ← Season
      </button>
      <h2 className="ss-h">{title}</h2>
    </div>
  );
}

function Standings({ season, byId, youId, mark }: { season: LiveSeasonResult; byId: Map<string, Team>; youId: string; mark: (id: string) => ReactElement }) {
  return (
    <table className="ss-table">
      <thead>
        <tr>
          <th>#</th>
          <th className="l">Team</th>
          <th>W-L</th>
          <th>Diff</th>
        </tr>
      </thead>
      <tbody>
        {season.standings.map((r, i) => {
          const diff = (r.pointsFor - r.pointsAgainst) / Math.max(1, r.wins + r.losses);
          return (
            <tr key={r.teamId} className={`${r.teamId === youId ? 'is-you' : ''}${i === 7 ? ' is-cut' : ''}${i > 7 ? ' is-out' : ''}`}>
              <td>{i + 1}</td>
              <td className="l">
                <span className="ss-teamcell">
                  {mark(r.teamId)}
                  {byId.get(r.teamId)?.name}
                </span>
              </td>
              <td className="n">
                {r.wins}-{r.losses}
              </td>
              <td className={`n ${diff >= 0 ? 'is-good' : 'is-bad'}`}>
                {diff >= 0 ? '+' : ''}
                {f1(diff)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Leaders({ title, lines, value, youId, mark, count = 5, fmt = f1 }: { title: string; lines: SeasonPlayerLine[]; value: (l: SeasonPlayerLine) => number; youId: string; mark: (id: string) => ReactElement; count?: number; fmt?: (x: number) => string }) {
  const top = [...lines].sort((x, y) => value(y) - value(x)).slice(0, count);
  return (
    <div className="ss-card ss-leaders">
      <h4 className="ss-kicker ss-kicker--small">{title}</h4>
      {top.map((l, i) => (
        <div key={`${l.teamId}${l.span.id}`} className={`ss-leader${l.teamId === youId ? ' is-you' : ''}`}>
          <span className="ss-leader-i">{i + 1}</span>
          {mark(l.teamId)}
          <span className="ss-leader-n">{l.span.playerName}</span>
          <span className="ss-leader-v">{fmt(value(l))}</span>
        </div>
      ))}
    </div>
  );
}

function Award({ title, line, byId, icon, sub }: { title: string; line: SeasonPlayerLine; byId: Map<string, Team>; icon: string; sub?: string }) {
  return (
    <div className="ss-award">
      <span className="ss-award-icon" aria-hidden>
        {icon}
      </span>
      <div>
        <div className="ss-award-t">{title}</div>
        <div className="ss-award-p">{line.span.playerName}</div>
        <div className="ss-award-s">
          {byId.get(line.teamId)?.name} · {sub ?? `${f1(per(line, 'pts'))} pts · ${f1(per(line, 'reb'))} reb · ${f1(per(line, 'ast'))} ast`}
        </div>
      </div>
    </div>
  );
}

function Five({ label, five, youId, codes }: { label: string; five: SeasonPlayerLine[]; youId: string; codes: Map<string, string> }) {
  return (
    <div className="ss-five-row">
      <div className="ss-five-label">{label}</div>
      <div className="ss-five">
        {five.map((l) => (
          <div key={`${l.teamId}${l.span.id}`} className={l.teamId === youId ? 'is-you' : ''}>
            <small>{l.span.primaryPosition}</small>
            <b>{l.span.playerName}</b>
            <small>
              {codes.get(l.teamId)} · {f1(per(l, 'pts'))}/{f1(per(l, 'reb'))}/{f1(per(l, 'ast'))}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerTable({ lines }: { lines: SeasonPlayerLine[] }) {
  return (
    <div className="ss-table-wrap">
      <table className="ss-table ss-table--stats">
        <thead>
          <tr>
            <th className="l">Player</th>
            <th>G</th>
            <th>MIN</th>
            <th>PTS</th>
            <th>REB</th>
            <th>AST</th>
            <th>STL</th>
            <th>BLK</th>
            <th>FG%</th>
            <th>3P%</th>
            <th>FT%</th>
            <th>TOV</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.span.id}>
              <td className="l">
                <b>{l.span.playerName}</b> <small>{l.span.primaryPosition}{l.starter ? '' : ' · bench'}</small>
              </td>
              <td className="n">{l.games}</td>
              <td className="n">{f1(per(l, 'min'))}</td>
              <td className="n">
                <b>{f1(per(l, 'pts'))}</b>
              </td>
              <td className="n">{f1(per(l, 'reb'))}</td>
              <td className="n">{f1(per(l, 'ast'))}</td>
              <td className="n">{f1(per(l, 'stl'))}</td>
              <td className="n">{f1(per(l, 'blk'))}</td>
              <td className="n">{pct(l.totals.fgm, l.totals.fga)}</td>
              <td className="n">{pct(l.totals.tpm, l.totals.tpa)}</td>
              <td className="n">{pct(l.totals.ftm, l.totals.fta)}</td>
              <td className="n">{f1(per(l, 'tov'))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AllStats({ teams, season, playoffs, youId, mark, onBack }: { teams: Team[]; season: LiveSeasonResult; playoffs: LivePlayoffResult | null; youId: string; mark: (id: string) => ReactElement; onBack: () => void }) {
  const [teamId, setTeamId] = useState(youId);
  const [phase, setPhase] = useState<'season' | 'playoffs'>('season');
  const pool = phase === 'playoffs' && playoffs ? playoffs.players : season.players;
  const lines = pool.filter((l) => l.teamId === teamId).sort((a, b) => b.totals.min - a.totals.min);
  const regulars = phase === 'playoffs' ? pool.filter((l) => l.games >= 4) : pool.filter((l) => l.games >= AWARD_MIN_GAMES);
  const ordered = [...teams].sort((a, b) => (a.id === youId ? -1 : b.id === youId ? 1 : a.name.localeCompare(b.name)));
  return (
    <div>
      <BackBar onBack={onBack} title="Stats" />
      <div className="ss-filters">
        <select className="ss-select" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
          {ordered.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.id === youId ? ' (you)' : ''}
            </option>
          ))}
        </select>
        <div className="at-calm-seg" role="group" aria-label="Season or playoffs">
          <button type="button" className={phase === 'season' ? 'is-on' : ''} onClick={() => setPhase('season')}>
            Regular season
          </button>
          {playoffs && (
            <button type="button" className={phase === 'playoffs' ? 'is-on' : ''} onClick={() => setPhase('playoffs')}>
              Playoffs
            </button>
          )}
        </div>
      </div>
      <section className="ss-card">
        {lines.length ? <PlayerTable lines={lines} /> : <p className="ss-note">No playoff games for this team.</p>}
      </section>
      <h3 className="ss-kicker ss-kicker--gap">League leaders{phase === 'playoffs' ? ' · playoffs' : ''}</h3>
      <div className="ss-grid3">
        <Leaders title="Points" lines={regulars} value={(l) => per(l, 'pts')} youId={youId} mark={mark} />
        <Leaders title="Rebounds" lines={regulars} value={(l) => per(l, 'reb')} youId={youId} mark={mark} />
        <Leaders title="Assists" lines={regulars} value={(l) => per(l, 'ast')} youId={youId} mark={mark} />
        <Leaders title="Steals" lines={regulars} value={(l) => per(l, 'stl')} youId={youId} mark={mark} />
        <Leaders title="Blocks" lines={regulars} value={(l) => per(l, 'blk')} youId={youId} mark={mark} />
        <Leaders title="Threes made" lines={regulars} value={(l) => per(l, 'tpm')} youId={youId} mark={mark} />
      </div>
    </div>
  );
}

function SeriesCard({
  s,
  shown,
  youId,
  byId,
  mark,
  onWatch,
}: {
  s: LivePlayoffSeries;
  shown: number;
  youId: string;
  byId: Map<string, Team>;
  mark: (id: string) => ReactElement;
  onWatch: ((game: number) => void) | null;
}) {
  const games = s.games.slice(0, shown);
  const wa = games.filter((g) => g.final[0] > g.final[1]).length;
  const wb = games.length - wa;
  const decided = shown >= s.games.length;
  const yours = s.teamAId === youId || s.teamBId === youId;
  const row = (id: string, seed: number, w: number, lost: boolean) => (
    <div className={`ss-srow${lost ? ' is-lost' : ''}`}>
      <span className="ss-seed">{seed}</span>
      {mark(id)}
      <span className="ss-sname">
        {mascot(byId.get(id))}
        {id === youId && <span className="ss-you">You</span>}
      </span>
      <b className="ss-wins">{w}</b>
    </div>
  );
  return (
    <div className={`ss-series${yours ? ' is-you' : ''}`}>
      {row(s.teamAId, s.teamASeed, wa, decided && s.winnerId !== s.teamAId)}
      {row(s.teamBId, s.teamBSeed, wb, decided && s.winnerId !== s.teamBId)}
      {games.length > 0 && (
        <div className="ss-games">
          {games.map((g, i) => {
            const youA = s.teamAId === youId;
            const yourWin = yours ? (youA ? g.final[0] > g.final[1] : g.final[1] > g.final[0]) : null;
            const label = `G${i + 1} ${g.final[0]}-${g.final[1]}`;
            return onWatch ? (
              <button key={i} type="button" className={`ss-game is-play${yourWin === null ? '' : yourWin ? ' is-win' : ' is-loss'}`} onClick={() => onWatch(i)} title="Watch this game">
                ▶ {label}
              </button>
            ) : (
              <span key={i} className="ss-game">
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Watch({
  teams,
  codes,
  series,
  gameIndex,
  youId,
  byId,
  onFinish,
  onNext,
  onBack,
}: {
  teams: Team[];
  codes: Map<string, string>;
  series: LivePlayoffSeries;
  gameIndex: number;
  youId: string;
  byId: Map<string, Team>;
  onFinish: () => void;
  onNext: (() => void) | null;
  onBack: () => void;
}) {
  const game = useMemo(() => playLivePlayoffGame(teams, series, gameIndex), [teams, series, gameIndex]);
  const [over, setOver] = useState(false);
  if (!game) return null;
  const before = series.games.slice(0, gameIndex);
  const wa = before.filter((g) => g.final[0] > g.final[1]).length;
  const wb = before.length - wa;
  const a = byId.get(series.teamAId);
  const b = byId.get(series.teamBId);
  const status = wa === wb ? `Series tied ${wa}-${wb}` : `${mascot(wa > wb ? a : b)} lead ${Math.max(wa, wb)}-${Math.min(wa, wb)}`;
  const matchup: LiveMatchup = {
    title: `${series.roundLabel} · Game ${gameIndex + 1}`,
    subtitle: gameIndex === 0 ? `${a?.name} vs ${b?.name}` : status,
    names: [a?.name ?? '', b?.name ?? ''],
    short: [mascot(a), mascot(b)],
    codes: [codes.get(series.teamAId) ?? '', codes.get(series.teamBId) ?? ''],
    yourSide: series.teamBId === youId ? 1 : 0,
  };
  return (
    <div>
      <BackBar onBack={onBack} title="Playoffs" />
      <LiveGame
        game={game}
        matchup={matchup}
        autoStart
        onFinish={() => {
          setOver(true);
          onFinish();
        }}
      />
      <div className="ss-actions">
        {over && onNext && (
          <button type="button" className="rs-primary" onClick={onNext}>
            Next: Game {gameIndex + 2}
          </button>
        )}
        <button type="button" className="at-calm-btn" onClick={onBack}>
          Back to the season
        </button>
      </div>
    </div>
  );
}
