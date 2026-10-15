import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { completeRosterGreedy } from './aiDrafter';
import { computeDefensiveTalent } from './defensiveTalent';
import { DESK_CAST, surname, type DeskLine, type ExpertId } from './desk';
import { HANDLE } from './deskBeefs';
import { hates, hatersOf, hatesByName, loves, MOONBAT_TAKES } from './deskTastes';
import { availablePlayers, currentTeamIndex, isPickLegal, pickBudget, ROUNDS, type DraftState } from './draft';
import { buildDraftDesk } from './draftDesk';
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

function threeFor(who: ExpertId, shortlist: Candidate[], extra?: (p: PlayerSpan) => boolean): PlayerSpan[] {
  const lens = LENS[who] ?? ((p: PlayerSpan) => effectiveTalent(p));
  const pool = shortlist.map((c) => c.p).filter((p) => !hates(who, p) && (!extra || extra(p)));
  return pool
    .map((p) => ({ p, s: (loves(who, p) ? 1000 : 0) + lens(p) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.p);
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

const voice = (who: ExpertId, kind: DeskLine['kind'], text: string, reply = false): DeskLine => (who === 'host' ? { who, kind: 'host', text } : { who, kind, text, reply });

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
    intro = hole
      ? `Nobody behind your ${POSITION_NAME[hole][0]}. February is coming. ${list(picks)}. Love you guys. 🙏`
      : `Your rotation is actually fine. *wipes a tear* ${list(picks)} for depth anyway. Love you guys.`;
  } else if (expert === 'jert') {
    const famous = shortlist[0]?.p;
    picks = threeFor('jert', shortlist.slice(3));
    intro = famous
      ? `Everybody wants ${surname(famous)}. Fraud tax. Take ${list(picks)}. I don’t have to explain myself. 📚`
      : `${list(picks)}. I don’t have to explain myself.`;
  } else {
    picks = threeFor(expert, shortlist);
    const budget = pickBudget(state, human);
    const INTRO: Partial<Record<ExpertId, string>> = {
      natalie: `Rules are rules: ${budget.capLeft.toFixed(1)} caps, ${budget.slotsLeft} spots. ${list(picks)}. All three give you more than they cost. Write them down. 💸`,
      shyman: `${list(picks)}. They guard. Can you pay them? Not my problem.`,
      sosini: `${list(picks)}. Talent, range, taste. Space the floor and the rest takes care of itself. 🥱`,
      solin: `${list(picks)}. Watch them for five minutes. Eye test says yes.`,
      prab: `${list(picks)}. Closers, my friend. Kobe would sign off on all three. 🐍`,
      binash: `${list(picks)}! Totally tubular, dudes. Showtime would approve. 🤙`,
      jeremy: `${list(picks)}. That’s ’90s basketball. Go watch the tape.`,
      lex: `${list(picks)}. Stars. STARS. Everything else is noise. 👑`,
      zoran: `${list(picks)}. *hand on heart* They move the ball. Listen to me.`,
      batt: `${list(picks)}. Two ends. Bellissimo. 🤌`,
      bannerman: `${list(picks)}. ${picks.some((p) => codes(p).includes('BOS')) ? 'Celtic DNA. ' : ''}Trust me. 🍀`,
    };
    intro = INTRO[expert] ?? list(picks);
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

