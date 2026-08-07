/**
 * Regenerates src/data/d1d2d3Allowlist.json — the unique player list drafted across three real
 * in-person "all-time draft" sessions the user ran with friends (D1/D2/D3), used by
 * buildDraftPool.ts's RESTRICT_TO_D1_D2_D3 override to temporarily limit the in-game pool to
 * exactly these, real-play-tested players instead of the normal talent/value-tier selection.
 *
 * The raw names below were extracted once from the user's own draft-log spreadsheets
 * (d1.xlsx/d2.xlsx/d3.xlsx, each row a real pick — player name + timestamp — across ~9 rounds x
 * several drafters) via a one-off pandas read of every "Pick*" column; those source files live
 * on the user's machine, not in this repo, so the extracted list is embedded here directly
 * rather than re-reading external files on every regen. Re-extract by hand (see git history of
 * this file, or ask the user to re-export) only if the source drafts change.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, '../src/data/d1d2d3Allowlist.json');

const RAW_NAMES: string[] = [
  "A.C. Green", "Aaron Gordon", "Aaron Nesmith", "Adrian Dantley", "Al Horford", "Alex Caruso", "Alex English", "Allan Houston", "Allen Iverson", "Alonzo Mourning", "Alperen Sengun", "Alvin Robertson", "Amar'e Stoudemire", "Amen Thompson", "Andre Iguodala", "Andrei Kirilenko", "Andrew Bogut", "Andrew Nembhard", "Andrew Wiggins", "Anthony Davis", "Anthony Edwards", "Anthony Mason", "Anthony Tolliver", "Antonio McDyess", "Artis Gilmore", "Arvydas Sabonis", "Ausar Thompson", "Austin Reaves", "Avery Bradley", "Bam Adebayo", "Ben Simmons", "Ben Wallace", "Bernard King", "Bill Russell", "Bill Walton", "Bismack Biyombo", "Blake Griffin", "Bo Outlaw", "Bob McAdoo", "Bobby Jones", "Bobby Phills", "Boris Diaw", "Brandon Ingram", "Brandon Roy", "Brent Barry", "Brook Lopez", "Bruce Bowen", "Bruce Brown", "Bryon Russell", "Buck Williams", "Cade Cunningham", "Cam Johnson", "Carmelo Anthony", "Cason Wallace", "Charles Barkley", "Charles Jones", "Charlie Ward", "Chauncey Sillos", "Chet Holmgren", "Chris Bosh", "Chris Mullin", "Chris Paul", "Chris Webber", "Clifford Robinson", "Clint Capela", "Clyde Drexler", "D.J Augustin", "DaMarcus Cousins", "Dale Ellis", "Damian Lillard", "Dan Majerle", "Danny Ainge", "Danny Granger", "Danny Green", "Darius Garland", "Darren Collison", "Dave Cowens", "David Robinson", "David Thompson", "David West", "Davion Mitchell", "DeAndre Jordan", "Deni Avdija", "Dennis Johnson", "Dennis Rodman", "Derek Fisher", "Derek Harper", "Deron Williams", "Derrick Rose", "Derrick White", "Desmond Bane", "Devin Booker", "Dikembe Mutombo", "Dillon Brooks", "Dirk Nowitzki", "Domantas Sabonis", "Dominique Wilkins", "Donovan Mitchell", "Donte DiVicenzo", "Donyell Marshall", "Dorian Finney Smith", "Doug Christie", "Draymond Green", "Dwight Howard", "Dwight Powell", "Dwyane Wade", "Dyson Daniels", "Ed Nealy", "Eddie Jones", "Elton Brand", "Eric Bledsoe", "Ervin Johnson", "Evan Mobley", "Fabricio Oberto", "Fred Hoiberg", "Fred VanVleet", "Gary Harris", "Gary Payton", "George Gervin", "George Hill", "Gerald Wallace", "Giannis Antetokounmpo", "Gilbert Arenas", "Glen Rice", "Gordon Hayward", "Grant Hill", "Grant Williams", "Hakeem Olajuwon", "Harrison Barnes", "Hasheem Thabeet", "Hassan Whiteside", "Hedo Turkoglu", "Herb Jones", "Hersey Hawkins", "Horace Grant", "Isaiah Hartenstein", "Isiah Thomas", "Ivica Zubac", "J.R. Smith", "JJ Redick", "JaVale McGee", "Jabari Smith Jr.", "Jack Sikma", "Jaden McDaniels", "Jalen Brunson", "Jalen Duren", "Jalen Suggs", "Jalen Williams", "Jamal Murray", "James Harden", "James Posey", "James Worthy", "Jaren Jackson Jr", "Jarred Vanderbilt", "Jarrett Allen", "Jason Kidd", "Jason Terry", "Jaylen Brown", "Jayson Tatum", "Jeff Hornacek", "Jerami Grant", "Jermaine O'Neal", "Jerry West", "Jimmy Butler", "Joakim Noah", "Joe Dumars", "Joe Ingles", "Joe Johnson", "Joel Anthony", "Joel Embiid", "John Havlicek", "John Starks", "John Stockton", "John Wall", "Jon Barry", "Josh Giddey", "Josh Hart", "Josh Smith", "Jrue Holiday", "Julius Erving", "Kareem Abdul-Jabbar", "Karl Anthony Towns", "Karl Malone", "Kawhi Leonard", "Kenny Smith", "Kentavious Caldwell-Pope", "Kenyon Martin", "Keon Ellis", "Kevin Durant", "Kevin Garnett", "Kevin Johnson", "Kevin Love", "Kevin McHale", "Kevon Looney", "Khris Middleton", "Kirk Hinrich", "Klay Thompson", "Kobe Bryant", "Kristaps Porzingis", "Kyle Korver", "Kyle Lowry", "Kyrie Irving", "LaMarcus Aldridge", "Lamar Odom", "Larry Bird", "Larry Nance", "Lauri Markkanen", "LeBron James", "Lonzo Ball", "Luguentz Dort", "Luka Doncic", "Luke Kornet", "Luol Deng", "Magic Johnson", "Malcolm Brogdon", "Manu Ginobili", "Marc Gasol", "Marcin Gortat", "Marcus Camby", "Marcus Smart", "Mario West", "Mark Eaton", "Mark Madsen", "Mark Price", "Matas Buzelis", "Matisse Thybulle", "Maxi Kleber", "Mehmet Okur", "Michael Cooper", "Michael Finley", "Michael Jordan", "Michael Ruffin", "Mikal Bridges", "Mike Conley", "Mike Miller", "Miles Bridges", "Miles McBride", "Mitch Richmond", "Mitchell Robinson", "Mookie Blaylock", "Moses Malone", "Myles Turner", "Nate Mcmillan", "Naz Reid", "Nene", "Nic Claxton", "Nickeil Alexander-Walker", "Nicolas Batum", "Nikola Jokić", "Norman Powell", "OG Anunoby", "Onyeka Okongwu", "Oscar Robertson", "Otto Porter", "PJ Brown", "PJ Tucker", "PJ Washington", "Pablo Prigioni", "Pascal Siakam", "Patrick Beverley", "Patrick Ewing", "Pau Gasol", "Paul George", "Paul Millsap", "Paul Pierce", "Paul Pressey", "Payton Pritchard", "Peja Stojakovic", "Penny Hardaway", "Raja Bell", "Rashard Lewis", "Rasheed Wallace", "Ray Allen", "Reggie Miller", "Richard Hamilton", "Richard Jefferson", "Rick Barry", "Rick Fox", "Robert Covington", "Robert Horry", "Robert Parish", "Ron Artest", "Royce O'Neale", "Rudy Gobert", "Rui Hachimura", "Russell Westbrook", "Ryan Hollins", "Sam Cassell", "Sam Hausser", "Scott Hastings", "Scottie Barnes", "Scottie Pippen", "Serge Ibaka", "Shai Gilgeous-Alexander", "Shane Battier", "Shaquile O'Neal", "Shaun Livingston", "Shawn Kemp", "Shawn Marion", "Sidney Moncrief", "Stephen Curry", "Steve Nash", "Steve Novak", "Steven Adams", "TR Dunn", "Tayshaun Prince", "Terry Porter", "Thabo Sefolosha", "Theo Ratliff", "Tim Duncan", "Toni Kukoc", "Tony Allen", "Tony Parker", "Torrey Craig", "Toumani Camara", "Tracy McGrady", "Trae Young", "Trevor Ariza", "Trey Murphy", "Tyrese Haliburton", "Tyrese Maxey", "Tyson Chandler", "Victor Oladipo", "Victor Wembanyama", "Vince Carter", "Vlade Divac", "Walker Kessler", "Walt Frazier", "Wesley Matthews", "Willis Reed", "Wilt Chamberlain", "Yao Ming",
];

/** Spreadsheet spelling -> our dataset's canonical spelling, for names that don't
 * normalize-match on their own (nicknames, abbreviation punctuation, suffix differences —
 * `normalizePlayerName` only strips accents/case, not punctuation or aliases). */
const NAME_CORRECTIONS: Record<string, string> = {
  'Cam Johnson': 'Cameron Johnson',
  'Chauncey Sillos': 'Chauncey Billups',
  'D.J Augustin': 'D.J. Augustin',
  'DaMarcus Cousins': 'DeMarcus Cousins',
  'Donte DiVicenzo': 'Donte DiVincenzo',
  'Dorian Finney Smith': 'Dorian Finney-Smith',
  'Jaren Jackson Jr': 'Jaren Jackson Jr.',
  'Karl Anthony Towns': 'Karl-Anthony Towns',
  'Otto Porter': 'Otto Porter Jr.',
  'PJ Brown': 'P.J. Brown',
  'PJ Tucker': 'P.J. Tucker',
  'PJ Washington': 'P.J. Washington',
  'Penny Hardaway': 'Anfernee Hardaway',
  'Sam Hausser': 'Sam Hauser',
  "Shaquile O'Neal": "Shaquille O'Neal",
  'TR Dunn': 'T.R. Dunn',
  'Trey Murphy': 'Trey Murphy III',
};

/** Confirmed zero rows in the full dataset (checked directly against players.ts, not guessed) —
 * excluded rather than corrected. All 4 are deep-bench/short-career players outside whatever
 * coverage threshold the auto-generation scripts used. */
const NO_DATA = new Set(['Hasheem Thabeet', 'Herb Jones', 'Mario West', 'Scott Hastings']);

const knownNames = new Set(players.map((p) => normalizePlayerName(p.playerName)));
const finalNames: string[] = [];
const stillMissing: string[] = [];
for (const raw of RAW_NAMES) {
  if (NO_DATA.has(raw)) continue;
  const candidate = NAME_CORRECTIONS[raw] ?? raw;
  if (knownNames.has(normalizePlayerName(candidate))) finalNames.push(candidate);
  else stillMissing.push(raw);
}

if (stillMissing.length > 0) {
  console.log('WARNING - no longer matching, dataset may have changed:', stillMissing);
}
console.log(`Allowlist size: ${finalNames.length} / ${RAW_NAMES.length} raw names (${NO_DATA.size} confirmed no-data, excluded)`);

fs.writeFileSync(OUT_FILE, JSON.stringify([...new Set(finalNames)].sort(), null, 2) + '\n');
console.log(`Wrote ${OUT_FILE}`);
