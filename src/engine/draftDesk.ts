import type { PlayerSpan } from '../data/schema';
import { PERIMETER_DEFENDER_ROLES, RIM_PROTECTOR_ROLES } from '../data/schema';
import { computeSpacing } from './spacing';
import { computeDefensiveTalent } from './defensiveTalent';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { rimPressureForFit, rimPressureTeam } from './rimPressure';
import { effectiveTalent } from './grades';
import { computeOffensiveProfile } from './offensiveProfile';

/**
 * 2026-09-25, user's ask (in place of the in-draft rim-pressure hint: "wypowiedzi ekspertów którzy
 * mówią o wadach i zaletach zespołu … po 3 pickach, jednorazowe", mockup C "debate thread"): after
 * the human's third pick, three pundits trade four or five lines about the start.
 *
 * Built from per-player measures, not `fitScore` — that needs a full five and returns zeros before
 * it. Each expert only covers his own area:
 *   coach   — rim protection, perimeter defense, rebounding
 *   analyst — spacing, rim pressure, how many players need the ball
 *   scout   — creation, star power
 * Thresholds come from the first three picks of seeded CPU drafts (2026-09-25): e.g. the best
 * rebounder of a CPU trio averages 10+ rpg in nine of ten, so "nobody over 8" is a real hole.
 * Bench, minutes and rotation topics are left out on purpose — there is no bench after 3 picks.
 */
export type DeskExpert = 'coach' | 'analyst' | 'scout';

export const DESK_EXPERT_TITLE: Record<DeskExpert, string> = {
  coach: 'The Coach',
  analyst: 'The Analyst',
  scout: 'The Scout',
};

export interface DeskTurn {
  expert: DeskExpert;
  text: string;
}

export interface DraftDeskResult {
  turns: DeskTurn[];
  /** One line on what to look for next ("Desk consensus · next pick"). */
  consensus: string;
}

type Topic = 'spacing' | 'rimPressure' | 'ballShare' | 'rimProtection' | 'perimeterD' | 'weakLink' | 'rebounding' | 'creation' | 'secondCreator' | 'starPower';

interface Take {
  topic: Topic;
  expert: DeskExpert;
  kind: 'strength' | 'concern';
  weight: number;
  line: string;
  /** Concerns only: what fixes it, finishing "Go get …" / the consensus line. */
  advice?: string;
}

const ON_BALL_ARCHETYPES = ['Primary Ball Handler', 'Secondary Ball Handler', 'Shot Creator'];
const NAME_SUFFIXES = new Set(['Jr.', 'Sr.', 'II', 'III', 'IV']);

/** Last name the way a TV desk says it ("Curry", "Griffey Jr." → "Griffey"). */
export function deskName(span: PlayerSpan): string {
  const parts = span.playerName.split(' ').filter((p) => !NAME_SUFFIXES.has(p));
  return parts[parts.length - 1] ?? span.playerName;
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function best<T>(items: T[], score: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((top, item) => (top === undefined || score(item) > score(top) ? item : top), undefined);
}

function takesFor(roster: PlayerSpan[]): Take[] {
  const takes: Take[] = [];
  const dtal = new Map(roster.map((p) => [p.id, computeDefensiveTalent(p)]));
  const d = (p: PlayerSpan) => dtal.get(p.id) ?? 0;

  // ── Analyst ──────────────────────────────────────────────────────────────
  const spacing = roster.map((p) => ({ p, v: computeSpacing(p) }));
  const shooters = spacing.filter((s) => s.v >= 65).map((s) => deskName(s.p));
  const nonSpacers = spacing.filter((s) => s.v < 20).map((s) => deskName(s.p));
  if (nonSpacers.length >= 2) {
    takes.push({ topic: 'spacing', expert: 'analyst', kind: 'concern', weight: 0.75,
      line: `${list(nonSpacers)} don’t shoot it from outside. That paint is going to get crowded fast.`,
      advice: 'a shooter who spaces the floor' });
  } else if (shooters.length === roster.length && roster.length >= 3) {
    takes.push({ topic: 'spacing', expert: 'analyst', kind: 'strength', weight: 0.85,
      line: `Best spacing I’ve seen at this desk. ${list(shooters)} — you cannot leave any of them open.` });
  } else if (shooters.length >= 2) {
    takes.push({ topic: 'spacing', expert: 'analyst', kind: 'strength', weight: 0.6,
      line: `${list(shooters)} both stretch the floor. That’s real room to operate.` });
  }

  // Pre-1997 spans have no shot-location data, and `rimPressureForFit` then only credits C/PF —
  // Jordan 1987-89 reads 0. Until that proxy covers perimeter players, the desk stays quiet on
  // rim pressure for any roster holding one, rather than telling Jordan he never gets to the rim.
  const rimBlind = roster.some((p) => p.primaryPosition !== 'C' && p.primaryPosition !== 'PF' && !computeOffensiveProfile(p).hasZoneData);
  const rim = rimPressureTeam(roster);
  if (rimBlind) {
    // no read either way
  } else if (rim < 55) {
    takes.push({ topic: 'rimPressure', expert: 'analyst', kind: 'concern', weight: 0.6 + (55 - rim) / 100,
      line: 'Nobody gets to the rim. Defenses will stay home on the shooters and live with long twos.',
      advice: 'a slasher or a big who finishes inside' });
  } else if (rim >= 100) {
    const driver = best(roster, rimPressureForFit)!;
    takes.push({ topic: 'rimPressure', expert: 'analyst', kind: 'strength', weight: 0.45,
      line: `${deskName(driver)} lives at the rim — the defense has to collapse every time he gets downhill.` });
  }

  const onBall = roster.filter((p) => ON_BALL_ARCHETYPES.includes(p.offensiveArchetype));
  if (onBall.length >= 3) {
    takes.push({ topic: 'ballShare', expert: 'analyst', kind: 'concern', weight: 0.65,
      line: `${list(onBall.map(deskName))} all want the ball. Somebody’s going to be standing in the corner, unhappy.`,
      advice: 'someone who scores without the ball' });
  }

  // ── Coach ────────────────────────────────────────────────────────────────
  const protectors = roster.filter((p) => RIM_PROTECTOR_ROLES.includes(p.defensiveRole));
  const anchor = best(protectors, d);
  if (!anchor) {
    takes.push({ topic: 'rimProtection', expert: 'coach', kind: 'concern', weight: 0.85,
      line: 'Nobody back there protects the rim. Every drive ends in a layup.',
      advice: 'a big who protects the rim' });
  } else if (d(anchor) >= 88) {
    takes.push({ topic: 'rimProtection', expert: 'coach', kind: 'strength', weight: 0.8,
      line: `${deskName(anchor)} behind them changes everything. Nobody’s getting easy layups.` });
  } else if (d(anchor) < 70) {
    takes.push({ topic: 'rimProtection', expert: 'coach', kind: 'concern', weight: 0.5,
      line: `${deskName(anchor)} is back there, but he’s not scaring anybody at the rim.`,
      advice: 'a big who protects the rim' });
  }

  const stopper = best(roster.filter((p) => PERIMETER_DEFENDER_ROLES.includes(p.defensiveRole) && p.primaryPosition !== 'C'), d);
  if (stopper && d(stopper) >= 85) {
    takes.push({ topic: 'perimeterD', expert: 'coach', kind: 'strength', weight: 0.7,
      line: `${deskName(stopper)} can take the other team’s best scorer every single night. That’s a real weapon.` });
  }
  const liability = best(roster.filter((p) => !protectors.includes(p)), (p) => -d(p));
  if (liability && d(liability) < 35) {
    takes.push({ topic: 'weakLink', expert: 'coach', kind: 'concern', weight: 0.55,
      line: `Teams are going to go right at ${deskName(liability)} on defense. You’ll have to hide him.`,
      advice: 'a perimeter stopper' });
  }

  const glass = best(roster, (p) => p.box.rpg)!;
  if (glass.box.rpg < 8) {
    takes.push({ topic: 'rebounding', expert: 'coach', kind: 'concern', weight: 0.7,
      line: 'Who’s grabbing a rebound? Nobody here cleans the glass.',
      advice: 'a big who rebounds' });
  } else if (glass.box.rpg >= 13) {
    takes.push({ topic: 'rebounding', expert: 'coach', kind: 'strength', weight: 0.45,
      line: `${deskName(glass)} is going to own the glass. Second chances every night.` });
  }

  // ── Scout ────────────────────────────────────────────────────────────────
  const pm = (p: PlayerSpan) => playmakingScoreForPlayer(p) ?? 0;
  const creator = best(onBall, pm);
  const bestPm = Math.max(...roster.map(pm));
  if (!creator && bestPm < 85) {
    takes.push({ topic: 'creation', expert: 'scout', kind: 'concern', weight: 0.8,
      line: 'Nobody here creates his own shot. Who has the ball with the clock running down?',
      advice: 'a lead ball handler' });
  } else if (creator && pm(creator) >= 90 && onBall.length === 1) {
    takes.push({ topic: 'creation', expert: 'scout', kind: 'strength', weight: 0.75,
      line: `${deskName(creator)} runs the show, and nobody else needs the ball. Nobody’s stepping on toes.` });
  } else if (creator && pm(creator) >= 90) {
    takes.push({ topic: 'creation', expert: 'scout', kind: 'strength', weight: 0.6,
      line: `${deskName(creator)} can get a good look out of any possession.` });
  }
  // A passing big (Jokic) or point forward is a second creator too, whatever his archetype tag.
  if (creator && onBall.length === 1 && !roster.some((p) => p !== creator && pm(p) >= 85)) {
    takes.push({ topic: 'secondCreator', expert: 'scout', kind: 'concern', weight: 0.45,
      line: `When ${deskName(creator)} sits, who makes a play? There’s no second creator yet.`,
      advice: 'a second ball handler' });
  }

  const stars = roster.filter((p) => effectiveTalent(p) >= 90).sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
  if (stars.length >= 2) {
    takes.push({ topic: 'starPower', expert: 'scout', kind: 'strength', weight: 0.5,
      line: stars.length === roster.length
        ? `Three picks, three stars in ${list(stars.map(deskName))}. Talent like that wins games by itself.`
        : `Two real stars already in ${list(stars.map(deskName))}. Talent like that wins games by itself.` });
  } else if (stars.length === 1 && effectiveTalent(stars[0]) >= 95) {
    takes.push({ topic: 'starPower', expert: 'scout', kind: 'strength', weight: 0.4,
      line: `${deskName(stars[0])} is a franchise player. You build around that and you’re fine.` });
  }

  return takes;
}

/** Hand-written replies for the pairs a desk actually argues about; anything else falls back to
 * the replying expert's own generic opener. */
const BRIDGES: Partial<Record<`${Topic}>${Topic}`, string>> = {
  'spacing>rimProtection': 'Spacing doesn’t get you stops.',
  'spacing>rebounding': 'Spacing doesn’t get you stops.',
  'spacing>rimPressure': 'Shooting’s great until the shots stop falling.',
  'creation>ballShare': 'Too many cooks, though.',
  'rimProtection>spacing': 'Great — until you have the ball.',
  'perimeterD>creation': 'Stops are nice. You still have to score.',
  'starPower>rimProtection': 'Talent’s great. Now look at the back line.',
  'starPower>spacing': 'Talent, sure. Spacing is another story.',
};
const OPENERS: Record<DeskExpert, string[]> = {
  coach: ['Nice. But defense wins titles.', 'Pump the brakes.', 'I’m not buying it yet.'],
  analyst: ['Let me bring it back to the numbers.', 'The numbers tell a different story.'],
  scout: ['Let me push back a little.', 'Not so fast.'],
};
const THIRD_STRENGTH_PREFIX: Record<DeskExpert, string> = {
  coach: 'I’ll say this:',
  analyst: 'In fairness,',
  scout: 'Give the kid credit:',
};
const THIRD_CONCERN_PREFIX: Record<DeskExpert, string> = {
  coach: 'Here’s what bugs me:',
  analyst: 'The numbers flag one more thing:',
  scout: 'My worry is different:',
};

/** Holes one big can fill at once, and how the consensus line names that part of the job. */
const BIG_FIX: Partial<Record<Topic, string>> = {
  rimProtection: 'protects the rim',
  rebounding: 'cleans the glass',
  rimPressure: 'finishes inside',
};

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** Joins a line after a lead-in ("But nobody…"), keeping a player's name capitalised. */
const LOWERABLE_OPENERS = new Set(['Nobody', 'Who’s', 'Teams', 'When', 'Best', 'Three', 'Two', 'And']);
function lowerFirst(s: string): string {
  const first = s.split(/[\s,]/)[0];
  return LOWERABLE_OPENERS.has(first) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export function buildDraftDesk(roster: PlayerSpan[], picksLeft: number): DraftDeskResult {
  const takes = takesFor(roster);
  const strengths = takes.filter((t) => t.kind === 'strength').sort((a, b) => b.weight - a.weight);
  const concerns = takes.filter((t) => t.kind === 'concern').sort((a, b) => b.weight - a.weight);
  const used = new Set<Take>();
  const turns: DeskTurn[] = [];
  const say = (take: Take, text: string, expert: DeskExpert = take.expert) => {
    used.add(take);
    turns.push({ expert, text });
  };

  // 1. The biggest thing going right (or, with nothing to praise, the biggest worry). The desk
  // argues, so the opener comes from someone other than the owner of the biggest worry when it
  // can; when only that expert has praise to give, he makes both points in one breath.
  const c1 = concerns[0];
  const lead = strengths.find((t) => !c1 || t.expert !== c1.expert) ?? strengths[0];
  if (lead && c1 && lead.expert === c1.expert) {
    say(lead, `${lead.line} But ${lowerFirst(c1.line)}`);
    used.add(c1);
  } else if (lead) {
    say(lead, lead.line);
  } else if (c1) {
    say(c1, `I’ll be honest, I’m worried. ${c1.line}`);
  } else {
    turns.push({ expert: 'scout', text: 'Solid start. No holes, nothing flashy — just good players.' });
  }

  // 2. The biggest worry, answered by whoever owns it.
  if (lead && c1 && !used.has(c1)) {
    // Same roster, same words (a re-render or resumed draft never rewords the desk).
    const variant = roster.reduce((sum, p) => sum + p.id.length + p.playerName.length, 0);
    const openers = OPENERS[c1.expert];
    say(c1, `${BRIDGES[`${lead.topic}>${c1.topic}`] ?? openers[variant % openers.length]} ${c1.line}`);
  }

  // 3. The expert who hasn't spoken yet, with his own strongest point.
  const spoken = new Set(turns.map((t) => t.expert));
  const third = (['coach', 'analyst', 'scout'] as DeskExpert[]).find((e) => !spoken.has(e));
  // Nothing in his area? Whoever has the strongest unused point (not the last speaker) takes it.
  const thirdTake = (third ? takes.filter((t) => t.expert === third && !used.has(t)).sort((a, b) => b.weight - a.weight)[0] : undefined)
    ?? takes.filter((t) => !used.has(t) && t.expert !== turns[turns.length - 1]?.expert).sort((a, b) => b.weight - a.weight)[0];
  if (thirdTake) {
    const prefix = thirdTake.kind === 'strength' ? THIRD_STRENGTH_PREFIX[thirdTake.expert] : THIRD_CONCERN_PREFIX[thirdTake.expert];
    say(thirdTake, `${prefix} ${lowerFirst(thirdTake.line)}`);
  }

  // 4. A second worry, if there is one — from someone other than whoever just spoke. The expert
  // who opened with praise concedes first ("Coach has a point, though.").
  const lastSpeaker = () => turns[turns.length - 1]?.expert;
  const c2 = concerns.find((t) => !used.has(t) && t.expert !== lastSpeaker());
  if (c1 && c2) {
    const conceding = lead !== undefined && c2.expert === lead.expert && c2.expert !== c1.expert;
    say(c2, conceding
      ? `${DESK_EXPERT_TITLE[c1.expert].replace('The ', '')} has a point, though. ${c2.line}`
      : `And it’s not just that. ${c2.line}`);
  }

  // 5. Close on what to go get.
  const closer = (preferred: DeskExpert): DeskExpert =>
    preferred !== lastSpeaker() ? preferred : (['coach', 'analyst', 'scout'] as DeskExpert[]).find((e) => e !== lastSpeaker())!;
  const worries = [c1, c2 && used.has(c2) ? c2 : undefined].filter((t): t is Take => Boolean(t));
  const bigJobs = worries.map((t) => BIG_FIX[t.topic]).filter((j): j is string => Boolean(j));
  const oneBigFixesAll = worries.length >= 2 && bigJobs.length === worries.length;
  const picks = `${NUMBER_WORDS[picksLeft] ?? picksLeft} more pick${picksLeft === 1 ? '' : 's'}.`;
  let consensus: string;
  if (!c1) {
    turns.push({ expert: closer('coach'), text: `I’ve got nothing. ${picks} Keep stacking talent.` });
    consensus = 'Best player available — this start has no hole to fill.';
  } else if (oneBigFixesAll) {
    turns.push({ expert: closer(c1.expert), text: `${picks} One big fixes both of our problems.` });
    consensus = `A big who ${list(bigJobs)}.`;
  } else {
    turns.push({ expert: closer(c1.expert), text: `${picks} Go get ${c1.advice}.` });
    consensus = `${c1.advice!.charAt(0).toUpperCase()}${c1.advice!.slice(1)}.`;
  }
  return { turns, consensus };
}
