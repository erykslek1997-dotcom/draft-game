import { Fragment, createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Team } from '../engine/types';
import type { PlayerSpan } from '../data/schema';
import {
  engineTeamViews,
  seasonSeed,
  playLiveAllStarGame,
  playLivePlayInGame,
  playLivePlayoffGame,
  playLiveSeasonGame,
  gameScorePerGame,
  playoffLinesShown,
  seasonLinesThrough,
  type LivePlayInGame,
  type LivePlayoffResult,
  type LiveSeasonGame,
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
import { teamNickname } from '../engine/teamNames';
import { overallTierForSpan } from '../engine/grades';
import { tierContextWithSixthMan } from '../engine/sixthMan';
import LiveGameNight from '../night/LiveGameNight';
import { LeagueMark } from '../night/league';
import { Actions, Btn, Dialog, H3, Mast, NFace, NightGame, Prompt, SubNote, Tally, cx } from '../night/ui';
import { ShareNight, type PosterData } from '../night/Share';
import { AllStarBreak, AllStarDraft, CalendarDay, MonthBreak, SeasonExtras, dateLabel, monthOf, standingsAt, teamGames } from './SeasonCalendar';

/**
 * 2026-10-08, the user (season simulation): the season after a draft. First the regular season —
 * Overview, Standings, Stats and Awards — then the playoffs as a chapter of their own: the bracket,
 * your series with the next game as the one main button, a screen between rounds, and the end of
 * your run or the title. The playoffs stay hidden until you play them, so nothing is spoiled.
 * 2026-10-21, the night edition (mockup `alltime.html` #season #stats #awards #playoffs #series
 * #finale #finaleOut #liveGame #pcard #share): one aside with the season's record and its pages.
 */

export type SeasonState =
  | { status: 'running'; progress: SimProgress | null }
  | { status: 'done'; season: LiveSeasonResult; playoffs: LivePlayoffResult | null };

/** How much of the playoffs is out: rounds before `round` in full, `game` games of that round. */
type Reveal = { kind: 'none' } | { kind: 'live'; round: number; game: number } | { kind: 'all' };
/** How many games of a series this moment of the playoffs has shown. */
const shownBy = (reveal: Reveal, last: number) => (round: number, s: LivePlayoffSeries) => {
  if (reveal.kind === 'all' || (reveal.kind === 'live' && reveal.round > last)) return s.games.length;
  if (reveal.kind !== 'live') return 0;
  return round < reveal.round ? s.games.length : round > reveal.round ? 0 : Math.min(s.games.length, reveal.game);
};
type Tab = 'overview' | 'standings' | 'stats' | 'awards';
type Chapter = 'calendar' | 'season' | 'playoffs';
type Watching = { round: number; series: number; game: number };

const AWARD_MIN_GAMES = 58;
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const ORD_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth'];
const per = (l: SeasonPlayerLine, k: keyof SeasonPlayerLine['totals']) => l.totals[k] / Math.max(1, l.games);
const f1 = (x: number) => x.toFixed(1);
const pct = (made: number, att: number) => (att > 0 ? (100 * made) / att : 0);
/** A shooting percentage, or "—" on too few tries to mean anything (playtest 2026-10-22: Shaq's
 * 50.0 3P% on two threes). */
const MIN_TRIES = 10;
const pctOr = (made: number, att: number) => (att >= MIN_TRIES ? f1(pct(made, att)) : '—');
const mascot = (team: Team | undefined) => (team ? teamNickname(team.name) : '');
const plural = (n: number, word: string) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
const lastName = (n: string) => n.split(' ').slice(-1)[0];
const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

/** A first name that hides on a phone (`.fn`), then the last name. */
function TwoPart({ name }: { name: string }) {
  const i = name.indexOf(' ');
  if (i < 0) return <>{name}</>;
  return (
    <>
      <span className="fn">{name.slice(0, i)} </span>
      {name.slice(i + 1)}
    </>
  );
}

/**
 * 2026-10-14 (playtest 12): any player name in the season opens his card — who he is and which
 * years of his career, where he went in the draft, his season next to the real years' numbers, and
 * his playoffs once they're out.
 */
const PlayerCardContext = createContext<((line: SeasonPlayerLine) => void) | null>(null);

function PlayerName({ line, children }: { line: SeasonPlayerLine; children?: ReactNode }) {
  const open = useContext(PlayerCardContext);
  const label = children ?? line.span.playerName;
  if (!open) return <>{label}</>;
  return (
    <button type="button" className="pn" onClick={() => open(line)} title={`${line.span.playerName}: his card`}>
      {label}
    </button>
  );
}

function SeasonPlayerCard({
  line,
  teams,
  byId,
  codes,
  season,
  playoffs,
  onClose,
}: {
  line: SeasonPlayerLine;
  teams: Team[];
  byId: Map<string, Team>;
  codes: Map<string, string>;
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult | null;
  onClose: () => void;
}) {
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
    pctOr(l.totals.tpm, l.totals.tpa),
    pctOr(l.totals.ftm, l.totals.fta),
    f1(per(l, 'tov')),
    f1(per(l, 'pf')),
  ];
  const heads = ['G', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG%', '3P%', 'FT%', 'TOV', 'PF'];
  return (
    <Dialog title={null} onClose={onClose} className="pcard">
      <div className="pc-head">
        <NFace name={span.playerName} />
        <div>
          <h2>{span.playerName}</h2>
          <small>
            {span.primaryPosition} · {span.spanLabel} · {overallTierForSpan(tierContextWithSixthMan(span))}
          </small>
        </div>
      </div>
      <div className="pc-facts">
        <span>
          {team && <LeagueMark name={team.name} code={codes.get(team.id) ?? ''} />} <b>{team?.name}</b>
        </span>
        {pick !== null && (
          <span>
            Drafted <b>#{pick}</b> · round {round + 1}
          </span>
        )}
        <span>
          {line.starter ? 'Starter' : 'Bench'}
          {rank >= 0 && rank < 30 && (
            <>
              {' '}
              · <b>{ord(rank + 1)}</b> in the league in points
            </>
          )}
        </span>
      </div>
      <div className="pc-wrap">
        <table className="pc-t">
          <thead>
            <tr>
              <th />
              {heads.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Season</td>
              {statRow(line).map((v, i) => (
                <td key={i} className={i === 2 ? 'k' : undefined}>
                  {v}
                </td>
              ))}
            </tr>
            {po && po.games > 0 && (
              <tr>
                <td>Playoffs</td>
                {statRow(po).map((v, i) => (
                  <td key={i} className={i === 2 ? 'k' : undefined}>
                    {v}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="pc-real">
        His real {span.spanLabel}:{' '}
        <b>
          {span.box.ppg.toFixed(1)} pts · {span.box.rpg.toFixed(1)} reb · {span.box.apg.toFixed(1)} ast
        </b>{' '}
        a game.
      </p>
    </Dialog>
  );
}

/** 2026-10-14 (playtest 13): where you are in the season — the chapter, the tab and how far the
 * playoffs have gone — is kept per season (the same draft always plays the same one), so leaving
 * or reloading comes back to the same place. */
interface SeasonProgress {
  chapter: Chapter;
  tab: Tab;
  reveal: Reveal;
  /** The calendar: nights played, the breaks already seen, breaks off. */
  day?: number;
  seen?: string[];
  noBreaks?: boolean;
  playInDone?: boolean;
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

/** What the end of the season offers besides sharing (playtest 2026-10-22: only a small "← Menu",
 * which went back to the results). */
export interface SeasonEnd {
  onNewDraft?: () => void;
  onMenu: () => void;
}

export default function SeasonView({ teams, codes, state, onClose, end }: { teams: Team[]; codes: Map<string, string>; state: SeasonState; onClose: () => void; end?: SeasonEnd }) {
  const seed = useMemo(() => seasonSeed(teams), [teams]);
  const [saved] = useState(() => readSeasonProgress(seed));
  const [chapter, setChapter] = useState<Chapter>(saved?.chapter ?? 'calendar');
  const [tab, setTab] = useState<Tab>(saved?.tab ?? 'overview');
  const [reveal, setReveal] = useState<Reveal>(saved?.reveal ?? { kind: 'none' });
  const [day, setDay] = useState(saved?.day ?? 0);
  const [seen, setSeen] = useState<string[]>(saved?.seen ?? []);
  const [noBreaks, setNoBreaks] = useState(saved?.noBreaks ?? false);
  const [playInDone, setPlayInDone] = useState(saved?.playInDone ?? false);
  useEffect(() => {
    try {
      window.localStorage.setItem(SEASON_PROGRESS_KEY, JSON.stringify({ seed, chapter, tab, reveal, day, seen, noBreaks, playInDone }));
    } catch {
      // Not kept — the season still plays, it just starts over next time.
    }
  }, [seed, chapter, tab, reveal, day, seen, noBreaks, playInDone]);
  // A new chapter, tab or playoff step starts at the top (playtest 13: "z automatu przesuwać na górę").
  const revealRound = reveal.kind === 'live' ? reveal.round : -1;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [chapter, tab, reveal.kind, revealRound]);

  if (state.status === 'running') return <Playing progress={state.progress} onClose={onClose} />;
  return (
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
      onClose={onClose}
      end={end}
      calendar={{ day, setDay, seen, setSeen, noBreaks, setNoBreaks, playInDone, setPlayInDone }}
    />
  );
}

interface CalendarState {
  day: number;
  setDay: (d: number | ((d: number) => number)) => void;
  seen: string[];
  setSeen: (s: string[]) => void;
  noBreaks: boolean;
  setNoBreaks: (v: boolean) => void;
  playInDone: boolean;
  setPlayInDone: (v: boolean) => void;
}

function Playing({ progress, onClose }: { progress: SimProgress | null; onClose: () => void }) {
  const share = progress ? progress.played / Math.max(1, progress.total) : 0;
  return (
    <NightGame
      aside={
        <>
          <Mast title="Your Season" sub={progress ? `${progress.played} of ${progress.total} games · simulating` : 'Tip-off · simulating'} />
          <div className="sprog keep">
            <i style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <Actions links={{ onMenu: onClose }} />
        </>
      }
    >
      <Prompt eb="Regular season · live" title="Playing the season…" now>
        82 games for every team, each one played on the game engine. Then the top eight play the playoffs.
      </Prompt>
    </NightGame>
  );
}

/** Your team's per-game leaders in one stat. */
function teamLeader(lines: SeasonPlayerLine[], key: keyof SeasonPlayerLine['totals']): SeasonPlayerLine | undefined {
  return [...lines].filter((l) => l.games >= 20).sort((a, b) => per(b, key) - per(a, key))[0];
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
  onClose,
  end,
  calendar,
}: {
  teams: Team[];
  codes: Map<string, string>;
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult | null;
  chapter: Chapter;
  setChapter: (c: Chapter) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  reveal: Reveal;
  setReveal: (r: Reveal) => void;
  onClose: () => void;
  end?: SeasonEnd;
  calendar: CalendarState;
}) {
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const spans = useMemo(() => new Map(teams.flatMap((t) => t.roster.map((p) => [p.id, p] as const))), [teams]);
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
  const mark = (id: string) => <LeagueMark name={byId.get(id)?.name ?? ''} code={codes.get(id) ?? ''} />;
  const rank = season.standings.findIndex((r) => r.teamId === you.id) + 1;
  const record = season.standings[rank - 1];
  const finalsDone = playoffs !== null && (reveal.kind === 'all' || (reveal.kind === 'live' && reveal.round >= playoffs.rounds.length));
  // The playoffs so far (playtest 2026-10-22): the games shown, nothing still to come.
  const playoffsSoFar = useMemo(
    () => (playoffs && !finalsDone && reveal.kind === 'live' ? { ...playoffs, players: playoffLinesShown(playoffs, shownBy(reveal, playoffs.rounds.length - 1)) } : null),
    [playoffs, finalsDone, reveal],
  );
  const [card, setCard] = useState<SeasonPlayerLine | null>(null);
  const [sharing, setSharing] = useState(false);
  const startPlayoffs = () => {
    if (reveal.kind === 'none') setReveal({ kind: 'live', round: 0, game: 0 });
    setChapter('playoffs');
  };
  const yourLines = season.players.filter((l) => l.teamId === you.id);
  const seedOf = (id: string) => season.standings.findIndex((r) => r.teamId === id) + 1;
  const rounds = playoffs?.rounds ?? [];
  const yourRuns = rounds.flatMap((r) => r.filter((x) => x.teamAId === you.id || x.teamBId === you.id));
  const lastRun = yourRuns[yourRuns.length - 1];
  const champ = playoffs?.championId;
  const runWL = (s: LivePlayoffSeries) => (s.teamAId === you.id ? [s.gamesWonA, s.gamesWonB] : [s.gamesWonB, s.gamesWonA]);
  const poW = yourRuns.reduce((n, s) => n + runWL(s)[0], 0);
  const poL = yourRuns.reduce((n, s) => n + runWL(s)[1], 0);
  const result = !finalsDone
    ? null
    : champ === you.id
      ? 'Champions'
      : lastRun
        ? `Out in the ${lastRun.roundLabel.toLowerCase()}, ${runWL(lastRun).join('–')} to ${mascot(byId.get(lastRun.teamAId === you.id ? lastRun.teamBId : lastRun.teamAId))}`
        : 'Missed the playoffs';

  // The aside: the record on top, the season's pages, your leaders, then the way on.
  const nav: { id: Tab | 'playoffs'; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'standings', label: 'Standings' },
    { id: 'stats', label: 'Stats' },
    { id: 'awards', label: 'Awards' },
    { id: 'playoffs', label: 'The playoffs' },
  ];
  const onNav = (id: Tab | 'playoffs') => {
    if (id === 'playoffs') {
      if (playoffs) startPlayoffs();
      return;
    }
    setChapter('season');
    setTab(id);
  };
  const leaders: [string, keyof SeasonPlayerLine['totals']][] = [
    ['Points', 'pts'],
    ['Rebounds', 'reb'],
    ['Assists', 'ast'],
    ['Blocks', 'blk'],
  ];
  const playoffsLabel = reveal.kind === 'none' ? (rank <= 8 ? 'Playoffs →' : 'See the playoffs →') : finalsDone ? 'The playoffs →' : 'Back to the playoffs →';
  const aside = (extra?: ReactNode, buttons?: ReactNode) => (
    <>
      <Mast title="Your Season" sub={finalsDone ? 'Regular season + playoffs · final' : `82 games · ${teams.length} teams · a play-in for 7 to 10`} />
      {finalsDone ? (
        <>
          <Tally you={`${record.wins}–${record.losses}`} mid={champ === you.id ? '🏆' : lastRun ? lastRun.roundLabel.replace('Quarterfinals', 'QF').replace('Semifinals', 'Semis') : '—'} ai={yourRuns.length ? `${poW}–${poL}` : '—'} youK="Season" midK="Result" aiK="Playoffs" plain small />
          <SubNote>
            <b>{result}</b> · {ord(rank)} seed
          </SubNote>
        </>
      ) : (
        <Tally you={record.wins} mid={ord(rank)} ai={record.losses} youK="Won" midK="Seed" aiK="Lost" plain />
      )}
      <section className="snav keep">
        <H3>Season</H3>
        {nav.map((n) => {
          const on = n.id === 'playoffs' ? chapter === 'playoffs' : chapter === 'season' && tab === n.id;
          return (
            <button key={n.id} type="button" className={cx('kv nav', on && 'on')} onClick={() => onNav(n.id)} disabled={n.id === 'playoffs' && !playoffs}>
              <span>{n.label}</span>
              <b style={n.id === 'playoffs' && !finalsDone && playoffs ? { color: 'var(--red)' } : undefined}>›</b>
            </button>
          );
        })}
      </section>
      {extra ?? (
        <section>
          <H3>Your leaders</H3>
          {leaders.map(([k, key]) => {
            const l = teamLeader(yourLines, key);
            return l ? (
              <div key={k} className="kv">
                <span>{k}</span>
                <b>
                  <PlayerName line={l}>
                    {lastName(l.span.playerName)} {f1(per(l, key))}
                  </PlayerName>
                </b>
              </div>
            ) : null;
          })}
        </section>
      )}
      <Actions links={finalsDone && end ? undefined : { onMenu: onClose }}>
        {buttons}
        {finalsDone && <Btn onClick={() => setSharing(true)}>Share your season</Btn>}
        {finalsDone && end ? (
          <>
            {end.onNewDraft && (
              <Btn kind="line" onClick={end.onNewDraft}>
                New draft
              </Btn>
            )}
            <Btn kind="line" onClick={end.onMenu}>
              Main menu
            </Btn>
            <button type="button" className="lk-inline back-res" onClick={onClose}>
              ← Back to the results
            </button>
          </>
        ) : (
          <Btn kind="line" onClick={onClose}>
            Back to the results
          </Btn>
        )}
      </Actions>
    </>
  );

  // The season card to share (mockup `#share`): the record, the run, the five by points.
  const roster = you.roster
    .map((p) => yourLines.find((l) => l.span.id === p.id))
    .filter((l): l is SeasonPlayerLine => Boolean(l))
    .sort((a, b) => per(b, 'min') - per(a, 'min'));
  const yourAwards = (() => {
    const out: string[] = [];
    const mine = (l: SeasonPlayerLine | null | undefined) => (l && l.teamId === you.id ? lastName(l.span.playerName) : null);
    const mvp = mine(season.awards.mvp);
    if (mvp) out.push(`MVP ${mvp}`);
    const fmvp = mine(playoffs?.finalsMvp);
    if (fmvp) out.push(`Finals MVP ${fmvp}`);
    const dpoy = mine(season.awards.dpoy);
    if (dpoy) out.push(`DPOY ${dpoy}`);
    const sixth = mine(season.awards.sixthMan);
    if (sixth) out.push(`Sixth Man ${sixth}`);
    season.awards.allNba.forEach((five, i) => five.filter((l) => l.teamId === you.id).forEach((l) => out.push(`All-NBA ${ord(i + 1)} ${lastName(l.span.playerName)}`)));
    return out;
  })();
  const poster: PosterData = {
    mode: 'All-Time Draft · season',
    date: new Date(),
    kick: result ?? `${ord(rank)} seed`,
    head: you.name,
    line: `${record.wins}–${record.losses} · ${ord(rank)} seed${yourRuns.length ? ` · ${poW}–${poL} in the playoffs` : ''}`,
    five: roster.slice(0, 5).map((l) => ({ span: l.span, num: Math.round(per(l, 'pts') * 10) / 10 })),
    bench: roster.slice(5).map((l) => ({ span: l.span, num: Math.round(per(l, 'pts') * 10) / 10 })),
    unit: 'ppg',
    prof: [],
    strip: [
      ['Season', `${record.wins}–${record.losses}`],
      ['Seed', ord(rank)],
      ['Playoffs', yourRuns.length ? `${poW}–${poL}` : '—'],
      ['Result', champ === you.id ? '🏆' : lastRun ? lastRun.roundLabel : '—'],
    ],
    foot: yourAwards.slice(0, 3).join(' · ') || 'The same draft always plays the same season',
    champ: champ === you.id,
  };
  const overlay = (
    <>
      {card && <SeasonPlayerCard line={card} teams={teams} byId={byId} codes={codes} season={season} playoffs={finalsDone ? playoffs : null} onClose={() => setCard(null)} />}
      {sharing && <ShareNight d={poster} fileName={`${you.name} season`} onClose={() => setSharing(false)} />}
    </>
  );

  if (chapter === 'calendar') {
    return (
      <PlayerCardContext.Provider value={setCard}>
        <CalendarChapter
          teams={teams}
          codes={codes}
          season={season}
          you={you}
          byId={byId}
          spans={spans}
          cal={calendar}
          overlay={overlay}
          onEnd={() => {
            setChapter('season');
            setTab('overview');
          }}
          onClose={onClose}
        />
      </PlayerCardContext.Provider>
    );
  }

  if (chapter === 'playoffs' && playoffs) {
    return (
      <PlayerCardContext.Provider value={setCard}>
        <PlayoffsChapter
          teams={teams}
          byId={byId}
          codes={codes}
          mark={mark}
          season={season}
          playoffs={playoffs}
          you={you}
          reveal={reveal}
          setReveal={setReveal}
          aside={aside}
          overlay={overlay}
          seedOf={seedOf}
          roster={roster}
          onClose={onClose}
          playInDone={calendar.playInDone}
          setPlayInDone={calendar.setPlayInDone}
        />
      </PlayerCardContext.Provider>
    );
  }

  const nextButtons = playoffs ? (
    <Btn onClick={startPlayoffs}>{playoffsLabel}</Btn>
  ) : null;
  let main: ReactNode;
  if (tab === 'overview') main = <Overview season={season} playoffs={playoffs} you={you} rank={rank} byId={byId} views={views} mark={mark} report={report} spans={spans} />;
  else if (tab === 'standings') main = <FullStandings season={season} byId={byId} youId={you.id} views={views} mark={mark} />;
  else if (tab === 'stats') main = <Stats key={playoffsSoFar ? 'so-far' : 'final'} teams={teams} season={season} playoffs={finalsDone ? playoffs : playoffsSoFar} youId={you.id} codes={codes} playoffsSoFar={playoffsSoFar !== null} />;
  else main = <Awards season={season} playoffs={finalsDone ? playoffs : null} byId={byId} youId={you.id} codes={codes} />;
  return (
    <PlayerCardContext.Provider value={setCard}>
      <NightGame aside={aside(undefined, nextButtons)} overlay={overlay}>
        {main}
        {playoffs && (
          <Btn className="phone-only" onClick={startPlayoffs}>
            {playoffsLabel}
          </Btn>
        )}
      </NightGame>
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
  report,
  spans,
}: {
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult | null;
  you: Team;
  rank: number;
  byId: Map<string, Team>;
  views: ReturnType<typeof engineTeamViews>;
  mark: (id: string) => ReactNode;
  report: RosterInsight[];
  spans: Map<string, PlayerSpan>;
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
  const entrants = playoffs ? new Set(playoffs.rounds[0].flatMap((x) => [x.teamAId, x.teamBId])) : null;
  const made = entrants ? entrants.has(you.id) : rank <= 8;
  const top = season.standings[0];
  const gap = made ? record.wins - (ninth?.wins ?? 0) : (eighth?.wins ?? 0) - record.wins;
  const sentence = [
    rank === 1
      ? `The ${name} own the regular season.`
      : `The ${mascot(byId.get(top.teamId))} took the one seed at ${top.wins}–${top.losses}.`,
    rank <= 6 ? 'Straight into the playoffs.' : rank <= 10 ? `Into the play-in as the ${ord(rank)} seed${made ? ', and through it.' : ', and out there.'}` : gap > 0 ? `${plural(gap, 'game')} out of the play-in.` : 'Out on the tiebreak.',
    best && `${best.span.playerName} led the way with ${f1(per(best, 'pts'))} a night.`,
  ]
    .filter(Boolean)
    .join(' ');
  const firstRound = playoffs?.rounds[0].find((s) => s.teamAId === you.id || s.teamBId === you.id);
  const opp = firstRound ? (firstRound.teamAId === you.id ? firstRound.teamBId : firstRound.teamAId) : null;
  const oppRow = opp ? season.standings.find((r) => r.teamId === opp) : null;
  const boards: [string, (l: SeasonPlayerLine) => number][] = [
    ['Points', (l) => per(l, 'pts')],
    ['Rebounds', (l) => per(l, 'reb')],
    ['Assists', (l) => per(l, 'ast')],
    ['Steals', (l) => per(l, 'stl')],
    ['Blocks', (l) => per(l, 'blk')],
    ['3PM', (l) => per(l, 'tpm')],
  ];
  return (
    <>
      <Prompt eb="Regular season · final" title={`${record.wins}–${record.losses}, ${ORD_WORDS[rank - 1] ?? ord(rank)}`}>
        {sentence}
        {story.length > 0 && ` ${story.join(' ')}`}
      </Prompt>
      <div className="split">
        <section>
          <H3 note="top six in · 7 to 10 play in">Standings</H3>
          <StandTable season={season} byId={byId} youId={you.id} mark={mark} />
          <div className="cutnote">Top six straight in · seeds 7 to 10 play in</div>
        </section>
        <div className="stack">
          <section>
            <H3>League leaders</H3>
            <table className="leaders">
              <tbody>
                {boards.map(([k, value]) => {
                  const l = [...regulars].sort((a, b) => value(b) - value(a))[0];
                  if (!l) return null;
                  return (
                    <tr key={k} className={l.teamId === you.id ? 'you' : undefined}>
                      <td className="k">{k}</td>
                      <td>
                        <b>
                          <PlayerName line={l} />
                        </b>{' '}
                        · {mascot(byId.get(l.teamId))}
                      </td>
                      <td className="v">{f1(value(l))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <SeasonExtras season={season} you={you} byId={byId} spans={spans} />
          <section>
            <H3 note="your season in three numbers">The {name}</H3>
            {best && (
              <div className="kv">
                <span>Best player</span>
                <b>
                  <PlayerName line={best}>
                    {lastName(best.span.playerName)} · {f1(per(best, 'pts'))} pts
                  </PlayerName>
                </b>
              </div>
            )}
            <div className="kv">
              <span>vs the draft grade</span>
              <b className={vs > 0 ? 'up' : vs < 0 ? 'dn' : undefined}>
                {vs === 0 ? `right on ${Math.round(projected)}` : `${vs > 0 ? '▲ ' : '▼ '}${plural(Math.abs(vs), 'win')} ${vs > 0 ? 'over' : 'under'} ${Math.round(projected)}`}
              </b>
            </div>
            <div className="kv">
              <span>Point differential</span>
              <b>{signed(diff)} a game</b>
            </div>
            {made && oppRow && opp && (
              <div className="kv">
                <span>First round</span>
                <b>
                  #{season.standings.findIndex((r) => r.teamId === opp) + 1} {mascot(byId.get(opp))} · {oppRow.wins}–{oppRow.losses}
                </b>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function StandTable({ season, byId, youId, mark }: { season: LiveSeasonResult; byId: Map<string, Team>; youId: string; mark: (id: string) => ReactNode }) {
  const top = season.standings[0];
  return (
    <table className="stand2">
      <thead>
        <tr>
          <th>#</th>
          <th />
          <th>Team</th>
          <th>W</th>
          <th>L</th>
          <th>Pct</th>
          <th>GB</th>
        </tr>
      </thead>
      <tbody>
        {season.standings.map((r, i) => {
          const g = Math.max(1, r.wins + r.losses);
          const gb = (top.wins - r.wins + (r.losses - top.losses)) / 2;
          return (
            <tr key={r.teamId} className={cx(r.teamId === youId && 'you', (i === 5 || i === 9) && 'cut')}>
              <td className="rk">{i + 1}</td>
              <td className="tmc">{mark(r.teamId)}</td>
              <td className="nm">{byId.get(r.teamId)?.name}</td>
              <td>{r.wins}</td>
              <td>{r.losses}</td>
              <td>.{String(Math.round((r.wins / g) * 1000)).padStart(3, '0').slice(-3)}</td>
              <td>{i === 0 ? '—' : gb % 1 ? gb.toFixed(1) : gb}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FullStandings({ season, byId, youId, views, mark }: { season: LiveSeasonResult; byId: Map<string, Team>; youId: string; views: ReturnType<typeof engineTeamViews>; mark: (id: string) => ReactNode }) {
  return (
    <>
      <Prompt eb="Regular season · final" title="Standings">
        Top eight make the playoffs. Proj W is the wins the draft grade expected.
      </Prompt>
      <section>
        <table className="stand2 full">
          <thead>
            <tr>
              <th>#</th>
              <th />
              <th>Team</th>
              <th>W–L</th>
              <th>Pts</th>
              <th>Opp</th>
              <th>Diff</th>
              <th>Proj W</th>
              <th>vs proj</th>
            </tr>
          </thead>
          <tbody>
            {season.standings.map((r, i) => {
              const g = Math.max(1, r.wins + r.losses);
              const diff = (r.pointsFor - r.pointsAgainst) / g;
              const proj = views.get(r.teamId)?.expectedWins ?? r.wins;
              const vs = Math.round(r.wins - proj);
              return (
                <tr key={r.teamId} className={cx(r.teamId === youId && 'you', (i === 5 || i === 9) && 'cut')}>
                  <td className="rk">{i + 1}</td>
                  <td className="tmc">{mark(r.teamId)}</td>
                  <td className="nm">{byId.get(r.teamId)?.name}</td>
                  <td>
                    {r.wins}–{r.losses}
                  </td>
                  <td>{f1(r.pointsFor / g)}</td>
                  <td>{f1(r.pointsAgainst / g)}</td>
                  <td>{signed(diff)}</td>
                  <td>{Math.round(proj)}</td>
                  <td>
                    <span className={cx('mv', vs > 0 ? 'up' : vs < 0 ? 'dn' : 'eq')}>{vs > 0 ? `▲ ${vs}` : vs < 0 ? `▼ ${-vs}` : '—'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="cutnote">Top six straight in · seeds 7 to 10 play in</div>
      </section>
    </>
  );
}

type SortKey = 'g' | 'min' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fga' | 'fg' | 'tpa' | 'tp' | 'fta' | 'ft' | 'tov' | 'pf' | 'dd' | 'td' | 'gs';
// `basic`: the columns the table opens with (the user: points, rebounds, assists, FG%, 3P%; then FGA); "More stats" adds the rest.
const COLUMNS: { key: SortKey; label: string; title?: string; basic?: true; value: (l: SeasonPlayerLine) => number; fmt: (l: SeasonPlayerLine) => string }[] = [
  { key: 'g', label: 'G', basic: true, value: (l) => l.games, fmt: (l) => String(l.games) },
  { key: 'min', label: 'MIN', basic: true, value: (l) => per(l, 'min'), fmt: (l) => f1(per(l, 'min')) },
  { key: 'pts', label: 'PTS', basic: true, value: (l) => per(l, 'pts'), fmt: (l) => f1(per(l, 'pts')) },
  { key: 'reb', label: 'REB', basic: true, value: (l) => per(l, 'reb'), fmt: (l) => f1(per(l, 'reb')) },
  { key: 'ast', label: 'AST', basic: true, value: (l) => per(l, 'ast'), fmt: (l) => f1(per(l, 'ast')) },
  { key: 'stl', label: 'STL', basic: true, value: (l) => per(l, 'stl'), fmt: (l) => f1(per(l, 'stl')) },
  { key: 'blk', label: 'BLK', basic: true, value: (l) => per(l, 'blk'), fmt: (l) => f1(per(l, 'blk')) },
  // 2026-10-14, the user: "brakuje mi możliwości sortowania przez FGA" — attempts per game beside each percentage.
  { key: 'fga', label: 'FGA', title: 'Field goal attempts per game', value: (l) => per(l, 'fga'), fmt: (l) => f1(per(l, 'fga')) },
  { key: 'fg', label: 'FG%', basic: true, value: (l) => pct(l.totals.fgm, l.totals.fga), fmt: (l) => f1(pct(l.totals.fgm, l.totals.fga)) },
  // 2026-10-15 (playtest: Gobert's 30.0 3P% read like a real number): the attempts beside the percentage.
  { key: 'tpa', label: '3PA', title: 'Three-point attempts per game', value: (l) => per(l, 'tpa'), fmt: (l) => f1(per(l, 'tpa')) },
  { key: 'tp', label: '3P%', basic: true, value: (l) => pct(l.totals.tpm, l.totals.tpa), fmt: (l) => pctOr(l.totals.tpm, l.totals.tpa) },
  { key: 'fta', label: 'FTA', title: 'Free throw attempts per game', value: (l) => per(l, 'fta'), fmt: (l) => f1(per(l, 'fta')) },
  { key: 'ft', label: 'FT%', value: (l) => pct(l.totals.ftm, l.totals.fta), fmt: (l) => pctOr(l.totals.ftm, l.totals.fta) },
  { key: 'tov', label: 'TOV', value: (l) => per(l, 'tov'), fmt: (l) => f1(per(l, 'tov')) },
  // 2026-10-14, the user: "pokaż faule w statystykach".
  { key: 'pf', label: 'PF', title: 'Personal fouls per game', value: (l) => per(l, 'pf'), fmt: (l) => f1(per(l, 'pf')) },
  { key: 'dd', label: 'DD', title: 'Double-doubles', value: (l) => l.doubleDoubles, fmt: (l) => String(l.doubleDoubles) },
  { key: 'td', label: 'TD', title: 'Triple-doubles', value: (l) => l.tripleDoubles, fmt: (l) => String(l.tripleDoubles) },
  { key: 'gs', label: 'GS', title: 'Game score: points, makes, rebounds, assists, steals and blocks against misses and turnovers, per game', value: gameScorePerGame, fmt: (l) => f1(gameScorePerGame(l)) },
];
const ROWS_SHOWN = 20;

/** The table of everyone's season (`.box.sbox`) with your team first in the team list. */
function Stats({ teams, season, playoffs, youId, codes, through, playoffsSoFar }: { teams: Team[]; season: LiveSeasonResult; playoffs: LivePlayoffResult | null; youId: string; codes: Map<string, string>; through?: { label: string; share: number }; playoffsSoFar?: boolean }) {
  const [view, setView] = useState<'leaders' | 'players'>('leaders');
  const [phase, setPhase] = useState<'season' | 'playoffs'>(playoffsSoFar ? 'playoffs' : 'season');
  const [teamId, setTeamId] = useState<string>('all');
  const [pos, setPos] = useState<'all' | 'G' | 'F' | 'C'>('all');
  const [minGames, setMinGames] = useState(0);
  const [sort, setSort] = useState<SortKey>('pts');
  const [showAll, setShowAll] = useState(false);
  const [moreStats, setMoreStats] = useState(false);
  const playoffPhase = phase === 'playoffs' && playoffs !== null;
  const pool = playoffPhase && playoffs ? playoffs.players : season.players;
  // Part of a season (the stats so far): the bars for a leader scale with the games played.
  const scale = playoffPhase ? (playoffsSoFar ? 0.03 : 0.1) : (through?.share ?? 1);
  const posOf = (l: SeasonPlayerLine) => (l.span.primaryPosition === 'PG' || l.span.primaryPosition === 'SG' ? 'G' : l.span.primaryPosition === 'C' ? 'C' : 'F');
  const col = COLUMNS.find((c) => c.key === sort) ?? COLUMNS[2];
  const rows = pool
    .filter((l) => (teamId === 'all' || l.teamId === teamId) && (pos === 'all' || posOf(l) === pos) && (playoffPhase || l.games >= minGames))
    .sort((a, b) => col.value(b) - col.value(a));
  const shown = showAll ? rows : rows.slice(0, ROWS_SHOWN);
  const columns = moreStats ? COLUMNS : COLUMNS.filter((c) => c.basic);
  // Leader boards: regulars only, and a percentage needs real volume behind it.
  const regulars = pool.filter((l) => l.games >= (playoffPhase ? (playoffsSoFar ? 1 : 4) : Math.max(1, Math.round(AWARD_MIN_GAMES * scale))));
  const ordered = [...teams].sort((a, b) => (a.id === youId ? -1 : b.id === youId ? 1 : a.name.localeCompare(b.name)));
  const boards: [string, SeasonPlayerLine[], (l: SeasonPlayerLine) => number, (x: number) => string][] = [
    ['Points', regulars, (l) => per(l, 'pts'), f1],
    ['Rebounds', regulars, (l) => per(l, 'reb'), f1],
    ['Assists', regulars, (l) => per(l, 'ast'), f1],
    ['Steals', regulars, (l) => per(l, 'stl'), f1],
    ['Blocks', regulars, (l) => per(l, 'blk'), f1],
    ['3PM', regulars, (l) => per(l, 'tpm'), f1],
    [`FG% · ${Math.round(400 * scale)}+ FGA`, regulars.filter((l) => l.totals.fga >= 400 * scale), (l) => pct(l.totals.fgm, l.totals.fga), f1],
    [`3P% · ${Math.round(150 * scale)}+ 3PA`, regulars.filter((l) => l.totals.tpa >= 150 * scale), (l) => pct(l.totals.tpm, l.totals.tpa), f1],
    ['Double-doubles', regulars, (l) => l.doubleDoubles, (x) => String(x)],
  ];
  return (
    <>
      <Prompt eb={playoffPhase ? (playoffsSoFar ? 'Playoffs · so far' : 'Playoffs') : through ? `Regular season · through ${through.label}` : 'Regular season'} title={through ? 'The league so far' : 'Who ran the league'}>
        Per game. Tap a player for his season card.
      </Prompt>
      <div className="ptabs" role="tablist">
        {(['leaders', 'players'] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={cx('pt', view === v && 'on')} onClick={() => setView(v)}>
            <b>{v === 'leaders' ? 'Leaders' : 'Players'}</b>
          </button>
        ))}
        <span className="pt-more">
          <span>Season</span>
          <select aria-label="Season or playoffs" value={phase} onChange={(e) => setPhase(e.target.value as 'season' | 'playoffs')}>
            <option value="season">Regular</option>
            {playoffs && <option value="playoffs">Playoffs</option>}
          </select>
          {view === 'players' && (
            <>
              <span>Team</span>
              <select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="all">All</option>
                {ordered.map((t) => (
                  <option key={t.id} value={t.id}>
                    {codes.get(t.id) ?? t.name}
                    {t.id === youId ? ' (you)' : ''}
                  </option>
                ))}
              </select>
              <span>Pos</span>
              <select aria-label="Position" value={pos} onChange={(e) => setPos(e.target.value as 'all' | 'G' | 'F' | 'C')}>
                <option value="all">All</option>
                <option value="G">G</option>
                <option value="F">F</option>
                <option value="C">C</option>
              </select>
              {!playoffPhase && (
                <>
                  <span>Games</span>
                  <select aria-label="Minimum games" value={minGames} onChange={(e) => setMinGames(Number(e.target.value))}>
                    <option value={0}>Any</option>
                    <option value={41}>41+</option>
                    <option value={58}>58+</option>
                  </select>
                </>
              )}
            </>
          )}
        </span>
      </div>
      {pool.length === 0 ? (
        <p className="empty-note">No playoff games played yet. The numbers come in as the games are played.</p>
      ) : view === 'leaders' ? (
        <div className="ldr-grid">
          {boards.map(([title, lines, value, fmt]) => (
            <section key={title} className="ldr">
              <H3>{title}</H3>
              <table className="leaders">
                <tbody>
                  {[...lines]
                    .sort((a, b) => value(b) - value(a))
                    .slice(0, 5)
                    .map((l, i) => (
                      <tr key={`${l.teamId}${l.span.id}`} className={l.teamId === youId ? 'you' : undefined}>
                        <td className="k">{i + 1}</td>
                        <td>
                          <b>
                            <PlayerName line={l} />
                          </b>{' '}
                          · {codes.get(l.teamId)}
                        </td>
                        <td className="v">{fmt(value(l))}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      ) : (
        <section>
          <div className="sbox-wrap">
            <table className="box sbox stats">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Team</th>
                  {columns.map((c) => (
                    <th key={c.key} title={c.title}>
                      <button type="button" className={cx('srt', c.key === sort && 'on')} onClick={() => setSort(c.key)}>
                        {c.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={`${l.teamId}${l.span.id}`} className={l.teamId === youId ? 'you' : undefined}>
                    <td>
                      <span className="sb-f">
                        <NFace name={l.span.playerName} />
                      </span>
                      <PlayerName line={l} />
                      <small>{l.span.primaryPosition}</small>
                    </td>
                    <td className="tc">{codes.get(l.teamId)}</td>
                    {columns.map((c) => (
                      <td key={c.key} className={c.key === sort ? 'hi' : undefined} title={c.key === 'tp' && l.totals.tpa < l.games ? `Only ${l.totals.tpa} threes all season` : undefined}>
                        {c.fmt(l)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="more">
            Showing {shown.length} of {rows.length} ·{' '}
            <button
              type="button"
              className="lk-inline"
              onClick={() => {
                if (moreStats && !COLUMNS.find((c) => c.key === sort)?.basic) setSort('pts');
                setMoreStats(!moreStats);
              }}
            >
              {moreStats ? 'fewer stats' : 'more stats'}
            </button>
            {rows.length > ROWS_SHOWN && (
              <>
                {' · '}
                <button type="button" className="lk-inline" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'fewer players' : `all ${rows.length} players`}
                </button>
              </>
            )}
            {' · '}tap a column to sort
          </div>
        </section>
      )}
    </>
  );
}

/** 2026-10-08, the user ("All stars kapitanowie"): the two best All-Stars captain a team each and
 * pick in turns, snake order (A, B, B, A, …), best available first. A captain and his first four
 * picks start; the next seven come off the bench. */
function allStarTeams(stars: SeasonPlayerLine[]): { captain: SeasonPlayerLine; picks: { line: SeasonPlayerLine; pick: number | null }[] }[] {
  if (stars.length < 2) return [];
  const sides: { line: SeasonPlayerLine; pick: number | null }[][] = [[{ line: stars[0], pick: null }], [{ line: stars[1], pick: null }]];
  stars.slice(2).forEach((l, i) => sides[[0, 1, 1, 0][i % 4]].push({ line: l, pick: i + 1 }));
  return sides.map((side) => ({ captain: side[0].line, picks: side }));
}

function Awards({ season, playoffs, byId, youId, codes }: { season: LiveSeasonResult; playoffs: LivePlayoffResult | null; byId: Map<string, Team>; youId: string; codes: Map<string, string> }) {
  const a = season.awards;
  const big = [
    a.mvp && { t: 'Most Valuable Player', l: a.mvp, line: `${f1(per(a.mvp, 'pts'))} pts · ${f1(per(a.mvp, 'reb'))} reb · ${f1(per(a.mvp, 'ast'))} ast` },
    playoffs?.finalsMvp && { t: 'Finals MVP', l: playoffs.finalsMvp, line: 'the best line on the champions in the Finals' },
    a.dpoy && { t: 'Defensive Player of the Year', l: a.dpoy, line: `${f1(per(a.dpoy, 'reb'))} reb · ${f1(per(a.dpoy, 'blk'))} blk · ${f1(per(a.dpoy, 'stl'))} stl` },
    a.sixthMan && { t: 'Sixth Man of the Year', l: a.sixthMan, line: `${f1(per(a.sixthMan, 'pts'))} pts off the bench` },
  ].filter(Boolean) as { t: string; l: SeasonPlayerLine; line: string }[];
  const yoursBig = big.filter((x) => x.l.teamId === youId).length;
  const yoursAll = [...a.allNba.flat(), ...a.allDefense.flat()].filter((l) => l.teamId === youId).length;
  const you = byId.get(youId);
  const five = (label: string, list: SeasonPlayerLine[], stat: (l: SeasonPlayerLine) => string) => (
    <div key={label} className="nba">
      <span className="an-l">{label}</span>
      {list.map((l) => (
        <div key={`${l.teamId}${l.span.id}`} className={cx('np', l.teamId === youId && 'you')}>
          <NFace name={l.span.playerName} />
          <div>
            <b>
              <PlayerName line={l}>
                <TwoPart name={l.span.playerName} />
              </PlayerName>
            </b>
            <small>
              {codes.get(l.teamId)}
              <span className="st"> · {stat(l)}</span>
            </small>
          </div>
        </div>
      ))}
    </div>
  );
  const ppg = (l: SeasonPlayerLine) => f1(per(l, 'pts'));
  const dstat = (l: SeasonPlayerLine) => (per(l, 'blk') > per(l, 'stl') ? `${f1(per(l, 'blk'))} blk` : `${f1(per(l, 'stl'))} stl`);
  const stars = allStarTeams(a.allStars);
  return (
    <>
      <Prompt eb="Season awards" title={yoursBig >= 2 ? `A ${mascot(you)} sweep` : yoursBig === 1 ? `One for the ${mascot(you)}` : 'The league’s best'} tone="gold">
        {yoursBig > 0
          ? `${plural(yoursBig, 'big award')}${yoursAll ? ` and ${plural(yoursAll, 'All-League spot')}` : ''} went to the ${mascot(you)}.`
          : yoursAll > 0
            ? `No big award for the ${mascot(you)}, but ${plural(yoursAll, 'All-League spot')}.`
            : `Nothing for the ${mascot(you)} this year.`}
      </Prompt>
      <section>
        {/* Finals MVP joins after the Finals; until then three awards, no empty fourth spot. */}
        <H3>{big.length === 4 ? 'The big four' : 'Season awards'}</H3>
        <div className="aw-grid" style={{ '--n': big.length } as CSSProperties}>
          {big.map((x) => (
            <div key={x.t} className="aw big">
              <span className="aw-f">
                <NFace name={x.l.span.playerName} />
              </span>
              <div>
                <span className="aw-t">{x.t}</span>
                <b>
                  <PlayerName line={x.l} />
                </b>
                <small>
                  {codes.get(x.l.teamId)} · {x.line}
                </small>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <H3 note="points per game">All-NBA</H3>
        {a.allNba.map((list, i) => five(['First team', 'Second team', 'Third team'][i], list, ppg))}
      </section>
      <section>
        <H3 note="steals or blocks per game">All-Defensive</H3>
        {a.allDefense.map((list, i) => five(['First team', 'Second team'][i], list, dstat))}
      </section>
      {season.allStarGame && you ? (
        <AllStarDraft season={season} you={you} codes={codes} title />
      ) : stars.length === 2 && (
        <section className="asg-sec">
          <H3 note={`${a.allStars.length} All-Stars · the two best captain a side and pick in turns`}>All-Star Game</H3>
          <div className="asg">
            {stars.map((side, k) => (
              <Fragment key={side.captain.span.id}>
              {k === 1 && <span className="asg-vs">vs</span>}
              <div>
                <div className="asg-cap">
                  <NFace name={side.captain.span.playerName} />
                  <div>
                    <b>Team {lastName(side.captain.span.playerName)}</b>
                    <small>
                      Captain · {codes.get(side.captain.teamId)} · {ppg(side.captain)} ppg
                    </small>
                  </div>
                </div>
                <span className="asg-h">Starters</span>
                {side.picks.slice(0, 5).map(({ line, pick }) => (
                  <div key={line.span.id} className={cx('asg-r', line.teamId === youId && 'you')}>
                    <span className="pk">{pick === null ? 'C' : `#${pick}`}</span>
                    <span className="nm">
                      <span>
                        <PlayerName line={line}>
                          <TwoPart name={line.span.playerName} />
                        </PlayerName>
                      </span>
                      <small>{codes.get(line.teamId)}</small>
                    </span>
                    <span className="v">{ppg(line)}</span>
                  </div>
                ))}
                <span className="asg-h">Reserves</span>
                <div className="asg-res">
                  {side.picks.slice(5).map(({ line, pick }) => (
                    <div key={line.span.id} className={cx('asg-r res', line.teamId === youId && 'you')}>
                      <span className="pk">#{pick}</span>
                      <span className="nm">
                        <span>
                          <PlayerName line={line}>
                            <TwoPart name={line.span.playerName} />
                          </PlayerName>
                        </span>
                        <small>{codes.get(line.teamId)}</small>
                      </span>
                      <span className="v">{ppg(line)}</span>
                    </div>
                  ))}
                </div>
              </div>
              </Fragment>
            ))}
          </div>
          <p className="asg-note">
            C captain · #pick in the captains’ draft · season points per game. {plural(a.allStars.filter((l) => l.teamId === youId).length, mascot(you).replace(/s$/, ''))} made it.
          </p>
        </section>
      )}
    </>
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
  you,
  reveal,
  setReveal,
  aside,
  overlay,
  seedOf,
  roster,
  onClose,
  playInDone,
  setPlayInDone,
}: {
  teams: Team[];
  byId: Map<string, Team>;
  codes: Map<string, string>;
  mark: (id: string) => ReactNode;
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult;
  playInDone: boolean;
  setPlayInDone: (v: boolean) => void;
  you: Team;
  reveal: Reveal;
  setReveal: (r: Reveal) => void;
  aside: (extra?: ReactNode, buttons?: ReactNode) => ReactNode;
  overlay: ReactNode;
  seedOf: (id: string) => number;
  roster: SeasonPlayerLine[];
  onClose: () => void;
}) {
  const youId = you.id;
  const [watching, setWatching] = useState<Watching | null>(null);
  const watchKey = watching ? `${watching.round}-${watching.series}-${watching.game}` : '';
  useEffect(() => {
    window.scrollTo({ top: 0 });
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
  const shown = shownBy(reveal, last);
  const run = live ? yourRuns.find((r) => r.round === live.round) : undefined;
  const yourSeries = run ? rounds[run.round][run.index] : null;
  const seriesOver = yourSeries !== null && live !== null && live.game >= yourSeries.games.length;
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
  const wl = (s: LivePlayoffSeries, upto: number) => {
    const g = s.games.slice(0, upto);
    const a = g.filter((x) => x.final[0] > x.final[1]).length;
    const b = g.length - a;
    return s.teamAId === youId ? [a, b] : [b, a];
  };

  if (!playInDone && playoffs.playIn?.length && !all) {
    return <PlayInScreen playIn={playoffs.playIn} teams={teams} byId={byId} codes={codes} mark={mark} you={you} seedOf={seedOf} aside={aside} overlay={overlay} onDone={() => setPlayInDone(true)} onClose={onClose} />;
  }

  if (watching) {
    const s = rounds[watching.round][watching.series];
    const isNextUnplayed = live !== null && watching.round === live.round && watching.game === live.game;
    return (
      <Watch
        key={watchKey}
        season={season}
        teams={teams}
        codes={codes}
        series={s}
        gameIndex={watching.game}
        youId={youId}
        byId={byId}
        overlay={overlay}
        onFinish={() => {
          if (isNextUnplayed) setReveal({ kind: 'live', round: watching.round, game: watching.game + 1 });
        }}
        onNext={watching.game + 1 < s.games.length ? () => setWatching({ ...watching, game: watching.game + 1 }) : null}
        onBack={() => setWatching(null)}
        onClose={onClose}
      />
    );
  }

  // The bracket as this moment shows it: between rounds, the next round's matchups are already set.
  let bracketShown: (round: number, s: LivePlayoffSeries) => number = shown;
  const path = (
    <section>
      <H3>Your path</H3>
      {yourRuns.length === 0 ? (
        <div className="kv">
          <span>Seed</span>
          <b>{ord(seedOf(youId))}, out of the top eight</b>
        </div>
      ) : (
        yourRuns.map((r) => {
          const s = rounds[r.round][r.index];
          const n = shown(r.round, s);
          if (!all && live && r.round > live.round) return null;
          const [w, l] = wl(s, n);
          return (
            <div key={r.round} className="kv">
              <span>{s.roundLabel.replace(/s$/, '')}</span>
              <b>
                {w}–{l} {mascot(byId.get(oppOf(s)))}
              </b>
            </div>
          );
        })
      )}
    </section>
  );

  // The series hub (mockup `#series`): your series, game by game, and the matchup.
  if (live && yourSeries && !seriesOver && run) {
    const [yw, ow] = wl(yourSeries, live.game);
    const opp = oppOf(yourSeries);
    const side = yourSeries.teamAId === youId ? 0 : 1;
    const p = seriesWinProbability(gameWinProbability(side === 0 ? yourSeries.margin : -yourSeries.margin));
    const preview = seriesPreview(season, youId, opp);
    const top = (id: string) => season.players.filter((l) => l.teamId === id).sort((a, b) => gameScorePerGame(b) - gameScorePerGame(a)).slice(0, 3);
    const [mine, theirs] = [top(youId), top(opp)];
    const row = (id: string) => season.standings.find((r) => r.teamId === id)!;
    const status = simming && live.game === 6 ? 'Game 7, winner takes it' : yw === ow ? (live.game === 0 ? 'Best of seven' : `Series tied, game ${live.game + 1} next`) : yw > ow ? 'You lead the series' : 'You trail the series';
    const play = () => setWatching({ round: live.round, series: run.index, game: live.game });
    const buttons = (
      <>
        <Btn onClick={play} disabled={simming}>
          ▶ Play game {live.game + 1}
        </Btn>
        <Btn kind="line" onClick={() => setSimming(true)} disabled={simming}>
          {simming ? `Game ${live.game + 1}…` : live.game === 0 ? 'Sim the series' : 'Sim the rest'}
        </Btn>
        <Btn kind="line" onClick={() => setReveal({ kind: 'all' })}>
          Sim to the end
        </Btn>
      </>
    );
    const sideT = (id: string, right: boolean) => (
      <div className={cx('sh-t', right && 'r')}>
        {mark(id)}
        <div>
          <b>{byId.get(id)?.name}</b>
          <small>
            #{seedOf(id)} · {row(id).wins}–{row(id).losses}
          </small>
        </div>
      </div>
    );
    return (
      <NightGame aside={aside(path, buttons)} overlay={overlay}>
        <div className="steps">
          {rounds.map((r, i) => {
            const yours = r.find(isYours);
            if (i < live.round && yours) {
              const [w, l] = wl(yours, yours.games.length);
              return (
                <span key={i} className="ok">
                  <i>✓</i>
                  {r[0].roundLabel.replace(/s$/, '')} · beat {codes.get(oppOf(yours))} {w}–{l}
                </span>
              );
            }
            return (
              <span key={i} className={i === live.round ? 'now' : undefined}>
                {i === live.round ? `● ${r[0].roundLabel} · now` : r[0].roundLabel}
              </span>
            );
          })}
        </div>
        <div className="sh-score">
          {sideT(youId, false)}
          <div className="sh-big">
            <b>
              {yw}–{ow}
            </b>
            <span>{status}</span>
          </div>
          {sideT(opp, true)}
        </div>
        <div className="sh-games">
          {Array.from({ length: 7 }, (_, i) => {
            if (i < live.game) {
              const g = yourSeries.games[i];
              const [us, them] = side === 0 ? g.final : [g.final[1], g.final[0]];
              const w = us > them;
              return (
                <button key={i} type="button" className="sh-g" onClick={() => setWatching({ round: live.round, series: run.index, game: i })} title={`Watch game ${i + 1} again`}>
                  <span>G{i + 1} ▶</span>
                  <b className={w ? 'w' : 'l'}>
                    {w ? 'W' : 'L'}{' '}
                    <small>
                      {us}–{them}
                    </small>
                  </b>
                </button>
              );
            }
            if (i === live.game)
              return (
                <div key={i} className="sh-g next">
                  <span>G{i + 1}</span>
                  <b>{simming ? 'Playing…' : 'Next'}</b>
                </div>
              );
            return (
              <div key={i} className="sh-g later">
                <span>G{i + 1}</span>
                <b>{i >= 4 ? 'If needed' : '—'}</b>
              </div>
            );
          })}
        </div>
        <div className="btn2 phone-only">
          <Btn onClick={play} disabled={simming}>
            ▶ Play game {live.game + 1}
          </Btn>
          <Btn kind="line" onClick={() => setSimming(true)} disabled={simming}>
            Sim the series
          </Btn>
        </div>
        <div className="split">
          <section>
            <H3 note={`series odds ${Math.round(p * 100)}%`}>The matchup</H3>
            {preview.map((line, i) => {
              const them = line.startsWith('Their');
              return (
                <p key={i} className="sh-edge">
                  <i className={them ? 'dn' : 'up'}>{them ? '−' : '+'}</i>
                  {line}
                </p>
              );
            })}
          </section>
          <section>
            <H3 note="season · pts · reb · ast">Top three</H3>
            {mine.map((l, i) => {
              const o = theirs[i];
              return (
                <div key={l.span.id} className="duel">
                  <div className="pl">
                    <NFace name={l.span.playerName} />
                    <div>
                      <b>
                        <PlayerName line={l}>
                          <TwoPart name={l.span.playerName} />
                        </PlayerName>
                        <small>{l.span.primaryPosition}</small>
                      </b>
                      <span className="ln">
                        {f1(per(l, 'pts'))} · {f1(per(l, 'reb'))} · {f1(per(l, 'ast'))}
                      </span>
                    </div>
                  </div>
                  <span className="vs">vs</span>
                  {o ? (
                    <div className="pl r">
                      <NFace name={o.span.playerName} />
                      <div>
                        <b>
                          <small>{o.span.primaryPosition}</small>
                          <PlayerName line={o}>
                            <TwoPart name={o.span.playerName} />
                          </PlayerName>
                        </b>
                        <span className="ln">
                          {f1(per(o, 'pts'))} · {f1(per(o, 'reb'))} · {f1(per(o, 'ast'))}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </section>
        </div>
        <section>
          <H3>Bracket</H3>
          <Bracket rounds={rounds} shown={bracketShown} youId={youId} byId={byId} mark={mark} />
        </section>
      </NightGame>
    );
  }

  // The end of your series, the rounds you watch from outside, or the whole thing.
  let eb = 'Playoffs';
  let title = 'The bracket is set';
  let line: ReactNode = 'Eight teams, best of seven. Your games are yours to play; the rest of the bracket plays alongside.';
  let buttons: ReactNode = null;
  let now = false;
  if (all) {
    return (
      <NightGame aside={aside(path)} overlay={overlay}>
        <Finale season={season} playoffs={playoffs} you={you} byId={byId} mark={mark} yourRuns={yourRuns.map((r) => rounds[r.round][r.index])} seedOf={seedOf} roster={roster} />
        <section>
          <H3>Bracket</H3>
          <Bracket rounds={rounds} shown={shown} youId={youId} byId={byId} mark={mark} />
        </section>
      </NightGame>
    );
  } else if (live && yourSeries && seriesOver) {
    const won = yourSeries.winnerId === youId;
    const opp = oppOf(yourSeries);
    const [w, l] = wl(yourSeries, yourSeries.games.length);
    bracketShown = (round, s) => (round <= live.round ? s.games.length : 0);
    const verdict = seriesVerdict(
      yourSeries.games.map((g) => (yourSeries.teamAId === youId ? g.final : ([g.final[1], g.final[0]] as [number, number]))),
      won,
    );
    line = (
      <>
        The {byId.get(youId)?.name} {won ? 'beat' : 'lose to'} the {byId.get(opp)?.name} <b className="w">{won ? `${w}–${l}` : `${l}–${w}`}</b>, {verdict}
      </>
    );
    if (won && live.round < last) {
      const next = rounds[live.round + 1].find(isYours)!;
      const upset = seedOf(youId) - seedOf(opp) >= 3;
      eb = upset ? 'Upset' : yourSeries.roundLabel;
      title = upset ? `#${seedOf(youId)} knocks out #${seedOf(opp)}` : `Into the ${next.roundLabel.toLowerCase()}`;
      buttons = <Btn onClick={() => setReveal({ kind: 'live', round: live.round + 1, game: 0 })}>On to the {next.roundLabel.toLowerCase()} →</Btn>;
    } else if (won) {
      eb = 'The Finals';
      title = 'Champions';
      buttons = <Btn onClick={() => setReveal({ kind: 'all' })}>Lift the trophy →</Btn>;
    } else {
      eb = yourSeries.roundLabel;
      title = 'Your run ends here';
      buttons = <Btn onClick={() => setReveal({ kind: 'all' })}>Watch the rest of the playoffs →</Btn>;
    }
  } else if (live) {
    // Not (or no longer) in it: the bracket plays round by round.
    const round = rounds[live.round];
    now = true;
    eb = yourRuns.length === 0 ? 'You missed the playoffs' : 'The rest of the bracket';
    title = live.round === 0 ? 'The bracket is set' : round[0].roundLabel;
    line = 'The top eight play on. Sim the bracket a round at a time.';
    buttons = (
      <>
        <Btn onClick={() => setReveal(live.round >= last ? { kind: 'all' } : { kind: 'live', round: live.round + 1, game: 0 })}>Sim the {round[0].roundLabel.toLowerCase()} →</Btn>
        <Btn kind="line" onClick={() => setReveal({ kind: 'all' })}>
          Sim to the end
        </Btn>
      </>
    );
  }
  return (
    <NightGame aside={aside(path, buttons)} overlay={overlay}>
      <Prompt eb={eb} title={title} now={now}>
        {line}
      </Prompt>
      {buttons && <div className="btn2 phone-only">{buttons}</div>}
      <Bracket rounds={rounds} shown={bracketShown} youId={youId} byId={byId} mark={mark} />
    </NightGame>
  );
}

/** The bracket (mockup `#playoffs`): a column a round, your series marked, the live one in red. */
function Bracket({
  rounds,
  shown,
  youId,
  byId,
  mark,
}: {
  rounds: LivePlayoffSeries[][];
  shown: (round: number, s: LivePlayoffSeries) => number;
  youId: string;
  byId: Map<string, Team>;
  mark: (id: string) => ReactNode;
}) {
  // A round shows its matchups once the round before it is complete on the page.
  const known = (round: number) => round === 0 || rounds[round - 1].every((s) => shown(round - 1, s) >= s.games.length);
  return (
    <div className="bracket">
      {rounds.map((round, r) => (
        <div key={r} className={cx('round', r === rounds.length - 1 && 'final')}>
          <h4>{round[0].roundLabel}</h4>
          {round.map((s, i) => {
            if (!known(r))
              return (
                <div key={i} className="series tbd">
                  <div className="note">To be decided</div>
                </div>
              );
            const n = Math.min(s.games.length, shown(r, s));
            const games = s.games.slice(0, n);
            const wa = games.filter((g) => g.final[0] > g.final[1]).length;
            const wb = games.length - wa;
            const done = n >= s.games.length;
            const yours = s.teamAId === youId || s.teamBId === youId;
            const liveNow = !done && n > 0;
            const tr = (id: string, seed: number, w: number) => (
              <div className={cx('tr', done && s.winnerId === id && 'win', id === youId && 'you')}>
                <span className="sd">{seed}</span>
                {mark(id)}
                <span>{mascot(byId.get(id))}</span>
                <span className="w">{w}</span>
              </div>
            );
            const note = done ? (Math.min(s.gamesWonA, s.gamesWonB) === 0 ? 'Sweep' : s.games.length === 7 ? 'Game 7' : null) : liveNow ? `Game ${n + 1} next` : null;
            return (
              <div key={i} className={cx('series', yours && 'you-path', liveNow && 'live')}>
                {tr(s.teamAId, s.teamASeed, wa)}
                {tr(s.teamBId, s.teamBSeed, wb)}
                {note && <div className="note">{note}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** After the playoffs (mockups `#finale`, `#finaleOut`): the title or the end of your run, your
 * path, the awards your team won and your team's numbers. */
function Finale({
  season,
  playoffs,
  you,
  byId,
  mark,
  yourRuns,
  seedOf,
  roster,
}: {
  season: LiveSeasonResult;
  playoffs: LivePlayoffResult;
  you: Team;
  byId: Map<string, Team>;
  mark: (id: string) => ReactNode;
  yourRuns: LivePlayoffSeries[];
  seedOf: (id: string) => number;
  roster: SeasonPlayerLine[];
}) {
  const youId = you.id;
  const [phase, setPhase] = useState<'season' | 'playoffs'>(yourRuns.length ? 'playoffs' : 'season');
  const champ = playoffs.championId;
  const fmvp = playoffs.finalsMvp;
  const finals = playoffs.rounds[playoffs.rounds.length - 1][0];
  const loser = finals.winnerId === finals.teamAId ? finals.teamBId : finals.teamAId;
  const fscore = `${Math.max(finals.gamesWonA, finals.gamesWonB)}–${Math.min(finals.gamesWonA, finals.gamesWonB)}`;
  const lastRun = yourRuns[yourRuns.length - 1];
  const won = champ === youId;
  const wlOf = (s: LivePlayoffSeries) => (s.teamAId === youId ? [s.gamesWonA, s.gamesWonB] : [s.gamesWonB, s.gamesWonA]);
  const lastGame = lastRun?.games[lastRun.games.length - 1];
  const lastScore = lastGame && lastRun ? (lastRun.teamAId === youId ? lastGame.final : [lastGame.final[1], lastGame.final[0]]) : null;
  const a = season.awards;
  const awards: { t: string; l: SeasonPlayerLine; line: string }[] = [];
  if (fmvp && fmvp.teamId === youId) awards.push({ t: 'Finals MVP', l: fmvp, line: 'best line in the Finals' });
  if (a.mvp && a.mvp.teamId === youId) awards.push({ t: 'MVP', l: a.mvp, line: `${f1(per(a.mvp, 'pts'))} pts · ${f1(per(a.mvp, 'reb'))} reb` });
  if (a.dpoy && a.dpoy.teamId === youId) awards.push({ t: 'DPOY', l: a.dpoy, line: `${f1(per(a.dpoy, 'reb'))} reb · ${f1(per(a.dpoy, 'blk'))} blk` });
  if (a.sixthMan && a.sixthMan.teamId === youId) awards.push({ t: 'Sixth Man', l: a.sixthMan, line: `${f1(per(a.sixthMan, 'pts'))} pts` });
  a.allNba.forEach((five, i) => five.filter((l) => l.teamId === youId).forEach((l) => awards.push({ t: `All-NBA ${ord(i + 1)}`, l, line: `${f1(per(l, 'pts'))} · ${f1(per(l, 'reb'))} · ${f1(per(l, 'ast'))}` })));
  a.allDefense.forEach((five, i) => five.filter((l) => l.teamId === youId).forEach((l) => awards.push({ t: `All-Defensive ${ord(i + 1)}`, l, line: `${f1(per(l, 'stl'))} stl · ${f1(per(l, 'blk'))} blk` })));
  const lines = phase === 'playoffs' ? roster.map((l) => playoffs.players.find((x) => x.teamId === youId && x.span.id === l.span.id)).filter((l): l is SeasonPlayerLine => Boolean(l && l.games > 0)) : roster;
  return (
    <>
      <div className={cx('champ', !won && 'out')}>
        <span className="eb">
          {lastRun ? `${lastRun.roundLabel} · Game ${lastRun.games.length}${lastScore ? ` · ${mascot(you)} ${lastScore[0]}, ${mascot(byId.get(lastRun.teamAId === youId ? lastRun.teamBId : lastRun.teamAId))} ${lastScore[1]}` : ''}` : `${ord(seedOf(youId))} in the regular season`}
        </span>
        <h2>{won ? 'Champions' : lastRun ? 'Your run ends here' : 'No playoffs this year'}</h2>
        <p>
          {won ? (
            <>
              The <b>{you.name}</b> win the title from the {ord(seedOf(youId))} seed.{fmvp && ` ${fmvp.span.playerName}, Finals MVP.`}
            </>
          ) : lastRun ? (
            <>
              The {byId.get(lastRun.winnerId)?.name} take the series <b className="w">{wlOf(lastRun)[1]}–{wlOf(lastRun)[0]}</b>.
            </>
          ) : (
            <>The top eight played on without the {mascot(you)}.</>
          )}
        </p>
      </div>
      {yourRuns.length > 0 && (
        <section>
          <H3 note="best of seven">Your path</H3>
          {yourRuns.map((s) => {
            const opp = s.teamAId === youId ? s.teamBId : s.teamAId;
            const [w, l] = wlOf(s);
            const ok = s.winnerId === youId;
            return (
              <div key={s.round} className={cx('path-r', ok ? 'won' : 'lost')}>
                <span className="pr-round">{s.roundLabel.replace(/s$/, '')}</span>
                {mark(opp)}
                <span className="pr-opp">{byId.get(opp)?.name}</span>
                <b className="pr-score">
                  {ok ? '▲' : '▼'} {w}–{l}
                </b>
                <span className="pr-note">{ok ? (seedOf(opp) < seedOf(youId) ? `upset of the ${ord(seedOf(opp))} seed` : 'through') : 'out'}</span>
              </div>
            );
          })}
        </section>
      )}
      {!won && (
        <p className="host">
          <b>Champions:</b> the {byId.get(champ)?.name} beat the {byId.get(loser)?.name} {fscore}.{fmvp && ` Finals MVP: ${fmvp.span.playerName}.`}
        </p>
      )}
      {awards.length > 0 && (
        <section>
          <H3 note={String(awards.length)}>Awards for the {mascot(you)}</H3>
          <div className="aw-row">
            {awards.map((x, i) => (
              <div key={i} className="aw">
                <span className="aw-f">
                  <NFace name={x.l.span.playerName} />
                </span>
                <div>
                  <span className="aw-t">{x.t}</span>
                  <b>
                    <PlayerName line={x.l} />
                  </b>
                  <small>{x.line}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>
          Your team
          <span className="sw">
            <button type="button" className={phase === 'season' ? 'on' : undefined} onClick={() => setPhase('season')}>
              Season
            </button>
            {yourRuns.length > 0 && (
              <button type="button" className={phase === 'playoffs' ? 'on' : undefined} onClick={() => setPhase('playoffs')}>
                Playoffs
              </button>
            )}
          </span>
        </h3>
        <SeasonTable lines={lines} />
      </section>
    </>
  );
}

function SeasonTable({ lines }: { lines: SeasonPlayerLine[] }) {
  const topPts = Math.max(0, ...lines.map((l) => per(l, 'pts')));
  return (
    <div className="sbox-wrap">
      <table className="box sbox">
        <thead>
          <tr>
            <th>Player</th>
            <th>G</th>
            <th>MIN</th>
            <th>PTS</th>
            <th>REB</th>
            <th>AST</th>
            <th>STL</th>
            <th>BLK</th>
            <th>FG%</th>
            <th>3P%</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.span.id}>
              <td>
                <span className="sb-f">
                  <NFace name={l.span.playerName} />
                </span>
                <PlayerName line={l} />
                <small>{l.span.primaryPosition}</small>
              </td>
              <td>{l.games}</td>
              <td>{f1(per(l, 'min'))}</td>
              <td className={per(l, 'pts') === topPts ? 'hi' : undefined}>{f1(per(l, 'pts'))}</td>
              <td>{f1(per(l, 'reb'))}</td>
              <td>{f1(per(l, 'ast'))}</td>
              <td>{f1(per(l, 'stl'))}</td>
              <td>{f1(per(l, 'blk'))}</td>
              <td>{f1(pct(l.totals.fgm, l.totals.fga))}</td>
              <td>{pctOr(l.totals.tpm, l.totals.tpa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One playoff game, live (mockup `#liveGame`), on the night live game. */
function Watch({
  season,
  teams,
  codes,
  series,
  gameIndex,
  youId,
  byId,
  overlay,
  onFinish,
  onNext,
  onBack,
  onClose,
}: {
  season: LiveSeasonResult;
  teams: Team[];
  codes: Map<string, string>;
  series: LivePlayoffSeries;
  gameIndex: number;
  youId: string;
  byId: Map<string, Team>;
  overlay: ReactNode;
  onFinish: () => void;
  onNext: (() => void) | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const game = useMemo(() => playLivePlayoffGame(teams, series, gameIndex), [teams, series, gameIndex]);
  const previous = useMemo(() => (gameIndex > 0 ? playLivePlayoffGame(teams, series, gameIndex - 1) : null), [teams, series, gameIndex]);
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
  const seriesLine = (x: number, y: number) => (x === y ? `Series tied ${x}–${y}` : `${mascot(x > y ? a : b)} lead ${Math.max(x, y)}–${Math.min(x, y)}`);
  const status = seriesLine(wa, wb);
  // The final line counts tonight's game too (playtest 2026-10-22: "lead 2–0" after the Sasquatch won game 3).
  const won = game.final[0] > game.final[1];
  const [fa, fb] = [wa + (won ? 1 : 0), wb + (won ? 0 : 1)];
  const after = Math.max(fa, fb) === 4 ? `${mascot(fa > fb ? a : b)} win the series ${Math.max(fa, fb)}–${Math.min(fa, fb)}` : seriesLine(fa, fb);
  const you: 0 | 1 = series.teamBId === youId ? 1 : 0;
  const intro = previous
    ? `Game ${gameIndex}: ${mascot(previous.final[0] > previous.final[1] ? a : b)} won ${Math.max(...previous.final)}–${Math.min(...previous.final)} · ${previous.star.name} ${previous.star.line.pts} pts, ${previous.star.line.reb} reb, ${previous.star.line.ast} ast · ${status}`
    : `${series.roundLabel} · ${a?.name} (#${series.teamASeed}) vs ${b?.name} (#${series.teamBSeed})`;
  const done = (
    <>
      {onNext ? <Btn onClick={onNext}>▶ Game {gameIndex + 2}</Btn> : <Btn onClick={onBack}>Back to the series →</Btn>}
      {onNext && (
        <Btn kind="line" onClick={onBack}>
          Back to the series
        </Btn>
      )}
    </>
  );
  return (
    <>
      <LiveGameNight
        game={game}
        variant="full"
        sides={{ names: [a?.name ?? '', b?.name ?? ''], short: [mascot(a), mascot(b)], codes: [codes.get(series.teamAId) ?? '', codes.get(series.teamBId) ?? ''], you }}
        mast={{
          title: `${series.roundLabel} · Game ${gameIndex + 1}`,
          sub: `Final · ${after}`,
          liveSub: `Live · ${status}`,
          preSub: `Tip-off · ${status}`,
        }}
        autoStart
        intro={intro}
        pregame={{
          eb: `${series.roundLabel} · Game ${gameIndex + 1} tonight`,
          now: true,
          title: `${mascot(a)} vs ${mascot(b)}`,
          line: gameIndex === 0 ? 'Best of seven. Your games are yours to watch; the rest of the bracket plays alongside.' : status,
        }}
        links={{ onMenu: onClose }}
        onPlayer={
          openCard
            ? (side, span: PlayerSpan) => {
                const teamId = side === 0 ? series.teamAId : series.teamBId;
                const line = season.players.find((l) => l.teamId === teamId && l.span.id === span.id);
                if (line) openCard(line);
              }
            : undefined
        }
        done={done}
        onFinish={onFinish}
      />
      <div className="nt">{overlay}</div>
    </>
  );
}

/* ── The calendar: the season a night at a time ───────────────────────────────────────────── */

const CAL_SPEEDS = [0.5, 1, 2, 4, 8] as const;
const CAL_SPEED_LABEL: Record<(typeof CAL_SPEEDS)[number], string> = { 0.5: '½', 1: '1×', 2: '2×', 4: '4×', 8: '8×' };
const breakKey = (s: { afterRound: number; kind: string }) => `${s.kind}:${s.afterRound}`;

/** The season unfolding (mockups `#simDay`, `#monthBreak`, `#asgBreak`): a night every second at
 * 1×, a stop at each month's end and at the All-Star break, your games to watch on the way. */
function CalendarChapter({
  teams,
  codes,
  season,
  you,
  byId,
  spans,
  cal,
  overlay,
  onEnd,
  onClose,
}: {
  teams: Team[];
  codes: Map<string, string>;
  season: LiveSeasonResult;
  you: Team;
  byId: Map<string, Team>;
  spans: Map<string, PlayerSpan>;
  cal: CalendarState;
  overlay: ReactNode;
  onEnd: () => void;
  onClose: () => void;
}) {
  const { day, setDay, seen, setSeen, noBreaks, setNoBreaks } = cal;
  const total = season.dates.length;
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState<(typeof CAL_SPEEDS)[number]>(1);
  const [watching, setWatching] = useState<{ kind: 'game'; game: LiveSeasonGame } | { kind: 'asg' } | null>(null);
  // The stats so far (playtest 2026-10-22): the season pauses while they're open.
  const [statsOpen, setStatsOpen] = useState(false);
  const pending = season.snapshots.find((s) => s.afterRound === day - 1 && !seen.includes(breakKey(s)) && (!noBreaks || s.kind === 'asg'));
  useEffect(() => {
    if (!running || pending || watching || statsOpen || day >= total) return;
    const t = window.setTimeout(() => setDay((d) => Math.min(total, d + 1)), 1000 / speed);
    return () => window.clearTimeout(t);
  }, [running, pending, watching, statsOpen, day, total, speed, setDay]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pending, watching, statsOpen]);
  const statsSoFar = useMemo(() => (statsOpen ? { ...season, players: seasonLinesThrough(season, day) } : null), [statsOpen, season, day]);

  const mine = teamGames(season, you.id);
  const played = mine.filter((x) => x.game.round < day);
  const stand = standingsAt(season, day);
  const pos = stand.findIndex((r) => r.teamId === you.id) + 1;
  const me = stand[pos - 1];
  const next = mine.filter((x) => x.game.round >= day).slice(0, 2);
  const nextBreak = season.snapshots.find((s) => s.afterRound >= day && (!noBreaks || s.kind === 'asg') && !seen.includes(breakKey(s)));
  const iso = season.dates[Math.max(0, day - 1)];

  if (watching) {
    const back = () => setWatching(null);
    if (watching.kind === 'asg' && season.allStarGame) {
      const asg = season.allStarGame;
      const cap = (k: 0 | 1) => `Team ${asg.sides[k][0].span.playerName.split(' ').slice(-1)[0]}`;
      return (
        <GameWatch
          build={() => playLiveAllStarGame(asg)}
          sides={{ names: [cap(0), cap(1)], short: [cap(0).slice(5), cap(1).slice(5)], codes: ['ASG', 'ASG'], you: 0 }}
          title="All-Star Game"
          status="the captains' draft"
          overlay={overlay}
          onDone={back}
          doneLabel="Back to the break"
          onClose={onClose}
        />
      );
    }
    if (watching.kind === 'game') {
      const g = watching.game;
      const [a, b] = [byId.get(g.aId), byId.get(g.bId)];
      // The record before this game, and after it once it's over (it read "3–3 before tonight" on the
      // final, the day having moved on; playtest 2026-10-22).
      const prior = mine.filter((x) => x.game.round < g.round);
      const wonIt = g.aId === you.id ? g.final[0] > g.final[1] : g.final[1] > g.final[0];
      return (
        <GameWatch
          build={() => playLiveSeasonGame(teams, g)}
          sides={{ names: [a?.name ?? '', b?.name ?? ''], short: [mascot(a), mascot(b)], codes: [codes.get(g.aId) ?? '', codes.get(g.bId) ?? ''], you: g.bId === you.id ? 1 : 0 }}
          title={`${dateLabel(season.dates[g.round])} · game ${mine.findIndex((x) => x.game === g) + 1}`}
          status={`${prior.filter((x) => x.won).length}–${prior.filter((x) => !x.won).length} before tonight`}
          finalStatus={`now ${prior.filter((x) => x.won).length + (wonIt ? 1 : 0)}–${prior.filter((x) => !x.won).length + (wonIt ? 0 : 1)}`}
          overlay={overlay}
          onFinish={() => setDay((d) => Math.max(d, g.round + 1))}
          onDone={back}
          doneLabel="Back to the season"
          onClose={onClose}
        />
      );
    }
  }

  const goOn = () => {
    if (pending) setSeen([...seen, breakKey(pending)]);
    setRunning(true);
  };
  const nextMonth = pending && pending.kind === 'month' ? season.dates[Math.min(total - 1, pending.afterRound + 1)] : null;
  const breakButtons = pending ? (
    pending.kind === 'asg' ? (
      <>
        <Btn onClick={goOn}>Back to the season</Btn>
        {season.allStarGame && (
          <Btn kind="line" onClick={() => setWatching({ kind: 'asg' })}>
            Watch the All-Star Game
          </Btn>
        )}
      </>
    ) : (
      <>
        <Btn onClick={goOn}>Play {nextMonth ? new Date(`${nextMonth}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }) : 'on'}</Btn>
        <Btn
          kind="line"
          onClick={() => {
            setNoBreaks(true);
            goOn();
          }}
        >
          No more month breaks
        </Btn>
      </>
    )
  ) : null;
  const ended = day >= total && !pending;
  // Your month (playtest 2026-10-22): the month in review at a break, else the month so far.
  const monthSnaps = season.snapshots.filter((s) => s.kind === 'month');
  const reviewing = pending?.kind === 'month' ? pending : null;
  const monthFrom = reviewing
    ? (monthSnaps.filter((s) => s.afterRound < reviewing.afterRound).pop()?.afterRound ?? -1) + 1
    : season.dates.findIndex((d) => d.slice(0, 7) === iso.slice(0, 7));
  const monthTo = reviewing ? reviewing.afterRound + 1 : day;
  const monthMine = mine.filter((x) => x.game.round >= monthFrom && x.game.round < monthTo);
  const monthTop = monthMine.length
    ? seasonLinesThrough(season, monthTo, monthFrom)
        .filter((l) => l.teamId === you.id && l.games >= monthMine.length / 2)
        .sort((a, b) => b.totals.pts / b.games - a.totals.pts / a.games)[0]
    : undefined;
  const aside = (
    <>
      <Mast title="Your Season" sub={pending ? (pending.kind === 'asg' ? `All-Star break · game ${played.length} of ${mine.length}` : `${pending.label} in review · game ${played.length} of ${mine.length}`) : day === 0 ? 'Opening night' : `${dateLabel(iso)} · game ${played.length} of ${mine.length}`} />
      <Tally you={me.wins} mid={ord(pos)} ai={me.losses} youK="Won" midK="Seed" aiK="Lost" plain />
      <div className="sprog keep">
        <i style={{ width: `${Math.round((day / total) * 100)}%` }} />
      </div>
      {pending ? (
        <section className="keep">
          <div className="stackb">{breakButtons}</div>
        </section>
      ) : ended ? (
        <section className="keep">
          <div className="stackb">
            <Btn onClick={onEnd}>The final standings →</Btn>
          </div>
        </section>
      ) : (
        <section className="keep">
          <H3 note="a night every second at 1×">Speed</H3>
          <div className="speeds" role="group" aria-label="Speed">
            {CAL_SPEEDS.map((sp) => (
              <button key={sp} type="button" className={speed === sp ? 'on' : undefined} aria-pressed={speed === sp} onClick={() => setSpeed(sp)}>
                {CAL_SPEED_LABEL[sp]}
              </button>
            ))}
          </div>
          <div className="stackb" style={{ marginTop: 14 }}>
            <Btn
              kind="line"
              onClick={() => {
                if (statsOpen) {
                  setStatsOpen(false);
                  setRunning(true);
                } else setRunning((r) => !r);
              }}
            >
              {running && !statsOpen ? 'Pause' : 'Play'}
            </Btn>
            <Btn kind="line" onClick={() => setDay(nextBreak ? nextBreak.afterRound + 1 : total)}>
              {nextBreak ? (nextBreak.kind === 'asg' ? 'Skip to the All-Star break' : 'Skip to the month break') : 'Skip to the end'}
            </Btn>
          </div>
        </section>
      )}
      {(monthMine.length > 0 || next.length > 0) && (
        <section>
          <H3 note={reviewing ? reviewing.label : monthOf(iso)}>Your month</H3>
          {monthMine.length > 0 && (
            <div className="kv">
              <span>Record</span>
              <b>
                {monthMine.filter((x) => x.won).length}–{monthMine.filter((x) => !x.won).length}
              </b>
            </div>
          )}
          {monthTop && (
            <div className="kv">
              <span>Top scorer</span>
              <b>
                {monthTop.span.playerName.split(' ').slice(-1)[0]} {(monthTop.totals.pts / monthTop.games).toFixed(1)}
              </b>
            </div>
          )}
          {next[0] && (
            <div className="kv">
              <span>Next</span>
              <b>
                {dateLabel(season.dates[next[0].game.round])} · vs {mascot(byId.get(next[0].opp))}
              </b>
            </div>
          )}
        </section>
      )}
      <Actions links={{ onMenu: onClose }}>
        {day > 0 && (
          <Btn kind="line" onClick={() => setStatsOpen((o) => !o)}>
            {statsOpen ? 'Back to the calendar' : 'Stats so far'}
          </Btn>
        )}
        {!pending && next[0] && (
          <Btn kind="line" onClick={() => setWatching({ kind: 'game', game: next[0].game })}>
            Watch the next game
          </Btn>
        )}
        {!pending && !ended && (
          <Btn
            kind="line"
            onClick={() => {
              setDay(total);
              setNoBreaks(true);
            }}
          >
            Skip to the end of the season
          </Btn>
        )}
      </Actions>
    </>
  );
  let main: ReactNode;
  if (pending?.kind === 'asg') main = <AllStarBreak season={season} you={you} codes={codes} />;
  else if (pending) main = <MonthBreak season={season} snap={pending} you={you} byId={byId} codes={codes} spans={spans} />;
  else if (day === 0)
    main = (
      <Prompt eb={`Opening night · ${dateLabel(season.dates[0])}`} title="The season starts" now>
        82 games for every team, a night at a time. A stop at the end of each month and at the All-Star break; watch any of your games on the way.
      </Prompt>
    );
  else main = <CalendarDay season={season} day={day} you={you} byId={byId} codes={codes} spans={spans} />;
  if (statsSoFar) main = <Stats teams={teams} season={statsSoFar} playoffs={null} youId={you.id} codes={codes} through={{ label: dateLabel(iso), share: day / total }} />;
  return (
    <NightGame aside={aside} overlay={overlay}>
      {main}
      <div className="btn2 phone-only">
        {pending ? breakButtons : ended ? <Btn onClick={onEnd}>The final standings →</Btn> : (
          <>
            <Btn kind="line" onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Play'}
            </Btn>
            <Btn kind="line" onClick={() => setDay(nextBreak ? nextBreak.afterRound + 1 : total)}>
              {nextBreak ? 'Skip to the break' : 'Skip to the end'}
            </Btn>
          </>
        )}
      </div>
    </NightGame>
  );
}

/** Any game played again on the night live game: a season night, the All-Star Game, a play-in. */
function GameWatch({
  build,
  sides,
  title,
  status,
  finalStatus,
  overlay,
  onFinish,
  onDone,
  doneLabel,
  onClose,
}: {
  build: () => ReturnType<typeof playLiveSeasonGame>;
  sides: { names: [string, string]; short: [string, string]; codes: [string, string]; you: 0 | 1 };
  title: string;
  status: string;
  /** The line under the title once the game is over; `status` if not given. */
  finalStatus?: string;
  overlay: ReactNode;
  onFinish?: () => void;
  onDone: () => void;
  doneLabel: string;
  onClose: () => void;
}) {
  const game = useMemo(build, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);
  if (!game) return null;
  return (
    <>
      <LiveGameNight
        game={game}
        variant="full"
        sides={sides}
        mast={{ title, sub: `Final · ${finalStatus ?? status}`, liveSub: `Live · ${status}`, preSub: `Tip-off · ${status}` }}
        autoStart
        pregame={{ eb: `${title} · tonight`, now: true, title: `${sides.short[0]} vs ${sides.short[1]}`, line: status }}
        links={{ onMenu: onClose }}
        done={
          <>
            <Btn onClick={onDone}>{doneLabel}</Btn>
          </>
        }
        onFinish={onFinish}
      />
      <div className="nt">{overlay}</div>
    </>
  );
}

/** The play-in (mockup `#playIn`): 7 v 8 for the 7 seed, 9 v 10 to stay alive, then the last game
 * for the 8 seed. */
function PlayInScreen({
  playIn,
  teams,
  byId,
  codes,
  mark,
  you,
  seedOf,
  aside,
  overlay,
  onDone,
  onClose,
}: {
  playIn: LivePlayInGame[];
  teams: Team[];
  byId: Map<string, Team>;
  codes: Map<string, string>;
  mark: (id: string) => ReactNode;
  you: Team;
  seedOf: (id: string) => number;
  aside: (extra?: ReactNode, buttons?: ReactNode) => ReactNode;
  overlay: ReactNode;
  onDone: () => void;
  onClose: () => void;
}) {
  const yourSeed = seedOf(you.id);
  const inIt = yourSeed >= 7 && yourSeed <= 10;
  // Your own game waits for you; the rest of the night is already played.
  const [shown, setShown] = useState(inIt ? 0 : 2);
  const [watching, setWatching] = useState<LivePlayInGame | null>(null);
  const yourGames = playIn.filter((g) => g.teamAId === you.id || g.teamBId === you.id);
  const yourNext = yourGames.find((g) => playIn.indexOf(g) >= shown);
  const yourLast = [...yourGames].reverse().find((g) => playIn.indexOf(g) < shown);
  if (watching) {
    const [a, b] = [byId.get(watching.teamAId), byId.get(watching.teamBId)];
    return (
      <GameWatch
        build={() => playLivePlayInGame(teams, watching)}
        sides={{ names: [a?.name ?? '', b?.name ?? ''], short: [mascot(a), mascot(b)], codes: [codes.get(watching.teamAId) ?? '', codes.get(watching.teamBId) ?? ''], you: watching.teamBId === you.id ? 1 : 0 }}
        title={`Play-in · ${watching.kind === '7v8' ? '7 v 8' : watching.kind === '9v10' ? '9 v 10' : 'for the 8 seed'}`}
        status={`#${watching.teamASeed} vs #${watching.teamBSeed}`}
        overlay={overlay}
        onFinish={() => setShown((n) => Math.max(n, playIn.indexOf(watching) + 1))}
        onDone={() => setWatching(null)}
        doneLabel="Back to the play-in"
        onClose={onClose}
      />
    );
  }
  const label: Record<LivePlayInGame['kind'], string> = { '7v8': '7 vs 8 · winner is the 7 seed', '9v10': '9 vs 10 · loser is out', last: 'For the 8 seed · winner is in' };
  const block = (g: LivePlayInGame, i: number) => {
    const done = i < shown;
    const note =
      g.kind === '7v8'
        ? `The ${mascot(byId.get(g.winnerId))} are the 7 seed.`
        : g.kind === '9v10'
          ? `The ${mascot(byId.get(g.winnerId === g.teamAId ? g.teamBId : g.teamAId))}' season is over.`
          : `The ${mascot(byId.get(g.winnerId))} take the 8 seed.`;
    return (
      <div key={g.kind} className={cx('pi-g', !done && 'live')}>
        <span>{done ? label[g.kind] : `Tonight · ${label[g.kind].toLowerCase()}`}</span>
        {([0, 1] as const).map((k) => {
          const id = k === 0 ? g.teamAId : g.teamBId;
          return (
            <div key={id} className={cx('tr', done && g.winnerId === id && 'win', id === you.id && 'you')}>
              <span className="sd">{k === 0 ? g.teamASeed : g.teamBSeed}</span>
              {mark(id)}
              <span>{mascot(byId.get(id))}</span>
              <span className="w">{done ? g.final[k] : '—'}</span>
            </div>
          );
        })}
        <p>
          {done ? note : 'Single game, playoff rules.'}{' '}
          <button type="button" className="lk-inline" onClick={() => setWatching(g)}>
            {done ? 'watch it' : 'watch it live'}
          </button>
        </p>
      </div>
    );
  };
  const finished = shown >= playIn.length;
  const buttons = finished ? (
    <Btn onClick={onDone}>On to the playoffs →</Btn>
  ) : (
    <>
      {yourNext ? (
        <Btn onClick={() => setWatching(yourNext)}>Watch your game</Btn>
      ) : (
        <Btn onClick={() => setWatching(playIn[Math.max(2, shown)])}>Watch the 8-seed game</Btn>
      )}
      <Btn kind="line" onClick={() => setShown(shown < 2 ? 2 : playIn.length)}>
        {shown < 2 ? 'Sim your game' : 'Sim to the playoffs'}
      </Btn>
    </>
  );
  const status = !inIt
    ? 'Seeds 7 to 10 play for the last two places.'
    : yourLast && yourLast.winnerId !== you.id && (yourLast.kind !== '7v8')
      ? `Your season ends here: the ${mascot(byId.get(yourLast.winnerId))} won ${Math.max(...yourLast.final)}–${Math.min(...yourLast.final)}.`
      : yourLast && yourLast.winnerId === you.id && yourLast.kind !== '9v10'
        ? `You are in as the ${yourLast.kind === '7v8' ? '7' : '8'} seed.`
        : yourNext
          ? `You are the ${ord(yourSeed)} seed and play ${yourNext.kind === 'last' ? 'for the 8 seed' : yourNext.kind === '7v8' ? 'for the 7 seed' : 'to stay alive'} tonight.`
          : `You are the ${ord(yourSeed)} seed.`;
  const extra = (
    <section>
      <H3>Your playoffs</H3>
      <div className="kv">
        <span>Seed</span>
        <b>
          {ord(yourSeed)}
          {yourSeed <= 6 ? ' · in' : inIt ? ' · play-in' : ' · out'}
        </b>
      </div>
    </section>
  );
  return (
    <NightGame aside={aside(extra, buttons)} overlay={overlay}>
      <Prompt eb={finished ? 'Play-in · final' : 'Play-in · tonight'} title={finished ? 'The bracket is set' : 'Two games for the last two seeds'} now={!finished}>
        Seeds 1 to 6 are in. {status}
      </Prompt>
      <div className="pi">
        <div>{playIn.slice(0, 2).map(block)}</div>
        <div>{playIn.slice(2).map((g, i) => block(g, i + 2))}</div>
      </div>
      <div className="btn2 phone-only">{buttons}</div>
    </NightGame>
  );
}
