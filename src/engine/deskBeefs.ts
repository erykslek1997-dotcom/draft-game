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
  | 'preTwoK' | 'noPreTwoK' | 'stars' | 'noStars' | 'oneStar' | 'international' | 'steal' | 'overpay';

export interface BeefCtx {
  read: RosterRead;
  /** Surname the way the desk says it. */
  sur: (p: PlayerSpan) => string;
  /** Up to `n` surnames as a list ("Bird, McHale and Parish"). */
  names: (ps: PlayerSpan[], n?: number) => string;
  /** A rostered player by full name. */
  has: (name: string) => PlayerSpan | undefined;
  caps: (p: PlayerSpan) => number;
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
  /** Each variant returns null when this roster doesn't fit it. */
  variants: ((c: BeefCtx) => BeefThread | null)[];
}

const DEFENSE: readonly InsightCategory[] = ['perimeter_defense', 'rim_protection', 'defensive_structure'];

export const BEEFS: readonly Beef[] = [
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
          ['jert', 'Kids today can’t spell “box out”.'],
          ['onoffsky', '*adjusts glasses* Technically, rebounding percentage in that era was—', 'cuts'],
          ['jert', 'NOBODY asked, Jake.'],
        ],
      }),
      () => ({
        lines: [
          ['onoffsky', '*adjusts glasses* Note: blocks and steals weren’t even tracked before 1973. We are guessing.', 'cuts'],
          ['jert', 'I don’t need a stat sheet. I have EYES.'],
          ['onoffsky', 'Eyes have a margin of error, Mattheus.'],
          ['jert', '*slams the desk*'],
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
          ['shyman', 'And give up 145. STOPS, Lex. Remember stops? I have nightmares about this roster.'],
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
