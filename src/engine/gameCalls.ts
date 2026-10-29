import type { BoxLineStats, LiveGameResult } from './liveGame';

/**
 * 2026-10-15 (playtest: "cała transmisja jest bardzo sztywna, fajnie jakby to był bardziej
 * komentowany mecz"): the commentator's lines for a live game, read off its moments — milestones,
 * hot and cold hands, one player carrying his team, droughts, the biggest lead, a comeback, the
 * last two minutes and the shooting at the half. Facts of this game only: nothing here says how
 * good a player is beyond what he has done tonight. Pure and deterministic, so the feed can show
 * the lines up to wherever the game is.
 */
export interface GameCall {
  /** The moment the line is said after. */
  at: number;
  side?: 0 | 1;
  text: string;
}

/** Points to call; 20 only while it is still early (the first half). */
const MILESTONES = [20, 30, 40, 50];
/** Straight makes to call a hot hand, then again at each step past it. */
const HOT_FROM = 5;
const HOT_STEP = 3;
/** Straight misses to call a cold spell. */
const COLD_FROM = 5;
const COLD_STEP = 3;
/** A team's points in a row by one man. */
const SOLO_FROM = 8;
const SOLO_STEP = 4;
/** Game-clock seconds without a field goal, and the longer one whose end gets its own line. */
const DROUGHT = 180;
const DROUGHT_END = 240;
/** A lead worth calling, and the step before the next call. */
const LEAD_FROM = 12;
const LEAD_STEP = 5;
const COMEBACK_FROM = 10;
const CLUTCH_LEFT = 120;
const CLUTCH_MARGIN = 5;
/** At most this many lines after one play, so the feed stays a feed. */
const PER_MOMENT = 2;
/** Plays between two of the lesser lines (streaks, droughts, leads); milestones and the clock always speak. */
const GAP = 4;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const shooting = (lines: BoxLineStats[]) => {
  const t = lines.reduce((s, l) => ({ fgm: s.fgm + l.fgm, fga: s.fga + l.fga, tpm: s.tpm + l.tpm, tpa: s.tpa + l.tpa }), { fgm: 0, fga: 0, tpm: 0, tpa: 0 });
  return `${t.fgm}/${t.fga} FG (${t.fga ? Math.round((100 * t.fgm) / t.fga) : 0}%), ${t.tpm}/${t.tpa} 3P`;
};
const tens = (l: BoxLineStats) => [l.pts, l.reb, l.ast, l.stl, l.blk].filter((v) => v >= 10).length;
const statLine = (l: BoxLineStats) => {
  const parts = [`${l.pts} pts`, `${l.reb} reb`, `${l.ast} ast`];
  if (l.stl >= 10) parts.push(`${l.stl} stl`);
  if (l.blk >= 10) parts.push(`${l.blk} blk`);
  return parts.join(', ');
};

export function gameCalls(game: LiveGameResult, short: [string, string]): GameCall[] {
  // The daily calls your side "You".
  const you = (side: 0 | 1) => short[side] === 'You';
  const their = (side: 0 | 1) => (you(side) ? 'your' : 'their');
  const theyLead = (side: 0 | 1) => (you(side) ? 'you lead' : 'they lead');
  const teams = (side: 0 | 1) => (you(side) ? 'your' : `the ${short[side].endsWith('s') ? `${short[side]}'` : `${short[side]}'s`}`);
  const calls: GameCall[] = [];
  const n = game.labels.map((l) => l.length);
  const hot = [new Array(n[0]).fill(0), new Array(n[1]).fill(0)];
  const cold = [new Array(n[0]).fill(0), new Array(n[1]).fill(0)];
  const solo: [{ k: number; pts: number; called: number }, { k: number; pts: number; called: number }] = [
    { k: -1, pts: 0, called: 0 },
    { k: -1, pts: 0, called: 0 },
  ];
  const lastMake = [game.gameSeconds ?? 2880, game.gameSeconds ?? 2880];
  const droughtCalled = [false, false];
  const leadCalled = [0, 0];
  const deficit = [0, 0];
  let clutchCalled = false;
  let lastLesser = -GAP;
  const empty = (side: 0 | 1) => game.labels[side].map(() => ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, pf: 0, min: 0 }));
  let prev: [BoxLineStats[], BoxLineStats[]] = [empty(0), empty(1)];
  let prevScore: [number, number] = [0, 0];

  game.moments.forEach((m, i) => {
    const here: (GameCall & { rank: number })[] = [];
    const say = (rank: number, text: string, side?: 0 | 1) => here.push({ at: i, side, text, rank });
    for (const side of [0, 1] as const) {
      const team = short[side];
      const madeFg = m.lines[side].reduce((s, l) => s + l.fgm, 0) > prev[side].reduce((s, l) => s + l.fgm, 0);
      if (madeFg) {
        const dry = lastMake[side] - m.left;
        if (droughtCalled[side] && dry >= DROUGHT_END) say(3, `${team} end a ${clock(dry)} field-goal drought`, side);
        lastMake[side] = m.left;
        droughtCalled[side] = false;
      } else if (!droughtCalled[side] && lastMake[side] - m.left >= DROUGHT && m.left > 0) {
        droughtCalled[side] = true;
        say(4, `${team} haven't scored from the field in ${Math.floor((lastMake[side] - m.left) / 60)} minutes`, side);
      }
      m.lines[side].forEach((l, k) => {
        const was = prev[side][k];
        const label = game.labels[side][k];
        const shots = l.fga - was.fga;
        if (shots > 0) {
          const made = l.fgm - was.fgm;
          if (made === shots) {
            hot[side][k] += made;
            cold[side][k] = 0;
          } else {
            hot[side][k] = made > 0 ? 1 : 0;
            cold[side][k] = made > 0 ? 0 : cold[side][k] + shots;
          }
          const h = hot[side][k];
          if (h >= HOT_FROM && (h - HOT_FROM) % HOT_STEP === 0 && made > 0) say(2, `${label} has hit ${h} straight — ${l.fgm}/${l.fga} tonight`, side);
          const c = cold[side][k];
          if (c >= COLD_FROM && (c - COLD_FROM) % COLD_STEP === 0) say(5, `${label} has missed ${c} in a row`, side);
        }
        const mile = MILESTONES.filter((v) => was.pts < v && l.pts >= v && (v > 20 || m.quarter <= 1)).pop();
        if (mile) say(1, `${label} has ${l.pts} — ${l.fgm}/${l.fga} from the field${l.tpm ? `, ${l.tpm} three${l.tpm > 1 ? 's' : ''}` : ''}`, side);
        const t = tens(l);
        if (t >= 2 && tens(was) < t) say(1, `${t >= 3 ? 'Triple' : 'Double'}-double for ${label}: ${statLine(l)}`, side);
      });
      const scored = m.score[side] - prevScore[side];
      if (scored > 0) {
        const k = m.lines[side].findIndex((l, j) => l.pts > prev[side][j].pts);
        const s = solo[side];
        if (k === s.k) s.pts += scored;
        else Object.assign(s, { k, pts: scored, called: 0 });
        solo[1 - side].k = -1;
        solo[1 - side].pts = 0;
        if (k >= 0 && s.pts >= SOLO_FROM && s.pts >= s.called + SOLO_STEP) {
          s.called = s.pts;
          say(2, `${game.labels[side][k]} has scored ${teams(side)} last ${s.pts}`, side);
        }
      }
    }
    const margin = m.score[0] - m.score[1];
    for (const side of [0, 1] as const) {
      const lead = side === 0 ? margin : -margin;
      if (lead >= LEAD_FROM && lead >= leadCalled[side] + LEAD_STEP) {
        leadCalled[side] = lead;
        say(3, `${short[side]} lead by ${lead}, ${their(side)} biggest of the game`, side);
      }
      if (lead < 0) deficit[side] = Math.max(deficit[side], -lead);
      else if (deficit[side] >= COMEBACK_FROM) {
        say(1, lead === 0 ? `${short[side]} were down ${deficit[side]} — all square at ${m.score[0]}` : `${short[side]} were down ${deficit[side]} — now ${theyLead(side)}`, side);
        deficit[side] = 0;
      }
    }
    if (!clutchCalled && m.quarter >= 3 && m.left <= CLUTCH_LEFT && Math.abs(margin) <= CLUTCH_MARGIN) {
      clutchCalled = true;
      say(0, `Under two minutes, ${margin === 0 ? 'all square' : `a ${Math.abs(margin)}-point game`}`);
    }
    const next = game.moments[i + 1];
    if (m.quarter === 1 && next && next.quarter === 2) say(0, `At the half: ${short[0]} ${shooting(m.lines[0])} · ${short[1]} ${shooting(m.lines[1])}`);
    here.sort((a, b) => a.rank - b.rank);
    const kept = here.filter((c) => c.rank <= 1 || i - lastLesser >= GAP).slice(0, PER_MOMENT);
    if (kept.some((c) => c.rank > 1)) lastLesser = i;
    for (const c of kept) calls.push({ at: c.at, side: c.side, text: c.text });
    prev = m.lines;
    prevScore = m.score;
  });
  return calls;
}

/** A few broadcast words for the same play, picked by its place in the game so a replay says the
 * same. Only the wording after the player's name changes; the feed still reads the play's own text
 * for its numbers. */
const SAY: [string, string[]][] = [
  ['corner three', ['corner three', 'from the corner — three', 'buries the corner three']],
  ['three', ['three', 'knocks down a three', 'from downtown', 'drills a three']],
  ['on the break — dunk', ['on the break — dunk', 'runs out and throws it down', 'finishes the break with a dunk']],
  ['on the break — layup', ['on the break — layup', 'leads the break and lays it in']],
  ['putback', ['putback', 'cleans up the miss', 'tips it back in']],
  ['misses a three', ['misses a three', 'three rims out', "can't get the three to fall"]],
  ['misses at the rim', ['misses at the rim', "can't finish at the rim", 'layup rolls off']],
  ['misses a jumper', ['misses a jumper', 'jumper off the mark', 'jumper rims out']],
];

export function sayPlay(text: string, label: string, at: number): string {
  if (!text.startsWith(`${label} `)) return text;
  const rest = text.slice(label.length + 1);
  for (const [plain, ways] of SAY) {
    if (rest === plain || rest.startsWith(`${plain} `) || rest.startsWith(`${plain},`)) return `${label} ${ways[(at * 7 + 3) % ways.length]}${rest.slice(plain.length)}`;
  }
  return text;
}
