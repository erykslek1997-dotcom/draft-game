import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import type { Team } from '../engine/types';
import {
  engineTeamViews,
  seasonSeed,
  playLivePlayoffGame,
  gameScorePerGame,
  type LivePlayoffResult,
  type LivePlayoffSeries,
  type LiveSeasonResult,
  type SeasonPlayerLine,
  type SimProgress,
} from '../engine/liveSeason';
import { gameWinProbability, seriesWinProbability } from '../engine/matchup';
import { seasonStory, seriesPreview, seriesVerdict } from '../engine/seasonStory';
import { generateRosterInsights, insightContextFor, type RosterInsight } from '../engine/insights';
import { buildTeamFeatureSnapshot } from '../engine/insightMapper';
import { rankTeams } from '../engine/scoring';
import LiveGame, { type LiveMatchup } from './LiveGame';
import { TeamMark } from './ResultsReport';
import { teamNickname } from '../engine/teamNames';
import { matchupHues } from './teamLogoKit';
import { SeasonShareModal } from './SeasonShareModal';
import './BestFive.css';
import { FitName, FitTeam } from './FitName';
import { PlayerRow, RowsLabel } from './PlayerRow';
import { Face } from './ShotChip';
import { OverallTierBadge } from './DraftBoard';

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
const mascot = (team: Team | undefined) => (team ? teamNickname(team.name) : '');
const plural = (n: number, word: string) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;

/**
 * 2026-10-14 (playtest 12: "w sezonie klikam w nazwisko i widzę dokładne dane kim jest, jaki span,
 * kiedy wybrany w drafcie, statystyki sezonu"): any player name in the season opens his card — who
 * he is and which years of his career, where he went in the draft, his season next to the real
 * years' numbers, and his playoffs once they're out.
 */
const PlayerCardContext = createContext<((line: SeasonPlayerLine) => void) | null>(null);

/** A player's name that opens his card (plain text where no card is wired). */
function PlayerName({ line, className, fit = false }: { line: SeasonPlayerLine; className?: string; fit?: boolean }) {
  const open = useContext(PlayerCardContext);
  const name = fit ? <FitName className={className} name={line.span.playerName} /> : <span className={className}>{line.span.playerName}</span>;
  if (!open) return name;
  return (
    <button type="button" className="ss-pname" onClick={() => open(line)} title={`${line.span.playerName} — his card`}>
      {name}
    </button>
  );
}

function SeasonPlayerCard({
  line,
  teams,
  byId,
  mark,
  season,
  playoffs,
  onClose,
}: {
  line: SeasonPlayerLine;
  teams: Team[];
  byId: Map<string, Team>;
  mark: Mark;
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const span = line.span;
  const team = byId.get(line.teamId);
  // Where he went: the draft runs in draft-slot order, snaking every round.
  const order = [...teams].sort((a, b) => a.draftSlot - b.draftSlot);
  const teamIdx = order.findIndex((t) => t.id === line.teamId);
  const round = team ? team.roster.findIndex((p) => p.id === span.id) : -1;
  const pick = teamIdx >= 0 && round >= 0 ? round * order.length + (round % 2 === 0 ? teamIdx : order.length - 1 - teamIdx) + 1 : null;
  const po = playoffs?.players.find((l) => l.teamId === line.teamId && l.span.id === span.id) ?? null;
  const rank = season.players
    .filter((l) => l.games >= AWARD_MIN_GAMES)
    .sort((a, b) => per(b, 'pts') - per(a, 'pts'))
    .findIndex((l) => l === line);
  const statRow = (l: SeasonPlayerLine) => [
    String(l.games),
    f1(per(l, 'min')),
    f1(per(l, 'pts')),
    f1(per(l, 'reb')),
    f1(per(l, 'ast')),
    f1(per(l, 'stl')),
    f1(per(l, 'blk')),
    f1(pct(l.totals.fgm, l.totals.fga)),
    l.totals.tpa ? f1(pct(l.totals.tpm, l.totals.tpa)) : '—',
    l.totals.fta ? f1(pct(l.totals.ftm, l.totals.fta)) : '—',
    f1(per(l, 'tov')),
    f1(per(l, 'pf')),
  ];
  const heads = ['G', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG%', '3P%', 'FT%', 'TOV', 'PF'];
  return (
    <div className="ss-pcard-back" onClick={onClose}>
      <div className="ss-pcard" role="dialog" aria-modal="true" aria-label={span.playerName} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ss-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <div className="ss-pcard-head">
          <Face name={span.playerName} size="md" />
          <div className="ss-pcard-id">
            <h3 className="ss-pcard-name">{span.playerName}</h3>
            <span className="ss-pcard-sub">
              {span.primaryPosition} · {span.spanLabel} <OverallTierBadge span={span} />
            </span>
          </div>
        </div>
        <div className="ss-pcard-facts">
          <span>
            {mark(line.teamId)} {team?.name}
            {team?.isHuman && <span className="ss-you"> You</span>}
          </span>
          {pick !== null && (
            <span>
              Drafted #{pick} · round {round + 1}
            </span>
          )}
          <span>
            {line.starter ? 'Starter' : 'Bench'}
            {rank >= 0 && rank < 30 && ` · ${ord(rank + 1)} in the league in points`}
          </span>
        </div>
        <div className="ss-table-wrap">
          <table className="ss-table ss-pcard-table">
            <thead>
              <tr>
                <th className="l" />
                {heads.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="l">Season</th>
                {statRow(line).map((v, i) => (
                  <td key={i} className="n">
                    {v}
                  </td>
                ))}
              </tr>
              {po && po.games > 0 && (
                <tr>
                  <th className="l">Playoffs</th>
                  {statRow(po).map((v, i) => (
                    <td key={i} className="n">
                      {v}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="ss-note">
          His real {span.spanLabel}: {span.box.ppg.toFixed(1)} pts · {span.box.rpg.toFixed(1)} reb · {span.box.apg.toFixed(1)} ast a game.
        </p>
      </div>
    </div>
  );
}

/** 2026-10-14 (playtest 13: "byłem w stanie wyjść z sezonu i musiałem zrobić wszystko od nowa —
 * albo się zapisuje, albo nie można wyjść"): where you are in the season — the chapter, the tab and
 * how far the playoffs have gone — is kept per season (the same draft always plays the same one),
 * so closing the sheet or reloading the page comes back to the same place. */
interface SeasonProgress {
  chapter: 'season' | 'playoffs';
  tab: Tab;
  reveal: Reveal;
}
const SEASON_PROGRESS_KEY = 'draftverse.seasonProgress.v1';

function readSeasonProgress(seed: string): SeasonProgress | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SEASON_PROGRESS_KEY) ?? 'null') as (SeasonProgress & { seed: string }) | null;
    return saved && saved.seed === seed ? saved : null;
  } catch {
    return null;
  }
}

export default function SeasonView({ teams, codes, state, onClose }: { teams: Team[]; codes: Map<string, string>; state: SeasonState; onClose: () => void }) {
  const seed = useMemo(() => seasonSeed(teams), [teams]);
  const [saved] = useState(() => readSeasonProgress(seed));
  const [chapter, setChapter] = useState<'season' | 'playoffs'>(saved?.chapter ?? 'season');
  const [tab, setTab] = useState<Tab>(saved?.tab ?? 'overview');
  const [reveal, setReveal] = useState<Reveal>(saved?.reveal ?? { kind: 'none' });
  useEffect(() => {
    try {
      window.localStorage.setItem(SEASON_PROGRESS_KEY, JSON.stringify({ seed, chapter, tab, reveal }));
    } catch {
      // Not kept — the season still plays, it just starts over next time.
    }
  }, [seed, chapter, tab, reveal]);
  // A new chapter, tab or playoff step starts at the top of the sheet (playtest 13: "z automatu
  // przesuwać na górę").
  const revealRound = reveal.kind === 'live' ? reveal.round : -1;
  useEffect(() => {
    document.querySelector('.ss-backdrop')?.scrollTo({ top: 0 });
  }, [chapter, tab, reveal.kind, revealRound]);
  // 2026-10-15 (playtest: "jak kliknę poza obszar, to mi zamyka symulację"): the season is a screen
  // of its own now — only its ✕ closes it; Esc steps back inside it (a game to its series).

  return (
    <div className="ss-backdrop">
      <div className={`ss-sheet at-calm${chapter === 'playoffs' ? ' is-playoffs' : ''}`} role="dialog" aria-modal="true" aria-label="Your season">
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
  // What your draft report said (the results screen's cut), for the season story to check.
  const report = useMemo((): RosterInsight[] => {
    const me = rankTeams(teams).find((r) => r.team.isHuman);
    if (!me) return [];
    const ins = generateRosterInsights(buildTeamFeatureSnapshot(me.team), undefined, insightContextFor(me.breakdown, me.rank, teams.length));
    const podium = me.rank <= 3;
    return [...ins.concerns.slice(0, podium ? 1 : 2), ...ins.strengths.slice(0, podium ? 3 : 2)];
  }, [teams]);
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
  const [card, setCard] = useState<SeasonPlayerLine | null>(null);
  const cardView = card && (
    <SeasonPlayerCard line={card} teams={teams} byId={byId} mark={mark} season={season} playoffs={finalsDone ? playoffs : null} onClose={() => setCard(null)} />
  );

  if (chapter === 'playoffs' && playoffs) {
    return (
      <PlayerCardContext.Provider value={setCard}>
      {cardView}
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
      </PlayerCardContext.Provider>
    );
  }

  return (
    <PlayerCardContext.Provider value={setCard}>
    {cardView}
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
      {tab === 'overview' && <Overview season={season} playoffs={playoffs} you={you} rank={rank} byId={byId} views={views} mark={mark} reveal={reveal} onPlayoffs={startPlayoffs} report={report} />}
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
    </PlayerCardContext.Provider>
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
  report,
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
  report: RosterInsight[];
}) {
  const story = seasonStory(season, you.id, report);
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
        {story.length > 0 && <p className="ss-lede ss-story">{story.join(' ')}</p>}
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
          <PlayerName line={l} className="ss-leader-n" fit />
          <span className="ss-leader-v">{fmt(value(l))}</span>
        </div>
      ))}
    </div>
  );
}

type SortKey = 'g' | 'min' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fga' | 'fg' | 'tpa' | 'tp' | 'fta' | 'ft' | 'tov' | 'pf' | 'dd' | 'td' | 'gs';
// `basic`: the columns the table opens with (the user: points, rebounds, assists, FG%, 3P%; then FGA); "More stats" adds the rest.
const COLUMNS: { key: SortKey; label: string; title?: string; basic?: true; value: (l: SeasonPlayerLine) => number; fmt: (l: SeasonPlayerLine) => string }[] = [
  { key: 'g', label: 'G', value: (l) => l.games, fmt: (l) => String(l.games) },
  { key: 'min', label: 'MIN', value: (l) => per(l, 'min'), fmt: (l) => f1(per(l, 'min')) },
  { key: 'pts', label: 'PTS', basic: true, value: (l) => per(l, 'pts'), fmt: (l) => f1(per(l, 'pts')) },
  { key: 'reb', label: 'REB', basic: true, value: (l) => per(l, 'reb'), fmt: (l) => f1(per(l, 'reb')) },
  { key: 'ast', label: 'AST', basic: true, value: (l) => per(l, 'ast'), fmt: (l) => f1(per(l, 'ast')) },
  { key: 'stl', label: 'STL', value: (l) => per(l, 'stl'), fmt: (l) => f1(per(l, 'stl')) },
  { key: 'blk', label: 'BLK', value: (l) => per(l, 'blk'), fmt: (l) => f1(per(l, 'blk')) },
  // 2026-10-14, the user: "brakuje mi możliwości sortowania przez FGA" — attempts per game beside each percentage.
  { key: 'fga', label: 'FGA', title: 'Field goal attempts per game', basic: true, value: (l) => per(l, 'fga'), fmt: (l) => f1(per(l, 'fga')) },
  { key: 'fg', label: 'FG%', basic: true, value: (l) => pct(l.totals.fgm, l.totals.fga), fmt: (l) => f1(pct(l.totals.fgm, l.totals.fga)) },
  // 2026-10-15 (playtest: Gobert's 30.0 3P% read like a real number): the attempts beside the percentage.
  { key: 'tpa', label: '3PA', title: 'Three-point attempts per game', basic: true, value: (l) => per(l, 'tpa'), fmt: (l) => f1(per(l, 'tpa')) },
  { key: 'tp', label: '3P%', basic: true, value: (l) => pct(l.totals.tpm, l.totals.tpa), fmt: (l) => (l.totals.tpa ? f1(pct(l.totals.tpm, l.totals.tpa)) : '—') },
  { key: 'fta', label: 'FTA', title: 'Free throw attempts per game', value: (l) => per(l, 'fta'), fmt: (l) => f1(per(l, 'fta')) },
  { key: 'ft', label: 'FT%', value: (l) => pct(l.totals.ftm, l.totals.fta), fmt: (l) => (l.totals.fta ? f1(pct(l.totals.ftm, l.totals.fta)) : '—') },
  { key: 'tov', label: 'TOV', value: (l) => per(l, 'tov'), fmt: (l) => f1(per(l, 'tov')) },
  // 2026-10-14, the user: "pokaż faule w statystykach".
  { key: 'pf', label: 'PF', title: 'Personal fouls per game', basic: true, value: (l) => per(l, 'pf'), fmt: (l) => f1(per(l, 'pf')) },
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
                  <b>
                    <PlayerName line={l} />
                  </b>{' '}
                  <small>{l.span.primaryPosition}</small>
                </td>
                <td className="l">
                  <span title={teams.find((t) => t.id === l.teamId)?.name}>{mark(l.teamId)}</span>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className={`n${c.key === sort ? ' is-sorted' : ''}${c.key === 'tp' && l.totals.tpa < l.games ? ' is-few' : ''}`} title={c.key === 'tp' && l.totals.tpa < l.games ? `Only ${l.totals.tpa} threes all season` : undefined}>
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
        <div className="ss-award-p">
          <PlayerName line={line} />
        </div>
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
            <b>
              <PlayerName line={l} fit />
            </b>
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
  const watchKey = watching ? `${watching.round}-${watching.series}-${watching.game}` : '';
  useEffect(() => {
    document.querySelector('.ss-backdrop')?.scrollTo({ top: 0 });
  }, [watchKey]);
  // "Sim the series" (2026-10-08, the user: no tension): the games land one after another, a
  // second apart, and a Game 7 gets a beat of its own before it's decided.
  const [simming, setSimming] = useState(false);
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
  const simStep = simming && live && yourSeries && !seriesOver ? live.game : null;
  useEffect(() => {
    if (simStep === null || !live) {
      if (simming && (seriesOver || !live)) setSimming(false);
      return;
    }
    const t = window.setTimeout(() => setReveal({ kind: 'live', round: live.round, game: simStep + 1 }), simStep === 6 ? 1800 : 1000);
    return () => window.clearTimeout(t);
  }, [simStep, simming, seriesOver, live, setReveal]);
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
          season={season}
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
  let hub: ReactElement | null = null;
  // The bracket as this moment shows it: between rounds, the next round's matchups are already set.
  let bracketShown: (round: number, s: LivePlayoffSeries) => number = shown;

  if (all) {
    const youWon = playoffs.championId === youId;
    title = youWon ? byId.get(youId)?.name ?? 'Champions' : `The ${mascot(byId.get(playoffs.championId))} win it all`;
    kicker = youWon ? 'Champions' : 'Playoffs';
  } else if (live && yourSeries && !seriesOver) {
    // 2026-10-14, the playoffs redesign (mockup A, "series hub"; the user: "umiejscowienie elementów
    // w symulacji playoffs jest mało intuicyjne"): the rounds as steps on top, your series as the
    // big card with the next game as the one main button, then the matchup and a small bracket.
    title = yourSeries.roundLabel;
    hub = (
      <SeriesHub
        s={yourSeries}
        round={live.round}
        played={live.game}
        youId={youId}
        season={season}
        rounds={rounds}
        bracket={<Bracket rounds={rounds} shown={bracketShown} youId={youId} byId={byId} codes={codes} mark={mark} onWatch={(r, i, g) => setWatching({ round: r, series: i, game: g })} />}
        byId={byId}
        codes={codes}
        mark={mark}
        simming={simming}
        onPlay={(g) => setWatching({ round: live.round, series: run!.index, game: g })}
        onSim={() => setSimming(true)}
        onSimAll={() => setReveal({ kind: 'all' })}
        onBack={onBack}
      />
    );
  } else if (live && yourSeries && seriesOver) {
    const won = yourSeries.winnerId === youId;
    const opp = oppOf(yourSeries);
    const [wa, wb] = tally(yourSeries, yourSeries.games.length);
    const score = `${Math.max(wa, wb)}-${Math.min(wa, wb)}`;
    bracketShown = (round, s) => (round <= live.round ? s.games.length : 0);
    // One line on how the series went (the old series panel's verdict, now on the screen after it).
    const verdict = seriesVerdict(
      yourSeries.games.map((g) => (yourSeries.teamAId === youId ? g.final : ([g.final[1], g.final[0]] as [number, number]))),
      won,
    );
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
          {verdict && <p className="pl-sub">{verdict}</p>}
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
          {verdict && <p className="pl-sub">{verdict}</p>}
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
          {verdict && <p className="pl-sub">{verdict}</p>}
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

  if (hub) return <div className="pl-stage">{hub}</div>;

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
      {all && <Finale season={season} playoffs={playoffs} youId={youId} byId={byId} codes={codes} mark={mark} yourRuns={yourRuns.map((r) => rounds[r.round][r.index])} seedOf={seedOf} />}
      {/* 2026-10-14, the user: "najpierw powinna być zapowiedź serii, później drabinka" — your
          series first (left on desktop, on top on a phone), the bracket after it. */}
      <div className={panel ? 'pl-split' : ''}>
        {panel}
        <Bracket rounds={rounds} shown={bracketShown} youId={youId} byId={byId} codes={codes} mark={mark} onWatch={(r, i, g) => setWatching({ round: r, series: i, game: g })} />
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

function SeriesHub({
  s,
  round: liveRound,
  played,
  youId,
  season,
  rounds,
  bracket,
  byId,
  codes,
  mark,
  simming,
  onPlay,
  onSim,
  onSimAll,
  onBack,
}: {
  s: LivePlayoffSeries;
  /** The round being played (index into `rounds`); earlier rounds are over, so their results show. */
  round: number;
  played: number;
  youId: string;
  season: LiveSeasonResult;
  rounds: LivePlayoffSeries[][];
  bracket: ReactElement;
  byId: Map<string, Team>;
  codes: Map<string, string>;
  mark: Mark;
  /** Games are landing one by one: the buttons wait. */
  simming: boolean;
  onPlay: (game: number) => void;
  onSim: () => void;
  onSimAll: () => void;
  onBack: () => void;
}) {
  const [phoneTab, setPhoneTab] = useState<'matchup' | 'bracket'>('matchup');
  const yourSide = s.teamAId === youId ? 0 : 1;
  const opp = yourSide === 0 ? s.teamBId : s.teamAId;
  const row = (id: string) => season.standings.find((r) => r.teamId === id)!;
  const seed = (id: string) => season.standings.findIndex((r) => r.teamId === id) + 1;
  const youWon = (g: { final: [number, number] }) => (yourSide === 0 ? g.final[0] > g.final[1] : g.final[1] > g.final[0]);
  const games = s.games.slice(0, played);
  const yw = games.filter(youWon).length;
  const ow = games.length - yw;
  const p = seriesWinProbability(gameWinProbability(yourSide === 0 ? s.margin : -s.margin));
  const top = (id: string) => season.players.filter((l) => l.teamId === id).sort((a, b) => gameScorePerGame(b) - gameScorePerGame(a)).slice(0, 3);
  const [mine, theirs] = [top(youId), top(opp)];
  const preview = seriesPreview(season, youId, opp);
  const code = (id: string) => codes.get(id) ?? '';
  // The card glows in both teams' colours (your side left), as the live game's scoreboard does.
  const [hueYou, hueOpp] = matchupHues(byId.get(youId)?.name ?? '', byId.get(opp)?.name ?? '');
  const heroColors = { '--ph-a': `hsl(${hueYou} 62% 45% / 0.2)`, '--ph-b': `hsl(${hueOpp} 62% 45% / 0.2)` } as CSSProperties;
  const status = simming && played === 6 ? 'Game 7 — winner takes it' : yw === ow ? (played === 0 ? 'Best of seven' : 'Series tied') : yw > ow ? 'You lead the series' : 'You trail the series';
  const side = (id: string, right: boolean, you: boolean) => (
    <div className={`ph-team${right ? ' is-right' : ''}`}>
      {mark(id, 'md')}
      <span className="ph-team-id">
        <span className={`ph-team-tag${you ? ' is-you' : ''}`}>{you ? 'You' : seed(id) === 1 ? 'Top seed' : 'Opponent'}</span>
        <span className="ph-team-name">{byId.get(id)?.name}</span>
        <span className="ph-team-rec">
          #{seed(id)} · {row(id).wins}-{row(id).losses}
        </span>
      </span>
    </div>
  );
  return (
    <>
      <div className="ph-top">
        <button type="button" className="pl-ghost" onClick={onBack}>
          ← Season
        </button>
        <nav className="ph-steps" aria-label="Playoff rounds">
          {rounds.map((round, r) => {
            const yours = round.find((x) => x.teamAId === youId || x.teamBId === youId);
            const label = round[0].roundLabel;
            if (r < liveRound && yours) {
              const o = yours.teamAId === youId ? yours.teamBId : yours.teamAId;
              const [w, l] = yours.teamAId === youId ? [yours.gamesWonA, yours.gamesWonB] : [yours.gamesWonB, yours.gamesWonA];
              return (
                <span key={r} className="ph-step is-done">
                  <span className="ph-step-mark" aria-hidden>
                    ✓
                  </span>{' '}
                  {label} · beat {code(o)} {w}-{l}
                </span>
              );
            }
            return (
              <span key={r} className={`ph-step${r === liveRound ? ' is-now' : ''}`}>
                {r === liveRound ? `● ${label} · now` : label}
              </span>
            );
          })}
        </nav>
        <button type="button" className="ph-link" onClick={onSimAll}>
          Sim to the end
        </button>
      </div>

      <section className="ph-hero" aria-label="Your series" style={heroColors}>
        <div className="ph-score-row">
          {side(youId, false, true)}
          <div className="ph-score">
            <span className="ph-round">{s.roundLabel} · best of 7</span>
            <span className="ph-big">
              {yw} <span className="ph-dash">–</span> {ow}
            </span>
            <span className="ph-status">{status}</span>
          </div>
          {side(opp, true, false)}
        </div>
        <div className="ph-games" role="list" aria-label="Series games">
          {Array.from({ length: 7 }, (_, i) => {
            if (i < played) {
              const g = s.games[i];
              const w = youWon(g);
              const [us, them] = yourSide === 0 ? g.final : [g.final[1], g.final[0]];
              return (
                <button key={i} type="button" role="listitem" className={`ph-game ${w ? 'is-w' : 'is-l'}`} onClick={() => onPlay(i)} title={`Watch game ${i + 1} again`}>
                  <span className="ph-game-n">
                    <span className="ph-long">Game {i + 1} · ▶</span>
                    <span className="ph-short">G{i + 1}</span>
                  </span>
                  <span className="ph-game-s">
                    <b>{w ? 'W' : 'L'}</b>
                    <span className="ph-long">
                      {' '}
                      {us}–{them}
                    </span>
                  </span>
                </button>
              );
            }
            if (i === played) {
              return (
                <div key={i} role="listitem" className="ph-game is-next">
                  <span className="ph-game-n">
                    <span className="ph-long">Game {i + 1}</span>
                    <span className="ph-short">G{i + 1}</span>
                  </span>
                  <span className="ph-game-s">{simming ? 'playing…' : 'next'}</span>
                </div>
              );
            }
            return (
              <div key={i} role="listitem" className="ph-game is-later">
                <span className="ph-game-n">
                  <span className="ph-long">Game {i + 1}</span>
                  <span className="ph-short">G{i + 1}</span>
                </span>
                <span className="ph-game-s">{i >= 4 ? 'if needed' : ''}</span>
              </div>
            );
          })}
        </div>
        <div className="ph-cta-row">
          <button type="button" className="pl-cta ph-cta" onClick={() => onPlay(played)} disabled={simming}>
            ▶ Play game {played + 1}
          </button>
          <button type="button" className="pl-ghost ph-sim" onClick={onSim} disabled={simming}>
            {simming ? `Game ${played + 1}…` : played === 0 ? 'Sim the series' : 'Sim the rest'}
          </button>
          <span className="ph-hint">A game takes about a minute to watch</span>
        </div>
      </section>

      <div className="ph-tabs" role="tablist" aria-label="Series details">
        <button type="button" role="tab" aria-selected={phoneTab === 'matchup'} className={phoneTab === 'matchup' ? 'is-on' : ''} onClick={() => setPhoneTab('matchup')}>
          Matchup
        </button>
        <button type="button" role="tab" aria-selected={phoneTab === 'bracket'} className={phoneTab === 'bracket' ? 'is-on' : ''} onClick={() => setPhoneTab('bracket')}>
          Bracket
        </button>
      </div>
      <div className="ph-below">
        <section className={`ph-card${phoneTab === 'matchup' ? '' : ' is-off-phone'}`} aria-label="The matchup">
          <h3 className="ph-h">The matchup</h3>
          {preview.length > 0 && (
            <div className="ph-edges">
              {preview.map((line, i) => (
                <p key={i} className={`ph-edge ${line.startsWith('Their') ? 'is-them' : 'is-you'}`}>
                  {line}
                </p>
              ))}
            </div>
          )}
          <div className="ph-odds">
            <span>Series odds</span>
            <span className="ph-odds-bar" aria-label={`${Math.round(p * 100)}% to win the series`}>
              <i style={{ width: `${Math.round(p * 100)}%` }} />
            </span>
            <b>{Math.round(p * 100)}%</b>
          </div>
          <div className="ph-duels">
            <div className="ph-duel is-head">
              <span>{byId.get(youId)?.name}</span>
              <span />
              <span>{byId.get(opp)?.name}</span>
            </div>
            {mine.map((l, i) => {
              const o = theirs[i];
              return (
                <div key={l.span.id} className="ph-duel">
                  <span className="ph-pl">
                    <Face name={l.span.playerName} size="sm" />
                    <span className="ph-pl-t">
                      <b>
                        <PlayerName line={l} /> <small>{l.span.primaryPosition}</small>
                      </b>
                      <span>
                        {f1(per(l, 'pts'))} · {f1(per(l, 'reb'))} · {f1(per(l, 'ast'))}
                      </span>
                    </span>
                  </span>
                  <span className="ph-vs">vs</span>
                  {o ? (
                    <span className="ph-pl is-right">
                      <span className="ph-pl-t">
                        <b>
                          <PlayerName line={o} /> <small>{o.span.primaryPosition}</small>
                        </b>
                        <span>
                          {f1(per(o, 'pts'))} · {f1(per(o, 'reb'))} · {f1(per(o, 'ast'))}
                        </span>
                      </span>
                      <Face name={o.span.playerName} size="sm" />
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
            <span className="ph-foot">Season averages · pts · reb · ast</span>
          </div>
        </section>
        <section className={`ph-card ph-bracket${phoneTab === 'bracket' ? '' : ' is-off-phone'}`} aria-label="Bracket">
          <h3 className="ph-h">Bracket</h3>
          {bracket}
        </section>
      </div>
    </>
  );
}

function Finale({
  season,
  playoffs,
  youId,
  byId,
  codes,
  mark,
  yourRuns,
  seedOf,
}: {
  season: LiveSeasonResult;
  codes: Map<string, string>;
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
  // 2026-10-14 (playtest: "po sezonie brakuje kolejnego podsumowania, skład + wynik"): your season
  // in one card — the record, the seed, how far you went, and the roster with its season lines.
  const you = byId.get(youId);
  const record = season.standings.find((r) => r.teamId === youId);
  const lastRun = yourRuns[yourRuns.length - 1];
  const result =
    champ === youId
      ? 'Champions'
      : lastRun
        ? (() => {
            const opp = lastRun.teamAId === youId ? lastRun.teamBId : lastRun.teamAId;
            const [w, l] = lastRun.teamAId === youId ? [lastRun.gamesWonA, lastRun.gamesWonB] : [lastRun.gamesWonB, lastRun.gamesWonA];
            return `Out in the ${lastRun.roundLabel}, ${w}-${l} to the ${mascot(byId.get(opp))}`;
          })()
        : 'Missed the playoffs';
  const roster = you
    ? you.roster
        .map((p) => season.players.find((l) => l.teamId === youId && l.span.id === p.id))
        .filter((l): l is SeasonPlayerLine => Boolean(l))
        .sort((a, b) => per(b, 'min') - per(a, 'min'))
    : [];
  const [sharing, setSharing] = useState(false);
  const awards = (() => {
    const mine = (l: SeasonPlayerLine | null) => (l && l.teamId === youId ? l.span.playerName : null);
    const out: string[] = [];
    const mvp = mine(season.awards.mvp);
    if (mvp) out.push(`MVP ${mvp}`);
    if (fmvp && fmvp.teamId === youId) out.push(`Finals MVP ${fmvp.span.playerName}`);
    const dpoy = mine(season.awards.dpoy);
    if (dpoy) out.push(`DPOY ${dpoy}`);
    const sixth = mine(season.awards.sixthMan);
    if (sixth) out.push(`Sixth Man ${sixth}`);
    season.awards.allNba.forEach((team, i) => {
      team.filter((l) => l.teamId === youId).forEach((l) => out.push(`All-NBA ${ord(i + 1)} ${l.span.playerName.split(' ').slice(-1)[0]}`));
    });
    return out;
  })();
  const shareModal =
    sharing && you && record ? (
      <SeasonShareModal
        onClose={() => setSharing(false)}
        teamName={you.name}
        teamCode={codes.get(youId) ?? ''}
        result={result}
        champion={champ === youId}
        record={`${record.wins}-${record.losses}`}
        seed={`${ord(seedOf(youId))} seed`}
        path={yourRuns.map((r) => {
          const opp = r.teamAId === youId ? r.teamBId : r.teamAId;
          const [w, l] = r.teamAId === youId ? [r.gamesWonA, r.gamesWonB] : [r.gamesWonB, r.gamesWonA];
          return { round: r.roundLabel, opp: codes.get(opp) ?? '', score: `${w}-${l}`, won: r.winnerId === youId };
        })}
        five={roster.slice(0, 5).map((l) => ({ name: l.span.playerName, line: `${f1(per(l, 'pts'))} ppg` }))}
        awards={awards}
      />
    ) : null;
  return (
    <div className="pl-finale">
      {shareModal}
      {you && record && (
        <div className="pl-card ss-summary">
          <div className="pl-label is-gold">Your season</div>
          <div className="ss-summary-head">
            {mark(youId, 'md')}
            <span className="ss-summary-team">{you.name}</span>
            <span className="ss-summary-rec">
              {record.wins}-{record.losses} · {ord(seedOf(youId))} seed
            </span>
            <span className={`ss-summary-result${champ === youId ? ' is-gold' : ''}`}>{result}</span>
            <button type="button" className="pl-cta ss-share-btn" onClick={() => setSharing(true)}>
              Share your season
            </button>
          </div>
          <div className="ss-table-wrap">
            <table className="ss-table">
              <thead>
                <tr>
                  <th className="l">Player</th>
                  <th>G</th>
                  <th>MIN</th>
                  <th>PTS</th>
                  <th>REB</th>
                  <th>AST</th>
                  <th>FG%</th>
                  <th>PF</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((l) => (
                  <tr key={l.span.id}>
                    <td className="l">
                      <b>
                        <PlayerName line={l} />
                      </b>{' '}
                      <small>
                        {l.span.primaryPosition} · {l.span.spanLabel}
                      </small>
                    </td>
                    <td className="n">{l.games}</td>
                    <td className="n">{f1(per(l, 'min'))}</td>
                    <td className="n">
                      <b>{f1(per(l, 'pts'))}</b>
                    </td>
                    <td className="n">{f1(per(l, 'reb'))}</td>
                    <td className="n">{f1(per(l, 'ast'))}</td>
                    <td className="n">{f1(pct(l.totals.fgm, l.totals.fga))}</td>
                    <td className="n">{f1(per(l, 'pf'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
                    <b>
                      <PlayerName line={l} />
                    </b>
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
  season,
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
  season: LiveSeasonResult;
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
  const previous = useMemo(() => (gameIndex > 0 ? playLivePlayoffGame(teams, series, gameIndex - 1) : null), [teams, series, gameIndex]);
  const [over, setOver] = useState(false);
  const [take, setTake] = useState(0);
  const openCard = useContext(PlayerCardContext);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
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
  // Before tip-off (playtest: "brakuje intro przed spotkaniem"): how the last game went.
  const intro = previous
    ? `Game ${gameIndex}: ${mascot(previous.final[0] > previous.final[1] ? a : b)} won ${Math.max(...previous.final)}–${Math.min(...previous.final)} · ${previous.star.name} ${previous.star.line.pts} pts, ${previous.star.line.reb} reb, ${previous.star.line.ast} ast · ${status}`
    : `${series.roundLabel} · ${a?.name} (#${series.teamASeed}) vs ${b?.name} (#${series.teamBSeed})`;
  const nextButton = onNext ? (
    <button type="button" className="sc-btn sc-btn--go" onClick={onNext}>
      ▶ Game {gameIndex + 2}
    </button>
  ) : (
    <button type="button" className="sc-btn sc-btn--go" onClick={onBack}>
      Back to the bracket →
    </button>
  );
  return (
    <div>
      <div className="pl-top">
        <button type="button" className="pl-ghost" onClick={onBack}>
          ← Bracket
        </button>
      </div>
      {/* 2026-10-14, the user: "Watch again zamienić miejscem z next game" — once the final is in,
          the next game (or the way back) takes the top bar's main button; watching it again moves
          down here. */}
      <LiveGame
        key={take}
        game={game}
        matchup={matchup}
        autoStart
        intro={intro}
        onPlayer={
          openCard
            ? (side, span) => {
                const teamId = side === 0 ? series.teamAId : series.teamBId;
                const line = season.players.find((l) => l.teamId === teamId && l.span.id === span.id);
                if (line) openCard(line);
              }
            : undefined
        }
        doneAction={nextButton}
        onFinish={() => {
          setOver(true);
          onFinish();
        }}
      />
      <div className="pl-actions">
        {over && (
          <button type="button" className="pl-cta" onClick={onNext ?? onBack}>
            {onNext ? `▶ Game ${gameIndex + 2}` : 'Back to the bracket →'}
          </button>
        )}
        {over && (
          <button
            type="button"
            className="pl-ghost"
            onClick={() => {
              setOver(false);
              setTake((t) => t + 1);
            }}
          >
            Watch again
          </button>
        )}
        {(onNext || !over) && (
          <button type="button" className="pl-ghost" onClick={onBack}>
            Back to the bracket
          </button>
        )}
      </div>
    </div>
  );
}
