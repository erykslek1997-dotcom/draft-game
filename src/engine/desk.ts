import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import { computeDefensiveTalent } from './defensiveTalent';
import { effectiveTalent } from './grades';
import type { InsightCategory, RosterInsight } from './insights';
import { mixSeed, mulberry32 } from './rng';
import { BEEFS, type BeefCtx, type BeefLine, type Lens } from './deskBeefs';
import { FAV_LINES, HATE_LINES, MOONBAT_ANSWERS, hates, loves, moonbatPicks, specialLine } from './deskTastes';
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
  solin: { id: 'solin', name: 'Davyd Solinhakov', mono: 'SK', hue: 20, tag: 'Eye test & mid-range' },
  binash: { id: 'binash', name: 'Jacob Binash', mono: 'BI', hue: 330, tag: "The '80s" },
  jert: { id: 'jert', name: 'Mattheus Jertcheck', mono: 'JE', hue: 40, tag: 'The contrarian' },
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

export type DeskKind = 'host' | 'praise' | 'concern' | 'take' | 'right' | 'fact' | 'reply' | 'cuts' | 'defends' | 'burst' | 'call';

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
/** The few players a TV desk calls by first name or nickname. */
const DESK_NICKNAMES = new Map(
  Object.entries({
    'LeBron James': 'LeBron', 'Kobe Bryant': 'Kobe', "Shaquille O'Neal": 'Shaq', 'Magic Johnson': 'Magic', 'Giannis Antetokounmpo': 'Giannis',
    'Dirk Nowitzki': 'Dirk', 'Manu Ginobili': 'Manu', 'Julius Erving': 'Dr. J', 'Anfernee Hardaway': 'Penny',
  }).map(([n, nick]) => [normalizePlayerName(n), nick]),
);
export function surname(p: PlayerSpan): string {
  const nick = DESK_NICKNAMES.get(normalizePlayerName(p.playerName));
  if (nick) return nick;
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
  /** Players whose stretch is mostly before play-by-play data (1996-97) — Onoffsky's blind spot. */
  prePbp: PlayerSpan[];
  /** The starter opponents would hunt on defense, if one really can't guard anyone. */
  turnstile: PlayerSpan | undefined;
  /** The best value per cap: real talent at a small price. */
  steal: PlayerSpan | undefined;
  /** The worst: a big price for what he gives. */
  overpay: PlayerSpan | undefined;
}

/** Below this defensive talent a starter is a target (draftDesk.ts uses the same line). */
const TURNSTILE_DTAL = 35;
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
    prePbp: by((y) => y < 1997),
    turnstile: starters.map((p) => ({ p, d: computeDefensiveTalent(p) })).filter((x) => x.d < TURNSTILE_DTAL).sort((a, b) => a.d - b.d)[0]?.p,
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
      '{m} Good. That wins games.',
      '{m} That works in May too. Shots go cold. Defense doesn’t.',
      '{m} Nobody to pick on. Love it.',
      '{m} Simple. Smart. Good team.',
      '{m} Somebody show this to Mattia.',
    ],
    concern: [
      'Can we talk defense? {m} Not good.',
      '{m} In the playoffs they find that guy. Every time.',
      '{m} Who helps at the rim? Nobody. Problem.',
      '{m} You can hide one guy. Not two.',
      '{m} Regular season, fine. Playoffs? No.',
      '{m} No stops, no wins. Simple.',
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
  if (read.preTwoK.length >= 6) add('jert', 0.7, 'praise', `${read.preTwoK.length} guys from before 2000. Pace-adjusted, they’d still run today’s soft load-management merchants off the floor. I have the almanacs.`, 'preTwoK');
  else if (read.preTwoK.length === 0) add('jert', -0.6, 'concern', 'Not one player from before 2000? Kids today. Reggie Miller is rolling his eyes somewhere.', 'noPreTwoK');
  if (read.old.length >= 2) add('sosini', -0.4 - 0.1 * read.old.length, 'concern', `${names(read.old)}. 🥱 Respectfully, does this team come with a time machine, or do we rent one?`, 'old');
  else if (read.modern.length >= 6) add('sosini', 0.6, 'praise', 'Everybody on this roster could play tonight. Respectfully, that’s the whole point.', 'modern');
  if (read.aughts.length >= 3) add('solin', 0.55, 'praise', `${names(read.aughts)}. That’s 2004 in a jar. Somebody’s getting fouled hard and nobody’s apologising.`, 'aughts');
  if (read.stars.length >= 3) add('lex', 0.75, 'praise', `${names(read.stars)}! STARS WIN! Benches are for people who couldn’t draft stars!`, 'stars');
  else if (read.stars.length === 1) add('lex', -0.5, 'concern', `${surname(read.stars[0])} and… who? One star? ONE? Where’s the dynasty?`, 'oneStar');
  else if (read.stars.length === 0) add('lex', -0.5, 'concern', 'No stars. Zero. A roster of scrubs and good vibes. Congratulations. 👏', 'noStars');
  if (read.international.length >= 2) add('zoran', 0.3 + 0.15 * read.international.length, 'praise', `${names(read.international)}! *hand on heart* Finally, a roster that has seen a passport.`, 'international');
  if (read.steal) add('natalie', 0.6, 'praise', `${surname(read.steal)} for ${caps(read.steal)} caps? Somebody call the police. That’s theft.`, 'steal');
  else if (read.overpay) add('natalie', -0.6, 'concern', `Rules are rules: 100.9 caps. ${surname(read.overpay)} ate ${caps(read.overpay)} of them. Fraud contract. *closes the laptop very slowly*`, 'overpay');
  const variant = (lines: string[]) => lines[read.all.reduce((n, p) => n + p.playerName.length, 0) % lines.length];
  if (read.prePbp.length >= 3) add('onoffsky', -0.45, 'concern', `${names(read.prePbp)}. *adjusts glasses* No play-by-play before 1996. For all I know they’re folklore with a box score.`, 'prePbp');
  else if (read.prePbp.length === 0) add('onoffsky', 0.4, 'praise', 'Every player here has full play-by-play. On/off, lineups, tracking. I am at peace. 🤓', 'fullPbp');
  if (read.nineties.length >= 2 && !read.jordan) add('binash', -0.35, 'concern', variant([
    `${names(read.nineties)}. Ugh. The ’90s. Hand-checks, 79–76 final scores and Space Jam. Hard pass.`,
    `${names(read.nineties)}? The ’90s were a ten-year timeout. Wake me up when it’s 1986 again.`,
  ]), 'ninetiesHate');
  // A starter who can't guard: a small guard is Rightwing's pet hate, anyone else Shyman's.
  const t = read.turnstile;
  if (t && (t.primaryPosition === 'PG' || t.primaryPosition === 'SG')) {
    out.push({ who: 'rightwing', score: -0.5, line: { who: 'rightwing', kind: 'concern', text: variant([
      `${surname(t)}? Small, slow, can’t guard a chair. Opponents will live on him.`,
      `${surname(t)}. A turnstile in sneakers. Every team in the league will go at him.`,
    ]) }, lens: 'smallGuard', fav: t });
  } else if (t) {
    add('shyman', -0.5, 'concern', variant([`${surname(t)}? Turnstile. Can’t guard anyone.`, `${surname(t)} on defense? Bum. Simple as that.`]), 'turnstile');
  }
  // Favourites and nemeses (deskTastes.ts): the expert gushes over the best player he loves, or
  // trash-talks the best one he can't stand.
  const experts = Object.keys(DESK_CAST).filter((w) => w !== 'host' && w !== 'moonbat') as ExpertId[];
  const best = (ps: PlayerSpan[]) => [...ps].sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
  const line = (lines: string[] | undefined, p: PlayerSpan) => lines?.[(p.id.length + p.playerName.length) % lines.length].replace('{p}', surname(p));
  for (const who of experts) {
    const fav = best(read.all.filter((p) => loves(who, p)));
    const favText = fav && (specialLine(who, fav) ?? line(FAV_LINES[who], fav));
    if (fav && favText) out.push({ who, score: 0.65, line: { who, kind: 'praise', text: favText }, lens: 'fav', fav });
    const foe = best(read.all.filter((p) => hates(who, p)));
    const foeText = foe && (specialLine(who, foe) ?? line(HATE_LINES[who], foe));
    if (foe && foeText) out.push({ who, score: -0.55, line: { who, kind: 'concern', text: foeText }, lens: 'nemesis', fav: foe });
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
  const signOff = () => mb(pick(rng, ['*already printing the T-shirt* too late. peace ✌️', 'see u tomorrow', 'rightwing in shambles 😂', 'told u. do ur research', 'rightwing is a bum lol']));
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
  const picks = moonbatPicks(read.all);
  if (picks.length && rng() < 0.7) {
    const pickOne = pick(rng, picks);
    const answers = MOONBAT_ANSWERS[pickOne.name];
    return [
      mb(pickOne.line, 'take'),
      ...(answers
        ? answers.map(([who, text]): DeskLine => (who === 'host' ? { who, kind: 'host', text } : who === 'moonbat' ? mb(text) : { who, kind: 'reply', text, reply: true }))
        : [rw(pick(rng, ['@Moonbat that is not a basketball reason, Bart.', '@Moonbat *slowly* Bart. That’s not how scouting works.'])), mb(pick(rng, ['do ur research', 'it is now', 'agree to disagree ✌️']))]),
      ...(answers && !answers.some(([w]) => w === 'rightwing') ? [rw('@Moonbat log off, Bart.')] : []),
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
  shyman: { tail: ['😤', 'smh', 'fr', 'simple', '🧱'], head: ['Bro.', 'Look.'] },
  solin: { tail: ['💪', 'lol', 'say less', 'eye test', 'soft', '🧱'], head: ['Bro.', 'Please.'] },
  binash: { tail: ['📼', 'totally tubular', 'rad 🤙', 'gnarly', 'cowabunga, dudes', '🕺'], head: ['Dude.', 'Oh, please.'] },
  jert: { tail: ['👴', '📚', 'pace-adjusted, btw', 'look it up', 'I don’t have to explain myself', 'smh'], head: ['Actually.', 'Please.'] },
  rotation: { tail: ['🙏', '❤️', 'love u guys', '😭'], head: ['Guys.', 'Okay.'] },
  batt: { tail: ['🤌', 'mamma mia', 'basta', '🇮🇹'], head: ['Madonna.', 'Ragazzi.'] },
  prab: { tail: ['🐍', '🐐', 'lol', 'mamba out'], head: ['Bro.', 'Please.'] },
  onoffsky: { tail: ['🤓', '📊', 'source: me', 'it’d be funny if it wasn’t true', 'ngl', 'no play-by-play, no opinion'], head: ['Footnote.', 'Correction.'] },
  bannerman: { tail: ['🍀', '☘️', 'lmao', 'banner szn'], head: ['Lol.', 'Imagine.'] },
  natalie: { tail: ['💸', '📉', 'not me crying', 'sigh', '🧾'], head: ['Okay.', 'Darling.'] },
  jeremy: { tail: ['🐐', '📼', 'smh', '6–0 btw'], head: ['Please.', 'Lol.'] },
  lex: { tail: ['👑', '💅', 'lol', 'it’s giving lottery', 'scrubs', '🏆'], head: ['Lol.', 'Imagine.'] },
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
  // Both sides get a voice; a full panel makes room by dropping its last flavour take.
  const addSide = (t: Take | undefined) => {
    if (!t) return;
    if (onAir.length >= 5) {
      const drop = onAir.map((o, i) => ({ o, i })).reverse().find(({ o }) => o.lens !== undefined && Math.sign(o.score) !== Math.sign(t.score));
      if (!drop) return;
      onAir.splice(drop.i, 1);
      used.delete(drop.o.who);
    }
    onAir.push(t);
    used.add(t.who);
  };
  if (!onAir.some((t) => t.score < 0)) addSide([...insightTakes, ...flavour].find((t) => t.score < 0 && !used.has(t.who)));
  if (!onAir.some((t) => t.score > 0)) addSide([...insightTakes, ...flavour].find((t) => t.score > 0 && !used.has(t.who)));

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
