import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import type { ExpertId } from './desk';
import { teamsForSpan } from './spanTeams';

/**
 * 2026-10-15, the user's own lists: who each expert loves and can't stand. The characters are
 * fictional, but these tastes come from the user's league (with the players' consent), so they
 * behave like real people — Jertcheck calls Curry a fraud, Moonbat swears Drexler was better than
 * Jordan. On the roster, a favourite makes the expert gush and a nemesis makes him trash-talk;
 * whoever at the desk feels the opposite about that player answers (deskBeefs.ts `fan-crush`,
 * `nemesis`). Full names as in the data; accents and case don't matter.
 */

export const FAVOURITES: Partial<Record<ExpertId, string[]>> = {
  onoffsky: ['Steve Nash', 'Chris Paul', 'Nikola Jokic', 'Kevin Garnett', 'LeBron James', 'Tim Duncan', 'Hakeem Olajuwon', 'Larry Bird', 'Deron Williams', 'Stephen Curry', 'Russell Westbrook'],
  shyman: ['Allen Iverson', 'Michael Jordan', 'Nikola Jokic', 'Russell Westbrook', 'Moses Malone', 'Detlef Schrempf', 'John Stockton', 'Dwyane Wade', 'Stephen Curry'],
  sosini: ['Nikola Jokic', 'Luka Doncic', 'Drazen Petrovic', 'Victor Wembanyama', 'Monta Ellis', 'Vince Carter', 'Stephen Curry', 'Damian Lillard', 'Larry Bird', 'Reggie Miller', 'Tim Duncan', 'Dirk Nowitzki'],
  solin: ['Kobe Bryant', 'Giannis Antetokounmpo', 'Pau Gasol', 'Marc Gasol', 'Chauncey Billups', 'DeMar DeRozan', 'Dirk Nowitzki', 'Kawhi Leonard', 'Richard Hamilton', 'Ron Artest', 'Rasheed Wallace'],
  binash: ['Magic Johnson', 'Kareem Abdul-Jabbar', 'James Worthy', 'Byron Scott', 'Michael Cooper', 'Larry Bird', 'Kevin McHale'],
  jert: ['Reggie Miller', 'Shawn Kemp', 'Luka Doncic', 'Rudy Gobert', 'Jayson Tatum', 'Gary Payton', 'Terry Porter', 'Mark Price', 'Bobby Jones', 'Dennis Johnson', 'Jack Sikma', 'Walt Frazier', 'Jerry West', 'John Havlicek', 'Bob McAdoo', 'Terry Cummings', 'Jeff Hornacek', 'Kyrie Irving', 'Kiki Vandeweghe', 'Nicolas Batum', 'George Hill', 'Elton Brand', 'Chris Paul', 'Antonio McDyess', 'Bill Russell', 'Alex English', 'Fat Lever', 'John Stockton', 'Detlef Schrempf', 'Brad Daugherty', 'Alex Caruso', 'DeMar DeRozan', 'Isiah Thomas', 'Baron Davis', 'Al Horford', 'Vince Carter'],
  rotation: ['John Stockton', 'Karl Malone', 'Jeff Hornacek', 'Mark Eaton', 'Andrei Kirilenko', 'Manu Ginobili', 'Robert Horry'],
  batt: ['Manu Ginobili', 'Kawhi Leonard', 'Scottie Pippen', 'Jimmy Butler', 'Paul George', 'Andre Iguodala', 'Shawn Marion', 'Gary Payton', 'Dennis Johnson', 'Sidney Moncrief', 'Michael Cooper', 'Kobe Bryant', 'Michael Jordan', 'Hakeem Olajuwon', 'Tim Duncan', 'Kevin Garnett', 'Giannis Antetokounmpo', 'Andrei Kirilenko', 'Jaylen Brown', 'OG Anunoby', 'Mikal Bridges', 'Marco Belinelli', 'Danilo Gallinari'],
  prab: ['Derek Fisher', "Shaquille O'Neal", 'Pau Gasol', 'Lamar Odom', 'Rick Fox', 'Trevor Ariza', 'Robert Horry', 'Ron Artest', 'DeMar DeRozan', 'Devin Booker', 'Jayson Tatum', 'Paul George', 'Jimmy Butler', 'Kawhi Leonard', 'Dikembe Mutombo', 'Tony Parker'],
  bannerman: ['Larry Bird', 'Paul Pierce', 'Kevin Garnett', 'Bill Russell', 'John Havlicek', 'Kevin McHale', 'Robert Parish', 'Dennis Johnson', 'Jayson Tatum', 'Chris Paul', 'Joe Johnson'],
  natalie: ['James Harden', 'Hakeem Olajuwon', 'Yao Ming', 'Tracy McGrady', 'Chris Paul', 'Clint Capela', 'Manu Ginobili', 'Draymond Green', 'Fred VanVleet', 'Ben Wallace', 'Dennis Rodman'],
  jeremy: ['Michael Jordan', 'Scottie Pippen', 'Dennis Rodman', 'Reggie Miller', 'Patrick Ewing', 'Hakeem Olajuwon', 'Gary Payton', 'Shawn Kemp', 'Dikembe Mutombo', 'Grant Hill', 'Anfernee Hardaway', 'Alonzo Mourning', 'Clyde Drexler', 'Charles Barkley', 'Elton Brand', 'Michael Redd'],
  lex: ['LeBron James', 'Kevin Durant', 'Kawhi Leonard', 'Paul George', "Shaquille O'Neal", 'Wilt Chamberlain', 'Kareem Abdul-Jabbar', 'James Harden'],
  zoran: ['Drazen Petrovic', 'Arvydas Sabonis', 'Toni Kukoc', 'Vlade Divac', 'Peja Stojakovic', 'Dirk Nowitzki', 'Pau Gasol', 'Manu Ginobili', 'Tony Parker', 'Nikola Jokic', 'Luka Doncic', 'Giannis Antetokounmpo', 'Victor Wembanyama', 'Hakeem Olajuwon', 'Dikembe Mutombo', 'Deni Avdija'],
  rightwing: ['James Harden', 'Al Horford', 'Hakeem Olajuwon', 'Yao Ming'],
};

export const NEMESES: Partial<Record<ExpertId, string[]>> = {
  onoffsky: ['Patrick Ewing', 'Julius Erving', 'Kobe Bryant', 'Dominique Wilkins', 'Allen Iverson', 'Magic Johnson', 'Kareem Abdul-Jabbar', 'Isiah Thomas'],
  shyman: ['LeBron James', 'Elton Brand', 'Antonio McDyess', 'Marcus Morris', 'Markieff Morris'],
  sosini: ['Antonio McDyess', 'Elton Brand', 'Oscar Robertson', 'Elgin Baylor', 'Karl Malone', 'Bob McAdoo', 'George Mikan', 'Deni Avdija', 'Kendrick Perkins'],
  binash: ['Michael Jordan'],
  jert: ['LeBron James', 'Derrick White', 'James Harden', 'Trae Young', 'Wilt Chamberlain', 'Moses Malone', 'Elgin Baylor', 'Tim Hardaway', 'Oscar Robertson', 'Dominique Wilkins', 'Jrue Holiday', 'Rik Smits', 'Russell Westbrook', 'LaMarcus Aldridge', 'Ja Morant', 'Andre Miller', 'Mark Jackson', 'Dirk Nowitzki', 'Stephen Curry', 'Manu Ginobili', 'Carmelo Anthony', 'Zach Randolph', 'Nikola Jokic'],
  batt: ['Trae Young', "D'Angelo Russell", 'Jamal Crawford', 'Lou Williams', 'Jordan Poole', 'Carmelo Anthony', 'Steve Nash', 'Enes Freedom', 'Isaiah Thomas', 'Andrea Bargnani'],
  prab: ['Smush Parker', 'Kwame Brown', 'Paul Pierce', 'Kevin Garnett', 'Ray Allen', 'Dwight Howard', 'LeBron James',
    // 2026-10-29, the user: "Prabuckov jest hejterem każdego Francuza oprócz Tony Parkera"
    'Rudy Gobert', 'Boris Diaw', 'Nicolas Batum', 'Joakim Noah', 'Evan Fournier', 'Victor Wembanyama', 'Frank Ntilikina', 'Ian Mahinmi',
    'Ronny Turiaf', 'Mickael Pietrus', 'Johan Petro', 'Kevin Seraphin', 'Alexis Ajinca', 'Timothe Luwawu-Cabarrot', 'Guerschon Yabusele',
    'Bilal Coulibaly', 'Zaccharie Risacher', 'Alex Sarr', 'Killian Hayes', 'Sekou Doumbouya', 'Elie Okobo', 'Tariq Abdul-Wahad', 'Moussa Diabate', 'Theo Maledon'],
  natalie: ['Gilbert Arenas', 'Rashard Lewis', 'Joe Johnson', 'Chandler Parsons', 'Timofey Mozgov', 'Joakim Noah', 'Andrew Wiggins'],
  jeremy: ['LeBron James', 'Kobe Bryant', 'Isiah Thomas', 'Bill Laimbeer', 'Rick Mahorn'],
  lex: ['Derrick White', 'Alex Caruso', 'Robert Horry', 'Fred VanVleet', 'Dirk Nowitzki'],
  zoran: ['Andrea Bargnani', 'Darko Milicic', 'Allen Iverson', 'Russell Westbrook', 'Kobe Bryant'],
};

/** Whole teams an expert loves or hates (span codes from spanTeams.ts). */
export const TEAM_LOVE: Partial<Record<ExpertId, string[]>> = {
  rotation: ['UTA'],
  binash: ['LAL'],
  natalie: ['HOU'],
  rightwing: ['HOU'],
};
export const TEAM_HATE: Partial<Record<ExpertId, string[]>> = {
  rotation: ['LAL', 'MNL'],
};

/** How each expert gushes; `{p}` is the player's surname. */
export const FAV_LINES: Partial<Record<ExpertId, string[]>> = {
  sosini: ['{p}! His shot chart is my phone background, kiddo. Ask Aunt Rosa.', '{p}. Uncle Mattia has his jersey. Two of them.', '{p}. Range, taste, everything. Anyone who disagrees can log off.'],
  shyman: ['{p}. Good player. Simple.', '{p}! Love him. Don’t need to explain.', '{p}. Ballplayer.'],
  solin: ['{p}. Pure eye test. You just know.', '{p}! Grown man. You don’t need a spreadsheet for this one. Just eyes.', '{p}. Watch him for five minutes. That’s all the data you need.'],
  binash: ['{p}! Somebody pass me the short shorts. This is a holy day.', '{p}! Totally tubular, dudes. *finger guns at the camera*', '{p}. *dims the studio lights, puts on a synth track* Let me just enjoy this.'],
  jert: ['{p}. Underrated. I have kept a spreadsheet on him since 1998. 412 rows.', '{p}! Nobody talks about him. I talk about him. Every day. At 7:15.', '{p}. Exactly as good as I said. I checked. Three times.'],
  rotation: ['{p}! Love you guys. Love HIM more.', '{p}. *exhales* Finally somebody I trust in February.'],
  batt: ['{p}! Both ends! That’s a basketball player.', '{p}. Scores, guards, never takes a play off. Perfetto.'],
  onoffsky: ['{p}. *adjusts glasses* Full play-by-play, elite on/off. Statistically, my favourite human being.', '{p}. I made a spreadsheet about him. It has a spreadsheet of its own.'],
  bannerman: ['{p}! A Celtic legend! *already crying*', '{p}. *points at the ceiling* Banner energy.'],
  natalie: ['{p}! Value AND talent. I need a moment.', '{p}. Efficient. Beautiful. My kind of spreadsheet.'],
  jeremy: ['{p}! That’s ’90s basketball. Go watch the tape.', '{p}. Michael would’ve wanted him on his team.'],
  prab: ['{p}! My friend, that is a winner.', '{p}. Kobe would approve. KOBE.'],
  lex: ['{p}. A real star. The rest of the league should be afraid. They should be very afraid.', '{p}. Build the statue now. I’ll pick the spot.'],
  zoran: ['{p}! *hand on heart* The way he passes. The way he THINKS.', '{p}. Listen to me. This is basketball as art.'],
  rightwing: ['{p}. Finally, a sensible pick.', '{p}. Solid. Smart. No nonsense.'],
};

/** How each expert trash-talks a player he can't stand. Harsh, never a slur. */
export const HATE_LINES: Partial<Record<ExpertId, string[]>> = {
  sosini: ['{p}? Kiddo. He shoots like Aunt Rosa parallel parks.', '{p}. I had a poster. I took it down.', '{p} in 2026? Uncle Mattia says no. Firmly.'],
  shyman: ['{p}? No.', '{p}. Bum. That’s it.', '{p}. Can’t stand him.'],
  solin: ['{p}. Soft. Cupcake. Next.', '{p}? Eye test says no. Loudly.'],
  binash: ['{p}. Ugh. Totally bogus, dudes.', '{p}? Not rad. Not rad at all.'],
  jert: ['{p}? Empty calories. I calculated it. Per 100 possessions. Twice.', '{p}. Overrated. I have a 14-page document. Nobody has read it. It is correct.', '{p}. Overrated by people who never opened an almanac. I have opened all of them.'],
  rotation: ['{p}. Love you guys, but no. Not him.', '{p}? *shudders* Purple and gold. Get him away from me.'],
  batt: ['{p}? Half a player. Plays one end.', '{p}. One end, and not even that one well.'],
  prab: ['{p}? My friend, no. Kobe would never pass him the ball.', '{p}. *shakes head* Bum.'],
  onoffsky: ['{p}. *adjusts glasses* The on/off says fraud. Loudly.', '{p}? Folklore with a highlight reel. 🤓'],
  natalie: ['{p}? That contract still keeps me up at night. Fraud contract.', '{p}. Rules are rules, and he broke every one of them.'],
  jeremy: ['{p}? Go watch the tape. It’s not good.', '{p}. Michael would’ve eaten him alive.'],
  lex: ['{p}? Staff. He carries the bags for someone important.', '{p}. Who? Exactly. Nobody will remember him either.'],
  zoran: ['{p}. *hand on heart* He does not pass. He has never passed.', '{p}? Listen to me. No.'],
  rightwing: ['{p}? Small, slow, can’t guard a chair. Next.', '{p}. A turnstile in sneakers.'],
};

/** Player-specific lines that beat the templates (expert → normalized name → line). */
const SPECIAL: Partial<Record<ExpertId, Record<string, string>>> = {
  prab: {
    'Derek Fisher': 'Fisher. Point four seconds, my friend. 0.4. Look it up.',
    'Smush Parker': 'Smush Parker. Kobe had to play with SMUSH PARKER. I need a minute.',
    'Kwame Brown': 'Kwame Brown. Kobe threw him the ball and he dropped it. Every time. Trauma.',
    "Shaquille O'Neal": 'Shaq! Three rings with Kobe. Complicated? Sure. Baza? Also sure.',
    // 2026-10-29, the user: Gobert "francuska szmata", Mutombo "baza"
    'Rudy Gobert': 'Gobert? A French dish towel, my friend. Soft, wet, and he folds in the playoffs. Every year.',
    'Dikembe Mutombo': 'Mutombo. Baza. Finger wag, four DPOYs, no fear. Kobe respected him and so do I.',
    'Tony Parker': 'Tony Parker. The only Frenchman I trust. Four rings, a floater from heaven. Respect, my friend.',
    'Victor Wembanyama': 'Wembanyama? Eight feet of French cheese. Call me when he wins something.',
    'Boris Diaw': 'Diaw. French. Passes when he should shoot, shoots when he should pass. Classic.',
    'Nicolas Batum': 'Batum. French. Nice guy, I’m sure. Kobe would have eaten him for breakfast.',
    'Joakim Noah': 'Noah. French passport, French jump shot. Next.',
  },
  batt: {
    'Andrea Bargnani': 'Bargnani. *covers his face* We don’t talk about Bargnani.',
    'Manu Ginobili': 'Manu! Bologna, 2001. Two ends, mamma mia. Bellissimo.',
  },
  bannerman: {
    'Joe Johnson': 'Joe Johnson! Started in Boston, you know. 2001. We should never have traded him. 🍀',
    'Chris Paul': 'Chris Paul. Not a Celtic. Should’ve been. I’ve made my peace with it. 🍀',
  },
  jeremy: {
    'Isiah Thomas': 'Isiah. Walked off without shaking hands in ’91. I never forgot. Never.',
    'Clyde Drexler': 'Drexler. Great player. Not Michael. Nobody is.',
  },
  onoffsky: {
    'Russell Westbrook': 'Westbrook. *sighs* I know. I KNOW the numbers. I love him anyway. Don’t look at me.',
  },
  sosini: {
    'Larry Bird': 'Bird is the only ’80s guy I’d let into 2026. He shot.',
    'Reggie Miller': 'Reggie. Ran off screens before it was cool. Basically modern. Respect.',
  },
  natalie: {
    'James Harden': 'Harden! Step-back threes and free throws: the two most efficient shots in basketball. Rules are rules.',
    'Joe Johnson': 'Joe Johnson. 119 million dollars. I still have the receipt. I look at it when I can’t sleep.',
  },
  rightwing: {
    'James Harden': 'Harden. Efficient. Sensible. Free throws are points, people.',
    'Al Horford': 'Horford. Does everything right. Nobody notices. I notice.',
  },
  binash: {
    'Michael Jordan': 'Jordan. Ugh. The guy who ended the ’80s. I will never forgive him.',
  },
  jert: {
    'Wilt Chamberlain': 'Wilt. Fifty a game and two rings. Empty calories. Russell won eleven guarding him.',
    'Reggie Miller': 'Reggie Miller. The GOAT. Yes, THE GOAT. I don’t have to explain myself.',
    'Oscar Robertson': 'Oscar. Triple-double season, sure. Jerry West did more with less, and he’s on the logo.',
    'Dominique Wilkins': 'Wilkins? Alex English was better. Look it up.',
  },
  solin: {
    'DeMar DeRozan': 'DeRozan. That mid-range. Elbow, fadeaway, bucket. Pure eye test. Beautiful.',
    'Kobe Bryant': 'Kobe. The fadeaway. Footwork from another planet. Eye test, case closed.',
    'Dirk Nowitzki': 'Dirk. One-legged fadeaway. Unguardable. You don’t need numbers, just eyes.',
    'Kawhi Leonard': 'Kawhi. Mid-range, slow, mean, perfect. Grown man.',
    'Richard Hamilton': 'Rip Hamilton. Runs off screens all night, mid-range all night. 2004. Beautiful.',
  },
  rotation: {
    'Karl Malone': 'Malone! Utah! Pick-and-roll with Stockton, eighteen years of it. Love you guys.',
  },
  shyman: {
    'Allen Iverson': 'Iverson. Heart. Guts. Love him.',
  },
};

/** Moonbat's own picks, each with the dumbest possible reason. */
export const MOONBAT_TAKES: Record<string, string> = {
  'Clyde Drexler': 'drexler > jordan. always was. always will be.',
  'Brandon Roy': 'brandon roy > kobe. do ur research',
  'Patrick Ewing': 'ewing. best center of the 90s. not close',
  'Darko Milicic': 'darko. tall guys are worth double',
  'Dennis Rodman': 'rodman. the hair. green, blue, whatever',
  'Ben Wallace': 'ben wallace. the afro alone is worth 10 points',
  'Boban Marjanovic': 'boban. biggest hands in the league. hands = buckets',
  'Nate Robinson': 'nate robinson. 3 dunk contests. that’s 3 rings basically',
  'JaVale McGee': 'javale. 3 rings. same as jordan’s first three-peat',
  'Manute Bol': 'manute bol. tallest guy ever AND shot threes. ahead of his time',
  'Muggsy Bogues': 'muggsy. defenders literally can’t see him',
  'Shawn Bradley': 'shawn bradley. 7’6”. posters don’t count if you’re that tall',
  'Brian Scalabrine': 'scalabrine. white mamba. undefeated in my heart',
  'Robert Horry': 'horry. 7 rings. more than jordan. case closed',
  'Kwame Brown': 'kwame. number 1 pick. that’s what number 1 means',
  'Anthony Bennett': 'anthony bennett. number 1 pick. so the best',
  'Greg Oden': 'oden. looked 40 at 19. experience',
  'Lance Stephenson': 'lance. blew in lebron’s ear. psychological warfare',
  'Mark Madsen': 'mark madsen. the parade dance. that’s leadership',
  'Gheorghe Muresan': 'muresan. was in a movie. range',
  'Yao Ming': 'yao. tall AND from far away. double value',
  'Tim Duncan': 'duncan. boring. zero tattoos. pass',
  'Kawhi Leonard': 'kawhi. never smiles. suspicious',
  'Steve Nash': 'nash. hair too long. can’t trust it',
  'Kevin Durant': 'durant. too many burner accounts',
  'Kyle Korver': 'korver. never dunks. what’s the point',
};

/** Who answers each of Moonbat's picks, and how (the rest get Rightwing's default). */
export const MOONBAT_ANSWERS: Record<string, [ExpertId, string][]> = {
  'Clyde Drexler': [['jeremy', '@Moonbat 1992 Finals. Michael hit six threes in one half and shrugged AT Drexler, Bart.'], ['moonbat', 'shrugging isn’t a stat']],
  'Brandon Roy': [['prab', '@Moonbat *takes off his mic and walks off set*'], ['host', 'Mikhail has left the building. Thanks, Bart.']],
  'Patrick Ewing': [['shyman', '@Moonbat Hakeem. 1994. Finals. Done.'], ['jeremy', '…Ewing was really good, though. I’ll say it.']],
  'Robert Horry': [['rightwing', '@Moonbat Bart, by that logic Horry is better than Jordan.'], ['moonbat', 'yes']],
  'Tim Duncan': [['rightwing', '@Moonbat five rings, Bart. Five.'], ['moonbat', 'zero tattoos though']],
};

const key = (name: string) => normalizePlayerName(name);
const asKeys = (list: Partial<Record<ExpertId, string[]>>) =>
  Object.fromEntries(Object.entries(list).map(([who, names]) => [who, new Set(names!.map(key))])) as Partial<Record<ExpertId, Set<string>>>;
const FAV_KEYS = asKeys(FAVOURITES);
const NEMESIS_KEYS = asKeys(NEMESES);
const SPECIAL_KEYS: Partial<Record<ExpertId, Map<string, string>>> = Object.fromEntries(
  Object.entries(SPECIAL).map(([who, lines]) => [who, new Map(Object.entries(lines!).map(([n, l]) => [key(n), l]))]),
);
const MOONBAT_KEYS = new Map(Object.entries(MOONBAT_TAKES).map(([n, l]) => [key(n), { name: n, line: l }]));

const codes = (p: PlayerSpan) => teamsForSpan(p).map((t) => t.code);
export function loves(who: ExpertId, p: PlayerSpan): boolean {
  return FAV_KEYS[who]?.has(key(p.playerName)) === true || (TEAM_LOVE[who]?.some((c) => codes(p).includes(c)) ?? false);
}
/** A named nemesis (not just a player from a team he hates). */
export function hatesByName(who: ExpertId, p: PlayerSpan): boolean {
  return NEMESIS_KEYS[who]?.has(key(p.playerName)) === true;
}
export function hates(who: ExpertId, p: PlayerSpan): boolean {
  return NEMESIS_KEYS[who]?.has(key(p.playerName)) === true || (TEAM_HATE[who]?.some((c) => codes(p).includes(c)) ?? false);
}
/** The desk's experts who love / hate this player. */
export const fansOf = (p: PlayerSpan, except?: ExpertId) => (Object.keys(FAV_KEYS) as ExpertId[]).concat(Object.keys(TEAM_LOVE) as ExpertId[]).filter((w, i, a) => a.indexOf(w) === i && w !== except && loves(w, p));
export const hatersOf = (p: PlayerSpan, except?: ExpertId) => (Object.keys(NEMESIS_KEYS) as ExpertId[]).concat(Object.keys(TEAM_HATE) as ExpertId[]).filter((w, i, a) => a.indexOf(w) === i && w !== except && hates(w, p));

/** The special line for this expert and player, if there is one. */
export function specialLine(who: ExpertId, p: PlayerSpan): string | undefined {
  return SPECIAL_KEYS[who]?.get(key(p.playerName));
}
/** Moonbat's pick on this roster, if any (name as listed, line). */
export function moonbatPicks(roster: PlayerSpan[]): { name: string; line: string }[] {
  return roster.map((p) => MOONBAT_KEYS.get(key(p.playerName))).filter((x): x is { name: string; line: string } => x !== undefined);
}
/** Every name the tastes mention (tests check they exist in the data). */
export function allTasteNames(): string[] {
  return [
    ...Object.values(FAVOURITES).flat(), ...Object.values(NEMESES).flat(),
    ...Object.values(SPECIAL).flatMap((m) => Object.keys(m!)), ...Object.keys(MOONBAT_TAKES),
  ] as string[];
}
