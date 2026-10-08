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
import { gameWinProbability, seriesWinProbability } from '../engine/matchup';
import LiveGame, { type LiveMatchup } from './LiveGame';
import { TeamMark } from './ResultsReport';
import './BestFive.css';
import { FitName, FitTeam } from './FitName';
import { PlayerRow, RowsLabel } from './PlayerRow';

/**
 * 2026-10-08, the user (season simulation): the season after a draft. First the regular season —
 * a hub with Overview, Standings, Stats and Awards ("UI mało ciekawe, mało intuicyjne"; "po season
 * stats przejście do play-offs powinno otwierać nową część zabawy"), then the playoffs as a chapter
 * of their own (mockup A, "drabinka wygląda całkiem based"): the bracket on stage, your series
 * beside it, your games played one by one ("tylko gracz"), a screen between rounds, and the end of
 * your run or the title. The playoffs stay hidden until you play them, so nothing is spoiled.
 */

export type SeasonState =
  | { status: 'running'; progress: SimProgress | null }
  | { status: 'done'; season: LiveSeasonResult; playoffs: LivePlayoffResult | null };

/** How much of the playoffs is out: rounds before `round` in full, `game` games of that round. */
type Reveal = { kind: 'none' } | { kind: 'live'; round: number; game: number } | { kind: 'all' };
type Tab = 'overview' | 'standings' | 'stats' | 'awards';
type Watching = { round: number; series: number; game: number };
type Mark = (id: string, size?: 'sm' | 'md') => ReactElement;
type EngineViews = ReturnType<typeof engineTeamViews>;

const AWARD_MIN_GAMES = 58;
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const per = (l: SeasonPlayerLine, k: keyof SeasonPlayerLine['totals']) => l.totals[k] / Math.max(1, l.games);
const f1 = (x: number) => x.toFixed(1);
const pct = (made: number, att: number) => (att > 0 ? (100 * made) / att : 0);
const mascot = (team: Team | undefined) => team?.name.split(' ').slice(-1)[0] ?? '';
const plural = (n: number, word: string) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;

export default function SeasonView({ teams, codes, state, onClose }: { teams: Team[]; codes: Map<string, string>; state: SeasonState; onClose: () => void }) {
  const [chapter, setChapter] = useState<'season' | 'playoffs'>('season');
  const [tab, setTab] = useState<Tab>('overview');
  const [reveal, setReveal] = useState<Reveal>({ kind: 'none' });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ss-backdrop" onClick={onClose}>
      <div className={`ss-sheet at-calm${chapter === 'playoffs' ? ' is-playoffs' : ''}`} role="dialog" aria-modal="true" aria-label="Your season" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ss-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        {state.status === 'running' ? (
          <Playing progress={state.progress} />
        ) : (
          <SeasonBody
            teams={teams}
            codes={codes}
            season={state.season}
            playoffs={state.playoffs}
            chapter={chapter}
            setChapter={setChapter}
            tab={tab}
            setTab={setTab}
            reveal={reveal}
            setReveal={setReveal}
          />
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

function SeasonBody({
  teams,
  codes,
  season,
  playoffs,
  chapter,
  setChapter,
  tab,
  setTab,
  reveal,
  setReveal,
}: {
  teams: Team[];
  codes: Map<string, string>;
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult | null;
  chapter: 'season' | 'playoffs';
  setChapter: (c: 'season' | 'playoffs') => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  reveal: Reveal;
  setReveal: (r: Reveal) => void;
}) {
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const you = teams.find((t) => t.isHuman) ?? teams[0];
  const views = useMemo(() => engineTeamViews(teams), [teams]);
  const mark: Mark = (id, size = 'sm') => <TeamMark code={codes.get(id) ?? ''} name={byId.get(id)?.name ?? ''} size={size} />;
  const rank = season.standings.findIndex((r) => r.teamId === you.id) + 1;
  const record = season.standings[rank - 1];
  const finalsDone = playoffs !== null && (reveal.kind === 'all' || (reveal.kind === 'live' && reveal.round >= playoffs.rounds.length));
  const startPlayoffs = () => {
    if (reveal.kind === 'none') setReveal({ kind: 'live', round: 0, game: 0 });
    setChapter('playoffs');
  };

  const playoffsLabel = reveal.kind === 'none' ? (rank <= 8 ? 'Start the playoffs →' : 'See the playoffs →') : finalsDone ? 'The playoffs →' : 'Back to the playoffs →';
  // The end of every tab says where to go next (2026-10-08, the user: scrolled to the bottom, no
  // hint what's next): your first-round series, or the bracket you watch from outside.
  const firstSeries = playoffs?.rounds[0].find((x) => x.teamAId === you.id || x.teamBId === you.id);
  const firstOpp = firstSeries ? byId.get(firstSeries.teamAId === you.id ? firstSeries.teamBId : firstSeries.teamAId) : undefined;
  const nextLabel = reveal.kind === 'none' ? (firstOpp ? `Your series vs the ${mascot(firstOpp)} →` : 'See how the playoffs play out →') : playoffsLabel;
  const TABS: Tab[] = ['overview', 'standings', 'stats', 'awards'];
  const nextTab = TABS[TABS.indexOf(tab) + 1];

  if (chapter === 'playoffs' && playoffs) {
    return (
      <PlayoffsChapter
        teams={teams}
        byId={byId}
        codes={codes}
        mark={mark}
        season={season}
        playoffs={playoffs}
        youId={you.id}
        reveal={reveal}
        setReveal={setReveal}
        onBack={() => setChapter('season')}
      />
    );
  }

  return (
    <div className="ss-hub">
      <header className="ss-hub-head">
        {mark(you.id, 'md')}
        <span className="ss-hub-rec">
          {record.wins}-{record.losses}
        </span>
        <span className="ss-hub-name">
          {you.name} · {ord(rank)}
        </span>
        {playoffs && (
          <button type="button" className="pl-cta ss-hub-cta" onClick={startPlayoffs}>
            {playoffsLabel}
          </button>
        )}
      </header>
      <nav className="ss-tabs" aria-label="Season">
        {TABS.map((t) => (
          <button key={t} type="button" className={t === tab ? 'is-on' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <Overview season={season} playoffs={playoffs} you={you} rank={rank} byId={byId} views={views} mark={mark} reveal={reveal} onPlayoffs={startPlayoffs} />}
      {tab === 'standings' && <FullStandings season={season} byId={byId} youId={you.id} views={views} mark={mark} />}
      {tab === 'stats' && <Stats teams={teams} season={season} playoffs={finalsDone ? playoffs : null} youId={you.id} mark={mark} />}
      {tab === 'awards' && <Awards season={season} playoffs={finalsDone ? playoffs : null} byId={byId} youId={you.id} codes={codes} />}
      <footer className="ss-hub-next">
        {nextTab && (
          <button
            type="button"
            className="at-calm-btn"
            onClick={() => {
              setTab(nextTab);
              document.querySelector('.ss-backdrop')?.scrollTo({ top: 0 });
            }}
          >
            Next: {nextTab[0].toUpperCase() + nextTab.slice(1)} →
          </button>
        )}
        {playoffs && (
          <button type="button" className="pl-cta" onClick={startPlayoffs}>
            {nextLabel}
          </button>
        )}
      </footer>
    </div>
  );
}

function Overview({
  season,
  playoffs,
  you,
  rank,
  byId,
  views,
  mark,
  reveal,
  onPlayoffs,
}: {
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult | null;
  you: Team;
  rank: number;
  byId: Map<string, Team>;
  views: EngineViews;
  mark: Mark;
  reveal: Reveal;
  onPlayoffs: () => void;
}) {
  const record = season.standings[rank - 1];
  const eighth = season.standings[7];
  const ninth = season.standings[8];
  const games = Math.max(1, record.wins + record.losses);
  const name = mascot(you);
  const regulars = season.players.filter((l) => l.games >= AWARD_MIN_GAMES);
  const yours = season.players.filter((l) => l.teamId === you.id && l.games >= AWARD_MIN_GAMES / 2);
  const best = [...yours].sort((a, b) => gameScorePerGame(b) - gameScorePerGame(a))[0];
  const projected = views.get(you.id)?.expectedWins ?? record.wins;
  const vs = Math.round(record.wins - projected);
  const diff = (record.pointsFor - record.pointsAgainst) / games;
  const made = rank <= 8;

  const headline =
    rank === 1
      ? `The ${name} own the regular season`
      : rank <= 4
        ? `The ${name} finish ${ord(rank)} and head into the playoffs as a top-four seed`
        : rank <= 7
          ? `The ${name} are in as the ${ord(rank)} seed`
          : rank === 8
            ? `In by a whisker: the ${name} take the last playoff spot`
            : eighth.wins - record.wins <= 2
              ? `So close: the ${name} miss the playoffs by ${plural(Math.max(1, eighth.wins - record.wins), 'game')}`
              : `A long year for the ${name}`;
  // Where your other players rank in the league: the highest board one of them reaches.
  const boards: { label: string; value: (l: SeasonPlayerLine) => number }[] = [
    { label: 'scoring', value: (l) => per(l, 'pts') },
    { label: 'rebounding', value: (l) => per(l, 'reb') },
    { label: 'assists', value: (l) => per(l, 'ast') },
    { label: 'steals', value: (l) => per(l, 'stl') },
    { label: 'blocks', value: (l) => per(l, 'blk') },
  ];
  const standout = boards
    .map((b) => {
      const sorted = [...regulars].sort((x, y) => b.value(y) - b.value(x));
      const i = sorted.findIndex((l) => l.teamId === you.id && l !== best);
      return { ...b, line: sorted[i], place: i + 1 };
    })
    .filter((b) => b.line)
    .sort((a, b) => a.place - b.place)[0];
  const gap = made ? record.wins - ninth.wins : eighth.wins - record.wins;
  const sentence = [
    `${record.wins}-${record.losses}, ${made ? (gap > 0 ? `${plural(gap, 'game')} clear of 9th` : 'level with 9th, in on the tiebreak') : gap > 0 ? `${plural(gap, 'game')} behind 8th` : 'level with 8th, out on the tiebreak'}.`,
    best && `${best.span.playerName} carried the offense with ${f1(per(best, 'pts'))} a night.`,
    standout && standout.place <= 10 && `${standout.line.span.playerName} was ${ord(standout.place)} in the league in ${standout.label}.`,
  ]
    .filter(Boolean)
    .join(' ');
  const firstRound = playoffs?.rounds[0].find((s) => s.teamAId === you.id || s.teamBId === you.id);
  const opp = firstRound ? (firstRound.teamAId === you.id ? firstRound.teamBId : firstRound.teamAId) : null;
  const oppRow = opp ? season.standings.find((r) => r.teamId === opp) : null;
  const oppSeed = opp ? season.standings.findIndex((r) => r.teamId === opp) + 1 : 0;

  return (
    <div className="ss-recap">
      <section>
        <div className="ss-kicker ss-kicker--gold">The season</div>
        <h2 className="ss-headline">{headline}</h2>
        <p className="ss-lede">{sentence}</p>
        <div className="ss-beats">
          {best && (
            <div className="ss-beat">
              <span>Best player</span>
              <b>{best.span.playerName}</b>
              <small>
                {f1(per(best, 'pts'))} pts · {f1(per(best, 'reb'))} reb · {f1(per(best, 'ast'))} ast
              </small>
            </div>
          )}
          <div className="ss-beat">
            <span>vs projection</span>
            <b className={vs > 0 ? 'is-good' : vs < 0 ? 'is-bad' : ''}>
              {vs > 0 ? '+' : ''}
              {plural(vs, 'win')}
            </b>
            <small>Projected {Math.round(projected)} from the draft grade</small>
          </div>
          <div className="ss-beat">
            <span>Point differential</span>
            <b>
              {diff >= 0 ? '+' : ''}
              {f1(diff)}
            </b>
            <small>
              {f1(record.pointsFor / games)} scored · {f1(record.pointsAgainst / games)} allowed
            </small>
          </div>
        </div>
      </section>

      {playoffs && (
        <section className="ss-po-card">
          <div>
            <div className="ss-kicker ss-kicker--gold">Playoffs</div>
            <div className="ss-po-title">{made ? `You're in as the ${ord(rank)} seed` : 'You missed the playoffs'}</div>
            <div className="ss-note">
              {made && oppRow ? `First round: #${oppSeed} ${byId.get(opp ?? '')?.name} (${oppRow.wins}-${oppRow.losses})` : 'The top 8 play on — watch the bracket unfold.'}
            </div>
          </div>
          <button type="button" className="pl-cta" onClick={onPlayoffs}>
            {reveal.kind === 'none' ? (made ? 'Start the playoffs →' : 'See the playoffs →') : 'Back to the playoffs →'}
          </button>
        </section>
      )}

      <div className="ss-two">
        <section className="ss-card">
          <h3 className="ss-kicker">Standings</h3>
          <CompactStandings season={season} byId={byId} youId={you.id} mark={mark} />
        </section>
        <div className="ss-stack">
          <Leaders title="Points" lines={regulars} value={(l) => per(l, 'pts')} youId={you.id} mark={mark} count={3} />
          <Leaders title="Rebounds" lines={regulars} value={(l) => per(l, 'reb')} youId={you.id} mark={mark} count={3} />
          <Leaders title="Assists" lines={regulars} value={(l) => per(l, 'ast')} youId={you.id} mark={mark} count={3} />
        </div>
      </div>
    </div>
  );
}

function CompactStandings({ season, byId, youId, mark }: { season: LiveSeasonResult; byId: Map<string, Team>; youId: string; mark: Mark }) {
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
                  {mascot(byId.get(r.teamId))}
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

function FullStandings({ season, byId, youId, views, mark }: { season: LiveSeasonResult; byId: Map<string, Team>; youId: string; views: EngineViews; mark: Mark }) {
  return (
    <section className="ss-card ss-table-wrap">
      <table className="ss-table">
        <thead>
          <tr>
            <th>#</th>
            <th className="l">Team</th>
            <th>W-L</th>
            <th>PTS</th>
            <th>OPP</th>
            <th>Diff</th>
            <th title="Wins the draft grade expected">Proj W</th>
            <th title="How the season went against the projection">vs proj</th>
          </tr>
        </thead>
        <tbody>
          {season.standings.map((r, i) => {
            const g = Math.max(1, r.wins + r.losses);
            const diff = (r.pointsFor - r.pointsAgainst) / g;
            const proj = views.get(r.teamId)?.expectedWins ?? r.wins;
            const vs = Math.round(r.wins - proj);
            return (
              <tr key={r.teamId} className={`${r.teamId === youId ? 'is-you' : ''}${i === 7 ? ' is-cut' : ''}${i > 7 ? ' is-out' : ''}`}>
                <td>{i + 1}</td>
                <td className="l">
                  <span className="ss-teamcell">
                    {mark(r.teamId)}
                    {byId.get(r.teamId)?.name}
                    {r.teamId === youId && <span className="ss-you">You</span>}
                  </span>
                </td>
                <td className="n">
                  {r.wins}-{r.losses}
                </td>
                <td className="n">{f1(r.pointsFor / g)}</td>
                <td className="n">{f1(r.pointsAgainst / g)}</td>
                <td className={`n ${diff >= 0 ? 'is-good' : 'is-bad'}`}>
                  {diff >= 0 ? '+' : ''}
                  {f1(diff)}
                </td>
                <td className="n">{Math.round(proj)}</td>
                <td className={`n ${vs > 0 ? 'is-good' : vs < 0 ? 'is-bad' : ''}`}>
                  {vs > 0 ? '+' : ''}
                  {vs}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ss-note">Top 8 make the playoffs. Proj W: the wins the draft grade expected.</p>
    </section>
  );
}

function Leaders({ title, lines, value, youId, mark, count = 10, fmt = f1 }: { title: string; lines: SeasonPlayerLine[]; value: (l: SeasonPlayerLine) => number; youId: string; mark: Mark; count?: number; fmt?: (x: number) => string }) {
  const top = [...lines].sort((x, y) => value(y) - value(x)).slice(0, count);
  return (
    <div className="ss-card ss-leaders">
      <h4 className="ss-kicker ss-kicker--small">{title}</h4>
      {top.map((l, i) => (
        <div key={`${l.teamId}${l.span.id}`} className={`ss-leader${l.teamId === youId ? ' is-you' : ''}`}>
          <span className="ss-leader-i">{i + 1}</span>
          {mark(l.teamId)}
          <FitName className="ss-leader-n" name={l.span.playerName} />
          <span className="ss-leader-v">{fmt(value(l))}</span>
        </div>
      ))}
    </div>
  );
}

type SortKey = 'g' | 'min' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg' | 'tp' | 'ft' | 'tov' | 'dd' | 'td' | 'gs';
// `basic`: the five the table opens with (the user: points, rebounds, assists, FG%, 3P%); "More stats" adds the rest.
const COLUMNS: { key: SortKey; label: string; title?: string; basic?: true; value: (l: SeasonPlayerLine) => number; fmt: (l: SeasonPlayerLine) => string }[] = [
  { key: 'g', label: 'G', value: (l) => l.games, fmt: (l) => String(l.games) },
  { key: 'min', label: 'MIN', value: (l) => per(l, 'min'), fmt: (l) => f1(per(l, 'min')) },
  { key: 'pts', label: 'PTS', basic: true, value: (l) => per(l, 'pts'), fmt: (l) => f1(per(l, 'pts')) },
  { key: 'reb', label: 'REB', basic: true, value: (l) => per(l, 'reb'), fmt: (l) => f1(per(l, 'reb')) },
  { key: 'ast', label: 'AST', basic: true, value: (l) => per(l, 'ast'), fmt: (l) => f1(per(l, 'ast')) },
  { key: 'stl', label: 'STL', value: (l) => per(l, 'stl'), fmt: (l) => f1(per(l, 'stl')) },
  { key: 'blk', label: 'BLK', value: (l) => per(l, 'blk'), fmt: (l) => f1(per(l, 'blk')) },
  { key: 'fg', label: 'FG%', basic: true, value: (l) => pct(l.totals.fgm, l.totals.fga), fmt: (l) => f1(pct(l.totals.fgm, l.totals.fga)) },
  { key: 'tp', label: '3P%', basic: true, value: (l) => pct(l.totals.tpm, l.totals.tpa), fmt: (l) => (l.totals.tpa ? f1(pct(l.totals.tpm, l.totals.tpa)) : '—') },
  { key: 'ft', label: 'FT%', value: (l) => pct(l.totals.ftm, l.totals.fta), fmt: (l) => (l.totals.fta ? f1(pct(l.totals.ftm, l.totals.fta)) : '—') },
  { key: 'tov', label: 'TOV', value: (l) => per(l, 'tov'), fmt: (l) => f1(per(l, 'tov')) },
  { key: 'dd', label: 'DD', title: 'Double-doubles', value: (l) => l.doubleDoubles, fmt: (l) => String(l.doubleDoubles) },
  { key: 'td', label: 'TD', title: 'Triple-doubles', value: (l) => l.tripleDoubles, fmt: (l) => String(l.tripleDoubles) },
  { key: 'gs', label: 'GS', title: 'Game score: points, makes, rebounds, assists, steals and blocks against misses and turnovers, per game', value: gameScorePerGame, fmt: (l) => f1(gameScorePerGame(l)) },
];
const ROWS_SHOWN = 20;

function Stats({ teams, season, playoffs, youId, mark }: { teams: Team[]; season: LiveSeasonResult; playoffs: LivePlayoffResult | null; youId: string; mark: Mark }) {
  const [phase, setPhase] = useState<'season' | 'playoffs'>('season');
  const [teamId, setTeamId] = useState<string>('all');
  const [pos, setPos] = useState<'all' | 'G' | 'F' | 'C'>('all');
  const [minGames, setMinGames] = useState(0);
  const [sort, setSort] = useState<SortKey>('pts');
  const [showAll, setShowAll] = useState(false);
  const [moreStats, setMoreStats] = useState(false);
  const [allLeaders, setAllLeaders] = useState(false);
  const playoffPhase = phase === 'playoffs' && playoffs !== null;
  const pool = playoffPhase && playoffs ? playoffs.players : season.players;
  const scale = playoffPhase ? 0.1 : 1;
  const posOf = (l: SeasonPlayerLine) => (l.span.primaryPosition === 'PG' || l.span.primaryPosition === 'SG' ? 'G' : l.span.primaryPosition === 'C' ? 'C' : 'F');
  const col = COLUMNS.find((c) => c.key === sort) ?? COLUMNS[2];
  const rows = pool
    .filter((l) => (teamId === 'all' || l.teamId === teamId) && (pos === 'all' || posOf(l) === pos) && (playoffPhase || l.games >= minGames))
    .sort((a, b) => col.value(b) - col.value(a));
  const shown = showAll ? rows : rows.slice(0, ROWS_SHOWN);
  const columns = moreStats ? COLUMNS : COLUMNS.filter((c) => c.basic);
  // Leader boards: regulars only, and a percentage needs real volume behind it.
  const regulars = pool.filter((l) => l.games >= (playoffPhase ? 4 : AWARD_MIN_GAMES));
  const ordered = [...teams].sort((a, b) => (a.id === youId ? -1 : b.id === youId ? 1 : a.name.localeCompare(b.name)));
  return (
    <div>
      <div className="ss-filters">
        <select className="ss-select" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
          <option value="all">All teams</option>
          {ordered.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.id === youId ? ' (you)' : ''}
            </option>
          ))}
        </select>
        <div className="at-calm-seg" role="group" aria-label="Position">
          {(['all', 'G', 'F', 'C'] as const).map((p) => (
            <button key={p} type="button" className={pos === p ? 'is-on' : ''} onClick={() => setPos(p)}>
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
        {!playoffPhase && (
          <select className="ss-select" value={minGames} onChange={(e) => setMinGames(Number(e.target.value))} aria-label="Minimum games">
            <option value={0}>Any games</option>
            <option value={41}>41+ games</option>
            <option value={58}>58+ games</option>
          </select>
        )}
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
      <section className="ss-card ss-table-wrap">
        <table className="ss-table ss-table--stats">
          <thead>
            <tr>
              <th className="l">Player</th>
              <th className="l">Team</th>
              {columns.map((c) => (
                <th key={c.key} title={c.title}>
                  <button type="button" className={`ss-sort${c.key === sort ? ' is-on' : ''}`} onClick={() => setSort(c.key)}>
                    {c.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={`${l.teamId}${l.span.id}`} className={l.teamId === youId ? 'is-you' : ''}>
                <td className="l">
                  <b>{l.span.playerName}</b> <small>{l.span.primaryPosition}</small>
                </td>
                <td className="l">
                  <span title={teams.find((t) => t.id === l.teamId)?.name}>{mark(l.teamId)}</span>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className={`n${c.key === sort ? ' is-sorted' : ''}`}>
                    {c.fmt(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ss-more">
          <button
            type="button"
            className="at-legend-toggle"
            aria-expanded={moreStats}
            onClick={() => {
              // Back to the five: a sort on a column that goes away falls back to points.
              if (moreStats && !COLUMNS.find((c) => c.key === sort)?.basic) setSort('pts');
              setMoreStats(!moreStats);
            }}
          >
            {moreStats ? 'Fewer stats ▴' : `More stats (${COLUMNS.length - COLUMNS.filter((c) => c.basic).length}) ▾`}
          </button>
          {rows.length > ROWS_SHOWN && (
            <button type="button" className="at-legend-toggle" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Fewer players ▴' : `All ${rows.length} players ▾`}
            </button>
          )}
          <span className="ss-note">Tap a column to sort.</span>
        </div>
      </section>
      <h3 className="ss-kicker ss-kicker--gap">League leaders · top 10{playoffPhase ? ' · playoffs' : ''}</h3>
      <div className="ss-grid3">
        <Leaders title="Points" lines={regulars} value={(l) => per(l, 'pts')} youId={youId} mark={mark} />
        <Leaders title="Rebounds" lines={regulars} value={(l) => per(l, 'reb')} youId={youId} mark={mark} />
        <Leaders title="Assists" lines={regulars} value={(l) => per(l, 'ast')} youId={youId} mark={mark} />
        <Leaders title={`FG% · min. ${Math.round(400 * scale)} FGA`} lines={regulars.filter((l) => l.totals.fga >= 400 * scale)} value={(l) => pct(l.totals.fgm, l.totals.fga)} youId={youId} mark={mark} />
        <Leaders title={`3P% · min. ${Math.round(150 * scale)} 3PA`} lines={regulars.filter((l) => l.totals.tpa >= 150 * scale)} value={(l) => pct(l.totals.tpm, l.totals.tpa)} youId={youId} mark={mark} />
        {allLeaders && (
          <>
            <Leaders title="Steals" lines={regulars} value={(l) => per(l, 'stl')} youId={youId} mark={mark} />
            <Leaders title="Blocks" lines={regulars} value={(l) => per(l, 'blk')} youId={youId} mark={mark} />
            <Leaders title="Threes made" lines={regulars} value={(l) => per(l, 'tpm')} youId={youId} mark={mark} />
            <Leaders title={`FT% · min. ${Math.round(150 * scale)} FTA`} lines={regulars.filter((l) => l.totals.fta >= 150 * scale)} value={(l) => pct(l.totals.ftm, l.totals.fta)} youId={youId} mark={mark} />
            <Leaders title="Minutes" lines={regulars} value={(l) => per(l, 'min')} youId={youId} mark={mark} />
            <Leaders title="Double-doubles" lines={regulars} value={(l) => l.doubleDoubles} youId={youId} mark={mark} fmt={(x) => String(x)} />
            <Leaders title="Game score" lines={regulars} value={gameScorePerGame} youId={youId} mark={mark} />
          </>
        )}
      </div>
      <div className="ss-more">
        <button type="button" className="at-legend-toggle" aria-expanded={allLeaders} onClick={() => setAllLeaders(!allLeaders)}>
          {allLeaders ? 'Fewer leaders ▴' : 'All leaders (12) ▾'}
        </button>
      </div>
    </div>
  );
}

function Awards({ season, playoffs, byId, youId, codes }: { season: LiveSeasonResult; playoffs: LivePlayoffResult | null; byId: Map<string, Team>; youId: string; codes: Map<string, string> }) {
  const a = season.awards;
  return (
    <section className="ss-card">
      <div className="ss-awards">
        {a.mvp && <Award title="Most Valuable Player" line={a.mvp} byId={byId} icon="🏆" />}
        {playoffs?.finalsMvp && <Award title="Finals MVP" line={playoffs.finalsMvp} byId={byId} icon="🏅" />}
        {a.dpoy && <Award title="Defensive Player of the Year" line={a.dpoy} byId={byId} icon="🛡️" sub={`${f1(per(a.dpoy, 'stl'))} stl · ${f1(per(a.dpoy, 'blk'))} blk · ${f1(per(a.dpoy, 'reb'))} reb`} />}
        {a.sixthMan && <Award title="Sixth Man of the Year" line={a.sixthMan} byId={byId} icon="⚡" />}
      </div>
      <h4 className="ss-kicker ss-kicker--small">All-NBA</h4>
      {a.allNba.map((five, i) => (
        <Five key={i} label={['First team', 'Second team', 'Third team'][i]} five={five} youId={youId} codes={codes} />
      ))}
      <h4 className="ss-kicker ss-kicker--small">All-Defensive</h4>
      {a.allDefense.map((five, i) => (
        <Five key={i} label={['First team', 'Second team'][i]} five={five} youId={youId} codes={codes} />
      ))}
      <h4 className="ss-kicker ss-kicker--small">All-Star Game</h4>
      <div className="ss-allstars">
        {allStarTeams(a.allStars).map((team) => (
          <div key={team.captain.span.id} className="ss-card ss-allstar-team">
            <h5 className="ss-allstar-head">Team {team.captain.span.playerName.split(' ').slice(-1)[0]}</h5>
            <RowsLabel>Starters</RowsLabel>
            {team.starters.map((l) => (
              <PlayerRow key={`${l.teamId}${l.span.id}`} size="lead" name={l.span.playerName} meta={`${codes.get(l.teamId) ?? ''} · ${l.span.primaryPosition}${l === team.captain ? ' · captain' : ''}`} value={f1(per(l, 'pts'))} unit="ppg" isYou={l.teamId === youId} />
            ))}
            <RowsLabel>Reserves</RowsLabel>
            {team.reserves.map((l) => (
              <PlayerRow key={`${l.teamId}${l.span.id}`} size="support" name={l.span.playerName} meta={`${codes.get(l.teamId) ?? ''} · ${l.span.primaryPosition}`} value={f1(per(l, 'pts'))} isYou={l.teamId === youId} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** 2026-10-08, the user ("All stars kapitanowie"): the two best All-Stars captain a team each and
 * pick in turns, snake order (A, B, B, A, …), best available first. A captain and his first four
 * picks start; the next seven come off the bench. */
function allStarTeams(stars: SeasonPlayerLine[]): { captain: SeasonPlayerLine; starters: SeasonPlayerLine[]; reserves: SeasonPlayerLine[] }[] {
  if (stars.length < 2) return [];
  const sides: SeasonPlayerLine[][] = [[stars[0]], [stars[1]]];
  stars.slice(2).forEach((l, i) => sides[[0, 1, 1, 0][i % 4]].push(l));
  return sides.map((side) => ({ captain: side[0], starters: side.slice(0, 5), reserves: side.slice(5) }));
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
            <FitName as="b" name={l.span.playerName} />
            <small>
              {codes.get(l.teamId)} · {f1(per(l, 'pts'))}/{f1(per(l, 'reb'))}/{f1(per(l, 'ast'))}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── The playoffs chapter ─────────────────────────────────────────────────────────────────── */

function PlayoffsChapter({
  teams,
  byId,
  codes,
  mark,
  season,
  playoffs,
  youId,
  reveal,
  setReveal,
  onBack,
}: {
  teams: Team[];
  byId: Map<string, Team>;
  codes: Map<string, string>;
  mark: Mark;
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult;
  youId: string;
  reveal: Reveal;
  setReveal: (r: Reveal) => void;
  onBack: () => void;
}) {
  const [watching, setWatching] = useState<Watching | null>(null);
  const rounds = playoffs.rounds;
  const last = rounds.length - 1;
  const isYours = (s: LivePlayoffSeries) => s.teamAId === youId || s.teamBId === youId;
  const yourRuns = rounds.map((r, round) => ({ round, index: r.findIndex(isYours) })).filter((x) => x.index >= 0);
  const live = reveal.kind === 'live' && reveal.round <= last ? reveal : null;
  const all = reveal.kind === 'all' || (reveal.kind === 'live' && reveal.round > last);
  const shown = (round: number, s: LivePlayoffSeries) => (all ? s.games.length : !live ? 0 : round < live.round ? s.games.length : round > live.round ? 0 : Math.min(s.games.length, live.game));
  const run = live ? yourRuns.find((r) => r.round === live.round) : undefined;
  const yourSeries = run ? rounds[run.round][run.index] : null;
  const seriesOver = yourSeries !== null && live !== null && live.game >= yourSeries.games.length;
  const seedOf = (id: string) => season.standings.findIndex((r) => r.teamId === id) + 1;
  const oppOf = (s: LivePlayoffSeries) => (s.teamAId === youId ? s.teamBId : s.teamAId);
  const tally = (s: LivePlayoffSeries, upto: number) => {
    const g = s.games.slice(0, upto);
    const a = g.filter((x) => x.final[0] > x.final[1]).length;
    return [a, g.length - a] as const;
  };

  if (watching) {
    const s = rounds[watching.round][watching.series];
    const isNextUnplayed = live !== null && watching.round === live.round && watching.game === live.game;
    return (
      <div className="pl-stage">
        <Watch
          key={`${watching.round}-${watching.series}-${watching.game}`}
          teams={teams}
          codes={codes}
          series={s}
          gameIndex={watching.game}
          youId={youId}
          byId={byId}
          onFinish={() => {
            if (isNextUnplayed) setReveal({ kind: 'live', round: watching.round, game: watching.game + 1 });
          }}
          onNext={watching.game + 1 < s.games.length ? () => setWatching({ ...watching, game: watching.game + 1 }) : null}
          onBack={() => setWatching(null)}
        />
      </div>
    );
  }

  // What the screen is about right now.
  let title: string;
  let kicker = 'Playoffs';
  let between: ReactElement | null = null;
  let panel: ReactElement | null = null;
  // The bracket as this moment shows it: between rounds, the next round's matchups are already set.
  let bracketShown: (round: number, s: LivePlayoffSeries) => number = shown;

  if (all) {
    const youWon = playoffs.championId === youId;
    title = youWon ? byId.get(youId)?.name ?? 'Champions' : `The ${mascot(byId.get(playoffs.championId))} win it all`;
    kicker = youWon ? 'Champions' : 'Playoffs';
  } else if (live && yourSeries && !seriesOver) {
    const [wa, wb] = tally(yourSeries, live.game);
    const [yw, ow] = yourSeries.teamAId === youId ? [wa, wb] : [wb, wa];
    const opening = live.game === 0 && live.round === 0;
    title = opening ? 'The bracket is set' : yourSeries.roundLabel;
    panel = (
      <SeriesPanel
        s={yourSeries}
        played={live.game}
        youId={youId}
        season={season}
        byId={byId}
        mark={mark}
        status={live.game === 0 ? `${yourSeries.roundLabel} · your series` : yw === ow ? `Series tied ${yw}-${ow}` : yw > ow ? `You lead ${yw}-${ow}` : `You trail ${yw}-${ow}`}
        onPlay={(g) => setWatching({ round: live.round, series: run!.index, game: g })}
        onSim={() => setReveal({ kind: 'live', round: live.round, game: yourSeries.games.length })}
      />
    );
  } else if (live && yourSeries && seriesOver) {
    const won = yourSeries.winnerId === youId;
    const opp = oppOf(yourSeries);
    const [wa, wb] = tally(yourSeries, yourSeries.games.length);
    const score = `${Math.max(wa, wb)}-${Math.min(wa, wb)}`;
    bracketShown = (round, s) => (round <= live.round ? s.games.length : 0);
    if (won && live.round < last) {
      const next = rounds[live.round + 1].find(isYours)!;
      const upset = seedOf(youId) - seedOf(opp) >= 3;
      title = upset ? `#${seedOf(youId)} knocks out #${seedOf(opp)}` : `Into the ${next.roundLabel}`;
      kicker = upset ? 'Upset' : yourSeries.roundLabel;
      between = (
        <div className="pl-between">
          <p className="pl-sub">
            The {byId.get(youId)?.name} beat the {byId.get(opp)?.name} {score}.
          </p>
          <button type="button" className="pl-cta" onClick={() => setReveal({ kind: 'live', round: live.round + 1, game: 0 })}>
            On to the {next.roundLabel}: vs the {mascot(byId.get(oppOf(next)))} →
          </button>
        </div>
      );
    } else if (won) {
      title = 'Champions';
      kicker = 'The Finals';
      between = (
        <div className="pl-between">
          <p className="pl-sub">
            The {byId.get(youId)?.name} beat the {byId.get(opp)?.name} {score}.
          </p>
          <button type="button" className="pl-cta" onClick={() => setReveal({ kind: 'all' })}>
            Lift the trophy →
          </button>
        </div>
      );
    } else {
      title = 'Your run ends here';
      kicker = yourSeries.roundLabel;
      between = (
        <div className="pl-between">
          <p className="pl-sub">
            The {byId.get(opp)?.name} beat you {score}.
          </p>
          <button type="button" className="pl-cta" onClick={() => setReveal({ kind: 'all' })}>
            Watch the rest of the playoffs →
          </button>
        </div>
      );
    }
  } else if (live) {
    // Not (or no longer) in it: the bracket plays round by round.
    const round = rounds[live.round];
    title = live.round === 0 ? 'The bracket is set' : round[0].roundLabel;
    panel = (
      <div className="pl-card">
        <div className="pl-label">{yourRuns.length === 0 ? 'You missed the playoffs' : 'The rest of the bracket'}</div>
        <p className="pl-sub">The top 8 play on. Sim the bracket a round at a time.</p>
        <div className="pl-actions">
          <button type="button" className="pl-cta" onClick={() => setReveal(live.round >= last ? { kind: 'all' } : { kind: 'live', round: live.round + 1, game: 0 })}>
            Sim the {round[0].roundLabel} →
          </button>
          <button type="button" className="pl-ghost" onClick={() => setReveal({ kind: 'all' })}>
            Sim to the end
          </button>
        </div>
      </div>
    );
  } else {
    title = 'Playoffs';
  }

  return (
    <div className="pl-stage">
      <div className="pl-top">
        <button type="button" className="pl-ghost" onClick={onBack}>
          ← Season
        </button>
      </div>
      <div className={`pl-head${between || all ? ' is-splash' : ''}`}>
        {all && <div className="pl-trophy" aria-hidden>🏆</div>}
        <div className="pl-word">{kicker}</div>
        <h2 className="pl-title">{title}</h2>
        {live && live.round === 0 && live.game === 0 && yourSeries && <p className="pl-sub">8 teams, best of seven. Your games are yours to play; the rest of the bracket plays alongside.</p>}
      </div>
      {between}
      {all && <Finale playoffs={playoffs} youId={youId} byId={byId} mark={mark} yourRuns={yourRuns.map((r) => rounds[r.round][r.index])} seedOf={seedOf} />}
      <div className={panel ? 'pl-split' : ''}>
        <Bracket rounds={rounds} shown={bracketShown} youId={youId} byId={byId} codes={codes} mark={mark} onWatch={(r, i, g) => setWatching({ round: r, series: i, game: g })} />
        {panel}
      </div>
    </div>
  );
}

function Bracket({
  rounds,
  shown,
  youId,
  byId,
  codes,
  mark,
  onWatch,
}: {
  rounds: LivePlayoffSeries[][];
  shown: (round: number, s: LivePlayoffSeries) => number;
  youId: string;
  byId: Map<string, Team>;
  codes: Map<string, string>;
  mark: Mark;
  onWatch: (round: number, series: number, game: number) => void;
}) {
  // A round shows its matchups once the round before it is complete on the page.
  const known = (round: number) => round === 0 || rounds[round - 1].every((s) => shown(round - 1, s) >= s.games.length);
  return (
    <div className="pl-bracket">
      {rounds.map((round, r) => (
        <div key={r} className="pl-col">
          <div className="pl-label">{round[0].roundLabel}</div>
          <div className="pl-col-in">
            {round.map((s, i) =>
              known(r) ? (
                <BracketSeries key={i} s={s} shown={Math.min(s.games.length, shown(r, s))} youId={youId} byId={byId} codes={codes} mark={mark} onWatch={s.teamAId === youId || s.teamBId === youId ? (g) => onWatch(r, i, g) : null} />
              ) : (
                <div key={i} className="pl-tbd">
                  TBD
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function BracketSeries({ s, shown, youId, byId, codes, mark, onWatch }: { s: LivePlayoffSeries; shown: number; youId: string; byId: Map<string, Team>; codes: Map<string, string>; mark: Mark; onWatch: ((game: number) => void) | null }) {
  const games = s.games.slice(0, shown);
  const wa = games.filter((g) => g.final[0] > g.final[1]).length;
  const wb = games.length - wa;
  const done = shown >= s.games.length;
  const row = (id: string, seed: number, w: number, out: boolean) => (
    <div className={`pl-row${out ? ' is-out' : ''}`}>
      <span className="pl-seed">{seed}</span>
      {mark(id)}
      <FitTeam className="pl-name" name={byId.get(id)?.name ?? ''} code={codes.get(id)} mascotFirst after={id === youId && <span className="ss-you">You</span>} />
      <b className="pl-w">{w}</b>
    </div>
  );
  return (
    <div className={`pl-series${s.teamAId === youId || s.teamBId === youId ? ' is-you' : ''}`}>
      {row(s.teamAId, s.teamASeed, wa, done && s.winnerId !== s.teamAId)}
      {row(s.teamBId, s.teamBSeed, wb, done && s.winnerId !== s.teamBId)}
      {onWatch && games.length > 0 && (
        <div className="pl-replays">
          {games.map((g, i) => (
            <button key={i} type="button" className="pl-replay" onClick={() => onWatch(i)} title={`Watch game ${i + 1} again`}>
              ▶ G{i + 1} {g.final[0]}-{g.final[1]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SeriesPanel({
  s,
  played,
  youId,
  season,
  byId,
  mark,
  status,
  onPlay,
  onSim,
}: {
  s: LivePlayoffSeries;
  played: number;
  youId: string;
  season: LiveSeasonResult;
  byId: Map<string, Team>;
  mark: Mark;
  status: string;
  onPlay: (game: number) => void;
  onSim: () => void;
}) {
  const yourSide = s.teamAId === youId ? 0 : 1;
  const opp = yourSide === 0 ? s.teamBId : s.teamAId;
  const row = (id: string) => season.standings.find((r) => r.teamId === id)!;
  const seed = (id: string) => season.standings.findIndex((r) => r.teamId === id) + 1;
  const pg = (id: string) => row(id).pointsFor / Math.max(1, row(id).wins + row(id).losses);
  const og = (id: string) => row(id).pointsAgainst / Math.max(1, row(id).wins + row(id).losses);
  const p = seriesWinProbability(gameWinProbability(yourSide === 0 ? s.margin : -s.margin));
  const top = (id: string) => season.players.filter((l) => l.teamId === id).sort((a, b) => gameScorePerGame(b) - gameScorePerGame(a)).slice(0, 3);
  const tape = (label: string, a: number, b: number, higher: boolean) => (
    <>
      <span className={`pl-t-l${(higher ? a > b : a < b) ? ' is-better' : ''}`}>{f1(a)}</span>
      <span className="pl-t-c">{label}</span>
      <span className={`pl-t-r${(higher ? b > a : b < a) ? ' is-better' : ''}`}>{f1(b)}</span>
    </>
  );
  const side = (id: string, right: boolean) => (
    <div className={`pl-vs-side${right ? ' is-right' : ''}`}>
      {mark(id, 'md')}
      <span className="pl-vs-seed">
        #{seed(id)} · {row(id).wins}-{row(id).losses}
      </span>
      <span className="pl-vs-name">{byId.get(id)?.name}</span>
    </div>
  );
  return (
    <div className="pl-card is-gold">
      <div className="pl-label is-gold">{status}</div>
      <div className="pl-vs">
        {side(youId, false)}
        <span className="pl-vs-mid">vs</span>
        {side(opp, true)}
      </div>
      <div className="pl-tape">
        {tape('Points', pg(youId), pg(opp), true)}
        {tape('Allowed', og(youId), og(opp), false)}
        {tape('Diff', pg(youId) - og(youId), pg(opp) - og(opp), true)}
      </div>
      <div className="pl-odds" aria-label={`${Math.round(p * 100)}% to win the series`}>
        <i style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
      <div className="pl-odds-l">
        <span>{Math.round(p * 100)}% to win the series</span>
        <span>{100 - Math.round(p * 100)}%</span>
      </div>
      <div className="pl-keys">
        {[youId, opp].map((id) => (
          <div key={id}>
            {top(id).map((l) => (
              <PlayerRow key={l.span.id} size="support" name={l.span.playerName} meta={`${l.span.primaryPosition} · ${f1(per(l, 'pts'))} / ${f1(per(l, 'reb'))} / ${f1(per(l, 'ast'))}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="pl-tracker" aria-label="Series games">
        {Array.from({ length: 7 }, (_, i) => {
          if (i < played) {
            const g = s.games[i];
            const won = yourSide === 0 ? g.final[0] > g.final[1] : g.final[1] > g.final[0];
            return (
              <button key={i} type="button" className={won ? 'is-w' : 'is-l'} onClick={() => onPlay(i)} title={`Game ${i + 1}: ${g.final[0]}-${g.final[1]} — watch again`}>
                G{i + 1}
              </button>
            );
          }
          return (
            <span key={i} className={i === played ? 'is-next' : ''}>
              G{i + 1}
            </span>
          );
        })}
      </div>
      <div className="pl-actions">
        <button type="button" className="pl-cta" onClick={() => onPlay(played)}>
          ▶ Play game {played + 1}
        </button>
        <button type="button" className="pl-ghost" onClick={onSim}>
          {played === 0 ? 'Sim the series' : 'Sim the rest'}
        </button>
      </div>
    </div>
  );
}

function Finale({
  playoffs,
  youId,
  byId,
  mark,
  yourRuns,
  seedOf,
}: {
  playoffs: LivePlayoffResult;
  youId: string;
  byId: Map<string, Team>;
  mark: Mark;
  yourRuns: LivePlayoffSeries[];
  seedOf: (id: string) => number;
}) {
  const champ = playoffs.championId;
  const fmvp = playoffs.finalsMvp;
  const finals = playoffs.rounds[playoffs.rounds.length - 1][0];
  const loser = finals.winnerId === finals.teamAId ? finals.teamBId : finals.teamAId;
  const fscore = `${Math.max(finals.gamesWonA, finals.gamesWonB)}-${Math.min(finals.gamesWonA, finals.gamesWonB)}`;
  const focus = yourRuns.length ? youId : champ;
  const runLines = playoffs.players.filter((l) => l.teamId === focus).sort((a, b) => b.totals.pts - a.totals.pts).slice(0, 6);
  return (
    <div className="pl-finale">
      <p className="pl-sub">
        {byId.get(champ)?.name} ({ord(seedOf(champ))} seed) beat the {byId.get(loser)?.name} {fscore} in the Finals
        {fmvp && ` · Finals MVP ${fmvp.span.playerName}`}
      </p>
      {yourRuns.length > 0 && (
        <div className="pl-path">
          {yourRuns.map((s) => {
            const opp = s.teamAId === youId ? s.teamBId : s.teamAId;
            const [w, l] = s.teamAId === youId ? [s.gamesWonA, s.gamesWonB] : [s.gamesWonB, s.gamesWonA];
            return (
              <div key={s.round} className={`pl-card${s.winnerId === youId ? '' : ' is-lost'}`}>
                <div className="pl-label is-gold">{s.roundLabel}</div>
                <div className="pl-path-opp">
                  {mark(opp)} {byId.get(opp)?.name}
                </div>
                <b className="pl-path-score">
                  {w}-{l}
                </b>
              </div>
            );
          })}
        </div>
      )}
      <div className="pl-card">
        <div className="pl-label">{yourRuns.length ? 'Your playoff run' : `${byId.get(champ)?.name} in the playoffs`}</div>
        <div className="ss-table-wrap">
          <table className="ss-table">
            <thead>
              <tr>
                <th className="l">Player</th>
                <th>G</th>
                <th>PTS</th>
                <th>REB</th>
                <th>AST</th>
                <th>FG%</th>
              </tr>
            </thead>
            <tbody>
              {runLines.map((l) => (
                <tr key={l.span.id}>
                  <td className="l">
                    <b>{l.span.playerName}</b>
                  </td>
                  <td className="n">{l.games}</td>
                  <td className="n">
                    <b>{f1(per(l, 'pts'))}</b>
                  </td>
                  <td className="n">{f1(per(l, 'reb'))}</td>
                  <td className="n">{f1(per(l, 'ast'))}</td>
                  <td className="n">{f1(pct(l.totals.fgm, l.totals.fga))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
      <div className="pl-top">
        <button type="button" className="pl-ghost" onClick={onBack}>
          ← Bracket
        </button>
      </div>
      <LiveGame
        game={game}
        matchup={matchup}
        autoStart
        autoPlay
        onFinish={() => {
          setOver(true);
          onFinish();
        }}
      />
      <div className="pl-actions">
        {over && onNext && (
          <button type="button" className="pl-cta" onClick={onNext}>
            ▶ Game {gameIndex + 2}
          </button>
        )}
        <button type="button" className="pl-ghost" onClick={onBack}>
          Back to the bracket
        </button>
      </div>
    </div>
  );
}
