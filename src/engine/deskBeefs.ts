import type { PlayerSpan } from '../data/schema';
import type { DeskKind, ExpertId, RosterRead } from './desk';
import type { InsightCategory } from './insights';

/**
 * 2026-10-15, the user ("więcej sosu … jak kłótnia na Twitterze", then "trzeba pogłębiać to co mamy.
 * Więcej kłótni, nawiązań"): the desk's arguments. A beef hangs off one take that went on air — a
 * flavour lens ("Kobe is on this roster") or an engine finding of one field ("the defense leaks") —
 * and turns it into a short thread: @-replies, someone cutting in, and now and then the host
 * breaking it up. Each beef has a few variants so the same roster type doesn't replay the same
 * fight, and the running gags (Jeremy's VHS, Sosini's 40-listener podcast, "we don't talk about
 * 2008", Lex muting the desk, Onoffsky's rulebook tab) come back across beefs on purpose.
 *
 * The facts the experts throw at each other are real (6–0 in the Finals, 81 points, Game 6 2008,
 * the 2004 Pistons, 11 rings…). Nothing here judges the roster beyond what its take already said:
 * a beef is colour around an opinion the engine (or the roster itself) backs.
 */

/** Which flavour take a beef can hang off (desk.ts `flavourTakes`). */
export type Lens =
  | 'kobe' | 'jordan' | 'lakers' | 'lakersConcern' | 'celtics' | 'old' | 'modern' | 'eighties' | 'nineties' | 'aughts'
  | 'preTwoK' | 'noPreTwoK' | 'stars' | 'noStars' | 'oneStar' | 'international' | 'steal' | 'overpay' | 'notMichael' | 'fav'
  | 'prePbp' | 'fullPbp' | 'ninetiesHate' | 'turnstile';

export interface BeefCtx {
  read: RosterRead;
  /** Surname the way the desk says it. */
  sur: (p: PlayerSpan) => string;
  /** Up to `n` surnames as a list ("Bird, McHale and Parish"). */
  names: (ps: PlayerSpan[], n?: number) => string;
  /** A rostered player by full name. */
  has: (name: string) => PlayerSpan | undefined;
  caps: (p: PlayerSpan) => number;
  /** Whose take the argument hangs off, and (for a 'fav' take) the favourite it is about. */
  anchor: { who: ExpertId; fav?: PlayerSpan };
}

/** A line of a thread: who, what, and (default 'reply') how it's labelled. */
export type BeefLine = [ExpertId, string] | [ExpertId, string, DeskKind];

export interface BeefThread {
  /** Replaces the take's own line when the beef needs a set-up of its own. */
  open?: string;
  lines: BeefLine[];
}

export type BeefAnchor =
  | { lens: Lens }
  | { category: readonly InsightCategory[]; side: 'praise' | 'concern' };

export interface Beef {
  id: string;
  on: BeefAnchor;
  /** For the commonest anchors: the share of shows where it may start at all (default 1), so the
   * same fight doesn't run every other show. */
  chance?: number;
  /** A running gag: when it fits, it wins over every other argument the same take could start. */
  priority?: boolean;
  /** Each variant returns null when this roster doesn't fit it. */
  variants: ((c: BeefCtx) => BeefThread | null)[];
}

const DEFENSE: readonly InsightCategory[] = ['perimeter_defense', 'rim_protection', 'defensive_structure'];

const CORE_BEEFS: Beef[] = [
  // ── Sosini vs the old guard ────────────────────────────────────────────────
  {
    id: 'time-machine',
    on: { lens: 'old' },
    variants: [
      (c) => ({
        open: `${c.names(c.read.old)}. In 2026. 🥱 Did this roster come with a time machine, or do we rent one by the hour?`,
        lines: [
          ['jert', `@Sosini ${c.sur(c.read.old[0])} would eat your favourite player for breakfast. And lunch. And your podcast.`],
          ['sosini', 'My podcast has a very loyal audience.'],
          ['jert', 'Forty people, Mattia. FORTY. Half of them are your cousins.'],
        ],
      }),
      (c) => {
        const wilt = c.has('Wilt Chamberlain');
        const russell = c.has('Bill Russell');
        if (!wilt && !russell) return null;
        return {
          open: `${c.names(c.read.old)}. 🥱 Respectfully, this roster’s scouting report is in black and white.`,
          lines: wilt
            ? [
              ['jert', '@Sosini Wilt averaged FIFTY a game. Fifty. Your favourite player averages fifty tweets.'],
              ['sosini', 'Fifty against centers who delivered mail in the summer. Cope.'],
              ['binash', '@Sosini *leans into the mic* He scored a hundred in one night. A HUNDRED. You’ve never scored a hundred of anything.', 'cuts'],
              ['host', 'Okay. OKAY. Nobody gets blocked live on air. Again.', 'host'],
            ]
            : [
              ['jert', '@Sosini Russell has eleven rings. ELEVEN. How many do you have?'],
              ['sosini', 'Eleven rings in an eight-team league. Cope. 🥱'],
              ['binash', '@Sosini right. Zero rings and a ring light. Sit down.', 'cuts'],
              ['host', 'Okay. OKAY. Nobody gets blocked live on air. Again.', 'host'],
            ],
        };
      },
      (c) => ({
        open: `${c.names(c.read.old)}. 🥱 Love the vintage. Does the team bus come with a horse?`,
        lines: [
          ['jert', '*slams the desk* Kids today think defense was invented together with the shot-clock app.'],
          ['sosini', 'Defense was invented in 2004 by Ben Wallace’s afro. Everybody knows that.'],
          ['solin', '…Honestly? Fair.', 'cuts'],
          ['jert', 'Unbelievable. Davyd, you too?'],
        ],
      }),
    ],
  },
  {
    id: 'whole-point',
    on: { lens: 'modern' },
    variants: [
      () => ({
        lines: [
          ['jert', '@Sosini kids today. Let’s see this “whole point” against a 1986 frontcourt.'],
          ['sosini', 'Your 1986 frontcourt would need oxygen by the second quarter. 🥱'],
          ['binash', '@Sosini McHale would put you in the torture chamber in four seconds. Look it up.', 'cuts'],
          ['sosini', 'Ratio.'],
        ],
      }),
      () => ({
        lines: [
          ['jeremy', '@Sosini all modern guys. So no mid-range. So no Michael. So no rings. Got it.'],
          ['sosini', 'The mid-range is a crime scene, Jeremy. Call the police.'],
          ['jeremy', 'Call your forty podcast listeners, Mattia.'],
        ],
      }),
    ],
  },
  {
    id: 'before-2000',
    on: { lens: 'preTwoK' },
    variants: [
      () => ({
        lines: [
          ['sosini', '@Jertcheck kids today would run this team off the floor by halftime. 🥱'],
          ['jert', 'Kids today can’t spell “box out”. Russell averaged 22.5 rebounds for his CAREER.'],
          ['onoffsky', '*adjusts glasses* Technically, rebounding percentage in that era was—', 'cuts'],
          ['jert', 'NOBODY asked, Jake.'],
        ],
      }),
      () => ({
        lines: [
          ['onoffsky', '*adjusts glasses* Note: blocks and steals weren’t even tracked before 1973. No play-by-play until 1996. We are guessing.', 'cuts'],
          ['jert', 'Rebounds were tracked from 1951, Jake. Russell grabbed 21,620 of them. Look it up.'],
          ['onoffsky', 'Rebounds without play-by-play. Cute. Who was he guarding?'],
          ['jert', 'EVERYONE. *slams an almanac on the desk*'],
        ],
      }),
    ],
  },
  {
    id: 'moses',
    on: { lens: 'noPreTwoK' },
    variants: [
      () => ({
        lines: [
          ['sosini', '@Jertcheck Moses Malone isn’t on Twitter. Nobody’s rolling their eyes.'],
          ['jert', 'Fo, fo, fo, Mattia. Look it up.'],
          ['sosini', 'Looked it up. Fo, five, fo. They lost a game. 🥱'],
          ['jert', '*long silence* …I hate that you know that.'],
        ],
      }),
    ],
  },
  // ── Kobe vs Jordan ─────────────────────────────────────────────────────────
  {
    id: 'kobe-jordan',
    on: { lens: 'kobe' },
    variants: [
      (c) => c.read.jordan ? null : ({
        lines: [
          ['jeremy', '@Prabuckov relax. It’s not like it’s Jordan.'],
          ['prab', '*stands up* Say that to my face, Jeremy.'],
          ['jeremy', 'Kobe went 6-for-24 in a Game 7.'],
          ['prab', 'And WON it. Look it up. Oh wait, you only own VHS.'],
        ],
      }),
      (c) => c.read.jordan ? null : ({
        lines: [
          ['jeremy', '@Prabuckov cute. Michael went 6–0 in the Finals.'],
          ['prab', 'Three of yours came before the league even had a team in Toronto. Different times, my friend.'],
          ['jeremy', '*takes off his glasses* Say that again. Slowly.'],
          ['host', 'We are NOT doing this for the fourth show in a row. Moving on.', 'host'],
        ],
      }),
      (c) => c.read.jordan ? null : ({
        lines: [
          ['jeremy', '@Prabuckov three of those rings came with Shaq doing the heavy lifting.'],
          ['prab', 'Michael had Pippen, Rodman and Phil Jackson. That’s a superteam with better PR.'],
          ['batt', 'Kobe made twelve All-Defensive teams. Two ends! I side with Mikhail.', 'cuts'],
          ['jeremy', 'Unbelievable. Blocked. Both of you.'],
        ],
      }),
      (c) => c.read.jordan ? ({
        lines: [
          ['jeremy', '@Prabuckov Kobe AND Michael on one roster. Finally, Kobe gets to learn from the best.'],
          ['prab', '*grips the desk* Michael gets to learn what a work ethic looks like, my friend.'],
          ['host', 'Both of you, hands where I can see them.', 'host'],
        ],
      }) : null,
    ],
  },
  {
    id: 'six-rings',
    on: { lens: 'jordan' },
    variants: [
      () => ({
        lines: [
          ['prab', '@May six rings, sure. Kobe gets eight with Phil and Pippen.'],
          ['jeremy', 'Kobe HAD Phil. For eleven years, Mikhail.'],
          ['prab', '*long pause* …Next question.'],
        ],
      }),
      (c) => c.read.celtics.length === 0 ? null : ({
        lines: [
          ['bannerman', '@May Michael dropped 63 on the ’86 Celtics. And LOST. 🍀'],
          ['jeremy', 'He was 23. Bird had half the Hall of Fame on his bench.'],
          ['bannerman', 'Count the banners, Jeremy. I’ll wait. It takes a while.'],
        ],
      }),
      () => ({
        lines: [
          ['sosini', '@May Michael took under two threes a game. Respectfully, he’d get benched today. 🥱'],
          ['jeremy', 'Benched. Michael. BENCHED. *stares into the camera*'],
          ['sosini', 'Ratio.'],
          ['jeremy', 'You can’t ratio me on live TV, Mattia. That’s not how TV works.'],
        ],
      }),
    ],
  },
  // ── Celtics vs Lakers ──────────────────────────────────────────────────────
  {
    id: 'banners',
    on: { lens: 'celtics' },
    variants: [
      (c) => c.read.celtics.length < 2 || !c.read.kobe ? null : ({
        open: `*stands up* ${c.names(c.read.celtics, 4)}! Celtic DNA. Count the banners: eighteen. EIGHTEEN.`,
        lines: [
          ['prab', '@Bannerman and the best player on this roster is still Kobe. Calm down, it’s a draft, not a parade.'],
          ['bannerman', 'Love that for him. Ask him about Game 6, 2008. Thirty-nine points. That’s not a loss, that’s a funeral.'],
          ['prab', '2010. Game 7. Who was holding the trophy? I’ll wait.'],
          ['bannerman', 'Gasol won you that ring and you know it. 🍀'],
          ['prab', '*long pause* …We don’t talk about 2008.'],
        ],
      }),
      (c) => c.read.celtics.length < 2 || c.read.lakers.length === 0 || c.read.kobe ? null : ({
        open: `*stands up* ${c.names(c.read.celtics, 4)}! Celtic DNA. Count the banners: eighteen. EIGHTEEN.`,
        lines: [
          ['prab', `@Bannerman ${c.names(c.read.lakers, 2)} in the same locker room and you’re counting banners? Seventeen, my friend. One more and we’re even.`],
          ['bannerman', 'And I’ll be right here polishing number nineteen. 🍀'],
          ['prab', '*to the camera* He’s been workshopping that one for a week.'],
        ],
      }),
      (c) => c.read.celtics.length < 2 ? null : ({
        open: `*stands up* ${c.names(c.read.celtics, 4)}! That’s Celtic DNA. I might actually cry.`,
        lines: [
          ['sosini', '@Bannerman respectfully, half those banners are older than colour TV. 🥱'],
          ['bannerman', 'And every one of them is still hanging, Mattia. Where’s your podcast’s banner?'],
          ['sosini', '…We have a mug.'],
          ['host', 'Somebody get Igor a tissue. And Mattia a second mug.', 'host'],
        ],
      }),
    ],
  },
  {
    id: 'purple-and-gold',
    on: { lens: 'lakersConcern' },
    variants: [
      () => ({
        lines: [
          ['prab', '@Bannerman purple and gold is a lifestyle, Igor. You wouldn’t understand. You only own green.'],
          ['bannerman', 'Green is a colour. Purple is a bruise. 🍀'],
          ['prab', '*to the camera* He’s been workshopping that one since 2008.'],
          ['bannerman', 'And it still works.'],
        ],
      }),
    ],
  },
  // ── Stars vs depth vs money ────────────────────────────────────────────────
  {
    id: 'stars-win',
    on: { lens: 'stars' },
    variants: [
      (c) => ({
        lines: [
          ['rotation', '@Lex 2004. The Lakers had Shaq, Kobe, Malone AND Payton. Lost 4–1 to Detroit and a bench.'],
          ['lex', 'Malone was hurt. Next.'],
          ['rotation', c.read.bench.length >= 2
            ? `Your bench is ${c.names(c.read.bench, 2)} and a prayer. Somebody call a doctor. Call two.`
            : 'Your bench is a rumour and a prayer. Somebody call a doctor. Call two.'],
          ['lex', '2017 Warriors. Four All-Stars. 16–1 in the playoffs. Ratio.'],
          ['natalie', '@Lex the Warriors could pay for that. You have 100.9 caps, same as everyone. Rules are rules.', 'cuts'],
          ['lex', 'Money is a social construct.'],
          ['natalie', 'So is your bench.'],
        ],
      }),
      () => ({
        lines: [
          ['zoran', '@Lex listen to me. 2014 Spurs. The ball moved, the Heat cried. Three superstars watched the trophy leave.'],
          ['lex', 'Duncan was a superstar. Checkmate.'],
          ['zoran', '*hand on heart* Duncan PASSED the ball, Lex. Look it up. It’s called sharing.'],
          ['lex', 'Blocked.'],
        ],
      }),
      () => ({
        lines: [
          ['shyman', '@Lex stars, sure. And who guards anybody?'],
          ['lex', 'Nobody needs to guard anybody when you score 140.'],
          ['batt', 'And give up 145. Mezza squadra. Half a team! Mamma mia.', 'cuts'],
          ['lex', 'I muted the entire desk.'],
          ['host', 'Lex, you can’t mute the desk. You’re ON the desk.', 'host'],
        ],
      }),
    ],
  },
  {
    id: 'no-stars',
    on: { lens: 'noStars' },
    variants: [
      () => ({
        lines: [
          ['rotation', '@Lex depth wins in February.'],
          ['lex', 'Nobody remembers February, Mark.'],
          ['rotation', '*softly* I remember February.'],
        ],
      }),
      () => ({
        lines: [
          ['zoran', '@Lex in Europe we call a team with no stars “a team”.'],
          ['lex', 'In America we call it “the lottery”.'],
          ['zoran', '*hand on heart* So much anger. Who hurt you, Lex?'],
          ['lex', 'The 2004 Pistons.'],
        ],
      }),
    ],
  },
  {
    id: 'one-star',
    on: { lens: 'oneStar' },
    variants: [
      (c) => ({
        open: `${c.sur(c.read.stars[0])} and… who?? ONE star?? This isn’t a team, it’s ${c.sur(c.read.stars[0])} and four interns. Where’s the DYNASTY?`,
        lines: [
          ['zoran', '@Lex in Europe we call those “teammates”.'],
          ['lex', 'In America we call them “the guys who pass the star the ball”.'],
          ['rotation', 'And who plays when the star sits? *taps the table* I’ll wait.', 'cuts'],
          ['lex', 'The star doesn’t sit, Mark. That’s why he’s the star.'],
        ],
      }),
      (c) => ({
        lines: [
          ['natalie', `@Lex ${c.sur(c.read.stars[0])} plus depth IS the dynasty. That’s what a cap is for.`],
          ['lex', 'Spreadsheets don’t win rings, Natalie.'],
          ['natalie', 'Spreadsheets are why you can’t afford a second star, Lex. *closes the laptop very slowly*'],
        ],
      }),
    ],
  },
  {
    id: 'theft',
    chance: 0.7,
    on: { lens: 'steal' },
    variants: [
      () => ({
        lines: [
          ['lex', '@Natalie bargain bins are for people who can’t afford stars.'],
          ['natalie', 'Bargain bins are HOW you afford stars, Lex. Basic maths.'],
          ['lex', 'Maths is a social construct.'],
          ['natalie', 'So is your entire personality.'],
        ],
      }),
      () => ({
        lines: [
          ['onoffsky', '*adjusts glasses* Confirmed. Best value per cap on the roster. By a distance.', 'cuts'],
          ['natalie', 'Jake, I’d high-five you, but you’d file a report.'],
          ['onoffsky', 'I would, actually. In triplicate.'],
        ],
      }),
      () => ({
        lines: [
          ['rotation', '@Natalie cheap AND good means money left for the bench. Love it. LOVE it. Somebody finally thought about February.', 'cuts'],
          ['natalie', 'Mark, that’s the nicest thing anyone has said to me on air.'],
          ['lex', 'Gross. Get a room, you two.', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'overpay',
    on: { lens: 'overpay' },
    variants: [
      (c) => ({
        lines: [
          ['lex', '@Natalie he’s worth every cap. Stars cost money.'],
          ['natalie', `He’s not a star, Lex. He’s a ${c.caps(c.read.overpay!)}-cap mood.`],
          ['lex', '…Blocked.'],
          ['natalie', 'That’s nine times this season. I keep count. It’s my job.'],
        ],
      }),
    ],
  },
  // ── Eras ───────────────────────────────────────────────────────────────────
  {
    id: 'short-shorts',
    on: { lens: 'eighties' },
    variants: [
      () => ({
        lines: [
          ['sosini', '@Binash 🥱 respectfully, can we score it already?'],
          ['binash', 'Bird would shoot 45% from three today. With a toothpick in his mouth.'],
          ['sosini', 'Bird took two threes a game. Cope.'],
          ['binash', '*clutches his chest* Somebody hold me back.'],
        ],
      }),
      () => ({
        lines: [
          ['jeremy', '@Binash the ’80s were the warm-up act. Michael showed up and ended your whole decade.'],
          ['binash', 'Michael lost to the Bad Boys three years straight, Jeremy.'],
          ['jeremy', '…That’s a low blow.'],
          ['binash', 'It’s a Pistons blow. Elbow included.'],
        ],
      }),
    ],
  },
  {
    id: 'mid-range',
    on: { lens: 'nineties' },
    variants: [
      () => ({
        lines: [
          ['sosini', '@May the mid-range is a crime scene. A long two? In 2026? Respectfully, call the police. 🥱'],
          ['jeremy', 'Michael lived in the mid-range and has six rings. You live in a spreadsheet and have a podcast.'],
          ['onoffsky', '*adjusts glasses* Technically his efficiency from there was elite. Technically, you’re both wrong.', 'cuts'],
          ['sosini', 'Who invited the calculator.'],
          ['jeremy', 'First thing we’ve agreed on all year.'],
        ],
      }),
      () => ({
        lines: [
          ['solin', '@May the ’90s were soft next to 2004. We had hand-checks AND bad intentions.'],
          ['jeremy', 'You had Finals games in the seventies, Davyd. That’s not defense, that’s a hostage situation.'],
          ['solin', '*cracks his knuckles* Thank you.'],
        ],
      }),
    ],
  },
  {
    id: 'grown-men',
    on: { lens: 'aughts' },
    variants: [
      () => ({
        lines: [
          ['onoffsky', '*adjusts glasses* Grown men also need to score, Davyd.'],
          ['solin', '@Onoffsky numbers don’t box out.'],
          ['onoffsky', 'They do, actually. It’s called defensive rebounding percentage. You’re welcome.'],
          ['solin', 'Come to the paint and say that. I’ll be waiting with an elbow.'],
          ['onoffsky', 'That’s a flagrant 2. I have the rulebook open in another tab.'],
          ['host', 'Okay. Okay. Davyd, put the chair down. Jake, close the spreadsheet.', 'host'],
        ],
      }),
      () => ({
        lines: [
          ['sosini', '@Solinhakov 2004 in a jar? Respectfully, keep the lid on. 🥱'],
          ['solin', 'That was DEFENSE, Mattia. You’d know if you’d ever played any.'],
          ['sosini', 'I play on Tuesdays.'],
          ['solin', 'Rec league doesn’t count.'],
        ],
      }),
    ],
  },
  {
    id: 'passport',
    chance: 0.6,
    on: { lens: 'international' },
    variants: [
      (c) => ({
        lines: [
          ['sosini', '@Eurostep respectfully, a passport isn’t a jump shot. 🥱'],
          ['zoran', 'Listen to me. Argentina beat Team USA in 2004. Manu brought the move I am NAMED after.'],
          ['sosini', '2004 Team USA couldn’t shoot. My grandma would’ve beaten them.'],
          ...(c.has('Dirk Nowitzki')
            ? [
              ['zoran', 'Dirk beat the Miami superteam in 2011. One German, zero excuses. In Europe we call that a lesson.'],
              ['sosini', 'Okay, Dirk is my guy. *mumbles* Dirk is everybody’s guy.'],
              ['zoran', '*hand on heart* Growth. I’m proud of you.'],
            ] as BeefLine[]
            : [
              ['zoran', 'Your grandma would also call this roster beautiful. She has taste. Unlike her grandson.'],
              ['sosini', 'Leave my grandma out of this.'],
            ] as BeefLine[]),
        ],
      }),
      (c) => ({
        lines: [
          ['lex', `@Eurostep cool, a passport. How many rings came with ${c.sur(c.read.international[0])}’s?`],
          ['zoran', 'Listen to me. Rings are an American obsession. In Europe we celebrate the PASS.'],
          ['lex', 'That’s why nobody watches.'],
          ['zoran', '*hand on heart* I will pray for you, Lex.'],
        ],
      }),
      (c) => ({
        lines: [
          ['jert', `@Eurostep ${c.sur(c.read.international[0])}? Learned the game over here, pal.`],
          ['zoran', 'Listen to me. He learned the game THERE. Here he learned to sign autographs.'],
          ['jert', '*slams the desk* Kids today. Europeans today. Everybody today.'],
        ],
      }),
    ],
  },
  // ── Engine findings that start fights ──────────────────────────────────────
  {
    id: 'defense-is-a-hobby',
    on: { category: DEFENSE, side: 'concern' },
    variants: [
      () => ({
        lines: [
          ['sosini', '@Shyman respectfully, it’s not 1994. Make more threes than them and go home. Defense is a hobby. 🥱'],
          ['shyman', '“Defense is a hobby.” Screenshot it. I want that on his tombstone.'],
          ['sosini', 'Ratio.'],
          ['host', 'Okay. OKAY. Phones down, both of you.', 'host'],
        ],
      }),
      () => ({
        lines: [
          ['lex', '@Shyman who cares, they’ll score 140.'],
          ['shyman', 'And give up 145. The refs already call a foul if you breathe on a guard, Lex. You don’t get to ALSO not try.'],
          ['batt', 'Half a team. Mezza squadra. Mamma mia.', 'cuts'],
          ['lex', 'Nightmares is what the other team has when my guys get hot.'],
        ],
      }),
      () => ({
        lines: [
          ['onoffsky', '*adjusts glasses* For once the numbers and the yelling agree.', 'cuts'],
          ['shyman', 'I’m not yelling. *yelling* I’M PASSIONATE.'],
        ],
      }),
    ],
  },
  {
    id: 'shooters-are-soft',
    chance: 0.5,
    on: { category: ['spacing', 'shooting'], side: 'concern' },
    variants: [
      () => ({
        lines: [
          ['jert', '@Sosini in ’86 nobody shot threes and we survived.'],
          ['sosini', 'You survived with 6’5” centers and short shorts. 🥱'],
          ['jert', '*slams the desk* The shorts were FUNCTIONAL.'],
        ],
      }),
      () => ({
        lines: [
          ['solin', '@Sosini shooters are soft. Give me a guy who sets a screen like a car crash.'],
          ['sosini', 'Your guy can set all the screens he wants. Nobody guards a man who can’t shoot.'],
          ['solin', 'Come to the paint and say that.'],
          ['sosini', 'I’m literally sitting next to you, Davyd.'],
        ],
      }),
      () => ({
        lines: [
          ['zoran', '@Sosini listen to me. In Europe kids shoot before they can walk. Here they dunk and pose.', 'cuts'],
          ['sosini', 'Finally, someone gets it. Respectfully, Zoran, you can sit next to me.'],
          ['jert', '*slams the desk* Traitors. Both of you.', 'cuts'],
        ],
      }),
      () => ({
        lines: [
          ['onoffsky', '*adjusts glasses* For the record, the spacing really is the problem here. Mattia is right.', 'cuts'],
          ['sosini', 'Say it louder, Jake. For the people still living in the ’80s.'],
          ['binash', 'We hear you fine, Mattia. We just don’t care.', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'spacing-loves',
    on: { category: ['spacing', 'shooting'], side: 'praise' },
    variants: [
      () => ({
        lines: [
          ['shyman', '@Sosini great. They shoot. Who guards anybody?'],
          ['sosini', 'The scoreboard does. 🥱'],
          ['shyman', '“The scoreboard does.” *buries face in hands* I’m going home.'],
        ],
      }),
    ],
  },
  {
    id: 'february',
    on: { category: ['rotation', 'depth'], side: 'concern' },
    variants: [
      () => ({
        lines: [
          ['lex', '@Rotation benches are for teams that couldn’t draft stars.'],
          ['rotation', 'Benches are for February, Lex. Stars get tired. Stars get hurt. Stars get MAD.'],
          ['lex', 'My stars don’t get tired.'],
          ['rotation', '*softens* Love you, man. They do.'],
        ],
      }),
      () => ({
        lines: [
          ['natalie', '@Rotation and every cap on a guy who sits is a cap I cry about at night. Rules are rules.', 'cuts'],
          ['rotation', 'Then cry with me, Natalie.'],
          ['natalie', '*pats his shoulder* The rules don’t care, Mark.'],
        ],
      }),
    ],
  },
  {
    id: 'half-a-team',
    on: { category: ['two_way'], side: 'concern' },
    variants: [
      () => ({
        lines: [
          ['zoran', '@Batterista in Europe we also call that half a team. Finally we agree.', 'cuts'],
          ['batt', 'Europe! Bellissimo! Zoran, my brother.'],
          ['sosini', '🥱 Get a room, you two.', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'closer',
    chance: 0.45,
    on: { category: ['creation'], side: 'praise' },
    variants: [
      (c) => c.read.kobe ? null : ({
        lines: [
          ['jeremy', '@Prabuckov a closer? Michael was a closer. This is a guy who takes the last shot. Sometimes.'],
          ['prab', '*stands up* He takes it EVERY time, Jeremy. That’s what closers do.'],
          ['jeremy', 'And makes it?'],
          ['prab', '…Next question.'],
        ],
      }),
      () => ({
        lines: [
          ['lex', '@Prabuckov one closer is nice. Two closers is a dynasty. Just saying.', 'cuts'],
          ['prab', 'There is ONE closer per team, Lex. It’s in the rulebook.'],
          ['onoffsky', '*adjusts glasses* It is not in the rulebook. I have it open in another tab.', 'cuts'],
          ['prab', 'It’s in MY rulebook, Jake.'],
        ],
      }),
      () => ({
        lines: [
          ['zoran', '@Prabuckov one man takes every big shot? Listen to me. In Europe we call that a problem.'],
          ['prab', 'In Los Angeles we call it a statue outside the arena, my friend.'],
          ['zoran', '*hand on heart* Statues don’t pass either.'],
        ],
      }),
    ],
  },
  {
    id: 'money-talks',
    on: { category: ['fga'], side: 'concern' },
    variants: [
      () => ({
        lines: [
          ['lex', '@Natalie money is a social construct.'],
          ['natalie', 'So is your bench, Lex.'],
          ['rotation', '*quietly* Ouch. Accurate, though.', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'box-out',
    on: { category: ['rebounding'], side: 'concern' },
    variants: [
      () => ({
        lines: [
          ['onoffsky', '*adjusts glasses* Fun fact: rebounding matters less in a five-out offense.', 'cuts'],
          ['solin', '@Onoffsky numbers don’t box out.'],
          ['onoffsky', 'They do, actually. It’s called defensive rebounding percentage. You’re welcome.'],
          ['solin', 'Come to the paint and say that. I’ll be waiting with an elbow.'],
          ['host', 'Okay. Okay. Davyd, put the chair down. Jake, close the spreadsheet.', 'host'],
        ],
      }),
    ],
  },
];

type Variant = Beef['variants'][number];

/** How each expert is @-mentioned. */
export const HANDLE: Record<ExpertId, string> = {
  host: 'Slim', sosini: 'Sosini', shyman: 'Shyman', solin: 'Solinhakov', binash: 'Binash', jert: 'Jertcheck',
  rotation: 'Rotation', rightwing: 'Rightwing', batt: 'Batterista', prab: 'Prabuckov', onoffsky: 'Onoffsky',
  moonbat: 'Moonbat', bannerman: 'Bannerman', natalie: 'Natalie', jeremy: 'May', lex: 'Lex', zoran: 'Eurostep',
};

/** Who goes after whom when an expert gushes over a favourite. */
const FAN_RIVAL: Partial<Record<ExpertId, ExpertId>> = {
  sosini: 'jert', shyman: 'sosini', solin: 'onoffsky', binash: 'jeremy', jert: 'onoffsky', rotation: 'lex', batt: 'lex',
  onoffsky: 'jert', bannerman: 'prab', natalie: 'lex', lex: 'rotation', zoran: 'sosini', prab: 'jeremy', jeremy: 'prab',
};

/**
 * Each expert's favourite players: on the roster, the expert gushes (a 'fav' take) and a rival makes
 * fun of the crush. 2026-10-15: a first guess per lens — the user is sending each specialist's real
 * favourites, which replace these. Full names as in the data; accents don't matter.
 */
export const FAVOURITES: Partial<Record<ExpertId, string[]>> = {
  sosini: ['Stephen Curry', 'Damian Lillard'],
  shyman: ['Ben Wallace', 'Gary Payton', 'Dennis Rodman'],
  solin: ['Ron Artest', 'Rasheed Wallace'],
  binash: ['Larry Bird', 'Magic Johnson', 'Kevin McHale'],
  jert: ['Wilt Chamberlain', 'Bill Russell', 'Moses Malone'],
  rotation: ['Manu Ginobili', 'Robert Horry', 'Lou Williams'],
  batt: ['Kawhi Leonard', 'Scottie Pippen'],
  onoffsky: ['Nikola Jokic', 'Chris Paul'],
  bannerman: ['Larry Bird', 'Paul Pierce', 'Kevin Garnett'],
  lex: ['LeBron James', 'Kevin Durant'],
  zoran: ['Dirk Nowitzki', 'Manu Ginobili', 'Arvydas Sabonis'],
};

/** How each expert gushes; `{fav}` is the player's surname. */
export const FAV_LINES: Partial<Record<ExpertId, string[]>> = {
  sosini: ['{fav}! Respectfully, his shot chart is my phone background.', '{fav}. *puts hand on heart* That is the future, and the future is now.'],
  shyman: ['{fav}! STOPS! I have a poster of him above my bed. A big one.', '{fav}. *rubs his arms* Somebody hold me. Actual chills.'],
  solin: ['{fav}. Grown man. Fouls hard, apologises never. My kind of guy.', '{fav}! Finally somebody on this roster who’d fight a parking meter.'],
  binash: ['{fav}! Somebody pass me the short shorts. This is a holy day.', '{fav}! Totally tubular, dudes. *finger guns at the camera*', '{fav}. *dims the studio lights, puts on a synth track* Let me just enjoy this.'],
  jert: ['{fav}! *stands up* Pace-adjusted, he’d still lead this league. I have the almanacs.', '{fav}. They don’t make them like that anymore. The numbers say they CAN’T.'],
  rotation: ['{fav}! The best off-the-bench energy in history. I might cry.', '{fav}. *exhales* Finally somebody I trust in February.'],
  batt: ['{fav}! Two ends! Bellissimo! *kisses his fingers*', '{fav}. Offense, defense, everything. Perfetto.'],
  onoffsky: ['{fav}. *adjusts glasses* Full play-by-play, elite on/off. Statistically, my favourite human being.', '{fav}. I made a spreadsheet about him. It has a spreadsheet of its own.'],
  bannerman: ['{fav}! A Celtic legend! *already crying*', '{fav}. *points at the ceiling* Banner energy.'],
  natalie: ['{fav}! Value AND talent. I need a moment.'],
  lex: ['{fav}! THAT is a star. THAT is how a dynasty starts.', '{fav}! Build the statue now. Save time.'],
  zoran: ['{fav}! *hand on heart* The way he passes. The way he THINKS.', '{fav}. Listen to me. This is basketball as art.'],
};


/** 2026-10-15, the user's own line for Binash (and Bannerman's standing offer): the three-point line
 * arrived in 1979, ten years after Russell retired — which, to Binash, proves nothing. */
const russellThree = (c: BeefCtx): BeefThread | null => !c.has('Bill Russell') ? null : ({
  lines: [
    ['binash', 'There is no proof. I repeat: there is NO proof that Bill Russell knew about the three-point line.', 'cuts'],
    ['bannerman', 'And my offer stands. A Celtics season ticket to anyone who proves he knew. 🍀', 'cuts'],
    ['binash', 'Nobody has claimed it. NOBODY.'],
    ['sosini', 'Because the line came in 1979 and he retired in 1969, Jacob.'],
    ['binash', '…Which is exactly what they want you to think.'],
  ],
});

const MORE_BEEFS: Beef[] = [
  {
    id: 'folklore',
    on: { lens: 'prePbp' },
    variants: [
      () => ({
        lines: [
          ['jert', '@Onoffsky folklore? Wilt averaged 50.4 points and 25.7 boards in 1962. That’s in the box score, nerd.'],
          ['onoffsky', 'A box score without play-by-play is a rumour with decimals.'],
          ['jert', 'Oscar averaged a triple-double for a whole season that same year. Rumour THAT.'],
          ['onoffsky', 'Show me his on/off. Oh right. You can’t. 🤓'],
          ['jert', '*slams an almanac on the desk*'],
        ],
      }),
      () => ({
        lines: [
          ['jert', '@Onoffsky Russell’s teams won 11 titles in 13 years. That’s the only plus-minus I need.'],
          ['onoffsky', 'That’s a team stat, Mattheus. You of all people should know better.'],
          ['jert', 'I DO know better. I also know Russell.'],
        ],
      }),
      () => ({
        lines: [
          ['jert', '@Onoffsky pace-adjust it. Per 100 possessions the old guys still hold up. I did the maths in 2003.'],
          ['onoffsky', 'In a notebook?'],
          ['jert', 'In a LEATHER notebook, Jake.'],
          ['sosini', 'Two nerds fighting about which decade of spreadsheets is real. Riveting. 🥱', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'full-data',
    on: { lens: 'fullPbp' },
    variants: [
      () => ({
        lines: [
          ['jert', '@Onoffsky full data and zero legends. Congratulations on your spreadsheet.'],
          ['onoffsky', 'Legends are just players nobody tracked properly.'],
          ['jert', '*takes off his glasses* Say that about Oscar Robertson one more time.'],
        ],
      }),
    ],
  },
  {
    id: 'nineties-hate',
    on: { lens: 'ninetiesHate' },
    variants: [
      () => ({
        lines: [
          ['jeremy', '@Binash what did the ’90s ever do to you?'],
          ['binash', 'Grunge. Baggy shorts. And Bird’s back gave out in ’92. I hold the whole decade responsible.'],
          ['jeremy', 'You mean Michael ended your decade.'],
          ['binash', '*puts on sunglasses* Nobody ends the ’80s. The ’80s are a state of mind. 😎'],
        ],
      }),
      () => ({
        lines: [
          ['jeremy', '@Binash six rings, Jacob. Six.'],
          ['binash', 'Six rings in a league full of expansion teams wearing teal. 🙄'],
          ['jeremy', 'Leave teal out of this.'],
        ],
      }),
      () => ({
        lines: [
          ['sosini', 'For once I’m with Jacob. The ’90s were 80-point slogs with elbows. 🥱', 'cuts'],
          ['binash', 'Mattia! My brother in hate!'],
          ['jeremy', 'Unbelievable. The two worst takes at this desk, holding hands.', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'turnstile',
    on: { lens: 'turnstile' },
    variants: [
      () => ({
        lines: [
          ['lex', '@Shyman he drops 30 a night. Who cares.'],
          ['shyman', 'He GIVES UP 32, Lex. Net minus two. Bum maths from a bum take.'],
          ['lex', 'Blocked, clown.'],
        ],
      }),
      () => ({
        lines: [
          ['sosini', '@Shyman he spaces the floor. Defense is optional in November.'],
          ['shyman', 'Then he’s optional in May. Turnstiles don’t get playoff minutes, Mattia.'],
          ['rotation', '*quietly* And guess who has to find those minutes.', 'cuts'],
        ],
      }),
    ],
  },
  { id: 'russell-three', on: { category: ['spacing', 'shooting'], side: 'concern' }, priority: true, variants: [russellThree] },
  { id: 'russell-three', on: { lens: 'old' }, priority: true, variants: [russellThree] },
  {
    id: 'playoff-hunt',
    on: { category: DEFENSE, side: 'concern' },
    chance: 0.7,
    variants: [
      () => ({
        lines: [
          ['sosini', '@Shyman relax. It’s the regular season. Outscore them.'],
          ['shyman', 'There’s no regular season in a series, Mattia. Game 1 they find the weak guy. Game 3 he’s in every action. Game 5 he’s on the bench and the rotation is on fire.'],
          ['rotation', '*quietly* And then I’m the one crying. Thanks, Matt.', 'cuts'],
          ['shyman', 'Any time, Mark.'],
        ],
      }),
      () => ({
        lines: [
          ['onoffsky', '*adjusts glasses* Opponents score more per trip when they can pick on one defender. It compounds.', 'cuts'],
          ['shyman', 'Thank you. THANK you. Numbers and me, same side. Write the date down.'],
          ['sosini', 'Two grumpy men and a spreadsheet. My favourite podcast. 🥱', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'gravity',
    on: { category: ['spacing', 'shooting'], side: 'praise' },
    chance: 0.7,
    variants: [
      () => ({
        lines: [
          ['jert', '@Sosini gravity? It’s basketball, kid, not astronomy.'],
          ['sosini', 'One shooter drags two defenders 30 feet from the rim and everybody else gets a layup. You’d love it if you watched a game after 1989.'],
          ['jert', 'I watched one. It was all threes. I turned it off.'],
          ['sosini', 'That was the Finals, Mattheus.'],
        ],
      }),
      () => ({
        lines: [
          ['solin', '@Sosini all these shooters and not one guy who’d set a real screen.'],
          ['sosini', 'Davyd, three is more than two. That’s not an opinion. That’s arithmetic.'],
          ['solin', 'Arithmetic never won a fight in the paint.'],
          ['sosini', 'Nobody fights in the paint anymore. They shoot over it.'],
        ],
      }),
    ],
  },
  {
    id: 'sag-off',
    on: { category: ['spacing', 'shooting'], side: 'concern' },
    chance: 0.6,
    variants: [
      () => ({
        lines: [
          ['shyman', '@Sosini I hate saying this on air. He’s right. They’ll sag off two guys and the best defense in the world can’t guard what isn’t a threat.', 'cuts'],
          ['sosini', 'Can I get that in writing, Matt?'],
          ['shyman', 'No.'],
          ['host', 'Shyman agrees with Sosini. Somebody check on the producer.', 'host'],
        ],
      }),
      () => ({
        lines: [
          ['lex', '@Sosini stars can score through a packed paint. That’s why they’re stars.', 'cuts'],
          ['sosini', 'For one quarter, Lex. Then they’re taking 30-footers with three guys in their face and you call it “clutch”.'],
          ['lex', 'It IS clutch.'],
          ['sosini', 'It’s a 30% shot with a nickname.'],
        ],
      }),
    ],
  },
  {
    id: 'fan-crush',
    chance: 0.6,
    on: { lens: 'fav' },
    variants: [
      (c) => {
        const rival = FAN_RIVAL[c.anchor.who];
        if (!rival || !c.anchor.fav) return null;
        return {
          lines: [
            [rival, `@${HANDLE[c.anchor.who]} calm down, it’s a draft, not a wedding.`],
            [c.anchor.who, `I’d marry ${c.sur(c.anchor.fav)}’s ${c.anchor.fav.spanLabel} and I’m not ashamed.`],
            ['host', 'Nobody is marrying anybody on my show.', 'host'],
          ],
        };
      },
      (c) => {
        const rival = FAN_RIVAL[c.anchor.who];
        if (!rival || !c.anchor.fav) return null;
        return {
          lines: [
            [rival, `@${HANDLE[c.anchor.who]} every time ${c.sur(c.anchor.fav)} gets drafted, you do this.`],
            [c.anchor.who, 'Every time. Proudly.'],
            [rival, '*to the camera* Every. Single. Time.'],
          ],
        };
      },
      (c) => {
        const rival = FAN_RIVAL[c.anchor.who];
        if (!rival || !c.anchor.fav) return null;
        return {
          lines: [
            [rival, `@${HANDLE[c.anchor.who]} overrated. Fraud. There, I said it.`],
            [c.anchor.who, `*stands up* Say ${c.sur(c.anchor.fav)}’s name again. I dare you.`],
            [rival, 'Fraud.'],
            ['host', 'Okay. OKAY. Sit down. Nobody says anybody’s name again.', 'host'],
          ],
        };
      },
    ],
  },
  {
    id: 'kobe-defense',
    on: { lens: 'kobe' },
    variants: [
      () => ({
        lines: [
          ['shyman', '@Prabuckov twelve All-Defensive teams? Half of them on reputation.'],
          ['prab', '*stands up* Say that again, Matt. Slowly.'],
          ['shyman', 'Re. Pu. Ta. Tion.'],
          ['prab', 'Blocked. Unblocked so you can watch his highlights. Blocked again.'],
        ],
      }),
      () => ({
        lines: [
          ['batt', '@Prabuckov two ends, and Kobe played both. Finally someone at this desk I agree with.', 'cuts'],
          ['prab', 'Filippo, my brother. You can stay.'],
          ['jeremy', '*rolls his eyes* Get a room, you two.', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'not-michael',
    on: { lens: 'notMichael' },
    variants: [
      () => ({
        lines: [
          ['prab', '@May he’s not Michael. He’s BETTER at being Kobe.'],
          ['jeremy', 'That sentence means nothing.'],
          ['prab', 'It means everything, my friend.'],
        ],
      }),
      () => ({
        lines: [
          ['prab', '@May Kobe practised at 4 a.m. When did Michael practise?'],
          ['jeremy', 'In between rings, Mikhail.'],
          ['prab', '*long pause* …Next question.'],
        ],
      }),
    ],
  },
  {
    id: 'lakers-respect',
    on: { lens: 'lakers' },
    variants: [
      () => ({
        lines: [
          ['bannerman', '@Prabuckov purple and gold. Somebody count the banners again, he’s getting excited.'],
          ['prab', 'Seventeen, Igor. One behind. Start sweating.'],
          ['bannerman', '*fans himself* Sweating with joy, maybe. 🍀'],
        ],
      }),
    ],
  },
  {
    id: 'defense-loves',
    on: { category: DEFENSE, side: 'praise' },
    chance: 0.35,
    variants: [
      () => ({
        lines: [
          ['sosini', '@Shyman great, they get stops. Then they walk it up and take a contested long two. A stop is only worth what you do with it. 🥱'],
          ['shyman', 'A stop is a miss you FORCED, Mattia. Your guys give up 1.2 a trip and call it “pace”.'],
          ['sosini', 'My guys SCORE 1.2 a trip. Yours score when the other team forgets to show up.'],
          ['shyman', '*leans in* Seven-game series. Game 1 they find your worst defender. Game 3 he’s in every pick-and-roll. Game 5 he’s on the bench. Then we talk.'],
        ],
      }),
      () => ({
        lines: [
          ['lex', '@Shyman nobody buys a ticket to watch a charge.'],
          ['shyman', 'I do. I bought season tickets to watch charges.'],
          ['lex', 'That explains a lot, Matt.'],
        ],
      }),
      () => ({
        lines: [
          ['batt', '@Shyman fratello! Defense! Now tell me they score too and I’ll cry with you.', 'cuts'],
          ['shyman', 'One thing at a time, Filippo. Let me have this.'],
        ],
      }),
    ],
  },
  {
    id: 'boards-love',
    on: { category: ['rebounding'], side: 'praise' },
    variants: [
      () => ({
        lines: [
          ['sosini', '@Solinhakov rebounds are for teams that miss. 🥱'],
          ['solin', 'Everybody misses, Mattia. Even your podcast.'],
          ['sosini', 'My podcast has never missed an episode.'],
          ['solin', 'It has missed every listener.'],
        ],
      }),
      () => ({
        lines: [
          ['onoffsky', '*adjusts glasses* Second chances are worth more than people think. Davyd is right.', 'cuts'],
          ['solin', 'Davyd is ALWAYS right.'],
          ['sosini', 'Davyd is right once a season, and this is it. Enjoy it, big man. 🥱', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'bench-love',
    on: { category: ['rotation', 'depth'], side: 'praise' },
    variants: [
      () => ({
        lines: [
          ['lex', '@Rotation nice bench. Where are the stars?'],
          ['rotation', 'Some of them are ON the bench, Lex, resting. That’s the point.'],
          ['lex', 'Stars don’t rest.'],
          ['rotation', '*softly* Everybody rests, Lex.'],
        ],
      }),
    ],
  },
  {
    id: 'two-ends',
    chance: 0.6,
    on: { category: ['two_way'], side: 'praise' },
    variants: [
      () => ({
        lines: [
          ['shyman', '@Batterista finally, someone at this desk talks sense.', 'cuts'],
          ['batt', 'Matteo! Fratello! TWO ENDS!'],
          ['sosini', '🥱 The defense club has a new member. Thrilling.', 'cuts'],
        ],
      }),
    ],
  },
  {
    id: 'off-ball',
    on: { category: ['off_ball'], side: 'praise' },
    variants: [
      () => ({
        lines: [
          ['sosini', '@May off-ball movement? You mean standing in the corner for a three. It’s called modern basketball.'],
          ['jeremy', 'I mean running off three screens like Reggie. Look it up.'],
          ['sosini', 'Reggie shot threes, Jeremy. He was one of us.'],
          ['jeremy', '*long pause* …Leave Reggie out of this.'],
        ],
      }),
    ],
  },
  {
    id: 'one-ball',
    on: { category: ['usage'], side: 'concern' },
    variants: [
      () => ({
        lines: [
          ['lex', '@Eurostep one ball? Give it to the star and move on.'],
          ['zoran', 'Listen to me. Then four guys watch. In Europe, watching is for the fans.'],
          ['lex', 'In America, watching is for the role players.'],
        ],
      }),
      () => ({
        lines: [
          ['prab', '@Eurostep give it to the closer. Problem solved.'],
          ['zoran', '*hand on heart* Your answer to everything is one man, Mikhail.'],
          ['prab', 'And it works, my friend.'],
        ],
      }),
    ],
  },
  {
    id: 'eye-test',
    on: { category: ['fit', 'redundancy', 'position', 'cross'], side: 'concern' },
    chance: 0.6,
    variants: [
      () => ({
        lines: [
          ['solin', '@Onoffsky the spreadsheet says they don’t fit. My eyes say they’d fight anyone.'],
          ['onoffsky', 'Your eyes are not peer-reviewed, Davyd.'],
          ['solin', 'Neither is my elbow.'],
        ],
      }),
      () => ({
        lines: [
          ['jert', '@Onoffsky in my day nobody “fit”. You played. *slams the desk*'],
          ['onoffsky', '*adjusts glasses* In your day nobody even counted turnovers, Mattheus.'],
          ['jert', 'Because we didn’t TURN IT OVER.'],
        ],
      }),
    ],
  },
  {
    id: 'money-love',
    on: { category: ['fga'], side: 'praise' },
    variants: [
      () => ({
        lines: [
          ['lex', '@Natalie under budget means you left a star on the table.'],
          ['natalie', 'It means I left you a bench, Lex. You’re welcome.'],
          ['rotation', '*mouths “thank you” at Natalie*', 'cuts'],
        ],
      }),
    ],
  },
];

/** More ways each core argument can go, so the same roster type doesn't replay the same fight. */
const MORE_VARIANTS: Record<string, Variant[]> = {
  closer: [
    () => ({
      lines: [
        ['jert', '@Prabuckov closers. In my day we called that “the guy who shoots”. *slams the desk*'],
        ['prab', 'In your day the shot clock was a sundial, my friend.'],
        ['jert', 'It was NOT a sundial.'],
      ],
    }),
  ],
  'shooters-are-soft': [
    () => ({
      lines: [
        ['binash', '@Sosini Bird didn’t need four shooters around him. He WAS four shooters.'],
        ['sosini', 'Bird took two threes a game, Jacob. We’ve been over this.'],
        ['binash', 'And I’ll keep bringing it up until you cry.'],
      ],
    }),
  ],
  'spacing-loves': [
    () => ({
      lines: [
        ['jert', '@Sosini threes, threes, threes. Basketball used to have a middle, kid.'],
        ['sosini', 'The middle is where possessions go to die. 🥱'],
        ['jert', '*slams the desk* The middle is where CHAMPIONS live.'],
      ],
    }),
    () => ({
      lines: [
        ['solin', '@Sosini nice. Now who sets the screens for all these artists?'],
        ['sosini', 'The screens set themselves, Davyd. It’s called spacing.'],
        ['solin', 'That sentence made my knees hurt.'],
      ],
    }),
  ],
  'stars-win': [
    () => ({
      lines: [
        ['rotation', '@Lex love you, man. Who plays the backup minutes?'],
        ['lex', 'Stars play forty-eight.'],
        ['rotation', '*whispers* Nobody plays forty-eight, Lex.'],
        ['jert', 'Wilt played forty-eight. Kids today.', 'cuts'],
        ['lex', 'See? Wilt gets it.'],
      ],
    }),
  ],
  'defense-is-a-hobby': [
    () => ({
      lines: [
        ['jert', '@Shyman in my day you’d foul a guy like that into next week.', 'cuts'],
        ['shyman', 'Mattheus, that’s assault.'],
        ['jert', 'That’s DEFENSE.'],
      ],
    }),
  ],
  'grown-men': [
    () => ({
      lines: [
        ['binash', '@Solinhakov 2004 grit? The Bad Boys would eat your 2004 for breakfast.'],
        ['solin', 'The Bad Boys were cosplay. We were the real thing.'],
        ['binash', '*stands up* Take that back.'],
        ['host', 'Sit down. Both of you. This is a basketball show, not a parking lot.', 'host'],
      ],
    }),
  ],
  'one-star': [
    (c) => ({
      lines: [
        ['prab', `@Lex one star is all you need if he’s a closer, my friend. Ask Kobe.`],
        ['lex', `Kobe had Shaq. ${c.sur(c.read.stars[0])} has a group chat.`],
        ['prab', '*long pause* …Next question.'],
      ],
    }),
  ],
  'six-rings': [
    () => ({
      lines: [
        ['lex', '@May six rings? LeBron made ten Finals. TEN.'],
        ['jeremy', 'And lost six of them, Lex. Michael never lost one.'],
        ['lex', 'Getting there is a skill.'],
        ['jeremy', '*takes off his glasses* So is winning.'],
      ],
    }),
  ],
  banners: [
    (c) => c.read.celtics.length !== 1 || c.read.celtics[0].playerName !== 'Bill Russell' ? null : ({
      lines: [
        ['jert', '@Bannerman finally, a Celtic I approve of.', 'cuts'],
        ['bannerman', 'Mattheus, my brother.'],
        ['sosini', '🥱 Two grandpas agreeing. Historic.', 'cuts'],
      ],
    }),
    (c) => c.read.celtics.length !== 1 || c.read.celtics[0].playerName === 'Bill Russell' ? null : ({
      lines: [
        ['prab', '@Bannerman one Celtic and you’re already crying?'],
        ['bannerman', 'One is all it takes. It’s in the DNA.'],
        ['prab', 'So is losing Game 7 to Kobe in 2010.'],
        ['bannerman', '*long pause* …We don’t talk about 2010.'],
      ],
    }),
  ],
  february: [
    () => ({
      lines: [
        ['jeremy', '@Rotation Michael never asked for a bench.'],
        ['rotation', 'Michael had Toni Kukoč coming off his bench, Jeremy.'],
        ['jeremy', '…That’s fair.'],
      ],
    }),
  ],
  'short-shorts': [
    () => ({
      lines: [
        ['onoffsky', '*adjusts glasses* Fun fact: teams in the ’80s played around a hundred possessions a game. Everyone ran.', 'cuts'],
        ['binash', 'SEE? We RAN, Mattia.'],
        ['sosini', 'Running to long twos. 🥱'],
      ],
    }),
  ],
  'mid-range': [
    () => ({
      lines: [
        ['binash', '@May the ’90s slowed the game to a crawl. Who enjoyed that?'],
        ['jeremy', 'Anyone who enjoys defense, Jacob.'],
        ['shyman', 'I enjoyed it. I enjoyed it a LOT.', 'cuts'],
      ],
    }),
  ],
  'whole-point': [
    () => ({
      lines: [
        ['zoran', '@Sosini modern? Listen to me. Europe played this way in 1995.'],
        ['sosini', 'Nobody was watching in 1995, Zoran.'],
        ['zoran', '*hand on heart* We were watching.'],
      ],
    }),
  ],
  moses: [
    () => ({
      lines: [
        ['binash', '@Jertcheck kids today wouldn’t survive one Pistons possession.', 'cuts'],
        ['sosini', 'Kids today would be in the bonus by the first timeout. 🥱', 'cuts'],
        ['jert', 'That’s called DEFENSE, Mattia.'],
      ],
    }),
  ],
  overpay: [
    () => ({
      lines: [
        ['rotation', '@Natalie that cap money was my bench. My whole bench.', 'cuts'],
        ['natalie', 'I know, Mark. I know. *hands him a tissue*'],
        ['rotation', 'Love you guys. I’m not okay.'],
      ],
    }),
  ],
};

export const BEEFS: readonly Beef[] = [
  ...CORE_BEEFS.map((b) => (MORE_VARIANTS[b.id] ? { ...b, variants: [...b.variants, ...MORE_VARIANTS[b.id]] } : b)),
  ...MORE_BEEFS,
];
