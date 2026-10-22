import { Fragment, type ReactNode } from 'react';
import type { Team } from '../engine/types';
import type { BoxLineStats } from '../engine/liveGame';
import { mvpRaceValue, type LiveSeasonGame, type LiveSeasonResult, type SeasonSnapshot } from '../engine/liveSeason';
import { teamNickname } from '../engine/teamNames';
import type { PlayerSpan } from '../data/schema';
import { H3, NFace, cx } from '../night/ui';
import { LeagueMark } from '../night/league';

/**
 * 2026-10-21, the season calendar (mockup `alltime.html` #simDay #monthBreak #asgBreak, and the
 * extras on #season: game of the season, team records): the season the engine already played,
 * shown a night at a time. Everything here reads the game log (`LiveSeasonResult.games`) and the
 * snapshots at the breaks; nothing is played again.
 */

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const f1 = (x: number) => x.toFixed(1);
const nick = (t: Team | undefined) => (t ? teamNickname(t.name) : '');
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const ORD_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth'];
const COUNT_WORDS = ['', '', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/** "Tue, Dec 2" from "2025-12-02". */
export function dateLabel(iso: string, long = false): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: long ? 'long' : 'short', month: long ? 'long' : 'short', day: 'numeric', timeZone: 'UTC' });
}
const monthOf = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

export interface StandRow {
  teamId: string;
  wins: number;
  losses: number;
  diff: number;
}

/** The standings after `rounds` nights. */
export function standingsAt(season: LiveSeasonResult, rounds: number): StandRow[] {
  const rows = new Map(season.standings.map((r) => [r.teamId, { teamId: r.teamId, wins: 0, losses: 0, diff: 0 }]));
  for (const g of season.games) {
    if (g.round >= rounds) break;
    const a = rows.get(g.aId)!;
    const b = rows.get(g.bId)!;
    const d = g.final[0] - g.final[1];
    a.diff += d;
    b.diff -= d;
    if (d > 0) {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }
  }
  return [...rows.values()].sort((x, y) => y.wins - x.wins || x.losses - y.losses || y.diff - x.diff);
}

/** A team's games in calendar order, from its side. */
export function teamGames(season: LiveSeasonResult, teamId: string): { game: LiveSeasonGame; opp: string; us: number; them: number; won: boolean; side: 0 | 1 }[] {
  return season.games
    .filter((g) => g.aId === teamId || g.bId === teamId)
    .map((g) => {
      const side: 0 | 1 = g.aId === teamId ? 0 : 1;
      const us = g.final[side];
      const them = g.final[1 - side];
      return { game: g, opp: side === 0 ? g.bId : g.aId, us, them, won: us > them, side };
    });
}

/** The streak a team is on after its games so far: +n wins, −n losses. */
function streakOf(results: boolean[]): number {
  if (!results.length) return 0;
  const last = results[results.length - 1];
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
  return last ? n : -n;
}

/** A player line by team and span at a snapshot, per game. */
interface SnapLine {
  teamId: string;
  spanId: string;
  games: number;
  totals: BoxLineStats;
}
const per = (l: SnapLine, k: keyof BoxLineStats) => l.totals[k] / Math.max(1, l.games);
const gameScore = (l: SnapLine) => {
  const t = l.totals;
  return (t.pts + 0.4 * t.fgm - 0.7 * t.fga - 0.4 * (t.fta - t.ftm) + 0.7 * t.reb + 0.7 * t.ast + t.stl + 0.7 * t.blk - t.tov) / Math.max(1, l.games);
};
/** The month between two snapshots: the later totals less the earlier ones. */
function delta(now: SnapLine[], before: SnapLine[] | null): SnapLine[] {
  if (!before) return now;
  const prev = new Map(before.map((l) => [`${l.teamId}|${l.spanId}`, l]));
  return now.map((l) => {
    const p = prev.get(`${l.teamId}|${l.spanId}`);
    if (!p) return l;
    const totals = { ...l.totals };
    for (const k of Object.keys(totals) as (keyof BoxLineStats)[]) totals[k] -= p.totals[k];
    return { ...l, games: l.games - p.games, totals };
  });
}

/** The MVP ladder at a snapshot: game score per game on a winning team, regulars only. */
export function mvpLadder(season: LiveSeasonResult, snap: SeasonSnapshot, count = 5): SnapLine[] {
  const stand = standingsAt(season, snap.afterRound + 1);
  const pct = new Map(stand.map((r) => [r.teamId, r.wins / Math.max(1, r.wins + r.losses)]));
  const min = (snap.afterRound + 1) * 0.7;
  return snap.players
    .filter((l) => l.games >= min && l.totals.min / l.games >= 20)
    .sort((a, b) => mvpRaceValue(gameScore(b), pct.get(b.teamId) ?? 0) - mvpRaceValue(gameScore(a), pct.get(a.teamId) ?? 0))
    .slice(0, count);
}

function TrendTag({ move }: { move: number | null }) {
  if (move === null || move === 0) return <span className="trd">—</span>;
  return <span className={cx('trd', move > 0 ? 'up' : 'down')}>{move > 0 ? `▲ ${move}` : `▼ ${-move}`}</span>;
}

function MoveTag({ move }: { move: number }) {
  return <span className={cx('mv', move > 0 ? 'up' : move < 0 ? 'dn' : 'eq')}>{move > 0 ? `▲ ${move}` : move < 0 ? `▼ ${-move}` : '—'}</span>;
}

/** Standings with each team's move since an earlier night (mockup `standMv`). */
export function StandMoves({ rows, before, byId, codes, youId, head, note, moves = true }: { rows: StandRow[]; before: StandRow[]; byId: Map<string, Team>; codes: Map<string, string>; youId: string; head: string; note: string; /** False on the first break: nothing to move from, so no column of dashes. */ moves?: boolean }) {
  const was = new Map(before.map((r, i) => [r.teamId, i]));
  return (
    <section>
      <H3 note={note}>{head}</H3>
      <table className="stand2 mvt">
        <thead>
          <tr>
            <th>#</th>
            <th />
            <th>Team</th>
            <th>W</th>
            <th>L</th>
            {moves && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.teamId} className={cx(r.teamId === youId && 'you', (i === 5 || i === 9) && 'cut')}>
              <td className="rk">{i + 1}</td>
              <td className="tmc">
                <LeagueMark name={byId.get(r.teamId)?.name ?? ''} code={codes.get(r.teamId) ?? ''} />
              </td>
              <td className="nm">{byId.get(r.teamId)?.name}</td>
              <td>{r.wins}</td>
              <td>{r.losses}</td>
              {moves && (
                <td>
                  <MoveTag move={(was.get(r.teamId) ?? i) - i} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The MVP ladder (mockup `mvpRow`): rank, face, the line and the move since the last break. */
export function MvpLadder({ season, snap, prev, spans, codes, youId, count, head, note }: { season: LiveSeasonResult; snap: SeasonSnapshot; prev: SeasonSnapshot | null; spans: Map<string, PlayerSpan>; codes: Map<string, string>; youId: string; count: number; head: string; note: string }) {
  const now = mvpLadder(season, snap, count);
  const was = prev ? mvpLadder(season, prev, 16).map((l) => `${l.teamId}|${l.spanId}`) : null;
  return (
    <section>
      <H3 note={note}>{head}</H3>
      {now.map((l, i) => {
        const span = spans.get(l.spanId);
        const k = was ? was.indexOf(`${l.teamId}|${l.spanId}`) : -1;
        return (
          <div key={`${l.teamId}${l.spanId}`} className={cx('mvp-r', l.teamId === youId && 'you')}>
            <span className="rk">{i + 1}</span>
            <NFace name={span?.playerName ?? ''} />
            <div>
              <b>
                {span?.playerName}
                <small>{codes.get(l.teamId)}</small>
              </b>
              <span className="ln">
                {f1(per(l, 'pts'))} pts · {f1(per(l, 'reb'))} reb · {f1(per(l, 'ast'))} ast
              </span>
            </div>
            {was ? <TrendTag move={k < 0 ? 16 - i : k - i} /> : <span />}
          </div>
        );
      })}
    </section>
  );
}

/** A big night (mockup `gos`): the face, the points, the shooting and the game. */
export function GameLine({ span, line, ctx }: { span: PlayerSpan | undefined; line: BoxLineStats; ctx: ReactNode }) {
  return (
    <div className="gos">
      <NFace name={span?.playerName ?? ''} />
      <div>
        <b>
          {span?.playerName}
          <em>
            {line.pts}
            <small>pts</small>
          </em>
        </b>
        <span className="ln">
          {line.fgm}/{line.fga} FG · {line.tpm}/{line.tpa} 3PT · {line.ftm}/{line.fta} FT · {line.reb} reb · {line.ast} ast
        </span>
        <span className="ctx">{ctx}</span>
      </div>
    </div>
  );
}

/** The best line on a team (or anyone, with `teamId` null) in rounds [from, to). */
export function bestNight(season: LiveSeasonResult, teamId: string | null, from = 0, to = Infinity) {
  let best: { game: LiveSeasonGame; side: 0 | 1 } | null = null;
  for (const g of season.games) {
    if (g.round < from || g.round >= to) continue;
    for (const side of [0, 1] as const) {
      const id = side === 0 ? g.aId : g.bId;
      if (teamId && id !== teamId) continue;
      const top = g.top[side];
      if (!top) continue;
      const cur = best ? best.game.top[best.side]! : null;
      if (!cur || top.line.pts > cur.line.pts || (top.line.pts === cur.line.pts && top.line.reb + top.line.ast > cur.line.reb + cur.line.ast)) best = { game: g, side };
    }
  }
  return best;
}

/** "Tulsa 121, Kentucky 117 · game 38". */
export function gameContext(season: LiveSeasonResult, g: LiveSeasonGame, byId: Map<string, Team>, gameNo?: number): string {
  const [a, b] = [byId.get(g.aId), byId.get(g.bId)];
  const winA = g.final[0] > g.final[1];
  const score = winA ? `${nick(a)} ${g.final[0]}, ${nick(b)} ${g.final[1]}` : `${nick(b)} ${g.final[1]}, ${nick(a)} ${g.final[0]}`;
  return `${score} · ${gameNo ? `game ${gameNo}` : dateLabel(season.dates[g.round])}`;
}

/** The extras on the season's last page: your best night and your team's records. */
export function SeasonExtras({ season, you, byId, spans }: { season: LiveSeasonResult; you: Team; byId: Map<string, Team>; spans: Map<string, PlayerSpan> }) {
  const mine = teamGames(season, you.id);
  const best = bestNight(season, you.id);
  const top = best ? best.game.top[best.side] : null;
  const gameNo = best ? mine.findIndex((x) => x.game === best.game) + 1 : 0;
  const bigWin = [...mine].filter((x) => x.won).sort((a, b) => b.us - b.them - (a.us - a.them))[0];
  const most = [...mine].sort((a, b) => b.us - a.us)[0];
  const fewest = [...mine].sort((a, b) => a.them - b.them)[0];
  let run = 0;
  let longest = 0;
  for (const x of mine) {
    run = x.won ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const vs = (id: string) => nick(byId.get(id));
  return (
    <>
      {top && best && (
        <section>
          <H3 note={`best line for the ${nick(you)}`}>Game of the season</H3>
          <GameLine span={spans.get(top.spanId)} line={top.line} ctx={gameContext(season, best.game, byId, gameNo)} />
        </section>
      )}
      <section>
        <H3 note="this season">Team records</H3>
        {bigWin && (
          <div className="kv">
            <span>Biggest win</span>
            <b>
              +{bigWin.us - bigWin.them} vs {vs(bigWin.opp)}
            </b>
          </div>
        )}
        <div className="kv">
          <span>Longest win streak</span>
          <b>{longest === 1 ? '1 game' : `${longest} games`}</b>
        </div>
        {most && (
          <div className="kv">
            <span>Most points</span>
            <b>
              {most.us} vs {vs(most.opp)}
            </b>
          </div>
        )}
        {fewest && (
          <div className="kv">
            <span>Best defense night</span>
            <b>
              {fewest.them} allowed, {vs(fewest.opp)}
            </b>
          </div>
        )}
      </section>
    </>
  );
}

/** One night of the season (mockup `#simDay`): your last game, your month, tonight's games, the
 * standings and the MVP ladder as of the last break. `day` nights have been played (1..82). */
export function CalendarDay({ season, day, you, byId, codes, spans }: { season: LiveSeasonResult; day: number; you: Team; byId: Map<string, Team>; codes: Map<string, string>; spans: Map<string, PlayerSpan> }) {
  const round = Math.max(0, day - 1);
  const iso = season.dates[round];
  const mine = teamGames(season, you.id).filter((x) => x.game.round < day);
  const last = mine[mine.length - 1];
  const stand = standingsAt(season, day);
  const before = standingsAt(season, Math.max(0, day - 3));
  const pos = stand.findIndex((r) => r.teamId === you.id) + 1;
  const streak = streakOf(mine.map((x) => x.won));
  const leader = stand[0];
  const me = stand[pos - 1];
  const gb = (leader.wins - me.wins + me.losses - leader.losses) / 2;
  const topSpan = last ? last.game.top[last.side] : null;
  let title = 'Opening night';
  if (last) {
    if (streak >= 3) title = `A ${COUNT_WORDS[streak] ?? `${streak}th`} straight win`.replace('A second straight win', 'Two in a row');
    else if (streak <= -3) title = `${-streak} losses in a row`;
    else title = last.won ? `Beat the ${nick(byId.get(last.opp))} ${last.us}–${last.them}` : `Lost to the ${nick(byId.get(last.opp))} ${last.them}–${last.us}`;
  }
  const line = [
    topSpan && `${spans.get(topSpan.spanId)?.playerName.split(' ').slice(-1)[0]} had ${topSpan.line.pts}${last && !last.won ? ' in the loss' : ''}.`,
    pos === 1
      ? stand[1] && stand[1].wins === me.wins
        ? `Tied for first with the ${nick(byId.get(stand[1].teamId))}.`
        : `First in the league, ${(me.wins - stand[1].wins + stand[1].losses - me.losses) / 2} games clear.`
      : `${cap(ORD_WORDS[pos] ?? ord(pos))}, ${gb === 1 ? 'a game' : `${gb} games`} behind the ${nick(byId.get(leader.teamId))}.`,
  ]
    .filter(Boolean)
    .join(' ');
  // Your month so far: every game of yours this month, played or to come.
  const month = iso.slice(0, 7);
  const monthGames = teamGames(season, you.id).filter((x) => season.dates[x.game.round].slice(0, 7) === month);
  const monthW = monthGames.filter((x) => x.game.round < day && x.won).length;
  const monthL = monthGames.filter((x) => x.game.round < day && !x.won).length;
  const lastDate = season.dates.filter((d) => d.slice(0, 7) === month).slice(-1)[0];
  const tonight = season.games.filter((g) => g.round === round);
  const snap = [...season.snapshots].reverse().find((s) => s.afterRound < day && s.kind === 'month') ?? null;
  const prevSnap = snap ? [...season.snapshots].filter((s) => s.kind === 'month' && s.afterRound < snap.afterRound).pop() ?? null : null;
  return (
    <>
      <div className="prompt">
        <span className="eb now">
          Live · {dateLabel(iso)} · game {mine.length}
        </span>
        <h2>{title}</h2>
        <p>{line}</p>
      </div>
      <section>
        <H3 note="your games · W and L">{monthOf(iso)}</H3>
        <div className="cal">
          {monthGames.map((x) => {
            const played = x.game.round < day;
            const today = x.game.round === round;
            return (
              <span key={x.game.round} className={cx(played && !today && (x.won ? 'w' : 'l'), today && 'today')} title={`${dateLabel(season.dates[x.game.round])} · ${nick(byId.get(x.opp))}${played ? ` · ${x.us}–${x.them}` : ''}`}>
                <small>{Number(season.dates[x.game.round].slice(8))}</small>
                {played ? (x.won ? 'W' : 'L') : ''}
              </span>
            );
          })}
        </div>
        <div className="cal-l">
          <span>
            {monthOf(iso).slice(0, 3)}: {monthW}–{monthL}
          </span>
          <span>Month break after {dateLabel(lastDate)}</span>
        </div>
      </section>
      <section>
        <H3 note={`${tonight.length} games · final`}>Tonight</H3>
        <div className="board8">
          {tonight.map((g) => {
            const yours = g.aId === you.id || g.bId === you.id;
            const aw = g.final[0] > g.final[1];
            const t = yours ? g.top[g.aId === you.id ? 0 : 1] : null;
            return (
              <div key={`${g.aId}${g.bId}`} className={cx('g8', yours && 'you')}>
                <span className={cx('tmr', aw && 'w')}>
                  <LeagueMark name={byId.get(g.aId)?.name ?? ''} code={codes.get(g.aId) ?? ''} />
                  {nick(byId.get(g.aId))}
                </span>
                <span className={cx('sc', aw && 'w')}>{g.final[0]}</span>
                <span className={cx('tmr', !aw && 'w')}>
                  <LeagueMark name={byId.get(g.bId)?.name ?? ''} code={codes.get(g.bId) ?? ''} />
                  {nick(byId.get(g.bId))}
                </span>
                <span className={cx('sc', !aw && 'w')}>{g.final[1]}</span>
                {t && (
                  <span className="np">
                    {spans.get(t.spanId)?.playerName.split(' ').slice(-1)[0]} {t.line.pts} pts · {t.line.reb} reb · {t.line.ast} ast
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <div className="split">
        <StandMoves rows={stand} before={before} byId={byId} codes={codes} youId={you.id} head="Standings" note={`after ${mine.length} games · move this week`} />
        <div className="stack">
          {snap ? (
            <MvpLadder season={season} snap={snap} prev={prevSnap} spans={spans} codes={codes} youId={you.id} count={3} head="MVP ladder" note={`after ${snap.label}`} />
          ) : (
            <section>
              <H3>MVP ladder</H3>
              <p className="empty-note">The ladder opens at the first month break.</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/** A month break (mockup `#monthBreak`): your month, the standings' moves, the player and the game
 * of the month, the MVP ladder. */
export function MonthBreak({ season, snap, you, byId, codes, spans }: { season: LiveSeasonResult; snap: SeasonSnapshot; you: Team; byId: Map<string, Team>; codes: Map<string, string>; spans: Map<string, PlayerSpan> }) {
  const months = season.snapshots.filter((s) => s.kind === 'month');
  const i = months.indexOf(snap);
  const prev = i > 0 ? months[i - 1] : null;
  const from = prev ? prev.afterRound + 1 : 0;
  const to = snap.afterRound + 1;
  const stand = standingsAt(season, to);
  // The first break has nothing to move from: its table shows no moves.
  const before = from > 0 ? standingsAt(season, from) : stand;
  const pos = stand.findIndex((r) => r.teamId === you.id) + 1;
  const monthRec = (id: string) => {
    const g = teamGames(season, id).filter((x) => x.game.round >= from && x.game.round < to);
    return [g.filter((x) => x.won).length, g.filter((x) => !x.won).length] as const;
  };
  const [mw, ml] = monthRec(you.id);
  const bestMonth = [...stand].sort((a, b) => monthRec(b.teamId)[0] - monthRec(a.teamId)[0])[0];
  const wasPos = before.findIndex((r) => r.teamId === you.id) + 1;
  const climbed = stand
    .map((r, k) => ({ id: r.teamId, move: before.findIndex((x) => x.teamId === r.teamId) - k }))
    .sort((a, b) => b.move - a.move)[0];
  const month = delta(snap.players, prev ? prev.players : null).filter((l) => l.games >= (to - from) * 0.6 && l.totals.min / Math.max(1, l.games) >= 20);
  const potm = [...month].sort((a, b) => gameScore(b) - gameScore(a))[0];
  const potmSpan = potm ? spans.get(potm.spanId) : undefined;
  const [pw, pl] = potm ? monthRec(potm.teamId) : [0, 0];
  const night = bestNight(season, null, from, to);
  const nightTop = night ? night.game.top[night.side] : null;
  const label = snap.label === 'November' && from === 0 ? 'October & November' : snap.label;
  return (
    <>
      <div className="prompt">
        <span className="eb">Month break · {label}</span>
        <h2>
          {nick(you)} {mw}–{ml}, {ORD_WORDS[pos] ?? ord(pos)}
        </h2>
        <p>
          {bestMonth.teamId === you.id
            ? 'The best month in the league.'
            : monthRec(bestMonth.teamId)[0] === mw
              ? `You and the ${nick(byId.get(bestMonth.teamId))} had the best month, ${mw}–${ml}.`
              : `The ${nick(byId.get(bestMonth.teamId))} had the best month, ${monthRec(bestMonth.teamId).join('–')}.`}{' '}
          {wasPos && wasPos !== pos ? (pos < wasPos ? `Up ${wasPos - pos} from ${ord(wasPos)}.` : `Down ${pos - wasPos} from ${ord(wasPos)}.`) : from > 0 ? 'Same place as a month ago.' : ''}
          {climbed && climbed.move >= 3 && climbed.id !== you.id && ` The ${nick(byId.get(climbed.id))} climbed ${climbed.move} places.`}
        </p>
      </div>
      <div className="split">
        <StandMoves rows={stand} before={before} byId={byId} codes={codes} youId={you.id} head="Standings" note={from > 0 ? `after ${label} · move this month` : `after ${label}`} moves={from > 0} />
        <div className="stack">
          {potm && potmSpan && (
            <section>
              <H3 note={label}>Player of the Month</H3>
              <div className="potm">
                <NFace name={potmSpan.playerName} />
                <div>
                  <b>{potmSpan.playerName}</b>
                  <span className="ln">
                    {f1(per(potm, 'pts'))} pts · {f1(per(potm, 'reb'))} reb · {f1(per(potm, 'ast'))} ast · {pw}–{pl}
                  </span>
                  <p>
                    {nick(byId.get(potm.teamId))}, {potm.games} games this month.
                  </p>
                </div>
              </div>
            </section>
          )}
          {night && nightTop && (
            <section>
              <H3>Game of the month</H3>
              <GameLine span={spans.get(nightTop.spanId)} line={nightTop.line} ctx={gameContext(season, night.game, byId)} />
            </section>
          )}
        </div>
      </div>
      <MvpLadder season={season} snap={snap} prev={prev} spans={spans} codes={codes} youId={you.id} count={5} head="MVP ladder" note={prev ? `top five · move since ${prev.label}` : 'top five'} />
    </>
  );
}

/** The All-Star break (mockup `#asgBreak`): the score, the game MVP and the captains' draft. */
export function AllStarBreak({ season, you, codes }: { season: LiveSeasonResult; you: Team; codes: Map<string, string> }) {
  const asg = season.allStarGame;
  if (!asg) return null;
  const capName = (k: 0 | 1) => asg.sides[k][0].span.playerName.split(' ').slice(-1)[0];
  const win: 0 | 1 = asg.final[0] > asg.final[1] ? 0 : 1;
  const yours = asg.sides.flat().filter((x) => x.teamId === you.id).length;
  return (
    <>
      <div className="prompt">
        <span className="eb">All-Star break · {dateLabel(season.dates[season.asgAfterRound])}</span>
        <h2>
          Team {capName(win)} {asg.final[win]}, Team {capName((1 - win) as 0 | 1)} {asg.final[1 - win]}
        </h2>
        <p>
          {asg.mvp ? `${asg.mvp.span.playerName} took the game MVP with ${asg.mvp.line.pts}. ` : ''}
          {yours === 0 ? `No ${nick(you)} among the 24.` : `${yours} ${yours === 1 ? 'player' : 'players'} from the ${nick(you)} made the 24.`}
        </p>
      </div>
      {asg.mvp && (
        <section>
          <H3>Game MVP</H3>
          <GameLine span={asg.mvp.span} line={asg.mvp.line} ctx={`Team ${capName(win)} ${asg.final[win]}, Team ${capName((1 - win) as 0 | 1)} ${asg.final[1 - win]} · ${asg.mvp.side === win ? 'on the winners' : ''}`} />
        </section>
      )}
      <AllStarDraft season={season} you={you} codes={codes} />
    </>
  );
}

/** The captains' draft of the All-Star Game: both sides, starters and reserves, points at the break. */
export function AllStarDraft({ season, you, codes, title }: { season: LiveSeasonResult; you: Team; codes: Map<string, string>; title?: boolean }) {
  const asg = season.allStarGame;
  if (!asg) return null;
  const capName = (k: 0 | 1) => asg.sides[k][0].span.playerName.split(' ').slice(-1)[0];
  const snap = season.snapshots.find((s) => s.kind === 'asg');
  const ppg = (teamId: string, spanId: string) => {
    const l = snap?.players.find((p) => p.teamId === teamId && p.spanId === spanId);
    return l ? f1(per(l, 'pts')) : '—';
  };
  return (
    <section className="asg-sec">
        {title ? (
          <H3 note={`Team ${capName(0)} ${asg.final[0]}, Team ${capName(1)} ${asg.final[1]}${asg.mvp ? ` · MVP ${asg.mvp.span.playerName}` : ''}`}>All-Star Game</H3>
        ) : (
          <H3 note="the 24 at the break · captains picked the teams">The captains’ draft</H3>
        )}
        <div className="asg">
          {asg.sides.map((side, k) => (
            <Fragment key={k}>
              {k === 1 && <span className="asg-vs">vs</span>}
              <div>
                <div className="asg-cap">
                  <NFace name={side[0].span.playerName} />
                  <div>
                    <b>Team {capName(k as 0 | 1)}</b>
                    <small>
                      Captain · {codes.get(side[0].teamId)} · {ppg(side[0].teamId, side[0].span.id)} ppg
                    </small>
                  </div>
                </div>
                <span className="asg-h">Starters</span>
                {side.slice(0, 5).map((x) => (
                  <div key={x.span.id} className={cx('asg-r', x.teamId === you.id && 'you')}>
                    <span className="pk">{x.pick === null ? 'C' : `#${x.pick}`}</span>
                    <span className="nm">
                      <span>{x.span.playerName}</span>
                      <small>{codes.get(x.teamId)}</small>
                    </span>
                    <span className="v">{ppg(x.teamId, x.span.id)}</span>
                  </div>
                ))}
                <span className="asg-h">Reserves</span>
                <div className="asg-res">
                  {side.slice(5).map((x) => (
                    <div key={x.span.id} className={cx('asg-r res', x.teamId === you.id && 'you')}>
                      <span className="pk">#{x.pick}</span>
                      <span className="nm">
                        <span>{x.span.playerName}</span>
                        <small>{codes.get(x.teamId)}</small>
                      </span>
                      <span className="v">{ppg(x.teamId, x.span.id)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
        <p className="asg-note">C captain · #pick in the captains’ draft · points per game at the break.</p>
    </section>
  );
}
