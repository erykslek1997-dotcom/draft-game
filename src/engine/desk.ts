import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import { effectiveTalent } from './grades';
import type { InsightCategory, RosterInsight } from './insights';
import { mixSeed, mulberry32 } from './rng';
import { teamsForSpan } from './spanTeams';
import type { Team } from './types';

/**
 * 2026-10-14, "The Desk" (user: twelve named pundits instead of The Coach / The Analyst / The
 * Scout; mockup https://claude.ai/artifact/NJFXtxXxKQgtybQPJBbXrc). A TV-studio panel: each expert
 * reads the roster through his own lens (-1 hates it, +1 loves it), the strongest opinions go on
 * air (at least one each way), rivals answer each other, and the host opens and closes. The
 * analysis itself still comes from the validated insight detectors (insights.ts) — an expert only
 * gives a finding of his own field its voice — so the panel never says anything the engine
 * doesn't measure. Flavour (eras, Kobe, Celtics, caps, stars) comes from the roster itself.
 *
 * Fictional characters (user's decision): their tics are inspired by the user's own league, with
 * the players' consent; no real names appear anywhere in the game.
 *
 * Bart Moonbat is the wildcard: on air about one show in four, never alone, and right about three
 * times in ten — only when the roster really holds a bargain he can (for a silly reason) praise, so
 * he never misleads the player. Micheal Rightwing exists to answer him.
 */

export type ExpertId =
  | 'host' | 'sosini' | 'shyman' | 'solin' | 'binash' | 'jert' | 'rotation' | 'rightwing' | 'batt' | 'prab'
  | 'onoffsky' | 'moonbat' | 'bannerman' | 'natalie' | 'jeremy' | 'lex' | 'zoran';

export interface Expert {
  id: ExpertId;
  name: string;
  /** Two letters for the badge. */
  mono: string;
  hue: number;
  tag: string;
}

export const DESK_CAST: Record<ExpertId, Expert> = {
  host: { id: 'host', name: 'Eric B. Slim', mono: 'ES', hue: 45, tag: 'Host' },
  sosini: { id: 'sosini', name: 'Mattia Sosini', mono: 'SO', hue: 200, tag: 'Modern game' },
  shyman: { id: 'shyman', name: 'Matt Shyman', mono: 'SH', hue: 145, tag: 'Defense' },
  solin: { id: 'solin', name: 'Davyd Solinhakov', mono: 'SK', hue: 20, tag: 'Gritty 2000s' },
  binash: { id: 'binash', name: 'Jacob Binash', mono: 'BI', hue: 330, tag: "The '80s" },
  jert: { id: 'jert', name: 'Mattheus Jertcheck', mono: 'JE', hue: 40, tag: 'Before 2000' },
  rotation: { id: 'rotation', name: 'Mark Rotation', mono: 'RO', hue: 260, tag: 'Bench depth' },
  rightwing: { id: 'rightwing', name: 'Micheal Rightwing', mono: 'RW', hue: 0, tag: "Moonbat's rival" },
  batt: { id: 'batt', name: 'Filippo Batterista', mono: 'BT', hue: 175, tag: 'Two-way' },
  prab: { id: 'prab', name: 'Mikhail Prabuckov', mono: 'PR', hue: 275, tag: 'Kobe' },
  onoffsky: { id: 'onoffsky', name: 'Jake Onoffsky', mono: 'ON', hue: 215, tag: 'Numbers' },
  moonbat: { id: 'moonbat', name: 'Bart Moonbat', mono: 'MB', hue: 55, tag: 'Hot takes' },
  bannerman: { id: 'bannerman', name: 'Igor Bannerman', mono: 'BN', hue: 130, tag: 'Celtics' },
  natalie: { id: 'natalie', name: 'Natalie Novacka', mono: 'NN', hue: 350, tag: 'Capologist' },
  jeremy: { id: 'jeremy', name: 'Jeremy May', mono: 'MA', hue: 5, tag: "The '90s & Jordan" },
  lex: { id: 'lex', name: 'Lex Superteam', mono: 'SU', hue: 300, tag: 'Stars only' },
  zoran: { id: 'zoran', name: 'Zoran Eurostep', mono: 'EU', hue: 225, tag: 'International' },
};

export type DeskKind = 'host' | 'praise' | 'concern' | 'take' | 'right' | 'fact' | 'reply' | 'defends' | 'burst';

export interface DeskLine {
  who: ExpertId;
  kind: DeskKind;
  /** May hold stage cues as *text* (rendered small and grey). */
  text: string;
  /** Indented under the line before it. */
  reply?: boolean;
}

/** Whose field each insight category is. */
const CATEGORY_EXPERT: Record<InsightCategory, ExpertId> = {
  spacing: 'sosini',
  shooting: 'sosini',
  perimeter_defense: 'shyman',
  rim_protection: 'shyman',
  defensive_structure: 'shyman',
  rebounding: 'solin',
  rotation: 'rotation',
  depth: 'rotation',
  fga: 'natalie',
  creation: 'prab',
  off_ball: 'jeremy',
  usage: 'zoran',
  two_way: 'batt',
  fit: 'onoffsky',
  redundancy: 'onoffsky',
  position: 'onoffsky',
  cross: 'onoffsky',
};

/** Players the international lens counts (no birthplace in the data, so a curated list). */
const INTERNATIONAL = new Set(
  [
    'Dirk Nowitzki', 'Nikola Jokic', 'Giannis Antetokounmpo', 'Luka Doncic', 'Hakeem Olajuwon', 'Tony Parker', 'Manu Ginobili',
    'Pau Gasol', 'Marc Gasol', 'Drazen Petrovic', 'Toni Kukoc', 'Vlade Divac', 'Arvydas Sabonis', 'Peja Stojakovic',
    'Dikembe Mutombo', 'Steve Nash', 'Yao Ming', 'Andrei Kirilenko', 'Hedo Turkoglu', 'Mehmet Okur', 'Zydrunas Ilgauskas',
    'Rudy Gobert', 'Joel Embiid', 'Pascal Siakam', 'Domantas Sabonis', 'Kristaps Porzingis', 'Nikola Vucevic', 'Boris Diaw',
    'Goran Dragic', 'Bojan Bogdanovic', 'Danilo Gallinari', 'Detlef Schrempf', 'Sarunas Marciulionis', 'Rik Smits',
    'Serge Ibaka', 'Al Horford', 'Ben Simmons', 'Patty Mills', 'Andrew Bogut', 'Victor Wembanyama', 'Shai Gilgeous-Alexander',
    'Jamal Murray', 'Andrew Wiggins', 'Dennis Schroder', 'Franz Wagner', 'Lauri Markkanen', 'Alperen Sengun',
    'Jonas Valanciunas', 'Bogdan Bogdanovic', 'Luis Scola', 'Nene', 'Anderson Varejao', 'Ricky Rubio', 'Jose Calderon',
    'Nicolas Batum', 'Evan Fournier', 'Joakim Noah', 'Clint Capela', 'Thabo Sefolosha', 'Marcin Gortat', 'Patrick Ewing',
    'Tim Duncan', 'Kyrie Irving', 'Josh Giddey', 'Deni Avdija', 'Jusuf Nurkic', 'Ersan Ilyasova', 'Zaza Pachulia',
  ].map(normalizePlayerName),
);

const NAME_SUFFIXES = new Set(['Jr.', 'Sr.', 'II', 'III', 'IV']);
/** Last name the way a TV desk says it. */
const NAME_PARTICLES = new Set(['van', 'von', 'de', 'del', 'della', 'di', 'da', 'la', 'le', 'st.', 'world']);
function surname(p: PlayerSpan): string {
  const parts = p.playerName.split(' ').filter((w) => !NAME_SUFFIXES.has(w));
  if (parts.length >= 3 && NAME_PARTICLES.has(parts[parts.length - 2].toLowerCase())) return parts.slice(-2).join(' ');
  return parts[parts.length - 1] ?? p.playerName;
}
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
/** The year a span is "from": its middle season, so a 1998-00 run reads as the ’90s. */
const eraYear = (p: PlayerSpan) => {
  const ys = spanEndYears(p.spanLabel);
  return ys.length ? ys[Math.floor((ys.length - 1) / 2)] : 2000;
};
const teamCodes = (p: PlayerSpan) => teamsForSpan(p).map((t) => t.code);
const caps = (p: PlayerSpan) => Math.round(p.fga);

/** What the flavour lenses see in a roster. */
export interface RosterRead {
  modern: PlayerSpan[];
  old: PlayerSpan[];
  eighties: PlayerSpan[];
  nineties: PlayerSpan[];
  aughts: PlayerSpan[];
  preTwoK: PlayerSpan[];
  celtics: PlayerSpan[];
  lakers: PlayerSpan[];
  kobe: PlayerSpan | undefined;
  jordan: PlayerSpan | undefined;
  international: PlayerSpan[];
  stars: PlayerSpan[];
  /** The best value per cap: real talent at a small price. */
  steal: PlayerSpan | undefined;
  /** The worst: a big price for what he gives. */
  overpay: PlayerSpan | undefined;
}

/** Talent at or above this is a star (the top of the effective-talent scale). */
const STAR_TALENT = 90;

export function readRoster(team: Team): RosterRead {
  const all = team.roster;
  const starterIds = new Set(team.rotation ? Object.values(team.rotation.slots).map((s) => s[0]?.playerId).filter(Boolean) : all.slice(0, 5).map((p) => p.id));
  const starters = all.filter((p) => starterIds.has(p.id));
  const by = (f: (y: number) => boolean) => all.filter((p) => f(eraYear(p)));
  const valueOf = (p: PlayerSpan) => effectiveTalent(p) - 2.2 * p.fga;
  const steals = all.filter((p) => effectiveTalent(p) >= 66 && p.fga <= 8 && valueOf(p) >= 55).sort((a, b) => valueOf(b) - valueOf(a));
  const overpays = all.filter((p) => p.fga >= 17 && effectiveTalent(p) < 86).sort((a, b) => valueOf(a) - valueOf(b));
  return {
    modern: by((y) => y >= 2011),
    old: by((y) => y <= 1979),
    eighties: by((y) => y >= 1980 && y <= 1990),
    nineties: by((y) => y >= 1991 && y <= 1999),
    aughts: by((y) => y >= 2000 && y <= 2010),
    preTwoK: by((y) => y < 2000),
    celtics: all.filter((p) => teamCodes(p).includes('BOS')),
    lakers: all.filter((p) => teamCodes(p).some((c) => c === 'LAL' || c === 'MNL')),
    kobe: all.find((p) => p.playerName === 'Kobe Bryant'),
    jordan: all.find((p) => p.playerName === 'Michael Jordan'),
    international: all.filter((p) => INTERNATIONAL.has(normalizePlayerName(p.playerName))),
    stars: starters.filter((p) => effectiveTalent(p) >= STAR_TALENT),
    steal: steals[0],
    overpay: overpays[0],
  };
}

interface Take {
  who: ExpertId;
  /** -1..1: how strongly, and which way. */
  score: number;
  line: DeskLine;
  /** Which flavour lens produced it; rival replies answer only these, never an engine finding. */
  lens?: 'kobe' | 'lakers' | 'old' | 'modern' | 'celtics' | 'eighties' | 'preTwoK' | 'stars';
}

const pick = <T,>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const names = (ps: PlayerSpan[], n = 3) => list(ps.slice(0, n).map(surname));

/** Each expert's voice around an engine finding. `{m}` is the finding's own sentence. */
const VOICE: Partial<Record<ExpertId, { praise: string[]; concern: string[] }>> = {
  sosini: { praise: ['Respectfully? {m} Finally, somebody gets it.', '{m} *nods* That is basketball in this century.'], concern: ['Respectfully. {m} 🥱', '{m} I mean… respectfully, no.'] },
  shyman: { praise: ['STOPS! {m}', '{m} *rubs his arms* I have actual chills.'], concern: ['Can we talk defense? {m} I’m getting a headache.', '{m} Stops? There won’t be any. None.'] },
  solin: { praise: ['{m} That’s grown-man basketball.', '{m} Back in ’04 that’s a toll booth.'], concern: ['{m} Soft. Way too soft.', '{m} Nobody’s scared of this team.'] },
  rotation: { praise: ['{m} *exhales* Finally, a bench I can trust.', '{m} Love you guys. Good game.'], concern: ['{m} Somebody call a doctor. Call two.', '{m} I love you guys, but no.'] },
  natalie: { praise: ['{m} That’s how you spend money.', '{m} Under budget AND good? Marry me.'], concern: ['{m} *closes the laptop very slowly*', 'Rules are rules. {m}'] },
  prab: { praise: ['{m} Kobe would sign off on that, my friend.', '{m} That’s a closer. That’s a CLOSER.'], concern: ['{m} Who takes the last shot? Exactly.', '{m} Kobe would never.'] },
  jeremy: { praise: ['{m} Go watch the tape. Textbook.', '{m} Pure ’90s off-ball work.'], concern: ['{m} Go watch the tape, then we talk.', '{m} Michael would have run them off three screens.'] },
  zoran: { praise: ['{m} *hand on heart* The ball moves. Beautiful.', '{m} Listen to me: that is European basketball.'], concern: ['{m} Listen to me: one ball, five guys. In Europe we call that a problem.', '{m} *hand on heart* The ball is crying.'] },
  batt: { praise: ['Do they play both ends? Yes. {m}', '{m} Two ends. Two! Bellissimo.'], concern: ['Do they guard anybody? No. {m}', '{m} Half a team, then.'] },
  onoffsky: { praise: ['{m} The numbers agree, for once.', '*adjusts glasses* {m}'], concern: ['*adjusts glasses* {m}', 'Verily, one must contemplate the evidence. {m}'] },
};

function voiced(rng: () => number, who: ExpertId, kind: 'praise' | 'concern', message: string): string {
  const v = VOICE[who];
  if (!v) return message;
  const m = message.trim();
  return pick(rng, v[kind]).replace('{m}', /[.!?…]$/.test(m) ? m : `${m}.`);
}

/** The flavour takes a roster gives each lens. */
function flavourTakes(read: RosterRead): Take[] {
  const out: Take[] = [];
  const add = (who: ExpertId, score: number, kind: DeskKind, text: string, lens?: Take['lens']) => out.push({ who, score, line: { who, kind, text }, lens });
  if (read.celtics.length >= 2) add('bannerman', 0.4 + 0.15 * read.celtics.length, 'praise', `*stands up* ${read.celtics.slice(0, 4).map(surname).join('! ')}! That’s Celtic DNA. I might actually cry.`, 'celtics');
  else if (read.celtics.length === 1 && read.celtics[0].playerName === 'Bill Russell') add('bannerman', 0.5, 'praise', 'Bill Russell. Eleven rings. ELEVEN. *points at the ceiling* I rest my case.', 'celtics');
  else if (read.celtics.length === 1) add('bannerman', 0.35, 'praise', `${surname(read.celtics[0])}. One Celtic. It’s a start. Count the banners, then we’ll talk.`);
  else if (read.lakers.length >= 2) add('bannerman', -0.45, 'concern', `${names(read.lakers)} in purple and gold. *shudders* The Celtics underground is already on its way.`);
  if (read.kobe) add('prab', 0.9, 'praise', `Kobe! KOBE! ${read.kobe.spanLabel} Kobe! The rest of this roster is a supporting cast, my friend.`, 'kobe');
  else if (read.lakers.length >= 2) add('prab', 0.4, 'praise', `${names(read.lakers)}. Lakers. I respect it. Not Kobe, but I respect it.`, 'lakers');
  if (read.jordan) add('jeremy', 0.9, 'praise', 'Michael Jordan. Six Finals. Six rings. Zero Game 7s. Next question.');
  else if (read.nineties.length >= 3) add('jeremy', 0.55, 'praise', `${names(read.nineties)} — that’s ’90s basketball. Go watch the tape.`);
  else if (read.kobe) add('jeremy', -0.4, 'concern', 'Kobe’s great. He’s not Michael. Go watch the ’98 tape, then we talk.');
  if (read.eighties.length >= 2) add('binash', 0.35 + 0.1 * read.eighties.length, 'praise', `${names(read.eighties)} from the ’80s! Oh, I’m home. Somebody find me a tape deck and a pair of short shorts.`, 'eighties');
  if (read.preTwoK.length >= 6) add('jert', 0.7, 'praise', `${read.preTwoK.length} guys from before 2000. Kids today couldn’t handle this team. Couldn’t.`, 'preTwoK');
  else if (read.preTwoK.length === 0) add('jert', -0.6, 'concern', 'Not one player from before 2000? Kids today. Moses Malone is rolling his eyes somewhere.');
  if (read.old.length >= 2) add('sosini', -0.4 - 0.1 * read.old.length, 'concern', `${names(read.old)}. 🥱 Respectfully — does this team come with a time machine, or do we rent one?`, 'old');
  else if (read.modern.length >= 6) add('sosini', 0.6, 'praise', 'Everybody on this roster could play tonight. Respectfully, that’s the whole point.', 'modern');
  if (read.aughts.length >= 3) add('solin', 0.55, 'praise', `${names(read.aughts)} — that’s 2004 in a jar. Somebody’s getting fouled hard and nobody’s apologising.`);
  if (read.stars.length >= 3) add('lex', 0.75, 'praise', `${names(read.stars)}! STARS WIN! Benches are for people who couldn’t draft stars!`, 'stars');
  else if (read.stars.length <= 1) add('lex', -0.5, 'concern', read.stars.length === 1 ? `${surname(read.stars[0])} and… who? One star? ONE? Where’s the dynasty?` : 'No stars. Zero. You built a very nice team of role players. Congratulations.');
  if (read.international.length >= 2) add('zoran', 0.3 + 0.15 * read.international.length, 'praise', `${names(read.international)}! *hand on heart* Finally, a roster that has seen a passport.`);
  if (read.steal) add('natalie', 0.6, 'praise', `${surname(read.steal)} for ${caps(read.steal)} caps? Somebody call the police. That’s theft.`);
  else if (read.overpay) add('natalie', -0.6, 'concern', `Rules are rules: 100.9 caps. ${surname(read.overpay)} ate ${caps(read.overpay)} of them. *closes the laptop very slowly*`);
  return out;
}

/** Rivals answer each other when both are on air (or the rival walks in for it). */
function rivalReply(a: Take, read: RosterRead): DeskLine[] {
  switch (a.who) {
    case 'bannerman':
      if (read.kobe && a.lens === 'celtics') return [
        { who: 'prab', kind: 'reply', text: 'Celtic DNA?! The best player in that building is Kobe, my friend. KOBE!', reply: true },
        { who: 'bannerman', kind: 'reply', text: '*grinning* Love that for him. Ask him how the 2008 Finals went.', reply: true },
        { who: 'prab', kind: 'reply', text: '*long pause* …We don’t talk about 2008.', reply: true },
      ];
      return [];
    case 'prab':
      if (!read.jordan && a.lens === 'kobe') return [
        { who: 'jeremy', kind: 'reply', text: 'Relax. It’s not like it’s Jordan.', reply: true },
        { who: 'prab', kind: 'reply', text: '*stands up* Say that to my face, Jeremy.', reply: true },
      ];
      return [];
    case 'sosini':
      if (a.lens === 'old') return [{ who: 'jert', kind: 'reply', text: `Time machine? ${surname(read.old[0])} would eat your favourite player for breakfast, kid. And lunch.`, reply: true }];
      if (a.lens === 'modern') return [{ who: 'jert', kind: 'reply', text: 'Kids today. Let’s see this “whole point” against a 1986 frontcourt.', reply: true }];
      return [];
    case 'jert':
    case 'binash':
      if (a.lens === 'eighties' || a.lens === 'preTwoK') return [{ who: 'sosini', kind: 'reply', text: '🥱 Respectfully, can we score it already?', reply: true }];
      return [];
    case 'lex':
      if (a.lens === 'stars') return [{ who: 'rotation', kind: 'reply', text: 'Stars win until February, Lex. Then the bench plays. *softens* Love you, man.', reply: true }];
      return [];
    default:
      return [];
  }
}

/** Moonbat's bit: a hot take (right about 3 in 10, and only when it really is a bargain), then
 * Rightwing — and when he's right, someone defends him. */
/** What Moonbat says when he's right about a team's real best strength, for the wrong reason. */
const MOONBAT_RIGHT_BY_CATEGORY: Partial<Record<InsightCategory, string>> = {
  perimeter_defense: 'this team defends. i can smell it.',
  rim_protection: 'nobody’s getting a layup here. tall guys. trust me.',
  defensive_structure: 'this team defends. i can smell it.',
  spacing: 'they shoot. i watched one highlight. that’s enough.',
  shooting: 'they shoot. i watched one highlight. that’s enough.',
  creation: 'somebody here can get a bucket. the vibes say so.',
  rotation: 'the bench is good. benches love me.',
  depth: 'the bench is good. benches love me.',
  rebounding: 'rebounds are basically points you get twice.',
  two_way: 'they play both ends. i counted. two ends.',
  off_ball: 'they move without the ball. like ghosts. i love ghosts.',
  fit: 'these guys fit. i can tell from the jerseys.',
  cross: 'this team is good at the good thing. trust me.',
  usage: 'everybody gets the ball. that’s sharing. sharing wins.',
  position: 'everybody’s in the right spot. like chess. i don’t play chess.',
  redundancy: 'no two guys are the same. very diverse. love it.',
  fga: 'they’re cheap. cheap is good. i’m cheap.',
};

function moonbatBit(read: RosterRead, rng: () => number, place: number, onAir: ReadonlySet<ExpertId> = new Set(), topStrength?: RosterInsight): DeskLine[] {
  const steal = read.steal;
  const right = rng() < 0.3;
  const strengthLine = topStrength ? MOONBAT_RIGHT_BY_CATEGORY[topStrength.category] : undefined;
  if (right && !steal && topStrength && strengthLine) {
    const expert = CATEGORY_EXPERT[topStrength.category];
    const defender: ExpertId = expert === 'moonbat' || expert === 'rightwing' ? 'onoffsky' : expert;
    return [
      { who: 'moonbat', kind: 'right', text: strengthLine },
      { who: 'rightwing', kind: 'reply', text: 'Bart. *sighs* That is not how any of this works.', reply: true },
      { who: defender, kind: 'defends', text: '…He’s right, though. *the whole desk turns* That IS this team’s best thing. Wrong reason. Right answer.', reply: true },
      { who: 'rightwing', kind: 'reply', text: '*through gritted teeth* Fine. Once. Don’t you dare get used to it.', reply: true },
      { who: 'moonbat', kind: 'reply', text: '*already printing the T-shirt* too late. peace ✌️', reply: true },
    ];
  }
  if (steal && right) {
    const defender: ExpertId = onAir.has('natalie') ? 'onoffsky' : 'natalie';
    return [
      { who: 'moonbat', kind: 'right', text: `${surname(steal).toLowerCase()} for ${caps(steal)}.` },
      { who: 'moonbat', kind: 'burst', text: `steal of the draft. ${pick(rng, ['cheap guys try harder.', 'his name sounds fast.', 'rebounds are basically points you get twice.'])}` },
      { who: 'rightwing', kind: 'reply', text: 'Bart. *sighs* That is not how any of this works.', reply: true },
      defender === 'natalie'
        ? { who: 'natalie', kind: 'defends', text: `…He’s right. ${caps(steal)} caps for that? Theft. Bart, I could kiss you.`, reply: true }
        : { who: 'onoffsky', kind: 'defends', text: `…He’s right. *the whole desk turns* That much player for ${caps(steal)} caps. Wrong reason. Right pick.`, reply: true },
      { who: 'rightwing', kind: 'reply', text: '*through gritted teeth* Fine. Once. Don’t you dare get used to it.', reply: true },
      { who: 'moonbat', kind: 'reply', text: '*already printing the T-shirt* too late. peace ✌️', reply: true },
    ];
  }
  const target = read.overpay;
  if (target) {
    return [
      { who: 'moonbat', kind: 'take', text: `${surname(target).toLowerCase()}.` },
      { who: 'moonbat', kind: 'burst', text: 'best pick of the draft. didn’t read the numbers. don’t need to.' },
      { who: 'rightwing', kind: 'reply', text: `*rubs temples* Bart. He ate ${caps(target)} caps and you finished ${ordinal(place)}.`, reply: true },
      { who: 'moonbat', kind: 'reply', text: 'agree to disagree. peace ✌️ *high-fives nobody*', reply: true },
    ];
  }
  return [
    { who: 'moonbat', kind: 'take', text: 'didn’t watch it.' },
    { who: 'moonbat', kind: 'burst', text: `${ordinal(place)} is a typo. freestyle.` },
    { who: 'rightwing', kind: 'reply', text: `*slowly* It’s not a typo, Bart. It’s a standings table. They come in order.`, reply: true },
  ];
}

/** About one show in four — its own stream, so it doesn't depend on how many lines came before. */
function moonbatOnAir(seed: number): boolean {
  return mulberry32(mixSeed(seed, 0x30ba))() < 0.25;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const HOST_OPEN: Record<'won' | 'podium' | 'middle' | 'bottom', string[]> = {
  won: ['CHAMPIONS! The {team} take it all! Okay, okay — panel, go.', 'Title for the {team}! Somebody stop Igor from crying. Panel?'],
  podium: ['{place} for the {team}. Podium! Panel — be nice. Or don’t.', '{place} place, {team}. So close you can smell it. Go.'],
  middle: ['{place} for the {team}. Not great, not terrible. Who wants it?', 'The {team} land {place}. Panel, I can see you vibrating. Go.'],
  bottom: ['{place}. {place}, for the {team}. Somebody explain this to me.', 'The {team}, {place}. Deep breaths, everybody. Go.'],
};

export interface DeskInput {
  team: Team;
  /** Ranked strengths and concerns from `generateRosterInsights`. */
  strengths: RosterInsight[];
  concerns: RosterInsight[];
  rank: number;
  fieldSize: number;
  /** How the team plays (styleLines.ts) — Jeremy's tape. */
  style?: string;
  /** One thing to try next draft (the host closes with it); omitted on the podium. */
  tip?: string;
  /** Replays the same panel for the same draft. */
  seed: number;
}

/** Your team's panel on the results screen. */
export function buildDesk({ team, strengths, concerns, rank, fieldSize, style, tip, seed }: DeskInput): DeskLine[] {
  const rng = mulberry32(mixSeed(seed, 0xde5c));
  const read = readRoster(team);
  const tier = rank === 1 ? 'won' : rank <= 3 ? 'podium' : rank <= Math.ceil(fieldSize / 2) ? 'middle' : 'bottom';
  const lines: DeskLine[] = [
    { who: 'host', kind: 'host', text: pick(rng, HOST_OPEN[tier]).replace(/\{team\}/g, team.name).replace(/\{place\}/g, ordinal(rank)) },
  ];

  // Engine findings, each in its expert's voice. The podium hears mostly what worked.
  const insightTakes: Take[] = [
    ...strengths.slice(0, rank <= 3 ? 3 : 2).map((i) => {
      const who = CATEGORY_EXPERT[i.category];
      return { who, score: 0.5 + 0.5 * Math.min(1, i.score), line: { who, kind: 'praise' as const, text: voiced(rng, who, 'praise', i.message) } };
    }),
    ...concerns.slice(0, rank <= 3 ? 1 : 2).map((i) => {
      const who = CATEGORY_EXPERT[i.category];
      return { who, score: -(0.5 + 0.5 * Math.min(1, i.score)), line: { who, kind: 'concern' as const, text: voiced(rng, who, 'concern', i.message) } };
    }),
  ];
  if (style) insightTakes.push({ who: 'jeremy', score: 0.45, line: { who: 'jeremy', kind: 'praise', text: `${style} Go watch the tape.` } });
  const flavour = flavourTakes(read).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  // Up to five voices: three engine findings first (they are the analysis), then the two strongest
  // flavour takes, one take per expert, keeping at least one on each side.
  const onAir: Take[] = [];
  const used = new Set<ExpertId>();
  const firstConcern = insightTakes.find((t) => t.score < 0);
  if (firstConcern) { onAir.push(firstConcern); used.add(firstConcern.who); }
  for (const t of insightTakes) if (t !== firstConcern && !used.has(t.who) && onAir.length < 3) { onAir.push(t); used.add(t.who); }
  // The bottom half doesn't get a love-in: praise stops at two voices there (three mid-table).
  const praiseCap = tier === 'bottom' ? 2 : tier === 'middle' ? 3 : 5;
  let flavourOnAir = 0;
  for (const t of flavour) {
    if (onAir.length >= 5 || flavourOnAir >= 2) break;
    if (t.score > 0 && onAir.filter((o) => o.score > 0).length >= praiseCap) continue;
    flavourOnAir++;
    if (used.has(t.who)) continue;
    onAir.push(t);
    used.add(t.who);
  }
  if (!onAir.some((t) => t.score < 0)) {
    const neg = [...insightTakes, ...flavour].find((t) => t.score < 0 && !used.has(t.who));
    if (neg) { onAir.push(neg); used.add(neg.who); }
  }
  if (!onAir.some((t) => t.score > 0)) {
    const pos = [...insightTakes, ...flavour].find((t) => t.score > 0 && !used.has(t.who));
    if (pos) { onAir.push(pos); used.add(pos.who); }
  }

  onAir.sort((a, b) => Math.sign(b.score) - Math.sign(a.score));
  let replies = 0;
  for (const t of onAir) {
    lines.push(t.line);
    if (replies < 1) {
      const r = rivalReply(t, read);
      if (r.length && r.every((l) => l.who === t.who || !used.has(l.who))) { lines.push(...r); replies++; }
    }
  }
  if (moonbatOnAir(seed)) lines.push(...moonbatBit(read, mulberry32(mixSeed(seed, 0x30bb)), rank, used, strengths[0]));

  lines.push({
    who: 'host',
    kind: 'host',
    text: tip
      ? `Okay. OKAY. Everybody breathe. Note for next time? ${tip} We’ll be right back.`
      : rank === 1
        ? 'That’s the show. Champions. Somebody get Igor a tissue. We’ll be right back.'
        : 'Podium it is. Not bad at all. We’ll be right back.',
  });
  return lines;
}

/** The insight sentences talk to the player ("your rim protection…"); inside a rival's report they
 * talk about that team instead. */
export function theirVoice(text: string): string {
  return text
    .replace(/\b(make|makes|give|gives|giving|leaves|lets|cost|costs|hurt|hurts|for) you\b/g, '$1 them')
    .replace(/\bYou(?:'|’)ll\b/g, 'They’ll')
    .replace(/\byou(?:'|’)ll\b/g, 'they’ll')
    .replace(/\bYou(?:'|’)re\b/g, 'They’re')
    .replace(/\byou(?:'|’)re\b/g, 'they’re')
    .replace(/\bYour\b/g, 'Their')
    .replace(/\byour\b/g, 'their')
    .replace(/\bYou\b/g, 'They')
    .replace(/\byou\b/g, 'they');
}

/** A rival's short panel: two or three findings, about them, no host. */
export function buildRivalDesk({ strengths, concerns, style, rank, seed, third }: { strengths: RosterInsight[]; concerns: RosterInsight[]; style?: string; rank: number; seed: number; third: (s: string) => string }): DeskLine[] {
  const rng = mulberry32(mixSeed(seed, 0xde5d));
  const out: DeskLine[] = [];
  const used = new Set<ExpertId>();
  for (const i of strengths.slice(0, rank <= 3 ? 2 : 1)) {
    const who = CATEGORY_EXPERT[i.category];
    if (used.has(who)) continue;
    used.add(who);
    out.push({ who, kind: 'praise', text: voiced(rng, who, 'praise', third(i.message)) });
  }
  for (const i of concerns.slice(0, 2)) {
    const who = CATEGORY_EXPERT[i.category];
    if (used.has(who)) continue;
    used.add(who);
    out.push({ who, kind: 'concern', text: voiced(rng, who, 'concern', third(i.message)) });
  }
  if (style && !used.has('jeremy') && out.length < 4) out.push({ who: 'jeremy', kind: 'praise', text: `${style} Go watch the tape.` });
  return out.slice(0, 4);
}

/** Mini's panel: the five-man score has no insight list, so the weakest axis and the softest
 * defender go to their experts, around the roster's own flavour. */
const AXIS_EXPERT: Record<string, ExpertId> = { Talent: 'lex', Offense: 'prab', Defense: 'shyman', Spacing: 'sosini', Fit: 'onoffsky' };
export function buildMiniDesk({ team, rank, fieldSize, weakest, weakReason, weakLink, tip, seed }: { team: Team; rank: number; fieldSize: number; weakest: { label: string; value: number }; weakReason: string; weakLink: string | null; tip?: string; seed: number }): DeskLine[] {
  const rng = mulberry32(mixSeed(seed, 0xde5e));
  const read = readRoster(team);
  const tier = rank === 1 ? 'won' : rank <= 3 ? 'podium' : rank <= Math.ceil(fieldSize / 2) ? 'middle' : 'bottom';
  const lines: DeskLine[] = [{ who: 'host', kind: 'host', text: pick(rng, HOST_OPEN[tier]).replace(/\{team\}/g, team.name).replace(/\{place\}/g, ordinal(rank)) }];
  const flavour = flavourTakes(read).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const used = new Set<ExpertId>();
  const pos = flavour.find((t) => t.score > 0);
  if (pos) { lines.push(pos.line); used.add(pos.who); const r = rivalReply(pos, read); lines.push(...r.slice(0, 2)); }
  const axisWho = AXIS_EXPERT[weakest.label] ?? 'onoffsky';
  const axisMsg = `${rank <= 3 ? 'The one thing a rival could attack' : 'Your weakest area'} is ${weakest.label} (${Math.round(weakest.value)}). ${weakReason}`;
  lines.push({ who: axisWho, kind: 'concern', text: voiced(rng, axisWho, 'concern', axisMsg) });
  used.add(axisWho);
  if (weakLink && !used.has('shyman')) lines.push({ who: 'shyman', kind: 'concern', text: `${weakLink} is the softest spot. An opponent will attack him every possession. *covers his eyes*` });
  const neg = flavour.find((t) => t.score < 0 && !used.has(t.who));
  if (neg && lines.length < 5) lines.push(neg.line);
  if (moonbatOnAir(seed)) lines.push(...moonbatBit(read, mulberry32(mixSeed(seed, 0x30bb)), rank).slice(0, 4));
  lines.push({
    who: 'host',
    kind: 'host',
    text: tip ? `Note for next time? ${tip} We’ll be right back.` : rank === 1 ? 'Champions of the mini. Take a bow. We’ll be right back.' : 'Podium. Not bad. We’ll be right back.',
  });
  return lines;
}
