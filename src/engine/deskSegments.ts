import type { PlayerSpan } from '../data/schema';
import { computeDefensiveTalent } from './defensiveTalent';
import type { DeskLine, ExpertId, RosterRead } from './desk';
import { effectiveTalent } from './grades';

/**
 * 2026-10-29 (the user, on the room: "szybko się nudzi + wygląda jak jednakowa kolejność"): besides
 * the takes, a show now and then runs one quick segment the host calls — the roster's MVP, its
 * worst pick, one word for the team — where each expert answers through his own lens from the
 * roster's real numbers, so every draft gives different answers and a different shape of show.
 * Answers are `seg` lines: not takes (a segment never counts as an expert opening on air).
 */
type Pick = { who: ExpertId; p: PlayerSpan; line: string };
const sur = (p: PlayerSpan) => p.playerName.split(' ').slice(-1)[0];
const one = (v: number) => v.toFixed(1);
const by = <T>(xs: T[], f: (x: T) => number) => [...xs].sort((a, b) => f(b) - f(a))[0];
const pick = <T>(rng: () => number, xs: T[]): T => xs[Math.floor(rng() * xs.length)];
const shuffle = <T>(rng: () => number, xs: T[]): T[] => xs.map((x) => ({ x, k: rng() })).sort((a, b) => a.k - b.k).map((o) => o.x);
const handle = (who: ExpertId, names: Record<ExpertId, string>) => `@${names[who]}`;

function mvpPicks(read: RosterRead): Pick[] {
  const all = read.all;
  const out: Pick[] = [];
  const d = by(all, computeDefensiveTalent);
  if (d) out.push({ who: 'shyman', p: d, line: `${sur(d)}. Guards everybody. Next.` });
  const s = by(all, (p) => p.box.threePA);
  if (s && s.box.threePA >= 2) out.push({ who: 'sosini', p: s, line: `${sur(s)}. ${one(s.box.threePA)} threes a game. The whole offense breathes through him. Obviously.` });
  const sc = by(all, (p) => p.box.ppg);
  if (sc) out.push({ who: 'prab', p: sc, line: `${sur(sc)}. ${one(sc.box.ppg)} a game. Gets buckets. Kobe would agree.` });
  const t = by(all, effectiveTalent);
  if (t) out.push({ who: 'lex', p: t, line: `${sur(t)}. The only real star here. Everybody else is staff.` });
  const b = read.bench[0];
  if (b) out.push({ who: 'rotation', p: b, line: `${sur(b)}. Off the bench. Nobody on this desk even noticed him. I did.` });
  if (read.steal) out.push({ who: 'natalie', p: read.steal, line: `${sur(read.steal)}. That price for that player? Theft. MVP of the spreadsheet.` });
  const r = by(all, (p) => p.box.rpg);
  if (r) out.push({ who: 'solin', p: r, line: `${sur(r)}. ${one(r.box.rpg)} rebounds. Owns the glass. Grown man.` });
  const old = by(read.preTwoK, effectiveTalent);
  if (old) out.push({ who: 'jert', p: old, line: `${sur(old)}. Pace-adjusted it isn’t close. I have the numbers. Laminated.` });
  return out;
}

function worstPicks(read: RosterRead): Pick[] {
  const playing = read.all.slice(0, 8);
  const out: Pick[] = [];
  const t = [...playing].sort((a, b) => effectiveTalent(a) - effectiveTalent(b))[0];
  if (t) out.push({ who: 'lex', p: t, line: `${sur(t)}. Who? Exactly. Staff.` });
  if (read.overpay) out.push({ who: 'natalie', p: read.overpay, line: `${sur(read.overpay)}. Fraud contract. Ate the caps and gave back vibes.` });
  if (read.turnstile) out.push({ who: 'shyman', p: read.turnstile, line: `${sur(read.turnstile)}. Can’t guard. They’ll find him.` });
  const brick = playing.filter((p) => p.box.threePA < 0.5 && p.primaryPosition !== 'C').sort((a, b) => b.box.ppg - a.box.ppg)[0];
  if (brick) out.push({ who: 'sosini', p: brick, line: `${sur(brick)}. Zero range in 2026. His defender will be sitting in the paint eating popcorn.` });
  const soft = [...playing].filter((p) => p.primaryPosition === 'C' || p.primaryPosition === 'PF').sort((a, b) => a.box.rpg - b.box.rpg)[0];
  if (soft) out.push({ who: 'solin', p: soft, line: `${sur(soft)}. ${one(soft.box.rpg)} rebounds as a big. Soft. Cupcake.` });
  return out;
}

const WORDS: Partial<Record<ExpertId, { good: string[]; bad: string[] }>> = {
  shyman: { good: ['Stops.', 'Solid.'], bad: ['Soft.', 'Turnstiles.'] },
  sosini: { good: ['Modern.', 'Spacing.'], bad: ['Bricks.', '2004.'] },
  lex: { good: ['Inevitable.', 'Dynasty.'], bad: ['Staff.', 'Lottery.'] },
  rotation: { good: ['Sustainable.', 'Depth.'], bad: ['February.', 'Fragile.'] },
  jert: { good: ['Pace-adjusted.', 'Underrated.'], bad: ['Overrated.', 'Empty calories.'] },
  natalie: { good: ['Value.', 'Efficient.'], bad: ['Overpaid.', 'Receipt.'] },
  prab: { good: ['Closers.', 'Mamba.'], bad: ['Nobody.', 'Scared.'] },
  zoran: { good: ['Beautiful.', 'Flowing.'], bad: ['Selfish.', 'Dribbling.'] },
  solin: { good: ['Grown men.', 'Tough.'], bad: ['Cupcakes.', 'Soft.'] },
};

const MVP_ASK = ['ok quick one. MVP of this roster. go', 'one player you keep from this team. one. go', 'best player on this roster, and no essays'];
const WORST_ASK = ['worst pick on this roster. be honest. you won’t be', 'who should not have been drafted here. go', 'one player you cut tomorrow. go'];
const WORD_ASK = ['one word for this team. one', 'describe this roster in one word. Jake, one WORD'];
const WRAP = ['great. very helpful. moving on', 'nobody agrees. as usual. next', 'ok that went exactly how I expected', 'I hate all of you. next'];
const COMEBACK = [
  '{at} says the guy who picked {p}',
  '{at} {p}. on air. with your whole chest. incredible',
  '{at} ok and? {p} wouldn’t make my bench',
  '{at} I’ll remember this when {p} disappears in May',
];
const JAB = [
  '{at} {p}?? be serious',
  '{at} {p}. imagine saying that on air',
  '{at} you picked {p} and you call yourself an analyst',
  '{at} {p} lmao. delete this',
];

/** One quick segment, or null when this roster can't fill one. */
export function deskSegment(read: RosterRead, good: boolean, rng: () => number, names: Record<ExpertId, string>): DeskLine[] | null {
  const kind = pick(rng, ['mvp', 'worst', 'word'] as const);
  if (kind === 'word') {
    const who = shuffle(rng, Object.keys(WORDS) as ExpertId[]).slice(0, 4);
    return [
      { who: 'host', kind: 'host', text: pick(rng, WORD_ASK), seg: kind },
      ...who.map((w) => ({ who: w, kind: 'reply' as const, text: pick(rng, WORDS[w]![good ? 'good' : 'bad']), reply: true, seg: kind })),
      { who: 'host', kind: 'host', text: pick(rng, WRAP), seg: kind },
    ];
  }
  const picks = shuffle(rng, kind === 'mvp' ? mvpPicks(read) : worstPicks(read));
  // Three different answers, three different players.
  const chosen: Pick[] = [];
  for (const p of picks) if (chosen.length < 3 && !chosen.some((c) => c.p.id === p.p.id || c.who === p.who)) chosen.push(p);
  if (chosen.length < 2) return null;
  const lines: DeskLine[] = [{ who: 'host', kind: 'host', text: pick(rng, kind === 'mvp' ? MVP_ASK : WORST_ASK), seg: kind }];
  for (const c of chosen) lines.push({ who: c.who, kind: 'reply', text: c.line, reply: true, seg: kind });
  const [a, b] = [chosen[chosen.length - 1], chosen[0]];
  lines.push({ who: a.who, kind: 'reply', text: pick(rng, JAB).replace('{at}', handle(b.who, names)).replace('{p}', sur(b.p)), reply: true, seg: kind });
  lines.push({ who: b.who, kind: 'reply', text: pick(rng, COMEBACK).replace('{at}', handle(a.who, names)).replace('{p}', sur(a.p)), reply: true, seg: kind });
  lines.push({ who: 'host', kind: 'host', text: pick(rng, WRAP), seg: kind });
  return lines;
}
