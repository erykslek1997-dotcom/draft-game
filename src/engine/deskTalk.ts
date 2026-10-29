import type { InsightCategory, RosterInsight } from './insights';

/**
 * 2026-10-29 (the user, on the room: "bardzo sztywnie brzmi… bardziej ludzko i jakby pisane w
 * emocjach"; then "nadal sztywno i nudno, czasem cringe"; picked "B + C" — friends shouting at the
 * TV, and a TV studio with clear characters whose arguments run over several lines): the experts
 * used to read the engine's finding aloud. Here each finding has lines in the voice of the expert
 * whose field it is (`CATEGORY_EXPERT` in desk.ts), about the players by name; and a take draws a
 * real answer (`exchangeFor`): somebody with the opposite taste pushes back on that very point and
 * the first one answers. The finding decides what is said; the push-back is taste, never a fact
 * that contradicts it, and the answer always holds the finding's ground.
 *
 * Slots: {a} {b} {c} are the surnames of the players the finding names, in order; {n} is the first
 * number in it. A line whose slots the finding can't fill is skipped; with no line left the expert
 * falls back on the finding itself (`voiced` in desk.ts). No "you"/"your": the same lines serve a
 * rival's panel.
 *
 * Voices (the user, 2026-10-29): Shyman says it plainly. Sosini is the modern-game guy who can't
 * stand a long two. Batterista is two-way first. Jertcheck keeps lists nobody asked for. Lex is the
 * villain. Mark worries about February. Natalie counts caps. Prabuckov measures everything in Kobe.
 */
type Lines = { praise?: string[]; concern?: string[] };

const TALK: Partial<Record<string, Lines>> = {
  // ── creation: Prabuckov ────────────────────────────────────────────────
  ELITE_PRIMARY_CREATOR: {
    praise: [
      'Ten seconds left, down one. Who gets it? {a}. Nobody on this desk even has to think about it.',
      '{a} can get his shot whenever he wants. Late clock, broken play, doesn’t matter. That’s the Kobe gene, my friend.',
      'I’ve looked at this roster for two minutes and I already know who takes the last shot. {a}. That’s how it should be.',
    ],
  },
  SINGLE_CREATOR_DEPENDENCY: {
    concern: [
      'It’s {a} or nothing. He sits for five minutes and the offense just stops. I’ve seen it, my friend.',
      'Everything goes through {a}. Fine in November. In a Game 7 they put two guys on him and then what?',
    ],
  },
  NO_GO_TO_SCORER: {
    concern: [
      'Down two, ten seconds left. Who gets the ball? {a}? I’m asking. Honestly asking.',
      'Nobody here wants the last shot. I can tell. Kobe wanted every last shot. Even the ones he shouldn’t have taken.',
    ],
  },
  NO_TRUE_PLAYMAKER: {
    concern: ['Who runs the offense? I keep looking. Nobody. Five guys waiting for someone else to make the play.'],
  },
  OFFENSE_IS_THE_WEAK_SIDE: {
    concern: ['They’ll guard. Great. Then they come back down and somebody has to score, and I don’t see who.'],
  },
  ELITE_FLOOR_GENERAL: {
    praise: ['{a} running the show, everybody else just catches and finishes. Easiest job in basketball, playing next to him.'],
  },

  // ── spacing: Sosini ────────────────────────────────────────────────────
  ELITE_STARTING_SPACING: {
    praise: [
      'Five guys who can shoot. FIVE. The paint is empty, the lanes are open, this is the sport now. Finally somebody drafted for it.',
      'Look at this floor. Nobody to sag off. Every closeout is a guess. This is what I’ve been yelling about for years.',
    ],
  },
  GOOD_STARTING_SPACING: {
    praise: ['Four real shooters. One more and I’d frame it, but four is a real offense. I’ll take it.'],
  },
  SPACING_DISTRIBUTED: {
    praise: ['Doesn’t matter who sits, somebody on the floor can shoot. That’s how you build in 2026.'],
  },
  BENCH_SPACING: {
    praise: ['{a} and {b} keep shooting when the starters sit. The second unit doesn’t turn into a museum. Love that.'],
  },
  MOVEMENT_SHOOTING_GRAVITY: {
    praise: ['{a} doesn’t even need the ball. He runs off a screen and two guys panic. That’s gravity.', 'Watch the defense when {a} moves. Nobody watches the ball. That’s the whole trick.'],
  },
  SPACING_WITH_TWO_BIGS_VIABLE: {
    praise: ['Two bigs, and it still works, because everybody else can shoot. Fine. I’m open-minded. Sometimes.'],
  },
  SPACING_CONCENTRATED: {
    concern: [
      '{a} is the only real shooter. He sits down and the paint is a parking lot. Five guys, nowhere to go.',
      'All the shooting is {a}. One cold night from him and this offense is dead. One night.',
    ],
  },
  ONE_CRITICAL_SHOOTER: {
    concern: ['Everything outside hangs on {a}. They’ll chase him off the line and dare everybody else. And everybody else can’t.'],
  },
  LOW_STARTING_SPACING: {
    concern: ['Nobody can shoot. In 2026. The other team just stands in the paint and waits. Who drafted this?'],
  },
  NON_SPACER_OVERLOAD: {
    concern: ['{a} and {b} don’t shoot threes. Their defenders won’t even guard them, they’ll just stand in the paint and wave.'],
  },
  MULTIPLE_NON_SPACERS: {
    concern: ['{a}, {b}, {c}. None of them shoot. That’s not a lineup, that’s a traffic jam.'],
  },
  NO_FRONTCOURT_SPACING: {
    concern: ['{a} and {b} together and neither of them shoots. Two big guys, one small paint. Good luck driving.'],
  },

  // ── defense: Shyman ────────────────────────────────────────────────────
  ELITE_DEFENSIVE_LAYERING: {
    praise: ['{a} takes their best guy, {b} is waiting at the rim. Beat one, the other gets you. Good luck.', '{a} on the ball, {b} behind him. Two stops on every play. I love this team.'],
  },
  BALANCED_DEFENSIVE_COVERAGE: {
    praise: ['Where do you attack this team? You don’t. No weak guy, no hole, nowhere to hide. Good defense.'],
  },
  DEFENSIVE_COVERAGE_CAPACITY_ELITE: {
    praise: ['A guy for the ball, a guy for the wing, a guy at the rim, and they switch everything. Every matchup is bad for the other team.'],
  },
  ELITE_PERIMETER_DEFENSE: {
    praise: ['{a}, {b}, {c}. Any of them can take the best scorer. Pick one. They’re all bad news.', 'There’s always a stopper on the floor. Always. Their best guy is going to have a long night.'],
  },
  MULTIPLE_PERIMETER_DEFENDERS: {
    praise: ['{a}, {b}, {c}. Three guys who can guard. That’s how you win in May.'],
  },
  POA_DEFENDER_PRESENT: {
    praise: ['{a} picks up the ball handler full court. Every possession. Their point guard is going to hate this.'],
  },
  WING_STOPPER_PRESENT: {
    praise: ['{a} takes the best wing every night. Done. That’s one problem solved.'],
  },
  PERIMETER_DEFENSE_BENCH_DEPTH: {
    praise: ['{a} and {b} off the bench and the defense doesn’t drop. That’s rare.'],
  },
  BALL_HAWKS: {
    praise: ['{a} jumps a pass, runs, layup. Easy points. I love easy points.', '{a} and {b} have quick hands. Turnover, fast break, again. Their guards won’t sleep.'],
  },
  ELITE_RIM_PROTECTION: {
    praise: ['Drive in there? Against {a}? Bad idea. Nobody scores at the rim on this team.'],
  },
  SHOT_BLOCKING_ANCHOR: {
    praise: ['{a} blocks {n} a game. Every layup is a coin flip. Every one.', 'Go ahead, drive on {a}. See what happens.'],
  },
  RIM_PROTECTION_CONTINUITY: {
    praise: ['{a} sits, {b} comes in, still somebody at the rim. Smart. Most teams forget that.'],
  },
  DEFENSE_SURVIVES_SUBSTITUTIONS: {
    praise: ['Starters sit and the defense stays the same. That almost never happens.'],
  },
  HUNTABLE_STARTER_EXPOSED: {
    concern: ['They’ll find {a}. Every play. Regular season you hide him. In May you can’t.', '{a} can’t guard. In a series they go at him every single time down the floor.'],
  },
  MULTIPLE_DEFENSIVE_WEAK_LINKS: {
    concern: ['{a} and {b} can’t guard. You can hide one guy. Not two. Never two.'],
  },
  DEFENSE_DEPENDS_ON_STARTERS: {
    concern: ['When {a} comes in, the defense falls off a cliff. The starters do all the work.'],
  },
  NO_RIM_PROTECTOR: {
    concern: ['Nobody at the rim. Get past one man and it’s a free layup. All night.'],
  },
  SINGLE_RIM_PROTECTOR_DEPENDENCY: {
    concern: ['{a} sits and the paint is wide open. One guy can’t play forty-eight.'],
  },
  NO_POA_DEFENDER: {
    concern: ['Nobody can stay in front of the ball. Their point guard is going to have a great night.'],
  },
  NO_WING_STOPPER: {
    concern: ['Nobody to guard a great wing. Whoever they have out there is getting forty.'],
  },

  // ── rebounding: Solin ──────────────────────────────────────────────────
  STRONG_STARTING_REBOUNDING: {
    praise: ['{a} and {b} own the glass. Miss and it’s gone. One shot, and it better go in.'],
  },
  WEAK_STARTING_REBOUNDING: {
    concern: ['Soft on the boards. They’ll give up second chances all night and wonder why they lost.', 'Nobody boxes out on this team. Nobody. That’s ten points a night they hand the other team.'],
  },

  // ── rotation and depth: Mark Rotation ──────────────────────────────────
  DEEP_PLAYOFF_ROTATION: {
    praise: ['{n} guys I’d trust in a playoff game. {n}! Somebody gets hurt and nothing breaks. I can finally relax.'],
  },
  HIGH_VALUE_ROLE_PLAYERS: {
    praise: ['{a} and {b}. Cheap, useful, never waste a shot. That’s my kind of bench.'],
  },
  MATCHUP_SPECIALIST_AVAILABLE: {
    praise: ['{a} on the bench for the right matchup. That’s the guy who wins a Game 5 nobody remembers.'],
  },
  TOP_HEAVY_ROTATION: {
    concern: ['The starters are amazing. And then? February comes, somebody’s ankle goes, and this falls apart.'],
  },
  DEAD_SLOT_HURTS_ROTATION: {
    concern: ['{a} can’t play real minutes, so everybody else plays too many. That’s how people get hurt in March.'],
  },
  DEAD_NINTH_SLOT_ACCEPTABLE: {
    praise: ['{a} won’t play much, and that’s fine. Eight guys cover it. Cheap ninth man. Smart.'],
  },
  CLOSING_FIVE_STABLE: {
    praise: ['Same five at the end, both ends. No coin flip in the last two minutes. I’ll sleep tonight.'],
  },
  CLOSING_FIVE_REQUIRES_TRADEOFF: {
    concern: ['Last two minutes: shooters or defenders? They can’t have both. I hate that choice.'],
  },
  PLAYER_ABOVE_MINUTES_CEILING: {
    concern: ['{a} is playing way too many minutes. He’s going to break down. I can feel it in my own knees.'],
  },
  MULTIPLE_MINUTES_CEILING_VIOLATIONS: {
    concern: ['Too many guys on too many minutes. That’s how a season ends in March.'],
  },
  STAR_MINUTES_UNDERUSED: {
    concern: ['{a} sitting this much? Why? Play the best guy. Please.'],
  },

  // ── caps: Natalie ──────────────────────────────────────────────────────
  STAR_FGA_COST_HURTS_DEPTH: {
    concern: ['{a} eats {n} caps and look what’s left around him. That’s not a team. That’s a receipt.'],
  },
  ELITE_DEFENSE_LOW_FGA_COST: {
    praise: ['Elite defense from cheap guys, so the money goes to the scorers. That’s how you build. I’m a little emotional.'],
  },

  // ── off the ball: Jeremy ───────────────────────────────────────────────
  OFF_BALL_SUPPORT_STRONG: {
    praise: ['{a}, {b}, {c}. Guys who cut, shoot and finish without needing the ball. That’s ’90s basketball. Go watch the tape.'],
  },

  // ── usage: Zoran ───────────────────────────────────────────────────────
  MULTIPLE_HIGH_USAGE_PLAYERS: {
    concern: ['{a}, {b}, {c}. All of them want the ball. There is one ball, my brother. One.'],
  },
  SEVERE_USAGE_COLLISION: {
    concern: ['{a}, {b} and {c} all need the ball to score. Listen to me. That ends with three guys watching one guy dribble.'],
  },

  // ── two-way: Batterista ────────────────────────────────────────────────
  ELITE_TWO_WAY_CORE: {
    praise: ['{a} and {b} play both ends. BOTH. Nobody comes off for defense, nobody comes off for offense. That’s basketball.'],
  },

  // ── fit and structure: Onoffsky ────────────────────────────────────────
  NO_MAJOR_STRUCTURAL_HOLE: {
    praise: ['I went looking for the hole in this roster. Twice. There isn’t one. Honestly annoying.'],
  },
  ROLE_FLEXIBILITY_LOW: {
    concern: ['Everybody here does exactly one thing. The lineups pick themselves, and not in a good way.'],
  },
  MULTIPLE_POSITIONAL_COMPROMISES: {
    concern: ['Too many guys out of position. The lineup data is going to look like a crime scene.'],
  },
  SEVERE_POSITIONAL_STRAIN: {
    concern: ['Guys playing positions they’ve never played. On paper it’s a team. On the floor, no.'],
  },
  DEFENSE_AT_COST_OF_SPACING: {
    concern: ['The best defensive five can’t shoot and the best shooting five can’t guard. Every night is a choice.'],
  },
  ELITE_CREATION_POOR_SPACING: {
    concern: ['{a} can create anything, but nobody around him shoots. They’ll send three guys at him. Every time.'],
  },
  ELITE_SPACING_WEAK_CREATION: {
    concern: ['Shooters everywhere and nobody to make the first move. Who gets them the ball?'],
  },
  GREAT_STARTERS_WEAK_BENCH: {
    concern: ['Starters: great. Bench: I checked twice. It’s not great.'],
  },
  PERIMETER_DEFENSE_BUT_NO_RIM_PROTECTION: {
    concern: ['Great on the perimeter. Then somebody gets beat once and it’s a free layup. Nobody behind them.'],
  },
  RIM_PROTECTION_BUT_POOR_PERIMETER_DEFENSE: {
    concern: ['Great at the rim. Shame every guard gets past his man first.'],
  },
  STAR_POWER_WITH_USAGE_COLLISION: {
    concern: ['Big stars, one ball. The on/off on this is going to be ugly. I can already see the numbers.'],
  },
  STRONG_CORE_FRAGILE_ROTATION: {
    concern: ['Great core. One injury and the whole thing falls apart. I ran it. It falls apart.'],
  },
};

/**
 * Who answers a take and how, by its field and side: [the one who pushes back, his push, the first
 * expert's answer]. The push is taste (style over results, stars over depth, the eye over the
 * numbers); the answer always holds the finding's ground. {who} is the first expert's surname.
 */
type Exchange = [string, string, string];
const PUSHBACK: Partial<Record<InsightCategory, { praise?: Exchange[]; concern?: Exchange[] }>> = {
  perimeter_defense: {
    praise: [
      ['sosini', '@{who} great, they get stops. Then they walk it up and take a long two. A stop is worth what you do with it.', 'A stop is worth a stop, Mattia. Ask anybody who’s won one.'],
      ['lex', '@{who} nobody buys a ticket to watch a charge.', 'Then don’t buy one. They’ll win without you.'],
    ],
    concern: [['sosini', '@{who} so they give up 115 and score 125. Next.', 'In May they score 98, Mattia. Then what?']],
  },
  rim_protection: {
    praise: [['sosini', '@{who} rim protector. Cute. In 2026 people shoot over him from 28 feet.', 'Then he walks out and contests it. That’s why he’s good.']],
    concern: [['lex', '@{who} rim protectors are for teams that can’t outscore people.', 'Lex, they give up a layup every time down. Even your stars can’t outscore that.']],
  },
  defensive_structure: {
    praise: [['lex', '@{who} defense is a hobby, Matt. Stars win.', 'Stars win when the other team can’t score, Lex. Look it up.']],
    concern: [['sosini', '@{who} it’s the regular season, relax. Outscore them.', 'They’ll find that guy in the playoffs, Mattia. They always do.']],
  },
  spacing: {
    praise: [
      ['shyman', '@{who} great, they shoot. Who guards anybody?', 'Nobody needs to guard anybody when they’re up twenty, Matt.'],
      ['solin', '@{who} jump shooters. Wait till it’s cold in May.', 'Davyd, the paint is empty. That doesn’t go cold.'],
    ],
    concern: [['solin', '@{who} so what, they play inside. Real basketball.', 'Inside where, Davyd? There’s no room inside. That’s the point.']],
  },
  creation: {
    praise: [['zoran', '@{who} one guy with the ball, four guys watching. Beautiful for one man.', 'When that one man is this good, Zoran, the four guys get rings.']],
    concern: [['lex', '@{who} give it to the best player and get out of the way. Simple.', 'Lex, I’m saying there isn’t a best player to give it to.']],
  },
  rebounding: {
    praise: [['onoffsky', '@{who} rebounding matters less every year. I have the numbers.', 'Numbers don’t box out, Jake.']],
    concern: [['onoffsky', '@{who} offensive rebounds are overrated, actually.', 'Tell that to the guy who gets dunked on after the second miss.']],
  },
  depth: {
    praise: [['lex', '@{who} nice bench. Where are the stars?', 'Lex, stars get hurt. Benches don’t.']],
    concern: [['lex', '@{who} stars play forty minutes, Mark. Who needs a bench?', 'Everybody in February, Lex. Everybody.']],
  },
  rotation: {
    concern: [['lex', '@{who} the stars play, the rest watch. That’s a rotation.', 'Until a star sprains an ankle in March, Lex.']],
  },
  two_way: {
    praise: [['sosini', '@{who} both ends, sure. Can they shoot from 30 feet?', 'They don’t need to when they guard, Mattia. That’s what both ends means.']],
  },
  usage: {
    concern: [['lex', '@{who} stars figure it out.', 'Stars figure it out with one ball, Lex? Show me when.']],
  },
  fga: {
    concern: [['lex', '@{who} stars cost money. Deal with it.', 'Stars cost money. Nine stars don’t fit. That’s the rule, Lex.']],
  },
  fit: {
    concern: [['solin', '@{who} put good players out there and let them play.', 'Good players out of position are average players, Davyd.']],
  },
};

const surnameOf = (name: string) => name.split(' ').slice(-1)[0];

/** The players a finding names, in the order it names them: its evidence, else the roster names
 * that appear in its sentence. */
function namesIn(insight: RosterInsight, roster: string[]): string[] {
  const listed = insight.evidence?.players ?? [];
  if (listed.length) return listed;
  return roster
    .map((n) => ({ n, at: insight.message.indexOf(n) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.n);
}

/** A human line for this finding in its expert's voice, or null to fall back on the finding. */
export function talkFor(insight: RosterInsight, kind: 'praise' | 'concern', roster: string[], rng: () => number): string | null {
  const lines = TALK[insight.id]?.[kind];
  if (!lines?.length) return null;
  const names = namesIn(insight, roster).map(surnameOf);
  const num = insight.message.match(/\d+(?:\.\d+)?/)?.[0];
  const fill: Record<string, string | undefined> = { a: names[0], b: names[1], c: names[2], n: num };
  const usable = lines.filter((l) => [...l.matchAll(/\{([abcn])\}/g)].every((m) => fill[m[1]] !== undefined));
  if (!usable.length) return null;
  const line = usable[Math.floor(rng() * usable.length)];
  return line.replace(/\{([abcn])\}/g, (_, k: string) => fill[k]!);
}

/** A real answer to a take on a finding: who pushes back, his line, and the first expert's reply —
 * or null when nobody in that field argues (`pileOn` then backs it instead). */
export function exchangeFor(insight: RosterInsight, kind: 'praise' | 'concern', who: string, whoSurname: string, rng: () => number): { by: string; push: string; answer: string } | null {
  const options = (PUSHBACK[insight.category]?.[kind] ?? []).filter(([by]) => by !== who);
  if (!options.length) return null;
  const [by, push, answer] = options[Math.floor(rng() * options.length)];
  return { by, push: push.replace('{who}', whoSurname), answer };
}
