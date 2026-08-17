import { pickForAi } from '../src/engine/aiDrafter';
import { activeDraftPool } from '../src/engine/draft';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { displayTalentForSpan, tierContextFor } from '../src/engine/grades';
import { CAP_LIMIT } from '../src/engine/positions';
import { optimizeSpans } from '../src/engine/spanOptimizer';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function pick(name: string, spanLabel: string): PlayerSpan {
  const player = activeDraftPool.find(
    (candidate) => normalizePlayerName(candidate.playerName) === normalizePlayerName(name) && candidate.spanLabel === spanLabel,
  );
  if (!player) throw new Error(`Missing backup-quality fixture: ${name}, ${spanLabel}`);
  return player;
}

// Exact browser-reported board immediately before pick #83. All spans of an already-selected
// player are unavailable in the real draft, so names (rather than the displayed representative
// span alone) are excluded here exactly as draft.ts does.
const pickedBefore83 = [
  'Larry Bird', 'LeBron James', 'Stephen Curry', 'Nikola Jokic', 'Kevin Durant', 'Michael Jordan',
  "Shaquille O'Neal", 'James Harden', 'Hakeem Olajuwon', 'Shai Gilgeous-Alexander', 'Joel Embiid',
  'Kevin Garnett', 'David Robinson', 'Magic Johnson', 'Giannis Antetokounmpo', 'Kareem Abdul-Jabbar',
  'Steve Nash', 'Chris Paul', 'Anthony Davis', 'Kawhi Leonard', 'Tim Duncan', 'Victor Wembanyama',
  'Dwight Howard', 'Dirk Nowitzki', 'Karl Malone', 'John Stockton', 'Andrei Kirilenko', 'Wilt Chamberlain',
  'Dwyane Wade', 'Kobe Bryant', 'Bill Walton', 'Bam Adebayo', 'Draymond Green', 'Paul George',
  'Charles Barkley', 'Rasheed Wallace', 'Tracy McGrady', 'Paul Pierce', 'Manu Ginobili', 'Rudy Gobert',
  'Grant Hill', 'Ray Allen', 'Gary Payton', 'Anthony Edwards', 'Chris Webber', 'Kristaps Porzingis',
  'Clyde Drexler', 'Eddie Jones', 'Al Horford', 'Scottie Pippen', 'Shawn Marion', 'Mark Price',
  'Jayson Tatum', 'Chris Mullin', 'Evan Mobley', 'Kyle Lowry', 'Reggie Miller', 'Khris Middleton',
  'DeMarcus Cousins', 'Bobby Jones', 'Terry Porter', 'Yao Ming', 'Jason Kidd', 'Luka Doncic',
  'Mookie Blaylock', 'Sidney Moncrief', 'Andre Iguodala', 'Metta World Peace', 'Steve Francis',
  'Danny Green', 'Chet Holmgren', 'Vince Carter', 'Klay Thompson', 'Shane Battier', 'Dana Barros',
  'David Wesley', 'Jrue Holiday', 'Gilbert Arenas', 'Alonzo Mourning', 'Jimmy Butler',
  'Detlef Schrempf', 'Cedric Maxwell',
];

const roster = [
  pick('Magic Johnson', '1988-90'),
  pick('Anthony Davis', '2018-20'),
  pick('Kristaps Porzingis', '2022-24'),
  pick('Shawn Marion', '2002-04'),
  pick('Gilbert Arenas', '2005-07'),
];
const draftedNames = new Set(pickedBefore83.map(normalizePlayerName));
const available = activeDraftPool.filter((candidate) => !draftedNames.has(normalizePlayerName(candidate.playerName)));
const currentFgas = roster.map((player) => player.fga);

function bestPoolTalent(name: string): number {
  return Math.max(
    ...activeDraftPool
      .filter((candidate) => normalizePlayerName(candidate.playerName) === normalizePlayerName(name))
      .map((candidate) => displayTalentForSpan(tierContextFor(candidate))),
  );
}

const originalRandom = Math.random;
const outcomes = new Map<string, PlayerSpan>();
try {
  // Thirty midpoint samples cover every interval of the weighted five-candidate lottery
  // (weights 5+4+3+2+1 = 15), including its lowest-weight tail, without making `npm test`
  // repeat the full draft evaluation hundreds of times.
  for (let step = 0; step < 30; step++) {
    Math.random = () => (step + 0.5) / 30;
    const selected = pickForAi(roster, currentFgas, available, 16, 83);
    outcomes.set(normalizePlayerName(selected.playerName), selected);
  }
} finally {
  Math.random = originalRandom;
}

console.log(
  [...outcomes.values()].map((player) => ({
    player: player.playerName,
    span: player.spanLabel,
    talent: displayTalentForSpan(tierContextFor(player)),
    fga: player.fga,
  })),
);

check(!outcomes.has(normalizePlayerName('Danny Young')), 'TAL 40 Danny Young cannot win the pick-83 backup-PG lottery');
check(
  [...outcomes.values()].every((player) => bestPoolTalent(player.playerName) >= 52 || player.fga < 2),
  'every material-minute lottery outcome has a playable span above the backup quality floor or is true sub-2-FGA cap glue',
);

// The draft chooses a player name first and GameShell optimizes every AI player's real span once
// the roster is complete. Use the exact remaining two names from the reported roster and keep the
// old expensive Arenas pick as a deliberately conservative cap fixture: Nate still resolves to
// his playable 1988-90 span rather than remaining the cheap TAL-49 representative selected at #83.
const nateRepresentative = outcomes.get(normalizePlayerName('Nate McMillan'));
check(nateRepresentative, 'the corrected pick-83 lottery contains Nate McMillan');
const optimizedReportedRoster = optimizeSpans([
  ...roster,
  nateRepresentative,
  pick('Robert Horry', '1997-99'),
  pick('Thabo Sefolosha', '2014-16'),
]);
const optimizedNate = optimizedReportedRoster.find(
  (player) => normalizePlayerName(player.playerName) === normalizePlayerName('Nate McMillan'),
);
check(
  optimizedNate && displayTalentForSpan(tierContextFor(optimizedNate)) >= 52,
  'post-draft span optimization turns the selected backup PG into a genuinely playable span',
);

const rosterBefore78 = roster.slice(0, 4);
const draftedBefore78 = new Set(pickedBefore83.slice(0, 77).map(normalizePlayerName));
const availableBefore78 = activeDraftPool.filter((candidate) => !draftedBefore78.has(normalizePlayerName(candidate.playerName)));
const fgasBefore78 = rosterBefore78.map((player) => player.fga);
const spentBefore78 = fgasBefore78.reduce((sum, fga) => sum + fga, 0);
const outcomes78 = new Map<string, PlayerSpan>();
try {
  for (let step = 0; step < 30; step++) {
    Math.random = () => (step + 0.5) / 30;
    const selected = pickForAi(rosterBefore78, fgasBefore78, availableBefore78, 16, 78);
    outcomes78.set(normalizePlayerName(selected.playerName), selected);
  }
} finally {
  Math.random = originalRandom;
}
console.log('Pick 78 reserve-aware outcomes:', [...outcomes78.values()].map((player) => ({ player: player.playerName, fga: player.fga })));
check(!outcomes78.has(normalizePlayerName('Gilbert Arenas')), '20.9-FGA Arenas cannot consume the budget reserved for all three bench spots');
check(
  [...outcomes78.values()].every((player) => CAP_LIMIT - spentBefore78 - player.fga >= 18 - 1e-9),
  'every fifth-starter lottery outcome leaves at least 18 FGA for a three-player bench',
);

console.log('AI backup-quality tests complete.');
