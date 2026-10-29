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
 * Tone (the user, 2026-10-29: "toksyczna dyskusja z najgorszych zakątków Twittera z nutką
 * profesjonalizmu", then "dokręć tą toksyczność"): they insult each other's takes, never the person,
 * and back it with a real number from the roster.
 *
 * Voices (the user, 2026-10-29): Shyman says it plainly, in short sentences. Sosini is the modern-game guy who can't
 * stand a long two. Batterista is two-way first. Jertcheck keeps lists nobody asked for. Lex is the
 * villain. Mark worries about February. Natalie counts caps. Prabuckov measures everything in Kobe.
 */
type Lines = { praise?: string[]; concern?: string[] };

const TALK: Partial<Record<string, Lines>> = {
  // ── creation: Prabuckov ────────────────────────────────────────────────
  ELITE_PRIMARY_CREATOR: {
    praise: [
      'Ten seconds left, down one, ball goes to {a}. Anyone on this desk who disagrees has never watched a fourth quarter.',
      '{a} gets a bucket whenever he wants. Late clock, broken play, doesn’t matter. That’s the Kobe gene. Cope.',
      'Imagine not having {a} with the clock running out. Couldn’t be this team. Couldn’t be me.',
    ],
  },
  SINGLE_CREATOR_DEPENDENCY: {
    concern: [
      'It’s {a} or nothing. He sits five minutes and the offense flatlines. Not a team. A one-man podcast.',
      'Everything through {a}. Cute in November. In a Game 7 they send two at him and the other four start looking at the floor.',
    ],
  },
  NO_GO_TO_SCORER: {
    concern: [
      'Down two, ten seconds left. Who gets it? {a}? Be serious. I’ll wait.',
      'Nobody on this roster wants the last shot. You can feel it. Kobe would’ve walked out of the building.',
    ],
  },
  NO_TRUE_PLAYMAKER: {
    concern: ['Who runs this offense? Genuinely asking. Five guys standing around waiting for a play that isn’t coming.'],
  },
  OFFENSE_IS_THE_WEAK_SIDE: {
    concern: ['They’ll guard, sure. Then they come back down and brick for 24 seconds. Watchable? No.'],
  },
  ELITE_FLOOR_GENERAL: {
    praise: ['{a} running the show and everybody else just catches and dunks. Easiest job in the league, playing next to him.'],
  },

  // ── spacing: Sosini ────────────────────────────────────────────────────
  ELITE_STARTING_SPACING: {
    praise: [
      'Five shooters. FIVE. Paint is empty, lanes are open. Every “defense wins” guy on this desk should log off.',
      'Nobody to sag off. Every closeout is a coin flip. This is basketball in 2026. Some of you are still in 2004.',
    ],
  },
  GOOD_STARTING_SPACING: {
    praise: ['Four real shooters. One short of perfect, still better than whatever Davyd would’ve drafted.'],
  },
  SPACING_DISTRIBUTED: {
    praise: ['Doesn’t matter who sits, somebody can shoot. That’s called drafting with a brain. Rare on this desk.'],
  },
  BENCH_SPACING: {
    praise: ['{a} and {b} keep shooting when the starters sit. Second unit isn’t a museum. Take notes, Mark.'],
  },
  MOVEMENT_SHOOTING_GRAVITY: {
    praise: ['{a} runs off one screen and two defenders panic. That’s gravity. Look it up, Matt.', '{a} doesn’t even need the ball. The defense is losing its mind anyway.'],
  },
  SPACING_WITH_TWO_BIGS_VIABLE: {
    praise: ['Two bigs and it still works, because everybody else can shoot. I hate admitting it. Fine.'],
  },
  SPACING_CONCENTRATED: {
    concern: [
      '{a} is the only real shooter. He sits and the paint turns into a parking lot. Embarrassing.',
      'All the shooting is {a}. One cold night from him and this offense is a crime scene.',
    ],
  },
  ONE_CRITICAL_SHOOTER: {
    concern: ['Everything outside is {a}. They run him off the line and dare the rest. The rest can’t. L.'],
  },
  LOW_STARTING_SPACING: {
    concern: ['Nobody can shoot. In 2026. The defense will literally stand in the paint and wave. Who approved this?'],
  },
  NON_SPACER_OVERLOAD: {
    concern: ['{a} and {b} don’t shoot threes. Their defenders will be sitting in the paint eating popcorn.'],
  },
  MULTIPLE_NON_SPACERS: {
    concern: ['{a}, {b}, {c}. Zero shooters between them. That’s not a lineup, that’s a traffic jam. Ratio.'],
  },
  NO_FRONTCOURT_SPACING: {
    concern: ['{a} and {b} together, neither of them shoots. Two big guys, one tiny paint. Good luck, genius.'],
  },

  // ── defense: Shyman (short) ────────────────────────────────────────────
  ELITE_DEFENSIVE_LAYERING: {
    praise: ['{a} on the ball. {b} at the rim. No points.', '{a} takes the star. {b} cleans up. Next.'],
  },
  BALANCED_DEFENSIVE_COVERAGE: {
    praise: ['No weak spot. Nowhere to hide. Good luck.', 'Where do you attack this? You don’t.'],
  },
  DEFENSIVE_COVERAGE_CAPACITY_ELITE: {
    praise: ['Ball, wing, rim. All covered. They switch everything.', 'Every matchup is bad for them. Every one.'],
  },
  ELITE_PERIMETER_DEFENSE: {
    praise: ['{a}. {b}. {c}. All stoppers. Pick one.', 'Always a stopper out there. Always.'],
  },
  MULTIPLE_PERIMETER_DEFENDERS: {
    praise: ['{a}, {b}, {c}. Three stoppers. May is theirs.'],
  },
  POA_DEFENDER_PRESENT: {
    praise: ['{a} picks up full court. Their point guard is done.'],
  },
  WING_STOPPER_PRESENT: {
    praise: ['{a} takes the best wing. Problem solved.'],
  },
  PERIMETER_DEFENSE_BENCH_DEPTH: {
    praise: ['{a}, {b} off the bench. Defense stays.'],
  },
  BALL_HAWKS: {
    praise: ['{a} jumps the pass. Layup. Again.', '{a} and {b}. Quick hands. Free points.'],
  },
  ELITE_RIM_PROTECTION: {
    praise: ['Drive on {a}? Bad idea.', 'Nobody scores at the rim. Nobody.'],
  },
  SHOT_BLOCKING_ANCHOR: {
    praise: ['{a}. {n} blocks a game. Try it.', 'Go at {a}. See what happens.'],
  },
  RIM_PROTECTION_CONTINUITY: {
    praise: ['{a} sits. {b} comes in. Still a wall.'],
  },
  DEFENSE_SURVIVES_SUBSTITUTIONS: {
    praise: ['Starters sit. Defense stays. Rare.'],
  },
  HUNTABLE_STARTER_EXPOSED: {
    concern: ['They’ll find {a}. Every play.', '{a} can’t guard. In May he sits.'],
  },
  MULTIPLE_DEFENSIVE_WEAK_LINKS: {
    concern: ['{a} and {b} can’t guard. Hide one. Not two.'],
  },
  DEFENSE_DEPENDS_ON_STARTERS: {
    concern: ['{a} comes in. Defense dies.'],
  },
  NO_RIM_PROTECTOR: {
    concern: ['Nobody at the rim. Layup line.'],
  },
  SINGLE_RIM_PROTECTOR_DEPENDENCY: {
    concern: ['{a} sits. Paint is open. Bad.'],
  },
  NO_POA_DEFENDER: {
    concern: ['Nobody stops the ball. Bad night.'],
  },
  NO_WING_STOPPER: {
    concern: ['Nobody for a great wing. He gets forty.'],
  },

  // ── rebounding: Solin ──────────────────────────────────────────────────
  STRONG_STARTING_REBOUNDING: {
    praise: ['{a} and {b} own the glass. You miss, it’s gone. Grown men. Spreadsheet guys can cry about it.'],
  },
  WEAK_STARTING_REBOUNDING: {
    concern: ['Soft on the boards. Soft. Second chances all night and then a thread about “bad luck”.', 'Nobody boxes out. My grandma boxes out harder. Ten free points a night, gift-wrapped.'],
  },

  // ── rotation and depth: Mark Rotation ──────────────────────────────────
  DEEP_PLAYOFF_ROTATION: {
    praise: ['{n} guys I’d trust in a playoff game. {n}. Lex can keep his “stars only” cope.'],
  },
  HIGH_VALUE_ROLE_PLAYERS: {
    praise: ['{a} and {b}. Cheap, useful, never waste a shot. The bench Lex pretends doesn’t matter.'],
  },
  MATCHUP_SPECIALIST_AVAILABLE: {
    praise: ['{a} on the bench for the right matchup. That’s how you steal a Game 5. Not that the stars-only crowd would know.'],
  },
  TOP_HEAVY_ROTATION: {
    concern: ['Starters: amazing. Bench: a group chat. February comes, an ankle goes, and this is over.'],
  },
  DEAD_SLOT_HURTS_ROTATION: {
    concern: ['{a} can’t play real minutes, so everyone else plays too many. This is how ACLs happen.'],
  },
  DEAD_NINTH_SLOT_ACCEPTABLE: {
    praise: ['{a} won’t play and that’s fine. Eight guys cover it. Cheap ninth man. Adults drafted this.'],
  },
  CLOSING_FIVE_STABLE: {
    praise: ['Same five at the end, both ends. No coin flip. Whoever drafted this has a brain.'],
  },
  CLOSING_FIVE_REQUIRES_TRADEOFF: {
    concern: ['Last two minutes: shooters or defenders? Can’t have both. Enjoy guessing.'],
  },
  PLAYER_ABOVE_MINUTES_CEILING: {
    concern: ['{a} on these minutes? He’s going to break. Book it.'],
  },
  MULTIPLE_MINUTES_CEILING_VIOLATIONS: {
    concern: ['Too many guys on too many minutes. Season ends in March. Screenshot this.'],
  },
  STAR_MINUTES_UNDERUSED: {
    concern: ['{a} sitting this much? Play the best guy. It’s not that hard.'],
  },

  // ── caps: Natalie ──────────────────────────────────────────────────────
  STAR_FGA_COST_HURTS_DEPTH: {
    concern: ['{a} eats {n} caps and look at the scraps around him. That’s not a team, that’s a receipt. Fraud contract.'],
  },
  ELITE_DEFENSE_LOW_FGA_COST: {
    praise: ['Elite defense from guys who cost nothing. That’s how you build. Lex could never.'],
  },

  // ── off the ball: Jeremy ───────────────────────────────────────────────
  OFF_BALL_SUPPORT_STRONG: {
    praise: ['{a}, {b}, {c}. Cut, shoot, finish, no ball needed. That’s ’90s basketball. Go watch the tape before you reply.'],
  },

  // ── usage: Zoran ───────────────────────────────────────────────────────
  MULTIPLE_HIGH_USAGE_PLAYERS: {
    concern: ['{a}, {b}, {c}. All want the ball. One ball, my brother. One. Somebody is sulking by December.'],
  },
  SEVERE_USAGE_COLLISION: {
    concern: ['{a}, {b}, {c}. All need the ball to score. That ends with three guys watching one guy dribble. Classic American basketball.'],
  },

  // ── two-way: Batterista ────────────────────────────────────────────────
  ELITE_TWO_WAY_CORE: {
    praise: ['{a} and {b} play both ends. BOTH. Nobody comes off. Half this desk only watches one end and it shows.'],
  },

  // ── fit and structure: Onoffsky ────────────────────────────────────────
  NO_MAJOR_STRUCTURAL_HOLE: {
    praise: ['I looked for the hole in this roster. Twice. None. Disappointing, honestly. I had a thread ready.'],
  },
  ROLE_FLEXIBILITY_LOW: {
    concern: ['Everybody does exactly one thing. The lineup data on this will be a crime scene.'],
  },
  MULTIPLE_POSITIONAL_COMPROMISES: {
    concern: ['Too many guys out of position. The numbers are going to be ugly. I’m already drafting the tweet.'],
  },
  SEVERE_POSITIONAL_STRAIN: {
    concern: ['Guys at positions they’ve never played. On paper, a team. On the floor, a war crime.'],
  },
  DEFENSE_AT_COST_OF_SPACING: {
    concern: ['Best defensive five can’t shoot, best shooting five can’t guard. Pick your L.'],
  },
  ELITE_CREATION_POOR_SPACING: {
    concern: ['{a} can create anything and nobody around him shoots. They’ll send three. Every time. Enjoy.'],
  },
  ELITE_SPACING_WEAK_CREATION: {
    concern: ['Shooters everywhere and nobody to make the first move. Who passes to them? Nobody. L.'],
  },
  GREAT_STARTERS_WEAK_BENCH: {
    concern: ['Starters: great. Bench: I checked twice. It’s bad. Really bad.'],
  },
  PERIMETER_DEFENSE_BUT_NO_RIM_PROTECTION: {
    concern: ['Great on the perimeter, then one blow-by and it’s a free layup. Nobody home behind them.'],
  },
  RIM_PROTECTION_BUT_POOR_PERIMETER_DEFENSE: {
    concern: ['Great rim protection. Shame every guard is through the front door first.'],
  },
  STAR_POWER_WITH_USAGE_COLLISION: {
    concern: ['Big names, one ball. The on/off is going to be hilarious. I can’t wait to post it.'],
  },
  STRONG_CORE_FRAGILE_ROTATION: {
    concern: ['Great core, made of glass. One injury and it’s over. I ran it. It’s over.'],
  },
};

/**
 * Who answers a take and how, by its field and side: [the one who pushes back, his push, the first
 * expert's answer, and sometimes the pusher's last word]. The push is taste (style over results,
 * stars over depth, the eye over the numbers) and an insult about the take, never the person; the
 * answer holds the finding's ground, often with a number.
 * {who} is the first expert's surname.
 */
type Exchange = [string, string, string, string?];
const PUSHBACK: Partial<Record<InsightCategory, { praise?: Exchange[]; concern?: Exchange[] }>> = {
  perimeter_defense: {
    praise: [
      ['jert', '@{who} for the record, the 1989 Pistons held teams under 100 with less athletic guards than these. Context matters. You lack it.', 'They win, Mattheus. Context is rings.', 'footnote: Pistons rings 2. your rings 0'],
      ['binash', '@{who} cute. Michael Cooper would’ve locked up all three of these guys in one quarter. In short shorts.', 'Cooper was great. These are better. Watch the tape.', 'I OWN the tape'],
      ['zoran', '@{who} defense defense defense. in Europe we also pass the ball, you know', 'Pass it to the other team? Sure, Zoran.', 'I will not dignify this'],
      ['sosini', '@{who} imagine celebrating a charge in 2026 💀', 'They win. You post.', 'ratio + nobody asked'],
      ['lex', '@{who} nobody bought a ticket to watch a deflection, Matt', 'Rings, Lex. Count them.', 'you’ve never counted anything above two'],
      ['sosini', '@{who} great, they get a stop and then walk it up for a long two. elite stuff', 'A stop is two points. Keep typing.'],
    ],
    concern: [
      ['lex', '@{who} who cares. stars outscore it', 'Not in May they don’t.', 'my stars do'],
      ['jeremy', '@{who} in the ’90s you got hand-checked into the third row for this. soft era', 'In any era they get scored on, Jeremy.', 'go watch the tape'],['sosini', '@{who} so they give up 115 and score 125. who cares', 'In May they score 98.', 'source: your feelings']],
  },
  rim_protection: {
    praise: [
      ['natalie', '@{who} love a rim protector. hate what he costs. it’s always a receipt with you guys', 'He’s worth it. Look at the paint.', 'look at the cap sheet'],
      ['jert', '@{who} for the record, Mark Eaton blocked 5.6 a game in 1985. this is fine. it’s not Eaton', 'It’s enough. They can’t score inside.', 'it is not Eaton'],['sosini', '@{who} rim protector lmao. people shoot over him from 28 feet now', 'Then he walks out. Contests. Blocks.', 'bro thinks it’s 2004']],
    concern: [
      ['prab', '@{who} Kobe never needed a rim protector. he needed teammates who caught the ball', 'They need someone at the rim, my friend.', 'they need someone who wants it'],['lex', '@{who} rim protectors are for teams that can’t outscore people', 'Layup every trip, Lex. Outscore that.', 'my stars would']],
  },
  defensive_structure: {
    praise: [
      ['jeremy', '@{who} the ’98 Bulls did this with Rodman and half a back. go watch the tape', 'Then you agree. Defense wins.', 'I agree with Rodman. not you'],
      ['onoffsky', '@{who} defensive on/off says this is real. I hate agreeing with you. 🤓', 'Then say it louder, Jake.', 'no'],['lex', '@{who} defense is a hobby. stars win. this is embarrassing for you', 'Stars win when the other team can’t score.', 'cope']],
    concern: [
      ['lex', '@{who} it’s a regular season problem. stars don’t get hunted, they hunt', 'Your star gets hunted every trip, Lex.', 'my star doesn’t play defense, Matt. that’s the point'],
      ['bannerman', '@{who} Celtics would’ve found that guy in two possessions. two. 🍀', 'Everybody finds him. That’s the problem.', 'just saying, 18 banners'],['sosini', '@{who} it’s the regular season grandpa. outscore them', 'They find that guy in May.', 'they find your posts too']],
  },
  spacing: {
    praise: [
      ['lex', '@{who} spacing is what you talk about when you don’t have a star', 'Stars need spacing, Lex. Even yours.', 'mine make their own'],
      ['jeremy', '@{who} spacing. in the ’90s we called that standing in the corner. go watch the tape', 'In the ’90s you scored 86 points, Jeremy.', 'and won'],
      ['binash', '@{who} Bird didn’t need five shooters. he WAS five shooters', 'Bird took two threes a game.', 'and made them'],
      ['shyman', '@{who} great. They shoot. Who guards?', 'Nobody needs to guard when you’re up 20, Matt.', 'Up 20 in November.'],
      ['solin', '@{who} jump shooters. wait till it’s cold in May, kiddo', 'Davyd, an empty paint doesn’t go cold. Math.', 'math never boxed anybody out'],
      ['jert', '@{who} for the record, the 1986 Celtics won a title barely shooting threes. I have the box scores. Laminated.', 'And they’d lose by 30 tonight.', 'pace-adjusted, they would not. footnote 3'],
    ],
    concern: [
      ['zoran', '@{who} who needs shooters when the ball moves. Americans and their threes', 'The ball moves into a packed paint, Zoran.', 'then it moves out. this is called basketball'],
      ['jert', '@{who} the 1986 Celtics shot fewer threes than this and won. I have the box scores', 'They’d lose by 30 tonight.', 'pace-adjusted they would not. footnote 3'],['solin', '@{who} so they play inside. real basketball. not your little math', 'Inside where, Davyd? There’s no room inside. That’s the point.', 'come to the paint and say that']],
  },
  creation: {
    praise: [
      ['jeremy', '@{who} a closer? Michael was a closer. this is a guy who shoots a lot', 'He makes them, Jeremy.', 'sometimes'],
      ['natalie', '@{who} love the closer. hate the cap number. pick one', 'You pay for buckets. That’s the rule.', 'you pay for vibes'],['zoran', '@{who} one guy dribbles, four guys watch. beautiful. for him', 'When he’s this good, the four guys get rings.', 'rings are an American disease']],
    concern: [
      ['zoran', '@{who} no closer? good. five guys passing. finally', 'Five guys passing with ten seconds left, Zoran?', 'yes. it’s called a play'],
      ['jeremy', '@{who} nobody wants the last shot. Michael would’ve taken all of them. and made five', 'Exactly my point.', 'my point first'],['lex', '@{who} give it to the best player and move. this isn’t hard', 'There is no best player, Lex. That’s the take.', 'then this team doesn’t matter']],
  },
  rebounding: {
    praise: [
      ['lex', '@{who} rebounds are for teams that miss. my guys don’t miss', 'Everybody misses, Lex.', 'not my guys'],
      ['jert', '@{who} for the record, Russell averaged 22.5 for his career. this is cute', 'It’s enough. They own the glass.', 'cute'],['onoffsky', '@{who} rebounding matters less every season. I have the data. you have vibes', 'Numbers don’t box out, Jake.', 'they do. it’s called DREB%. you’re welcome']],
    concern: [
      ['lex', '@{who} who cares about rebounds. stars don’t miss', 'They miss forty times a game, Lex.', 'not the important ones'],
      ['binash', '@{who} Moses Malone would’ve had 20 offensive rebounds against this team. TWENTY', 'That’s literally my point, Jacob.', 'I made it first'],['onoffsky', '@{who} offensive rebounds are overrated, actually. 🤓', 'Tell that to the guy who gets dunked on after the second miss.', 'anecdotal']],
  },
  depth: {
    praise: [
      ['natalie', '@{who} deep bench, love it. cheap too. someone here finally can count', 'Thank you. Rare.', 'don’t get used to it'],
      ['prab', '@{who} bench, bench, bench. Kobe didn’t need a bench. he needed the ball', 'Kobe had Fisher and Odom, my friend.', 'don’t you dare'],['lex', '@{who} lovely bench. where are the stars? oh. there aren’t any', 'Stars get hurt, Lex. Benches don’t.', 'benches don’t get banners either']],
    concern: [
      ['jert', '@{who} for the record, the 1996 Bulls played 7 guys in the Finals. you don’t need a bench', 'Their 7 were good, Mattheus.', 'footnote: so are these'],
      ['bannerman', '@{who} the 2008 Celtics had Big Baby and Posey off the bench. that’s depth. this is a group chat', 'Exactly.', 'just saying. banners'],['lex', '@{who} stars play 40. who needs a bench. this take is unemployed', 'Everybody in February, Lex.', 'February is for losers']],
  },
  rotation: {
    concern: [
      ['prab', '@{who} play the stars 44 minutes. Kobe played 44', 'Kobe’s knees disagree, my friend.', 'Kobe’s knees won five rings'],
      ['onoffsky', '@{who} minutes don’t matter as much as you think. I have the load data', 'They matter in March, Jake.', 'anecdotal'],['lex', '@{who} stars play, the rest watch. that’s a rotation', 'Until a star sprains an ankle in March.', 'my stars don’t sprain']],
  },
  two_way: {
    praise: [
      ['lex', '@{who} both ends. cute. one end wins rings. the scoring one', 'Both ends win rings, Lex. Look it up.', 'I looked. still cute'],
      ['jeremy', '@{who} two-way? Michael was two-way. nine All-Defense. this is nice', 'Nice is enough to win, Jeremy.', 'not a sixth ring'],['sosini', '@{who} both ends sure, can any of them hit a 30-footer', 'They don’t need to when they guard.', 'L']],
  },
  usage: {
    concern: [
      ['prab', '@{who} give it to the best one and the others watch. Kobe solved this in 2006', 'Kobe took 50 shots a night, my friend.', 'and scored 81'],
      ['natalie', '@{who} three guys who need the ball, and you paid for all three. tragic', 'Exactly my point.', 'my point is the money'],['lex', '@{who} stars figure it out', 'With one ball? Show me once.', 'this you? 👇 “stars always find a way” — you, last week']],
  },
  fga: {
    concern: [
      ['prab', '@{who} stars cost money, Natalie. Kobe cost money', 'Kobe’s team had Pau, my friend.', 'don’t'],['lex', '@{who} stars cost money. deal with it, accountant', 'Nine stars don’t fit under 100.9 caps. That’s the rule.', 'rules are for role players']],
  },
  fit: {
    concern: [
      ['lex', '@{who} fit is for teams without stars', 'Stars without fit lose in the second round, Lex.', 'mine win'],
      ['jeremy', '@{who} put Michael anywhere and he fits. this is overthinking', 'This isn’t Michael, Jeremy.', 'nobody is'],['solin', '@{who} put good players out there and let them hoop', 'Good players out of position are average players.', 'nerd']],
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
export function exchangeFor(insight: RosterInsight, kind: 'praise' | 'concern', who: string, whoSurname: string, rng: () => number, busy: (expert: string) => boolean = () => false): { by: string; push: string; answer: string; last?: string } | null {
  // 2026-10-29 (the user: "wszędzie Sossini… po prostu więcej postaci się kłóci"): whoever has
  // talked enough tonight sits this one out.
  const options = (PUSHBACK[insight.category]?.[kind] ?? []).filter(([by]) => by !== who && !busy(by));
  if (!options.length) return null;
  const [by, push, answer, last] = options[Math.floor(rng() * options.length)];
  return { by, push: push.replace('{who}', whoSurname), answer, last };
}
