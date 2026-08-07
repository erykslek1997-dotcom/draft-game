import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';

const names = [
  'Michael Jordan', 'Kevin Durant', 'Larry Bird', 'Chris Paul', 'Paul Pierce',
  'Kyle Lowry', 'John Stockton', 'David Robinson', 'Hakeem Olajuwon', "Shaquille O'Neal",
  'Tim Duncan', 'Kareem Abdul-Jabbar', 'Stephen Curry', 'Kawhi Leonard', 'Kevin Garnett',
  'Steve Nash', 'Giannis Antetokounmpo', 'Joel Embiid', 'Paul George', 'LeBron James',
  'Jason Kidd', 'Shai Gilgeous-Alexander', 'Mark Price', 'Wilt Chamberlain', 'Bob McAdoo',
  'Anthony Davis', 'Magic Johnson', 'Luka Doncic', 'Kobe Bryant', 'Tracy McGrady',
  'Dwyane Wade', 'Dirk Nowitzki', 'Victor Wembanyama',
];

for (const name of names) {
  const spans = players.filter((p) => p.playerName === name);
  if (spans.length === 0) {
    console.log(name.padEnd(24), 'NOT FOUND');
    continue;
  }
  let best = spans[0];
  let bestTal = computeTalent(best);
  for (const s of spans) {
    const t = computeTalent(s);
    if (t > bestTal) { bestTal = t; best = s; }
  }
  console.log(name.padEnd(24), 'peakTAL', bestTal, 'span', best.spanLabel, 'FGA', best.fga, 'archetype', best.offensiveArchetype);
}
