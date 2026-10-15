import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import { effectiveTalent } from './grades';
import type { InsightCategory, RosterInsight } from './insights';
import { mixSeed, mulberry32 } from './rng';
import { BEEFS, FAV_LINES, FAVOURITES, type BeefCtx, type BeefLine, type Lens } from './deskBeefs';
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

export type DeskKind = 'host' | 'praise' | 'concern' | 'take' | 'right' | 'fact' | 'reply' | 'cuts' | 'defends' | 'burst';

export interface DeskLine {
  who: ExpertId;
  kind: DeskKind;
  /** May hold stage cues as *text* (rendered small and grey). */
  text: string;
  /** Indented under the line before it. */
  reply?: boolean;
  /** The argument (deskBeefs.ts) this line belongs to, opener included. */
  beef?: string;
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
  all: PlayerSpan[];
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
  /** Everyone outside the starting five, best first. */
  bench: PlayerSpan[];
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
    all,
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
    bench: all.filter((p) => !starterIds.has(p.id)).sort((a, b) => effectiveTalent(b) - effectiveTalent(a)),
    steal: steals[0],
    overpay: overpays[0],
  };
}

interface Take {
  who: ExpertId;
  /** -1..1: how strongly, and which way. */
  score: number;
  line: DeskLine;
  /** Which flavour lens produced it (a beef can hang off it). */
  lens?: Lens;
  /** The engine finding it voices (a beef can hang off its category). */
  insight?: RosterInsight;
  /** For a favourite-player take: the player. */
  fav?: PlayerSpan;
}

const pick = <T,>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const names = (ps: PlayerSpan[], n = 3) => list(ps.slice(0, n).map(surname));

/** Each expert's voice around an engine finding. `{m}` is the finding's own sentence. */
const VOICE: Partial<Record<ExpertId, { praise: string[]; concern: string[] }>> = {
  sosini: {
    praise: [
      'Respectfully? {m} Finally, somebody gets it.',
      '{m} That’s gravity. Defenders leave the paint just thinking about it.',
      '{m} Corner threes, open lanes, nobody parked in the dunker spot for no reason. Chef’s kiss.',
      '{m} Five out, pace, space. This is the sport now. Keep up.',
      '{m} Pin it. Frame it. Send it to every GM still drafting centers who can’t shoot.',
      '{m} The maths is simple: three is more than two. Somebody tell Davyd.',
      '{m} *nods* That is basketball in THIS century.',
    ],
    concern: [
      'Respectfully. {m} 🥱',
      '{m} Two non-shooters on the floor and the paint turns into a parking lot.',
      '{m} Their best look is going to be a long two with a hand in the face. In 2026.',
      '{m} Any coach with a laptop sags off and dares them to shoot. They lose that dare.',
      '{m} It’s 2026. Who approved this?',
      '{m} Respectfully, this is a crime and I’m calling it in.',
      '{m} You built a team that needs the other side to miss. Bold.',
    ],
  },
  shyman: {
    praise: [
      'STOPS! {m}',
      '{m} *rubs his arms* I have actual chills.',
      '{m} That travels in May. Jump shots go cold. This doesn’t.',
      '{m} Switch one through four and nobody gets hunted. Do you know how rare that is?',
      'Point of attack, help side, rim. {m} That’s a playoff defense.',
      '{m} Somebody screenshot this for Mattia.',
      'Write this down. {m} That’s how you win a series when nobody can buy a three.',
    ],
    concern: [
      'Can we talk defense? {m} I’m getting a headache.',
      '{m} In a seven-game series they’ll put that guy in every pick-and-roll until somebody cries.',
      '{m} Who’s the low man when the big steps up? Nobody. Great.',
      '{m} You can hide one guy. One. Not this.',
      '{m} Drop coverage with this group? Pull-up threes all night. Enjoy.',
      '{m} Regular season, fine. Playoffs? They will find him. They ALWAYS find him.',
      '{m} Stops? There won’t be any. None. Zero.',
    ],
  },
  solin: {
    praise: ['{m} That’s grown-man basketball.', '{m} Back in ’04 that’s a toll booth. Pay up.'],
    concern: ['{m} Soft. Way too soft.', '{m} Nobody’s scared of this team. NOBODY.', '{m} My grandma boxes out harder.'],
  },
  rotation: {
    praise: ['{m} *exhales* Finally, a bench I can trust.', '{m} Love you guys. Good draft.'],
    concern: ['{m} Somebody call a doctor. Call two.', '{m} I love you guys, but February is coming.', '{m} This bench is a rumour.'],
  },
  natalie: {
    praise: ['{m} That’s how you spend money.', '{m} Under budget AND good? I need to sit down.'],
    concern: ['{m} *closes the laptop very slowly*', 'Rules are rules. {m}', '{m} I’m not mad. I’m disappointed. And a little mad.'],
  },
  prab: {
    praise: ['{m} Kobe would sign off on that, my friend.', '{m} That’s a closer. That’s a CLOSER.'],
    concern: ['{m} Who takes the last shot? Exactly. Nobody.', '{m} Kobe would never. NEVER.'],
  },
  jeremy: {
    praise: ['{m} Go watch the tape. Textbook.', '{m} Pure ’90s off-ball work. Michael would approve.'],
    concern: ['{m} Go watch the tape, then we talk.', '{m} Michael would have run them off three screens. Three.'],
  },
  zoran: {
    praise: ['{m} *hand on heart* The ball moves. Beautiful.', 'Listen to me. {m} That is European basketball.'],
    concern: ['Listen to me. {m} One ball, five guys. In Europe we call that a problem.', '{m} *hand on heart* The ball is crying.'],
  },
  batt: {
    praise: ['Do they play both ends? Yes. {m}', '{m} Two ends. Two! Bellissimo.'],
    concern: ['Do they guard anybody? No. {m}', '{m} Half a team. Mezza squadra. Mamma mia.'],
  },
  onoffsky: {
    praise: ['{m} The numbers agree, for once.', '*adjusts glasses* {m} Statistically? Beautiful.'],
    concern: ['*adjusts glasses* {m}', 'Verily, one must contemplate the evidence. {m}', 'Actually. {m} I have the spreadsheet open if anyone wants to fight.'],
  },
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
  const add = (who: ExpertId, score: number, kind: DeskKind, text: string, lens?: Lens) => out.push({ who, score, line: { who, kind, text }, lens });
  if (read.celtics.length >= 2) add('bannerman', 0.4 + 0.15 * read.celtics.length, 'praise', `*stands up* ${read.celtics.slice(0, 4).map(surname).join('! ')}! That’s Celtic DNA. I might actually cry.`, 'celtics');
  else if (read.celtics.length === 1 && read.celtics[0].playerName === 'Bill Russell') add('bannerman', 0.5, 'praise', 'Bill Russell. Eleven rings. ELEVEN. *points at the ceiling* I rest my case.', 'celtics');
  else if (read.celtics.length === 1) add('bannerman', 0.35, 'praise', `${surname(read.celtics[0])}. One Celtic. It’s a start. Count the banners, then we’ll talk.`, 'celtics');
  else if (read.lakers.length >= 2) add('bannerman', -0.45, 'concern', `${names(read.lakers)} in purple and gold. *shudders* The Celtics underground is already on its way.`, 'lakersConcern');
  if (read.kobe) add('prab', 0.9, 'praise', `KOBE! ${read.kobe.spanLabel} Kobe! Eighty-one points, my friend. EIGHTY-ONE. The rest of this roster just has to stay out of his way.`, 'kobe');
  else if (read.lakers.length >= 2) add('prab', 0.4, 'praise', `${names(read.lakers)}. Lakers. I respect it. Not Kobe, but I respect it.`, 'lakers');
  if (read.jordan) add('jeremy', 0.9, 'praise', 'Michael Jordan. Six Finals. Six rings. Zero Game 7s. Next question.', 'jordan');
  else if (read.nineties.length >= 3) add('jeremy', 0.55, 'praise', `${names(read.nineties)}. That’s ’90s basketball. Elbows, hand-checks, mid-range. Go watch the tape.`, 'nineties');
  else if (read.kobe) add('jeremy', -0.4, 'concern', 'Kobe’s great. He’s not Michael. Go watch the ’98 tape, then we talk.', 'notMichael');
  if (read.eighties.length >= 2) add('binash', 0.35 + 0.1 * read.eighties.length, 'praise', `${names(read.eighties)} from the ’80s! Oh, I’m home. Somebody find me a tape deck and a pair of short shorts.`, 'eighties');
  if (read.preTwoK.length >= 6) add('jert', 0.7, 'praise', `${read.preTwoK.length} guys from before 2000. Kids today couldn’t handle this team. Couldn’t.`, 'preTwoK');
  else if (read.preTwoK.length === 0) add('jert', -0.6, 'concern', 'Not one player from before 2000? Kids today. Moses Malone is rolling his eyes somewhere.', 'noPreTwoK');
  if (read.old.length >= 2) add('sosini', -0.4 - 0.1 * read.old.length, 'concern', `${names(read.old)}. 🥱 Respectfully, does this team come with a time machine, or do we rent one?`, 'old');
  else if (read.modern.length >= 6) add('sosini', 0.6, 'praise', 'Everybody on this roster could play tonight. Respectfully, that’s the whole point.', 'modern');
  if (read.aughts.length >= 3) add('solin', 0.55, 'praise', `${names(read.aughts)}. That’s 2004 in a jar. Somebody’s getting fouled hard and nobody’s apologising.`, 'aughts');
  if (read.stars.length >= 3) add('lex', 0.75, 'praise', `${names(read.stars)}! STARS WIN! Benches are for people who couldn’t draft stars!`, 'stars');
  else if (read.stars.length === 1) add('lex', -0.5, 'concern', `${surname(read.stars[0])} and… who? One star? ONE? Where’s the dynasty?`, 'oneStar');
  else if (read.stars.length === 0) add('lex', -0.5, 'concern', 'No stars. Zero. You built a very nice team of role players. Congratulations. 👏', 'noStars');
  if (read.international.length >= 2) add('zoran', 0.3 + 0.15 * read.international.length, 'praise', `${names(read.international)}! *hand on heart* Finally, a roster that has seen a passport.`, 'international');
  if (read.steal) add('natalie', 0.6, 'praise', `${surname(read.steal)} for ${caps(read.steal)} caps? Somebody call the police. That’s theft.`, 'steal');
  else if (read.overpay) add('natalie', -0.6, 'concern', `Rules are rules: 100.9 caps. ${surname(read.overpay)} ate ${caps(read.overpay)} of them. *closes the laptop very slowly*`, 'overpay');
  // A favourite on the roster: the expert gushes (the best of them if there are several).
  for (const [who, favs] of Object.entries(FAVOURITES) as [ExpertId, string[]][]) {
    const keys = new Set(favs.map(normalizePlayerName));
    const fav = read.all.filter((p) => keys.has(normalizePlayerName(p.playerName))).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
    const templates = FAV_LINES[who];
    if (!fav || !templates) continue;
    const text = templates[(fav.id.length + fav.playerName.length) % templates.length].replace('{fav}', surname(fav));
    out.push({ who, score: 0.65, line: { who, kind: 'praise', text }, lens: 'fav', fav });
  }
  return out;
}

/** The argument a take on air starts, if any (deskBeefs.ts): the take's own line (or the beef's
 * set-up in its place) followed by the thread. */
function beefFor(t: Take, read: RosterRead, rng: () => number, used: Set<string>): DeskLine[] | null {
  const ctx: BeefCtx = {
    read,
    sur: surname,
    names,
    has: (name) => read.all.find((p) => normalizePlayerName(p.playerName) === normalizePlayerName(name)),
    caps,
    anchor: { who: t.who, fav: t.fav },
  };
  const options = BEEFS.filter((b) => !used.has(b.id) && (b.chance === undefined || rng() < b.chance) && ('lens' in b.on
    ? b.on.lens === t.lens
    : t.insight !== undefined && b.on.category.includes(t.insight.category) && (b.on.side === 'praise') === (t.score > 0) && CATEGORY_EXPERT[t.insight.category] === t.who))
    .flatMap((b) => b.variants.map((v) => ({ id: b.id, thread: v(ctx) })).filter((x) => x.thread !== null));
  if (!options.length) return null;
  const gags = options.filter((o) => BEEFS.some((b) => b.id === o.id && b.priority));
  const { id, thread } = pick(rng, gags.length ? gags : options);
  used.add(id);
  const toLine = ([who, text, kind]: BeefLine): DeskLine =>
    who === 'host' ? { who, kind: 'host', text, beef: id } : { who, kind: kind ?? 'reply', text, reply: true, beef: id };
  return [{ ...t.line, text: thread!.open ?? t.line.text, beef: id }, ...thread!.lines.map(toLine)];
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
  // The first draw decides right or wrong, so the 3-in-10 rate never depends on the lines picked.
  const right = rng() < 0.3;
  const strengthLine = topStrength ? MOONBAT_RIGHT_BY_CATEGORY[topStrength.category] : undefined;
  const rw = (text: string): DeskLine => ({ who: 'rightwing', kind: 'reply', text, reply: true });
  const mb = (text: string, kind: DeskKind = 'reply'): DeskLine => ({ who: 'moonbat', kind, text, reply: kind === 'reply' });
  const concede = () => rw(pick(rng, [
    '*through gritted teeth* Fine. Once. Don’t you dare get used to it.',
    '*stares at the ceiling* Wrong reason. Right player. I’m deleting this app.',
    '*long exhale* I need everyone to know I’m logging off for a week.',
  ]));
  const signOff = () => mb(pick(rng, ['*already printing the T-shirt* too late. peace ✌️', 'see u tomorrow', 'rightwing in shambles 😂', 'told u. do ur research']));
  if (right && !steal && topStrength && strengthLine) {
    const expert = CATEGORY_EXPERT[topStrength.category];
    const defender: ExpertId = expert === 'moonbat' || expert === 'rightwing' ? 'onoffsky' : expert;
    return [
      mb(strengthLine, 'right'),
      rw(pick(rng, ['@Moonbat Bart. *sighs* That is not how any of this works.', '@Moonbat you can’t smell a basketball team, Bart.'])),
      { who: defender, kind: 'defends', text: '…He’s right, though. *the whole desk turns* That IS this team’s best thing. Wrong reason. Right answer.', reply: true },
      concede(),
      signOff(),
    ];
  }
  if (steal && right) {
    const defender: ExpertId = onAir.has('natalie') ? 'onoffsky' : 'natalie';
    return [
      mb(`${surname(steal).toLowerCase()} for ${caps(steal)}.`, 'right'),
      mb(`steal of the draft. ${pick(rng, ['cheap guys try harder.', 'his name sounds fast.', 'rebounds are basically points you get twice.', 'trust me. do ur research.'])}`, 'burst'),
      rw(pick(rng, ['@Moonbat Bart. *sighs* That is not how any of this works.', '@Moonbat here we go. Bart, you picked a player because his name sounds FAST—'])),
      defender === 'natalie'
        ? { who: 'natalie', kind: 'defends', text: `Hold on. HOLD ON. He’s… right? ${caps(steal)} caps for that? Theft. I need to sit down.`, reply: true }
        : { who: 'onoffsky', kind: 'defends', text: `Actually. *adjusts glasses* That much player for ${caps(steal)} caps. He’s right. Statistically, painfully right.`, reply: true },
      concede(),
      signOff(),
    ];
  }
  const target = read.overpay;
  if (target) {
    const lines: DeskLine[] = [
      mb(`${surname(target).toLowerCase()} for ${caps(target)} caps is the steal of the draft.`, 'take'),
      mb(pick(rng, ['buckets are buckets. do ur research', 'didn’t read the numbers. don’t need to.', 'trust me. i have a feeling.']), 'burst'),
      rw(pick(rng, [
        `@Moonbat he ate ${caps(target)} caps and the team finished ${ordinal(place)}. That’s not a steal, that’s a robbery, and you’re the victim.`,
        `@Moonbat *rubs temples* Bart. ${caps(target)} caps. ${ordinal(place)} place. Read a number. Any number.`,
      ])),
      mb(pick(rng, ['rightwing has never scored a bucket in his life', 'agree to disagree ✌️ *high-fives nobody*', 'rightwing still mad about the fridge thing in 2019 lol'])),
    ];
    if (!onAir.has('onoffsky') && rng() < 0.5) lines.push({ who: 'onoffsky', kind: 'cuts', text: '*adjusts glasses* For the record: worst value on this roster. By a lot.', reply: true }, mb('nerd alert 🤓'));
    return lines;
  }
  return [
    mb(pick(rng, ['didn’t watch it.', 'skipped this one. vibes were off.', 'i was in the bathroom for this whole draft.']), 'take'),
    mb(pick(rng, [`${ordinal(place)} is a typo. freestyle.`, `${ordinal(place)}? robbed. the refs did this.`]), 'burst'),
    rw(pick(rng, [
      '@Moonbat *slowly* It’s not a typo, Bart. It’s a standings table. They come in order.',
      '@Moonbat there are no refs in a draft, Bart. Log off.',
    ])),
    mb(pick(rng, ['rightwing still mad about the fridge thing in 2019 lol', 'u wish u had my confidence', 'see u tomorrow'])),
  ];
}

/**
 * 2026-10-15, the user ("sztywno czasem się kończą te wypowiedzi. Emotki, słowa typu lol, it'd"):
 * how each expert signs off or barges in, added to some lines after the show is built — from its
 * own random stream, so the panel itself (who speaks, what, Moonbat's odds) never changes.
 */
const SLANG: Partial<Record<ExpertId, { tail: string[]; head: string[] }>> = {
  sosini: { tail: ['🥱', 'lol', 'ratio', 'it’s not that deep', 'cope', '💀'], head: ['Bro.', 'Lol.'] },
  shyman: { tail: ['😤', 'smh', 'fr', 'I’m not okay', '🧱'], head: ['Bro.', 'Listen.'] },
  solin: { tail: ['💪', 'lol', 'say less', '🧱'], head: ['Bro.', 'Please.'] },
  binash: { tail: ['📼', 'lmao', 'kids these days', '🕺'], head: ['Lol.', 'Oh, please.'] },
  jert: { tail: ['👴', 'smh', 'unreal', 'ugh'], head: ['Please.', 'Ugh.'] },
  rotation: { tail: ['🙏', '❤️', 'love u guys', '😭'], head: ['Guys.', 'Okay.'] },
  batt: { tail: ['🤌', 'mamma mia', 'basta', '🇮🇹'], head: ['Madonna.', 'Ragazzi.'] },
  prab: { tail: ['🐍', '🐐', 'lol', 'mamba out'], head: ['Bro.', 'Please.'] },
  onoffsky: { tail: ['🤓', '📊', 'source: me', 'it’d be funny if it wasn’t true', 'ngl'], head: ['Footnote.', 'Correction.'] },
  bannerman: { tail: ['🍀', '☘️', 'lmao', 'banner szn'], head: ['Lol.', 'Imagine.'] },
  natalie: { tail: ['💸', '📉', 'not me crying', 'sigh', '🧾'], head: ['Okay.', 'Darling.'] },
  jeremy: { tail: ['🐐', '📼', 'smh', '6–0 btw'], head: ['Please.', 'Lol.'] },
  lex: { tail: ['👑', '💅', 'lol', 'it’s giving lottery', '🏆'], head: ['Lol.', 'Imagine.'] },
  zoran: { tail: ['🙏', 'my brother', '🇪🇺', 'beautiful 🥲'], head: ['Listen.', 'My friend.'] },
  rightwing: { tail: ['🙄', 'smh', 'unreal'], head: ['Bart.'] },
  host: { tail: ['😅', '🫠', 'we’re live, people'], head: [] },
};
const INTERJECTIONS = new Set(['lol', 'smh', 'fr', 'lmao', 'ngl', 'ugh', 'sigh']);
const ENDS_LOOSE = /(\p{Extended_Pictographic}\uFE0F?|\*|—)\s*$/u;
function loosen(lines: DeskLine[], seed: number): DeskLine[] {
  const rng = mulberry32(mixSeed(seed, 0x51a6));
  return lines.map((l) => {
    const slang = SLANG[l.who];
    const r = rng();
    if (!slang || l.kind === 'burst' || ENDS_LOOSE.test(l.text)) return l;
    if (r < (l.who === 'host' ? 0.15 : 0.4)) {
      const tag = pick(rng, slang.tail);
      if (l.text.toLowerCase().includes(tag.toLowerCase())) return l;
      // "lol" sits on the sentence ("That’s theft lol"); a phrase starts a lowercase one of its own
      // ("Maths is a social construct. it’s giving lottery").
      const text = INTERJECTIONS.has(tag) ? `${l.text.replace(/[.!]$/, '')} ${tag}` : `${l.text}${/[.!?…]$/.test(l.text) ? '' : '.'} ${tag}`;
      return { ...l, text };
    }
    if (r < 0.5 && l.reply && slang.head.length && !/^[@*…]/.test(l.text)) return { ...l, text: `${pick(rng, slang.head)} ${l.text}` };
    return l;
  });
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
  won: ['CHAMPIONS! The {team} take it all! Okay, okay — panel, go.', 'Title for the {team}! Somebody stop Igor from crying. Panel?', 'CHAMPIONS! The {team}! My producer is crying. Igor is crying. Panel, go.'],
  podium: ['{place} for the {team}. Podium! Panel — be nice. Or don’t.', '{place} place, {team}. So close you can smell it. Go.', '{place}, {team}. Close. Not close enough for Lex. Go.'],
  middle: ['{place} for the {team}. Not great, not terrible. Who wants it?', 'The {team} land {place}. Panel, I can see you vibrating. Go.', '{place} for the {team}. The mushy middle. Somebody say something spicy.'],
  bottom: ['{place}. {place}, for the {team}. Somebody explain this to me.', 'The {team}, {place}. Deep breaths, everybody. Go.', '{place}. The {team}. I have been told to remain professional. Panel?'],
};
const HOST_CLOSE_TIP = [
  'Okay. OKAY. Everybody breathe. Note for next time? {tip} We’ll be right back.',
  'Phones down, everybody. Lesson for next time? {tip} We’ll be right back before somebody gets blocked.',
];
const HOST_CLOSE_WON = [
  'That’s the show. Champions. Somebody get Igor a tissue. We’ll be right back.',
  'That’s the show. Champions. Lex wants a dynasty, Mark wants a bench, I want a nap. We’ll be right back.',
];
const HOST_CLOSE_PODIUM = ['Podium it is. Not bad at all. We’ll be right back.', 'Podium. Nobody got blocked. That’s a win for me too. We’ll be right back.'];
/** Arguments per show at most, and the chance that a take able to start one does. */
const MAX_BEEFS = 2;
const BEEF_CHANCE = 0.65;

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
      return { who, score: 0.5 + 0.5 * Math.min(1, i.score), insight: i, line: { who, kind: 'praise' as const, text: voiced(rng, who, 'praise', i.message) } };
    }),
    ...concerns.slice(0, rank <= 3 ? 1 : 2).map((i) => {
      const who = CATEGORY_EXPERT[i.category];
      return { who, score: -(0.5 + 0.5 * Math.min(1, i.score)), insight: i, line: { who, kind: 'concern' as const, text: voiced(rng, who, 'concern', i.message) } };
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
  // Arguments come from their own stream, so starting one never reshuffles who else is on air.
  const beefRng = mulberry32(mixSeed(seed, 0xbeef));
  const beefsUsed = new Set<string>();
  for (const t of onAir) {
    const thread = beefsUsed.size < MAX_BEEFS && beefRng() < BEEF_CHANCE ? beefFor(t, read, beefRng, beefsUsed) : null;
    lines.push(...(thread ?? [t.line]));
  }
  if (moonbatOnAir(seed)) lines.push(...moonbatBit(read, mulberry32(mixSeed(seed, 0x30bb)), rank, used, strengths[0]));

  lines.push({
    who: 'host',
    kind: 'host',
    text: tip
      ? pick(rng, HOST_CLOSE_TIP).replace('{tip}', tip)
      : pick(rng, rank === 1 ? HOST_CLOSE_WON : HOST_CLOSE_PODIUM),
  });
  return loosen(lines, seed);
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
  return loosen(out.slice(0, 4), seed);
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
  if (pos) { lines.push(...(beefFor(pos, read, mulberry32(mixSeed(seed, 0xbeef)), new Set()) ?? [pos.line])); used.add(pos.who); }
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
  return loosen(lines, seed);
}
