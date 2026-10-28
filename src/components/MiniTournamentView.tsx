import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Team } from '../engine/types';
import { MINI_ROUNDS, exitRound, playMiniGame, simulateMiniTournament, type MiniGame } from '../engine/miniTournament';
import { gameWinProbability } from '../engine/matchup';
import { teamNickname } from '../engine/teamNames';
import { Actions, Btn, H3, Kv, Mast, NightGame, Prompt, cx } from '../night/ui';
import { leagueColors } from '../night/league';
import LiveGameNight from '../night/LiveGameNight';
import { TeamLogo } from './TeamLogo';

/**
 * The Mini's tournament screens (mockup `docs/mockups/mini-ncaa.html`, the user 2026-10-28): the
 * aside carries your next game as a duel — two crests, VS, the engine's odds — and your road to the
 * title, round by round; the stage carries the bracket: a mirrored tree on a desktop (two halves
 * meeting at the final), the rounds stacked like a scoreboard on a phone, your round on top.
 * The whole bracket is played the moment the screen opens; it is shown a round at a time.
 */
export function MiniTournamentView({
  seeded,
  scores,
  seed,
  codeOf,
  title,
  links,
  onBack,
  onNewDraft,
}: {
  /** The sixteen teams, best draft grade first: index 0 is the 1 seed. */
  seeded: Team[];
  /** Each team's draft grade, by id. */
  scores: Map<string, number>;
  seed: string;
  codeOf: (t: Team) => string;
  title: string;
  links: { onMenu: () => void; onHowTo: () => void; onSettings: () => void };
  onBack: () => void;
  onNewDraft: () => void;
}) {
  const t = useMemo(() => simulateMiniTournament(seeded, seed), [seeded, seed]);
  const byId = useMemo(() => new Map(seeded.map((x) => [x.id, x])), [seeded]);
  const you = seeded.find((x) => x.isHuman)!;
  const yourSeed = t.seeds.indexOf(you.id) + 1;
  const out = exitRound(t, you.id);
  // Rounds shown so far: a round is revealed when your game in it is played or simmed, or all at
  // once with "Sim to the end" once you are out.
  const [shown, setShown] = useState(0);
  const [watching, setWatching] = useState<MiniGame | null>(null);
  const [openRound, setOpenRound] = useState<number | null>(null);
  const yourGame = (round: number) => t.rounds[round]?.find((g) => g.teamAId === you.id || g.teamBId === you.id);
  const next = shown < MINI_ROUNDS.length ? yourGame(shown) : undefined;
  const alive = out === null || out >= shown;
  const finished = shown >= MINI_ROUNDS.length;
  const nick = (id: string) => teamNickname(byId.get(id)?.name ?? '');
  const code = (id: string) => codeOf(byId.get(id)!);
  const wins = t.rounds.slice(0, shown).filter((r) => r.some((g) => g.winnerId === you.id)).length;
  const losses = out !== null && out < shown ? 1 : 0;

  if (watching) {
    const game = playMiniGame(seeded, watching);
    if (game) {
      const side: 0 | 1 = watching.teamBId === you.id ? 1 : 0;
      const a = watching.teamAId;
      const b = watching.teamBId;
      const done = (
        <Btn
          onClick={() => {
            setWatching(null);
            setShown((s) => Math.max(s, watching.round + 1));
          }}
        >
          Back to the bracket →
        </Btn>
      );
      return (
        <LiveGameNight
          game={game}
          variant="full"
          sides={{ names: [byId.get(a)!.name, byId.get(b)!.name], short: [nick(a), nick(b)], codes: [code(a), code(b)], you: side }}
          mast={{ title: `${MINI_ROUNDS[watching.round]}`, sub: `Final · ${game.final[0] > game.final[1] ? nick(a) : nick(b)} advance`, liveSub: 'Live · one game, the loser goes home', preSub: `Tip-off · #${watching.teamASeed} vs #${watching.teamBSeed}` }}
          autoStart
          pregame={{ eb: `${MINI_ROUNDS[watching.round]} · tonight`, now: true, title: `${nick(a)} vs ${nick(b)}`, line: 'One game. The loser goes home.' }}
          links={{ onMenu: links.onMenu }}
          done={done}
        />
      );
    }
  }

  const crest = (id: string, seedNo: number) => {
    const name = byId.get(id)?.name ?? '';
    const { bg } = leagueColors(name);
    return (
      <div className="mt-crest" style={{ '--c': bg } as CSSProperties}>
        <TeamLogo name={name} size={54} />
        <small>#{seedNo}</small>
      </div>
    );
  };

  const duel = next && alive && (
    <section className="mt-duel">
      <span className="eb">{MINI_ROUNDS[next.round]} · tonight</span>
      <div className="mt-vs">
        {crest(next.teamAId, next.teamASeed)}
        <b>VS</b>
        {crest(next.teamBId, next.teamBSeed)}
      </div>
      <div className="mt-nm">
        <b>{nick(next.teamAId)}</b>
        <b>{nick(next.teamBId)}</b>
      </div>
      <div className="mt-nm s">
        <span>{scores.get(next.teamAId)}</span>
        <span>{scores.get(next.teamBId)}</span>
      </div>
      {(() => {
        const pA = Math.round(100 * gameWinProbability(next.margin));
        const pYou = next.teamAId === you.id ? pA : 100 - pA;
        return (
          <>
            <div className="mt-odds">
              <i style={{ width: `${pA}%`, background: leagueColors(byId.get(next.teamAId)!.name).bg }} />
              <u style={{ background: leagueColors(byId.get(next.teamBId)!.name).bg }} />
            </div>
            <div className="mt-nm s">
              <span>{next.teamAId === you.id ? `you ${pYou}%` : `${pA}%`}</span>
              <span>{next.teamBId === you.id ? `you ${pYou}%` : `${100 - pA}%`}</span>
            </div>
          </>
        );
      })()}
    </section>
  );

  const road = (
    <section className="mt-road">
      {MINI_ROUNDS.map((label, r) => {
        const g = yourGame(r);
        const played = r < shown && g;
        const won = played && g.winnerId === you.id;
        const opp = g ? (g.teamAId === you.id ? g.teamBId : g.teamAId) : null;
        const oppSeed = g ? (g.teamAId === you.id ? g.teamBSeed : g.teamASeed) : 0;
        const score = g ? (g.teamAId === you.id ? g.final : [g.final[1], g.final[0]]) : null;
        const state = played ? (won ? 'done' : 'lost') : r === shown && alive ? 'now' : '';
        return (
          <div key={label} className={cx('mt-rs', state)}>
            <i>{played ? (won ? '✓' : '✕') : r + 1}</i>
            <div>
              <b>{label}</b>
              <span>
                {played && opp && score
                  ? `${won ? 'beat' : 'lost to'} #${oppSeed} ${nick(opp)} ${score[0]}–${score[1]}`
                  : r === shown && alive && opp
                    ? `#${oppSeed} ${nick(opp)} · tonight`
                    : out !== null && r > out
                      ? '—'
                      : 'to come'}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );

  const champion = finished ? t.championId : null;
  const headline: [string, string, string] = finished
    ? champion === you.id
      ? ['Tournament · champions', `${nick(you.id)} win it all`, `Four wins as the #${yourSeed} seed.`]
      : [
          'Tournament · final',
          `Out in the ${MINI_ROUNDS[out ?? 0]}`,
          `${nick(champion!)} are the champions. ${wins === 0 ? 'One and done' : `${wins} ${wins === 1 ? 'win' : 'wins'}`} as the #${yourSeed} seed.`,
        ]
    : !alive
      ? ['Tournament', `Out in the ${MINI_ROUNDS[out!]}`, 'The bracket plays on without you.']
      : ['Tournament · one game a round', MINI_ROUNDS[shown], shown === 0 ? `Sixteen teams, seeded by the draft. You are the #${yourSeed} seed.` : `${wins} ${wins === 1 ? 'win' : 'wins'} in. One more and you move on.`];

  const team = (g: MiniGame, side: 0 | 1, revealed: boolean) => {
    const id = side === 0 ? g.teamAId : g.teamBId;
    const s = side === 0 ? g.teamASeed : g.teamBSeed;
    return (
      <div className={cx('mt-t', revealed && g.winnerId === id && 'w', revealed && g.winnerId !== id && 'l', id === you.id && 'you')}>
        <span className="sd">{s}</span>
        <span className="cd">{code(id)}</span>
        <span className="nx">{nick(id)}</span>
        <b>{revealed ? g.final[side] : '–'}</b>
      </div>
    );
  };
  const known = (round: number) => round <= shown;
  const gameEl = (g: MiniGame) => {
    const revealed = g.round < shown;
    if (!known(g.round)) {
      return (
        <div key={g.seed} className="mt-g tbd">
          <div className="mt-t">TBD</div>
          <div className="mt-t">TBD</div>
        </div>
      );
    }
    const yours = g.teamAId === you.id || g.teamBId === you.id;
    return (
      <div key={g.seed} className={cx('mt-g', yours && !revealed && 'now')}>
        {team(g, 0, revealed)}
        {team(g, 1, revealed)}
      </div>
    );
  };
  const col = (label: string, games: MiniGame[]) => (
    <div className="mt-col">
      <span className="rn">{label}</span>
      <div className="cg">{games.map(gameEl)}</div>
    </div>
  );
  const half = (r: number, h: 0 | 1) => {
    const n = t.rounds[r].length / 2;
    return t.rounds[r].slice(h * n, h * n + n);
  };
  const champBox = (
    <div className={cx('mt-champ', champion && 'on')}>
      <span className="eb">Champions</span>
      <b>{champion ? nick(champion) : '?'}</b>
    </div>
  );
  const tree = (
    <div className="mt-tree">
      {col(MINI_ROUNDS[0], half(0, 0))}
      {col(MINI_ROUNDS[1], half(1, 0))}
      {col(MINI_ROUNDS[2], half(2, 0))}
      <div className="mt-col mid">
        <span className="rn">{MINI_ROUNDS[3]}</span>
        <div className="cg">
          {gameEl(t.rounds[3][0])}
          {champBox}
        </div>
      </div>
      {col(MINI_ROUNDS[2], half(2, 1))}
      {col(MINI_ROUNDS[1], half(1, 1))}
      {col(MINI_ROUNDS[0], half(0, 1))}
    </div>
  );
  // The phone: rounds stacked, the one being played on top, the next ones under it, the played
  // ones below, folded.
  const current = Math.min(shown, MINI_ROUNDS.length - 1);
  const order = [...Array(MINI_ROUNDS.length).keys()].filter((r) => r >= current).concat([...Array(current).keys()].reverse());
  const stack = (
    <div className="mt-stack">
      {order.map((r) => {
        const played = r < shown && !(finished && r === MINI_ROUNDS.length - 1);
        const open = !played || openRound === r || r === shown - 1;
        return (
          <div key={r} className={cx('mt-rd', r === shown && !finished && 'now', played && 'done')}>
            <button type="button" className="rdh" onClick={() => played && setOpenRound(openRound === r ? null : r)}>
              <b>{MINI_ROUNDS[r]}</b>
              <span>{r === shown && !finished ? (alive ? 'tonight' : 'now') : played ? `${t.rounds[r].length} ${t.rounds[r].length === 1 ? 'game' : 'games'} ${open ? '▾' : '▸'}` : 'to come'}</span>
            </button>
            {open && <div className={cx('mt-sbw', t.rounds[r].length === 1 && 'one')}>{t.rounds[r].map(gameEl)}</div>}
          </div>
        );
      })}
      {champBox}
    </div>
  );

  const buttons: ReactNode = finished ? (
    <>
      <Btn onClick={onNewDraft}>New draft</Btn>
      <Btn kind="line" onClick={onBack}>
        Back to the results
      </Btn>
    </>
  ) : alive && next ? (
    <>
      <Btn onClick={() => setWatching(next)}>▶ Play the {MINI_ROUNDS[next.round]}</Btn>
      <Btn kind="line" onClick={() => setShown((s) => s + 1)}>
        Sim the game
      </Btn>
    </>
  ) : (
    <>
      <Btn onClick={() => setShown(MINI_ROUNDS.length)}>Sim to the end</Btn>
      <Btn kind="line" onClick={() => setShown((s) => s + 1)}>
        Next round
      </Btn>
    </>
  );

  const aside = (
    <>
      <Mast title={title} sub={`Tournament · ${finished ? 'final' : MINI_ROUNDS[shown]}`} />
      <section>
        <Kv k="Seed" v={`#${yourSeed} of ${seeded.length}`} />
        <Kv k="Draft grade" v={scores.get(you.id)} />
        <Kv k="Record" v={`${wins}–${losses}`} />
      </section>
      {duel}
      {road}
      <Actions links={links}>{buttons}</Actions>
    </>
  );

  return (
    <NightGame aside={aside}>
      <Prompt eb={headline[0]} title={headline[1]} now={alive && !finished}>
        {headline[2]}
      </Prompt>
      {/* a phone folds the aside into its app bar: the duel, the road and the buttons come here */}
      <div className="phone-only mt-phone">
        {duel}
        {road}
        <div className="stackb phone-only">{buttons}</div>
      </div>
      <section className="mt-bracket">
        <H3 note="seeded by the draft">The bracket</H3>
        {tree}
        {stack}
      </section>
    </NightGame>
  );
}
