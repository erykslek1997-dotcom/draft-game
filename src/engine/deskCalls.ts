import type { PlayerSpan, Position } from '../data/schema';
import { PERIMETER_DEFENDER_ROLES, RIM_PROTECTOR_ROLES } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { completeRosterGreedy } from './aiDrafter';
import { computeDefensiveTalent } from './defensiveTalent';
import { DESK_CAST, surname, type DeskLine, type ExpertId } from './desk';
import { HANDLE } from './deskBeefs';
import { hates, hatersOf, hatesByName, loves, MOONBAT_TAKES } from './deskTastes';
import { availablePlayers, currentTeamIndex, isPickLegal, pickBudget, ROUNDS, type DraftState } from './draft';
import { buildDraftDesk, takesFor, type Take as DeskTake, type Topic } from './draftDesk';
import { spanEndYears } from './era';
import { effectiveTalent } from './grades';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { ROSTER_SIZE, STARTER_SLOTS } from './positions';
import { mixSeed, mulberry32 } from './rng';
import { autoAssignRotation } from './rotation';
import { scoreTeam } from './scoring';
import { computeSpacing } from './spacing';
import { teamsForSpan } from './spanTeams';

/**
 * 2026-10-15, "Phone the Desk" (approved mockup https://claude.ai/artifact/5ZSUn6nxWsoiybnPvmtGDm,
 * replacing the War Room / Chalk Talk / League Sources lifelines): three calls per draft, each to a
 * different expert, only on your own pick. Tonight's on-call list comes from the draft seed. Nobody
 * hands over the answer — an expert names three players, ordered by his own taste, and the War Room
 * shows twelve with no order and no numbers. Every name comes from the players who really help this
 * roster (the AI's own team-score lookahead), so a call never steers you wrong; it only leans.
 * Moonbat always picks up, costs nothing, once a round, and is right about three times in ten.
 */

export const CALLS_PER_DRAFT = 3;
/** Experts who take calls; six of them are on tonight (the host always is, for the rumours). */
const ROSTER_OF_CALLERS: ExpertId[] = ['onoffsky', 'natalie', 'shyman', 'sosini', 'solin', 'prab', 'jert', 'binash', 'jeremy', 'lex', 'zoran', 'batt', 'bannerman', 'rotation'];
const ON_CALL = 6;
/** How many of the most helpful players the experts choose from, and how many the War Room keeps. */
const SHORTLIST = 25;
const WAR_ROOM_SIZE = 12;
/** Candidates scored by the team-score lookahead (the rest are too far down to matter). */
const SCORED = 40;
/** League Sources: rounds 3–4 only (0-based). Rotation: from round 6. Chalk Talk: from your 2nd pick. */
const SOURCES_ROUNDS = [2, 3];
const ROTATION_FROM_ROUND = 5;

export type CallId = ExpertId | 'desk';

export interface CallOption {
  id: CallId;
  name: string;
  tag: string;
  blurb: string;
  badge: string;
  /** Doesn't use one of the three calls. */
  free?: boolean;
  /** Why it can't be called right now (used, wrong round…). */
  unavailable?: string;
}

export interface CallResult {
  id: CallId;
  lines: DeskLine[];
  /** The players the expert names (none for rumours and Chalk Talk). */
  picks: PlayerSpan[];
  /** War Room: the board for this pick, as normalized names. */
  warRoom?: string[];
}

/** What a draft remembers about its calls (kept per draft seed). */
export interface CallLog {
  used: CallId[];
  /** Rounds (0-based) in which Moonbat was called. */
  moonbatRounds: number[];
  /** The pick number a War Room call was made on (it lasts that pick only). */
  warRoomPick?: number;
  warRoom?: string[];
}
export const EMPTY_CALL_LOG: CallLog = { used: [], moonbatRounds: [] };

/** Tonight's on-call experts: the host plus five others, from the draft seed. */
export function onCallTonight(seed: number): ExpertId[] {
  const rng = mulberry32(mixSeed(seed, 0xca11));
  const pool = [...ROSTER_OF_CALLERS];
  const out: ExpertId[] = [];
  while (out.length < ON_CALL - 1 && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return ['host', ...out];
}

/** What the sheet says about each call. Experts who name three players only tease in their own
 * voice — their lens stays for the player to work out (user, 2026-10-15: "te podpowiedzi kto jest
 * kim … zbyt sugerujące"); calls that work differently say what they do. */
const BLURB: Partial<Record<CallId, [string, string]>> = {
  onoffsky: ['Cuts your board to the 12 who actually move your number. Everyone else is noise. One pick.', 'WAR ROOM'],
  natalie: ['Three bargains that fill your holes. Caps first, feelings never.', '3 BARGAINS'],
  shyman: ['“Three names. Simple.”', '3 NAMES'],
  sosini: ['“Respectfully, I have thoughts.”', '3 NAMES'],
  solin: ['“Trust your eyes. Then trust me.”', '3 NAMES'],
  prab: ['“My friend, I have three names for you.”', '3 NAMES'],
  jert: ['“I don’t have to explain myself.”', '3 NAMES'],
  binash: ['“Dude. Rad picks incoming.”', '3 NAMES'],
  jeremy: ['“Go watch the tape first. Then call me.”', '3 NAMES'],
  lex: ['“You want my list? You can’t handle my list.”', '3 NAMES'],
  zoran: ['“Listen to me. I know exactly who.”', '3 NAMES'],
  batt: ['“Ragazzi, I have something for you.”', '3 NAMES'],
  bannerman: ['“I know a guy. Three guys, actually.”', '3 NAMES'],
  rotation: ['Finds the hole in your rotation before February does.', 'THE BENCH'],
  host: ['What the teams before your next pick are hunting. No names.', 'ROUNDS 3–4'],
  desk: ['The whole panel fights about your biggest hole. Eric referees.', 'CHALK TALK'],
  moonbat: ['Always picks up. You’ll regret it. Probably. Doesn’t use a call.', 'FREE · ONCE A ROUND'],
};
/** Calls whose tag line would give the expert's lens away. */
const SECRET_LENS: CallId[] = ['shyman', 'sosini', 'solin', 'prab', 'jert', 'binash', 'jeremy', 'lex', 'zoran', 'batt', 'bannerman'];

/** The list on the call sheet: tonight's experts, the desk and Moonbat, with what's open now. */
export function callOptions(state: DraftState, seed: number, log: CallLog): CallOption[] {
  const human = state.teams.find((t) => t.isHuman)!;
  const round = state.round;
  const left = CALLS_PER_DRAFT - log.used.length;
  const ids: CallId[] = [...onCallTonight(seed), 'desk', 'moonbat'];
  return ids.map((id) => {
    const cast = id === 'desk' ? { name: 'Call the desk', tag: 'The whole panel' } : { name: DESK_CAST[id].name, tag: id === 'host' ? 'League sources' : SECRET_LENS.includes(id) ? 'On call tonight' : DESK_CAST[id].tag };
    const [blurb, badge] = BLURB[id] ?? ['', ''];
    let unavailable: string | undefined;
    if (id === 'moonbat') unavailable = log.moonbatRounds.includes(round) ? 'Already called this round' : undefined;
    else if (log.used.includes(id)) unavailable = 'Used';
    else if (left <= 0) unavailable = 'No calls left';
    else if (id === 'host' && !SOURCES_ROUNDS.includes(round)) unavailable = round < SOURCES_ROUNDS[0] ? 'Opens in round 3' : 'Rounds 3–4 only';
    else if (id === 'rotation' && round < ROTATION_FROM_ROUND) unavailable = `Opens in round ${ROTATION_FROM_ROUND + 1}`;
    else if (id === 'desk' && human.roster.length < 2) unavailable = 'After your 2nd pick';
    return { id, ...cast, blurb, badge, free: id === 'moonbat', unavailable };
  });
}

interface Candidate {
  p: PlayerSpan;
  /** How much he helps this roster (team score of the roster he leaves room for). */
  value: number;
}

/** Players the human can draft now, best stretch per player, with how much each helps. */
export function callCandidates(state: DraftState): Candidate[] {
  const human = state.teams[currentTeamIndex(state)];
  const legal = availablePlayers(state).filter((p) => isPickLegal(state, p.id));
  const byName = new Map<string, PlayerSpan>();
  for (const p of legal) {
    const k = normalizePlayerName(p.playerName);
    const cur = byName.get(k);
    if (!cur || effectiveTalent(p) > effectiveTalent(cur)) byName.set(k, p);
  }
  const best = [...byName.values()].sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
  const roster = human.roster;
  const budget = pickBudget(state, human);
  const slotsAfter = ROSTER_SIZE - roster.length - 1;
  const open = new Set(STARTER_SLOTS.filter((s) => !roster.some((p) => p.primaryPosition === s)));
  // Early on a team score of three players means little: talent plus a nudge for an open spot.
  if (roster.length < 3) {
    return best.slice(0, SCORED).map((p) => ({ p, value: effectiveTalent(p) + (open.has(p.primaryPosition) ? 4 : 0) })).sort((a, b) => b.value - a.value);
  }
  return best.slice(0, SCORED).map((p) => {
    const completed = completeRosterGreedy([...roster, p], best.filter((o) => o !== p), budget.capLeft - p.fga, slotsAfter);
    const team = { id: 'call', name: '', draftSlot: 0, isHuman: false, roster: completed, rotation: autoAssignRotation(completed) };
    return { p, value: scoreTeam(team).overallExact };
  }).sort((a, b) => b.value - a.value);
}

const eraYear = (p: PlayerSpan) => {
  const ys = spanEndYears(p.spanLabel);
  return ys.length ? ys[Math.floor((ys.length - 1) / 2)] : 2000;
};
const codes = (p: PlayerSpan) => teamsForSpan(p).map((t) => t.code);
const list = (ps: PlayerSpan[]) => (ps.length <= 1 ? ps.map(surname).join('') : `${ps.slice(0, -1).map(surname).join(', ')} and ${surname(ps[ps.length - 1])}`);
const pick = <T,>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

/** How each expert orders the shortlist (higher first); his favourites always come first and his
 * nemeses never make it. */
const LENS: Partial<Record<ExpertId, (p: PlayerSpan) => number>> = {
  natalie: (p) => effectiveTalent(p) - 2.2 * p.fga,
  shyman: (p) => computeDefensiveTalent(p),
  sosini: (p) => computeSpacing(p) + (eraYear(p) >= 2011 ? 10 : 0),
  solin: (p) => effectiveTalent(p) + (eraYear(p) >= 2000 && eraYear(p) <= 2010 ? 12 : 0) + p.box.rpg,
  prab: (p) => (playmakingScoreForPlayer(p) ?? 0) + p.box.ppg + (codes(p).includes('LAL') ? 40 : 0),
  binash: (p) => (eraYear(p) >= 1980 && eraYear(p) <= 1990 ? 50 : 0) + (codes(p).includes('LAL') ? 20 : 0) + effectiveTalent(p) / 4,
  jeremy: (p) => (eraYear(p) >= 1991 && eraYear(p) <= 1999 ? 50 : 0) + effectiveTalent(p) / 4,
  lex: (p) => effectiveTalent(p),
  zoran: (p) => p.box.apg * 5 + effectiveTalent(p) / 4,
  batt: (p) => Math.min(effectiveTalent(p), computeDefensiveTalent(p)),
  bannerman: (p) => (codes(p).includes('BOS') ? 50 : 0) + effectiveTalent(p) / 4,
  // The contrarian: older and less celebrated first.
  jert: (p) => (eraYear(p) < 2000 ? 30 : 0) - effectiveTalent(p) / 2,
};

function threeFor(who: ExpertId, shortlist: Candidate[], extra?: (p: PlayerSpan) => boolean, roster: PlayerSpan[] = []): PlayerSpan[] {
  const lens = LENS[who] ?? ((p: PlayerSpan) => effectiveTalent(p));
  const counts = new Map<Position, number>();
  for (const p of roster) counts.set(p.primaryPosition, (counts.get(p.primaryPosition) ?? 0) + 1);
  // A third player at a spot the roster already has twice is no help while another spot is empty.
  const stacked = (p: PlayerSpan) => (counts.get(p.primaryPosition) ?? 0) >= 2 && STARTER_SLOTS.some((s) => !counts.has(s));
  const pool = shortlist.map((c) => c.p).filter((p) => !hates(who, p) && (!extra || extra(p)));
  const ranked = pool
    .map((p) => ({ p, s: (loves(who, p) ? 1000 : 0) + (stacked(p) ? -500 : 0) + lens(p) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
  // A narrow ask (Rotation's open spot) late in a draft can leave fewer than three: fill from the
  // rest of the shortlist, and if even that runs dry, name whoever is left.
  if (ranked.length < 3 && extra) {
    for (const c of shortlist) if (ranked.length < 3 && !ranked.includes(c.p) && !hates(who, c.p)) ranked.push(c.p);
  }
  return ranked.slice(0, 3);
}

const POSITION_NAME: Record<Position, [string, string]> = {
  PG: ['point guard', 'point guards'], SG: ['shooting guard', 'shooting guards'], SF: ['small forward', 'small forwards'],
  PF: ['power forward', 'power forwards'], C: ['center', 'centers'],
};
const NUMBER = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen'];

/** The rival picks between this one and the human's next one. */
function teamsBeforeNextPick(state: DraftState): number[] {
  const n = state.teams.length;
  const humanIdx = state.teams.findIndex((t) => t.isHuman);
  const out: number[] = [];
  for (let k = state.round * n + state.pickInRound + 1; k < n * ROUNDS; k++) {
    const round = Math.floor(k / n);
    const inRound = k % n;
    const idx = round % 2 === 0 ? inRound : n - 1 - inRound;
    if (idx === humanIdx) break;
    out.push(idx);
  }
  return out;
}

/**
 * 2026-10-15, the user ("eksperci mimo specjalizacji powinni reagować na skład gracza"): every call
 * starts from the roster on the board. The expert names the hole in his own field if there is one,
 * otherwise the roster's biggest hole ("not my department, but…"), and his three are players who
 * fill it, in his order of taste. Holes come from the same detectors as Chalk Talk (draftDesk.ts).
 */
const ON_BALL = ['Primary Ball Handler', 'Secondary Ball Handler', 'Shot Creator'];
const INSIDE = ['Slasher', 'Roll & Cut Big', 'Post Scorer', 'Versatile Big'];
const FIXES: Record<Topic, (p: PlayerSpan) => boolean> = {
  rimProtection: (p) => RIM_PROTECTOR_ROLES.includes(p.defensiveRole) && computeDefensiveTalent(p) >= 70,
  perimeterD: (p) => PERIMETER_DEFENDER_ROLES.includes(p.defensiveRole) && computeDefensiveTalent(p) >= 70,
  weakLink: (p) => PERIMETER_DEFENDER_ROLES.includes(p.defensiveRole) && computeDefensiveTalent(p) >= 70,
  rebounding: (p) => p.box.rpg >= 9,
  spacing: (p) => computeSpacing(p) >= 65,
  rimPressure: (p) => INSIDE.includes(p.offensiveArchetype),
  ballShare: (p) => !ON_BALL.includes(p.offensiveArchetype),
  creation: (p) => ON_BALL.includes(p.offensiveArchetype) || (playmakingScoreForPlayer(p) ?? 0) >= 85,
  secondCreator: (p) => ON_BALL.includes(p.offensiveArchetype) || (playmakingScoreForPlayer(p) ?? 0) >= 85,
  starPower: (p) => effectiveTalent(p) >= 90,
};
const HOLE_SAY: Record<Topic, string> = {
  rimProtection: 'nobody protects the rim',
  perimeterD: 'nobody stops a scorer on the perimeter',
  weakLink: 'teams will hunt one of your guys on defense',
  rebounding: 'nobody grabs a rebound',
  spacing: 'nobody spaces the floor',
  rimPressure: 'nobody gets to the rim',
  ballShare: 'everybody wants the ball',
  creation: 'nobody creates his own shot',
  secondCreator: 'there’s no second creator',
  starPower: 'there’s no star',
};
/** The worries each expert owns. */
const FIELD: Partial<Record<ExpertId, Topic[]>> = {
  shyman: ['rimProtection', 'perimeterD', 'weakLink'],
  batt: ['perimeterD', 'weakLink', 'rimProtection'],
  solin: ['rebounding', 'rimPressure'],
  sosini: ['spacing'],
  prab: ['creation', 'secondCreator'],
  zoran: ['ballShare', 'secondCreator'],
  jeremy: ['ballShare', 'spacing'],
  lex: ['starPower'],
  // The capologist fixes whatever is broken — cheaply.
  natalie: ['rimProtection', 'perimeterD', 'weakLink', 'rebounding', 'spacing', 'rimPressure', 'ballShare', 'creation', 'secondCreator'],
};
interface Hole { topic: Topic; own: boolean }
function holeFor(who: ExpertId, roster: PlayerSpan[], shortlist: Candidate[]): Hole | null {
  if (roster.length === 0) return null;
  const worries: DeskTake[] = takesFor(roster).filter((t) => t.kind === 'concern').sort((a, b) => b.weight - a.weight);
  const topics = worries.map((t) => t.topic);
  if (!roster.some((p) => effectiveTalent(p) >= 90)) topics.push('starPower');
  const fixable = (t: Topic) => shortlist.filter((c) => FIXES[t](c.p) && !hates(who, c.p)).length >= 1;
  const own = (FIELD[who] ?? []).find((t) => topics.includes(t) && fixable(t));
  if (own) return { topic: own, own: true };
  const any = topics.find((t) => t !== 'starPower' && fixable(t));
  return any ? { topic: any, own: false } : null;
}
const rosterNames = (roster: PlayerSpan[]) => {
  const top = [...roster].sort((a, b) => effectiveTalent(b) - effectiveTalent(a)).map(surname);
  return top.length <= 2 ? top.join(' and ') : `${top[0]}, ${top[1]} and friends`;
};

const voice = (who: ExpertId, kind: DeskLine['kind'], text: string, reply = false): DeskLine => (who === 'host' ? { who, kind: 'host', text } : { who, kind, text, reply });


interface CallVoiceCtx {
  /** The roster's best players ("LeBron and McAdoo"), empty before the first pick. */
  team: string;
  /** The hole he's talking about (lower case), or null when nothing's broken. */
  say: string | null;
  /** The hole is in his own field. */
  own: boolean;
  topic: Topic | null;
  names: string;
  picks: PlayerSpan[];
  caps: number;
  slots: number;
  famous: string | null;
  rng: () => number;
}
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** What Kobe would have asked about each hole (Prabuckov's version of a diagnosis). */
const KOBE_ASKS: Record<Topic, string> = {
  rimProtection: 'who protects the rim', perimeterD: 'who guards their best scorer', weakLink: 'who are they going to hunt',
  rebounding: 'who gets the rebound', spacing: 'who makes them guard the arc', rimPressure: 'who attacks the basket',
  ballShare: 'who moves without the ball', creation: 'who takes the last shot', secondCreator: 'who runs it when the star sits',
  starPower: 'who is the star',
};
/**
 * 2026-10-15, the user ("każda z postaci potrzebuje też różnych cech charakteru, żeby nie miały
 * takiej samej formułki przy wyborze"): each expert answers a call in his own way — Shyman in five
 * words, Sosini as a lecture, Natalie with a price tag on every name, Lex as if the question were
 * beneath him — with a couple of variants each, all built on the same roster read.
 */
function callVoice(who: ExpertId, c: CallVoiceCtx): string {
  const v = (options: string[]) => pick(c.rng, options);
  const team = c.team || 'An empty roster';
  const capsOf = c.picks.map((p) => `${surname(p)} (${p.fga.toFixed(1)})`).join(', ');
  const last = c.picks.length ? surname(c.picks[c.picks.length - 1]) : '';
  const mine = list(c.picks.slice(0, -1));
  // The hole isn't his field: he says so, hands over one name for it, and keeps two for his taste.
  if (c.say && !c.own && c.picks.length >= 2 && who !== 'natalie' && who !== 'jert') {
    const ASIDE: Partial<Record<ExpertId, string[]>> = {
      shyman: [`${team}. ${cap1(c.say)}. Not my thing. ${last} fixes it. ${mine} guard. Simple.`],
      sosini: [`${team}. Yes, yes, ${c.say}. ${last}, fine. But respectfully, the real upgrade is ${mine}. 🥱`],
      solin: [`${team}. Somebody will tell you ${c.say}. Sure, ${last}. My eyes want ${mine}, though.`],
      prab: [`${team}. ${cap1(c.say)}, my friend, so take ${last}. But closers win: ${mine}. 🐍`],
      zoran: [`Listen to me. ${team}, and ${c.say}. ${last} for that. For the soul of the team: ${mine}.`],
      jeremy: [`${team}. The tape says ${c.say}, so ${last}. The tape ALSO says ${mine}.`],
      batt: [`${team}. ${cap1(c.say)}? Va bene, ${last}. But my heart says ${mine}. 🤌`],
      lex: [`${team}. ${cap1(c.say)}? ${last}, whatever. STARS: ${mine}. 👑`],
      binash: [`Dude. ${team}. ${cap1(c.say)}, bummer, so ${last}. Totally tubular bonus: ${mine}. 🤙`],
      bannerman: [`${team}. ${cap1(c.say)}. ${last} handles it. Red would add ${mine}. 🍀`],
    };
    const lines = ASIDE[who];
    if (lines) return v(lines);
  }
  switch (who) {
    case 'shyman':
      return c.say
        ? v([`${team}. ${cap1(c.say)}. ${c.names}. Pick one. Simple.`, `Look. ${team}? ${cap1(c.say)}. Fix it. ${c.names}. Done.`])
        : v([`${team}. Looks fine. Want stops? ${c.names}. Simple.`, `${team}. No problem I can see. ${c.names}. They guard. That’s it.`]);
    case 'sosini':
      return c.say
        ? v([
          `Respectfully, let me explain basketball to you. ${team}, and ${c.say}. In 2026. The fix is obvious: ${c.names}. You’re welcome. 🥱`,
          `${team}. Cute. But ${c.say}, and every coach with a laptop knows it. ${c.names}. Take notes.`,
        ])
        : v([`${team}. Fine, I guess. If you want to be modern: ${c.names}. 🥱`, `Respectfully, ${team} is a start. ${c.names}. Talent, range, taste.`]);
    case 'solin':
      return c.say
        ? v([`I looked at ${team} for five seconds. ${cap1(c.say)}. I can see it from here. ${c.names}. Grown men.`, `${team}. No spreadsheet needed: ${c.say}. ${c.names}. Watch them once, you’ll get it.`])
        : v([`${team}. Eye test says okay. ${c.names} would make it mean. 💪`, `${team}. Looks right to me. ${c.names}. Trust your eyes.`]);
    case 'prab':
      return c.topic
        ? v([
          `My friend. Kobe would look at ${team} and ask one question: ${KOBE_ASKS[c.topic]}? Nobody. ${c.names}. Answer the question. 🐍`,
          `${team}. In 2009 Kobe didn’t wait for help, he demanded it. You need to know ${KOBE_ASKS[c.topic]}. ${c.names}. Demand them.`,
        ])
        : v([`${team}. Good. Now add killers, my friend. ${c.names}. Mamba mentality.`, `${team}. Kobe would nod. Slowly. ${c.names} would make him smile.`]);
    case 'zoran':
      return c.say
        ? v([`Listen to me. Basketball is a conversation. ${team}, and ${c.say}, so the conversation stops. ${c.names}. They talk with the ball. *hand on heart*`, `${team}. In Europe we would call this unfinished: ${c.say}. ${c.names}. Now it is a team.`])
        : v([`Listen to me. ${team} already passes the ball a little. ${c.names}. Then it sings.`, `${team}. Beautiful start. ${c.names}. Five guys, one ball, no ego.`]);
    case 'jeremy':
      return c.say
        ? v([`Rewind the tape on ${team}. Pause. See it? ${cap1(c.say)}. Phil fixes that in one phone call. ${c.names}.`, `${team}. I watched the tape twice: ${c.say}. In ’96 that gets you swept. ${c.names}. Go watch them.`])
        : v([`${team}. Tape looks clean. ${c.names}, and it looks like ’96.`, `${team}. Good tape. ${c.names}. Textbook.`]);
    case 'batt':
      return c.say
        ? v([`Madonna! ${team}… and ${c.say}! I cannot watch. ${c.names}. Ecco. Now I can breathe. 🤌`, `Ragazzi. ${team}. Beautiful. And then: ${c.say}. Tragedy. ${c.names}. Two ends. Basta.`])
        : v([`${team}! Bellissimo! Add ${c.names} and I cry. Happy tears. 🤌`, `${team}. Perfetto, almost. ${c.names}. Two ends. Mamma mia.`]);
    case 'lex':
      return c.say
        ? v([`You called ME because ${c.say}? Cute. Draft a star and the problem disappears. ${c.names}. 👑`, `${team}. Problems are for teams without stars. ${c.names}. Next question.`])
        : v([`${team}. Fine. Now get a real star. ${c.names}. Everything else is noise. 👑`, `${team}? Role players with a dream. ${c.names}. You’re welcome.`]);
    case 'natalie':
      return c.say
        ? v([`Rules are rules. ${c.caps.toFixed(1)} caps, ${c.slots} spots, and ${c.say}. Best fix per cap: ${capsOf}. Write it down. 💸`, `${team}. Budget: ${c.caps.toFixed(1)}. Problem: ${c.say}. Answer: ${capsOf}. I’m not repeating myself.`])
        : v([`Rules are rules. ${c.caps.toFixed(1)} caps, ${c.slots} spots. ${capsOf}. All three give you more than they cost. 💸`, `${team}. Nothing broken, money left. Spend it here: ${capsOf}.`]);
    case 'jert':
      return v([
        `${team}. ${c.say ? `Everybody will tell you ${c.say}. Fine. ` : ''}Everybody wants ${c.famous ?? 'the obvious guy'}. Wrong. ${c.names}. Don’t ask me why. 📚`,
        `${team}. ${c.famous ?? 'The famous guy'}? Fraud tax. ${c.say ? `You need help, sure: ${c.say}. ` : ''}${c.names}. I don’t have to explain myself.`,
      ]);
    case 'binash':
      return c.say
        ? v([`Dude! ${team}! Radical! But ${c.say}, and that’s totally bogus. ${c.names}. Tubular fix, my dudes. 🤙`, `${team}. Gnarly start. Bummer: ${c.say}. ${c.names}! Cue the synth solo. 🕺`])
        : v([`${team}! Totally tubular! ${c.names} and it’s 1986 again. 🤙`, `Dude. ${team}. Rad. ${c.names}. Showtime would approve.`]);
    case 'bannerman':
      return c.say
        ? v([`${team}. ${cap1(c.say)}. Red Auerbach would’ve lit a cigar and fixed it before dinner. ${c.names}. 🍀`, `${team}. Banner teams don’t leave holes like this: ${c.say}. ${c.names}. Trust me.`])
        : v([`${team}. Banner energy, almost. ${c.names}. 🍀`, `${team}. Red would approve. Mostly. ${c.names}. Trust me.`]);
    default:
      return `${team}. ${c.names}.`;
  }
}

/** Places a call. Pure: the same draft state and seed always give the same answer. */
export function placeCall(id: CallId, state: DraftState, seed: number): CallResult {
  const pickNo = state.round * state.teams.length + state.pickInRound;
  const idHash = [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rng = mulberry32(mixSeed(mixSeed(seed, 0xc0de + pickNo), idHash));
  const human = state.teams[currentTeamIndex(state)];

  if (id === 'host') {
    const before = [...new Set(teamsBeforeNextPick(state))];
    const need = new Map<Position, number>();
    for (const idx of before) {
      const roster = state.teams[idx].roster;
      for (const slot of STARTER_SLOTS) if (!roster.some((p) => p.primaryPosition === slot)) need.set(slot, (need.get(slot) ?? 0) + 1);
    }
    const ranked = [...need.entries()].sort((a, b) => b[1] - a[1]);
    const quiet = STARTER_SLOTS.filter((s) => !need.has(s));
    const say = (pos: Position, n: number) => `${NUMBER[n] ?? n} team${n === 1 ? '' : 's'} before your next pick still need${n === 1 ? 's' : ''} a ${POSITION_NAME[pos][0]}`;
    const parts = [
      '*touches earpiece* My phone is MELTING.',
      ranked[0] ? `${say(ranked[0][0], ranked[0][1])}.` : 'Everybody before you has a full five. Nobody’s desperate.',
      ranked[1] ? `${say(ranked[1][0], ranked[1][1]).replace(' before your next pick', '')}.` : '',
      quiet.length ? `${POSITION_NAME[quiet[0]][1].charAt(0).toUpperCase()}${POSITION_NAME[quiet[0]][1].slice(1)}? Nobody’s calling. Crickets.` : '',
      'You didn’t hear it from me.',
    ];
    return { id, picks: [], lines: [voice('host', 'host', parts.filter(Boolean).join(' '))] };
  }

  if (id === 'desk') {
    const desk = buildDraftDesk(human.roster, ROSTER_SIZE - human.roster.length);
    const who: Record<string, ExpertId> = { coach: 'shyman', analyst: 'sosini', scout: 'prab' };
    return {
      id,
      picks: [],
      lines: [
        voice('host', 'host', `We’ve got a caller with ${list(human.roster.slice(0, 4))}. Panel, what’s the hole? Try not to kill each other.`),
        ...desk.turns.map((t, i) => voice(who[t.expert], i === 0 ? 'concern' : 'reply', t.text.replace(/\b(Coach|Analyst|Scout) has a point/, (_m, title: string) => `${{ Coach: 'Matt', Analyst: 'Mattia', Scout: 'Mikhail' }[title]} has a point`), i > 0)),
        voice('host', 'host', `Okay. OKAY. Phones down. Next pick? ${desk.consensus}`),
      ],
    };
  }

  const candidates = callCandidates(state);
  const shortlist = candidates.slice(0, SHORTLIST);

  if (id === 'moonbat') {
    const right = rng() < 0.3;
    const p = right ? pick(rng, candidates.slice(0, 5)).p : pick(rng, candidates.slice(SHORTLIST).length ? candidates.slice(SHORTLIST) : candidates).p;
    const reason = MOONBAT_TAKES[Object.keys(MOONBAT_TAKES).find((n) => normalizePlayerName(n) === normalizePlayerName(p.playerName)) ?? ''];
    const take = reason ?? `${surname(p).toLowerCase()}. ${pick(rng, ['trust me. do ur research', 'his name sounds fast', 'i had a dream about him', 'vibes. pure vibes'])}`;
    const lines: DeskLine[] = [voice('moonbat', right ? 'right' : 'take', take)];
    if (right) {
      lines.push(
        voice('rightwing', 'reply', '@Moonbat Bart. *sighs* That is not how any of this works.', true),
        voice(pick(rng, ['natalie', 'onoffsky'] as ExpertId[]), 'defends', '…He’s right, though. *the whole desk turns* Wrong reason. Right player.', true),
        voice('rightwing', 'reply', '*stares at the ceiling* I’m deleting this app.', true),
      );
    } else {
      lines.push(
        voice('rightwing', 'reply', pick(rng, ['@Moonbat that is not a basketball reason, Bart. Don’t.', '@Moonbat please don’t draft him. Please.']), true),
        voice('moonbat', 'reply', pick(rng, ['see u tomorrow', 'agree to disagree ✌️', 'u wish u had my confidence']), true),
      );
    }
    return { id, picks: [p], lines };
  }

  if (id === 'onoffsky') {
    const board = shortlist.slice(0, WAR_ROOM_SIZE).map((c) => c.p);
    return {
      id,
      picks: [],
      warRoom: board.map((p) => normalizePlayerName(p.playerName)),
      lines: [voice('onoffsky', 'call', `*adjusts glasses* ${board.length} players. The other ${Math.max(0, candidates.length - board.length)}+ don’t move your number. Which of these? Your call. I don’t do hand-holding. Ends after your pick. 🤓`)],
    };
  }

  const expert = id as ExpertId;
  let picks: PlayerSpan[];
  let intro: string;
  if (expert === 'rotation') {
    const counts = new Map<Position, number>();
    for (const p of human.roster) counts.set(p.primaryPosition, (counts.get(p.primaryPosition) ?? 0) + 1);
    const thin = STARTER_SLOTS.filter((s) => (counts.get(s) ?? 0) < 2);
    const hole = thin[0];
    picks = threeFor('rotation', shortlist, hole ? (p) => thin.includes(p.primaryPosition) : undefined);
    const holder = hole ? human.roster.find((p) => p.primaryPosition === hole) : undefined;
    intro = hole
      ? holder
        ? `Nobody behind ${surname(holder)} at ${POSITION_NAME[hole][0]}. What happens when he sits? February is coming. ${list(picks)}. Love you guys. 🙏`
        : `${rosterNames(human.roster)}, and not one ${POSITION_NAME[hole][0]}. Not one! ${list(picks)}. Love you guys. 🙏`
      : `${rosterNames(human.roster)}. Your rotation is actually fine. *wipes a tear* ${list(picks)} for depth anyway. Love you guys.`;
  } else {
    const roster = human.roster;
    const hole = holeFor(expert, roster, shortlist);
    const fix = hole ? FIXES[hole.topic] : undefined;
    // The contrarian skips the obvious names at the top of the board.
    const famous = expert === 'jert' ? shortlist[0]?.p : undefined;
    const pool = expert === 'jert' ? shortlist.slice(3) : shortlist;
    if (hole && !hole.own) {
      // Not his field: one name for the hole, the other two his own taste.
      const fixer = threeFor(expert, pool, fix, roster)[0];
      const rest = threeFor(expert, pool.filter((c) => c.p !== fixer), undefined, roster).slice(0, fixer ? 2 : 3);
      picks = fixer ? [...rest, fixer] : rest;
    } else {
      picks = threeFor(expert, pool, fix, roster);
    }
    const names = list(picks);
    const team = roster.length ? rosterNames(roster) : '';
    const budget = pickBudget(state, human);
    intro = callVoice(expert, {
      team,
      say: hole ? HOLE_SAY[hole.topic] : null,
      own: hole?.own ?? false,
      topic: hole?.topic ?? null,
      names,
      picks,
      caps: budget.capLeft,
      slots: budget.slotsLeft,
      famous: famous ? surname(famous) : null,
      rng,
    });
  }
  const lines: DeskLine[] = [voice(expert, 'call', intro)];
  // Somebody at the desk can't stand one of the names: he cuts in.
  const target = picks.find((p) => hatersOf(p, expert).some((w) => w !== 'moonbat'));
  if (target) {
    const hater = hatersOf(target, expert).find((w) => w !== 'moonbat')!;
    lines.push(
      voice(hater, 'cuts', hatesByName(hater, target) ? `@${HANDLE[expert]} ${surname(target)}? Fraud. Don’t listen to him.` : `@${HANDLE[expert]} ${surname(target)}? Purple and gold. Get him away from me.`, true),
      voice(expert, 'reply', pick(rng, ['Agree to disagree.', 'Nobody asked you.', `Says the guy who ${hater === 'jert' ? 'calls Curry a fraud' : 'got the last one wrong'}.`]), true),
    );
  }
  return { id, picks, lines };
}

/** Whether a call can be placed right now (the UI also checks it's the human's pick). */
export function canCall(id: CallId, state: DraftState, seed: number, log: CallLog): boolean {
  return callOptions(state, seed, log).some((o) => o.id === id && !o.unavailable);
}

/** The log after a call. */
export function logCall(log: CallLog, result: CallResult, state: DraftState): CallLog {
  const pickNo = state.round * state.teams.length + state.pickInRound;
  if (result.id === 'moonbat') return { ...log, moonbatRounds: [...log.moonbatRounds, state.round] };
  return {
    ...log,
    used: [...log.used, result.id],
    ...(result.warRoom ? { warRoomPick: pickNo, warRoom: result.warRoom } : {}),
  };
}

