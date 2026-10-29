import type { RosterInsight } from './insights';

/**
 * 2026-10-29 (the user, on the room: "bardzo sztywnie brzmi… bardziej ludzko i jakby pisane w
 * emocjach"): the experts used to read the engine's finding aloud and add a tag to it ("Your
 * starting five has a defender for the ball handler… Love it."). Here each finding has lines in the
 * voice of the expert whose field it is (`CATEGORY_EXPERT` in desk.ts), written the way people post:
 * short, about the players, no report prose. The finding decides what is said; these only decide how.
 *
 * Slots: {a} {b} {c} are the surnames of the players the finding names, in the order it names them;
 * {n} is the first number in it. A line whose slots the finding can't fill is skipped, and with no
 * line left the expert falls back to the finding itself (`voiced` in desk.ts). No "you": the same
 * lines serve a rival's panel.
 *
 * Voices (the user, 2026-10-29): Shyman says it simply. Sosini is everybody's uncle at a barbecue who
 * found the three-point line. Batterista is two-way first, Italian only now and then. Jertcheck
 * counts things nobody asked about. Lex (not here: he has no field) is the villain.
 */
type Lines = { praise?: string[]; concern?: string[] };

const TALK: Partial<Record<string, Lines>> = {
  // ── creation: Prabuckov (Kobe) ─────────────────────────────────────────
  ELITE_PRIMARY_CREATOR: {
    praise: [
      'Clock running out? Give it to {a}. That’s it. That’s the whole playbook, my friend.',
      '{a} gets a bucket whenever he wants one. You can’t teach that. Kobe had it. {a} has it.',
      'Broken play, three seconds left, {a} with the ball. I’m not even nervous.',
    ],
  },
  SINGLE_CREATOR_DEPENDENCY: {
    concern: [
      'Everything goes through {a}. Everything. What happens when he’s tired? Exactly.',
      '{a} and then… nobody. One guy can’t carry this for 82 games, my friend. Even Kobe had Pau.',
    ],
  },
  NO_GO_TO_SCORER: {
    concern: [
      'Who takes the last shot? {a}? Really? I’m asking. Nobody on this desk knows.',
      'Down two, ten seconds left. Who gets the ball? I’ve been staring at this roster for a minute. I don’t know.',
    ],
  },
  NO_TRUE_PLAYMAKER: {
    concern: ['Who passes the ball on this team? Anybody? Hello?', 'Nobody here runs an offense. They just kind of… stand there and hope.'],
  },
  OFFENSE_IS_THE_WEAK_SIDE: {
    concern: ['They’ll guard people. Great. Can they score? Not really. That’s a problem in May.', 'Love the effort. Hate the offense. Somebody has to put the ball in the hoop, my friend.'],
  },
  ELITE_FLOOR_GENERAL: {
    praise: ['{a} running the show. Everybody else just has to catch and finish. Easy money.', '{a} makes every teammate look better. That’s a real point guard. Respect.'],
  },

  // ── spacing: Sosini (the uncle) ────────────────────────────────────────
  ELITE_STARTING_SPACING: {
    praise: [
      'Five shooters. FIVE. Kiddo, Uncle Mattia has been waiting for this his whole life.',
      'Everybody on the floor can shoot. You know what that’s called? That’s called good basketball. Write it down.',
      'Pass me a beer, this is beautiful. Shooters everywhere. The paint is wide open. Like my nephew’s calendar.',
    ],
  },
  GOOD_STARTING_SPACING: {
    praise: ['Four shooters. Not bad, not bad. Uncle Mattia approves. One more and I’d cry.', 'Four guys who can shoot. That’s a real offense, kid. Mostly.'],
  },
  SPACING_DISTRIBUTED: {
    praise: ['Shooting all over the rotation, not just one guy. That’s how Uncle Mattia drafts.', 'Doesn’t matter who sits. Somebody can always shoot. Smart.'],
  },
  BENCH_SPACING: {
    praise: ['{a} and {b} keep shooting when the starters sit. Good. The bench is not a museum.'],
  },
  MOVEMENT_SHOOTING_GRAVITY: {
    praise: ['{a} running around screens all night. Defenders hate him. Uncle Mattia loves him.', '{a} doesn’t even need the ball and the defense is panicking. That’s gravity, kiddo.'],
  },
  SPACING_WITH_TWO_BIGS_VIABLE: {
    praise: ['Two bigs and it still works? Because the rest can shoot. See? Uncle Mattia is open-minded.'],
  },
  SPACING_CONCENTRATED: {
    concern: [
      '{a} is the only real shooter. He sits down, the paint turns into a family reunion. Everybody standing around.',
      'One shooter. ONE. {a} can’t play 48 minutes, kiddo. Trust me, I asked.',
    ],
  },
  ONE_CRITICAL_SHOOTER: {
    concern: ['All the shooting hangs on {a}. If he’s cold, it’s over. Ask Uncle Mattia how he knows.'],
  },
  LOW_STARTING_SPACING: {
    concern: ['Nobody can shoot. In 2026. Kiddo, who drafted this, grandpa?', 'The paint is going to be a parking lot. A parking lot, I tell you.'],
  },
  NON_SPACER_OVERLOAD: {
    concern: ['{a} and {b} don’t shoot threes. The other team will just stand in the paint and wave.', '{a}, {b}… nobody is guarding them past the arc. Why would they? Uncle Mattia wouldn’t.'],
  },
  MULTIPLE_NON_SPACERS: {
    concern: ['{a}, {b}, {c}… none of them shoot. That’s not spacing, that’s a traffic jam.'],
  },
  NO_FRONTCOURT_SPACING: {
    concern: ['{a} and {b} together and neither shoots. Two big guys in one small paint. Uncle Mattia sees a problem.'],
  },

  // ── defense: Shyman (says it simply) ───────────────────────────────────
  ELITE_DEFENSIVE_LAYERING: {
    praise: ['{a} takes their best guy. {b} is waiting at the rim. Good luck scoring.', '{a} on the ball, {b} behind him. Two stops on one play. Love it.'],
  },
  BALANCED_DEFENSIVE_COVERAGE: {
    praise: ['No weak guy to go at. Nowhere to hide. Good defense. Simple.', 'Where do you attack this team? You don’t. Good luck.'],
  },
  DEFENSIVE_COVERAGE_CAPACITY_ELITE: {
    praise: ['A guy for the ball, a guy for the wing, a guy at the rim. And they switch everything. Good night.', 'They can switch anything. Every matchup is bad for the other team.'],
  },
  ELITE_PERIMETER_DEFENSE: {
    praise: ['{a}, {b}, {c}. All of them can guard the best scorer. Pick one. They’re all bad news.', 'Always a stopper on the floor. Always. Good.'],
  },
  MULTIPLE_PERIMETER_DEFENDERS: {
    praise: ['{a}, {b}, {c}. Three guys who can guard. That’s how you win in the playoffs.'],
  },
  POA_DEFENDER_PRESENT: {
    praise: ['{a} picks up the ball handler full court. Annoying. In a good way.'],
  },
  WING_STOPPER_PRESENT: {
    praise: ['{a} takes the best wing. Every night. Done.'],
  },
  PERIMETER_DEFENSE_BENCH_DEPTH: {
    praise: ['{a} and {b} off the bench and the defense doesn’t drop. Good.'],
  },
  BALL_HAWKS: {
    praise: ['{a} steals the ball, runs, scores. Easy points. I love easy points.', '{a} and {b} have quick hands. Turnover, layup. Again.'],
  },
  ELITE_RIM_PROTECTION: {
    praise: ['Nobody scores at the rim on this team. Nobody. {a} is waiting.', 'Drive in there? Against {a}? Bad idea.'],
  },
  SHOT_BLOCKING_ANCHOR: {
    praise: ['{a} blocks {n} a game. Every layup is a coin flip. Love it.', '{a} at the rim. Go ahead. Try it.'],
  },
  RIM_PROTECTION_CONTINUITY: {
    praise: ['{a} sits, {b} comes in. Still somebody at the rim. Smart.'],
  },
  DEFENSE_SURVIVES_SUBSTITUTIONS: {
    praise: ['Starters sit, defense stays the same. That’s rare. Good.'],
  },
  HUNTABLE_STARTER_EXPOSED: {
    concern: ['{a} can’t guard. In the playoffs they will go at him every single time.', 'They’ll find {a}. Every play. You can’t hide him in May.'],
  },
  MULTIPLE_DEFENSIVE_WEAK_LINKS: {
    concern: ['{a} and {b} can’t guard. You can hide one guy. Not two.', 'Two guys who can’t defend in the same five. Too many holes.'],
  },
  DEFENSE_DEPENDS_ON_STARTERS: {
    concern: ['When {a} comes in, the defense gets worse. Simple as that.', 'Starters guard. The bench doesn’t. That’s a problem.'],
  },
  NO_RIM_PROTECTOR: {
    concern: ['Nobody at the rim. Free layups all night. Not good.', 'Who blocks shots? Nobody. Layup line.'],
  },
  SINGLE_RIM_PROTECTOR_DEPENDENCY: {
    concern: ['{a} sits and the paint is wide open. One guy can’t play 48.'],
  },
  NO_POA_DEFENDER: {
    concern: ['Nobody can stop the ball. Their point guard is going to have a great night.'],
  },
  NO_WING_STOPPER: {
    concern: ['Nobody to guard a great wing. That guy is getting 40. Bad.'],
  },

  // ── rebounding: Solin (eye test) ───────────────────────────────────────
  STRONG_STARTING_REBOUNDING: {
    praise: ['{a} and {b} own the glass. Grown men. One shot and you’re done.', 'You miss, they get it. You miss again, they get it again. {a} doesn’t play nice.'],
  },
  WEAK_STARTING_REBOUNDING: {
    concern: ['Soft on the boards. Way too soft. Second chances all night for the other team.', 'Nobody boxes out. My grandma boxes out harder than this five.'],
  },

  // ── rotation and depth: Mark Rotation ──────────────────────────────────
  DEEP_PLAYOFF_ROTATION: {
    praise: ['{n} guys I trust in the playoffs. {n}! Guys. I’m emotional.', 'Real depth. Somebody gets hurt and nothing breaks. Thank you. Thank you so much.'],
  },
  HIGH_VALUE_ROLE_PLAYERS: {
    praise: ['{a} and {b}. Cheap, useful, no shots wasted. My kind of bench.'],
  },
  MATCHUP_SPECIALIST_AVAILABLE: {
    praise: ['{a} on the bench for the right matchup. Love having options. Love you guys.'],
  },
  TOP_HEAVY_ROTATION: {
    concern: ['Great five. And then? February is coming, guys. February always comes.', 'Starters are amazing. The bench scares me. Like, physically.'],
  },
  DEAD_SLOT_HURTS_ROTATION: {
    concern: ['{a} can’t play real minutes. So everybody else plays too many. That’s how people get hurt.'],
  },
  DEAD_NINTH_SLOT_ACCEPTABLE: {
    praise: ['{a} won’t play much. And that’s fine. Eight guys cover it. I’m calm. I’m calm.'],
  },
  CLOSING_FIVE_STABLE: {
    praise: ['Same five at the end, both ends. No coin flip at the end of the game. I can sleep tonight.'],
  },
  CLOSING_FIVE_REQUIRES_TRADEOFF: {
    concern: ['End of the game: shooters or defenders? You can’t have both. I hate this choice. I hate it.'],
  },
  PLAYER_ABOVE_MINUTES_CEILING: {
    concern: ['{a} is playing way too many minutes. He’s going to break. I can feel it in my knees.'],
  },
  MULTIPLE_MINUTES_CEILING_VIOLATIONS: {
    concern: ['Too many guys on too many minutes. This is how a season ends in March.'],
  },
  STAR_MINUTES_UNDERUSED: {
    concern: ['{a} sitting this much? Why? Play the best guy. Please.'],
  },

  // ── caps: Natalie ──────────────────────────────────────────────────────
  STAR_FGA_COST_HURTS_DEPTH: {
    concern: ['{a} eats {n} caps and look at the rest of the roster. Darling. That’s not a team, that’s a receipt.'],
  },
  ELITE_DEFENSE_LOW_FGA_COST: {
    praise: ['Elite defense from cheap guys. Leaves money for the scorers. That’s how you build. I’m a little emotional.'],
  },

  // ── off the ball: Jeremy ('90s) ────────────────────────────────────────
  OFF_BALL_SUPPORT_STRONG: {
    praise: ['{a}, {b}, {c}. Guys who cut, shoot and finish without the ball. Pure ’90s. Go watch the tape.'],
  },

  // ── usage: Zoran ───────────────────────────────────────────────────────
  MULTIPLE_HIGH_USAGE_PLAYERS: {
    concern: ['{a}, {b}, {c}. All of them want the ball. There is one ball, my brother. One.'],
  },
  SEVERE_USAGE_COLLISION: {
    concern: ['{a}, {b} and {c} all need the ball. Listen to me. This ends with three guys watching one guy dribble.'],
  },

  // ── two-way: Batterista ────────────────────────────────────────────────
  ELITE_TWO_WAY_CORE: {
    praise: ['{a} and {b} play both ends. BOTH. Nobody has to come off for defense. That’s basketball.', '{a} scores, then {a} guards. {b} too. This is how you build a team. Bellissimo.'],
  },

  // ── fit and structure: Onoffsky (numbers) ──────────────────────────────
  NO_MAJOR_STRUCTURAL_HOLE: {
    praise: ['I looked for the hole in this roster. Twice. There isn’t one. Annoying, honestly. 🤓'],
  },
  ROLE_FLEXIBILITY_LOW: {
    concern: ['Everybody here does one thing. One. The lineups basically pick themselves, and not in a good way.'],
  },
  MULTIPLE_POSITIONAL_COMPROMISES: {
    concern: ['Too many guys out of position. The lineup data is going to look like a crime scene.'],
  },
  SEVERE_POSITIONAL_STRAIN: {
    concern: ['Guys playing positions they’ve never played. On paper it’s a team. On the floor? No.'],
  },
  DEFENSE_AT_COST_OF_SPACING: {
    concern: ['Best defensive five can’t shoot. Best shooting five can’t defend. Pick a poison.'],
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
    concern: ['Great perimeter defense. Then they get beat once and it’s a free layup. Nobody at the rim.'],
  },
  RIM_PROTECTION_BUT_POOR_PERIMETER_DEFENSE: {
    concern: ['Great rim protection. Shame every guard gets past their man first.'],
  },
  STAR_POWER_WITH_USAGE_COLLISION: {
    concern: ['Huge stars, one ball. The on/off on this is going to be ugly. I can already see it.'],
  },
  STRONG_CORE_FRAGILE_ROTATION: {
    concern: ['Great core. One injury and the whole thing falls apart. I ran it. It falls apart.'],
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

